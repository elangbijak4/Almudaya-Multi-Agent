import { redactRecursively } from '../../execution/environment.js';
import {
  computeContentHash,
  deriveIdempotencyKey,
  deriveMemoryEventId,
} from '../contracts/identity.js';
import {
  type KnowledgeId,
  type KnowledgeLifecycleStatus,
  type KnowledgeObject,
  type KnowledgeRelation,
  type KnowledgeTreeNode,
  type MemoryEvent,
  type MemoryLifecyclePlan,
  type MemoryLifecycleRequest,
  type ProjectMemoryUniverse,
  type ProjectUniverseId,
  type TreeNodeId,
} from '../contracts/types.js';
import { ProjectMemoryUniverseService } from '../pmu/project-memory-universe.js';
import type { IMemoryLifecycleManager } from '../ports/lifecycle.js';
import type { IPKUStore } from '../ports/pku-store.js';

export class LifecycleSafetyError extends Error {
  public readonly code = 'LIFECYCLE_SAFETY_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleSafetyError';
  }
}

export interface ExportedUniverseBundle {
  exportedAt: string;
  universe: ProjectMemoryUniverse | null;
  knowledgeObjects: KnowledgeObject[];
  treeNodes: KnowledgeTreeNode[];
  relations: KnowledgeRelation[];
  events: MemoryEvent[];
}

/**
 * Memory Lifecycle Management Service (Phase 8 — Spec v0.2 §2.6 & §10, PKU-015, PKU-016, PKU-017).
 *
 * Supports lifecycle states:
 * - `active`, `dormant`, `archived`, `reusable`, `deleted`, `purged`
 *
 * Supports safe lifecycle operations:
 * - `archive`, `restore`, `prune`, `detach`, `soft_delete`, `purge`, `reuse`, `fork`, `export`, `merge`
 *
 * Enforces:
 * - Separation of structural pruning/detachment from physical deletion (`PKU-015`)
 * - Full data & provenance recovery on `soft_delete` -> `restore` before `purge` (`PKU-016`)
 * - Reference counting & external dependency protection blocking unsafe `purge` (`PKU-017`)
 * - Mandatory explicit confirmation token for destructive operations
 */
export class MemoryLifecycleService implements IMemoryLifecycleManager {
  private readonly pkuStore: IPKUStore;
  private readonly pmuService: ProjectMemoryUniverseService;
  private readonly customSecrets: string[];

  constructor(
    pkuStore: IPKUStore,
    pmuService?: ProjectMemoryUniverseService,
    options: { customSecrets?: string[] } = {}
  ) {
    this.pkuStore = pkuStore;
    this.customSecrets = options.customSecrets ?? [];
    this.pmuService =
      pmuService ?? new ProjectMemoryUniverseService(pkuStore, { customSecrets: this.customSecrets });
  }

  /**
   * Generates a deterministic confirmation token for a planned lifecycle operation.
   */
  public static createConfirmationToken(plan: MemoryLifecyclePlan): string {
    return `CONFIRM:${plan.request.operation}:${plan.request.projectUniverseId}`;
  }

  /**
   * Analyzes dependencies, shared tree memberships, and cross-project/external references
   * to produce a safe `MemoryLifecyclePlan` before execution.
   */
  public async plan(request: MemoryLifecycleRequest): Promise<MemoryLifecyclePlan> {
    const targetIds = new Set<KnowledgeId>(request.targetIds ?? []);
    const targetTreeNodeIds = new Set<TreeNodeId>(request.targetTreeNodeIds ?? []);

    // If tree nodes are targeted (e.g. for prune or detach), collect their member knowledgeIds
    if (targetTreeNodeIds.size > 0 && this.pkuStore.listTreeNodes) {
      const allTreeNodes = await this.pkuStore.listTreeNodes(request.projectUniverseId);
      for (const node of allTreeNodes) {
        if (targetTreeNodeIds.has(node.nodeId)) {
          for (const kid of node.knowledgeIds) {
            targetIds.add(kid);
          }
        }
      }
    }

    // If no specific targetIds were given for universe-wide archive/export/fork/merge, collect universe objects
    if (
      targetIds.size === 0 &&
      (request.operation === 'archive' ||
        request.operation === 'export' ||
        request.operation === 'fork' ||
        request.operation === 'merge')
    ) {
      const res = await this.pkuStore.queryKnowledge({
        projectUniverseIds: [request.projectUniverseId],
        includeArchived: true,
      });
      for (const item of res.items) {
        targetIds.add(item.id);
      }
    }

    const protectedKnowledgeIds = new Set<KnowledgeId>();
    const externalReferences: string[] = [];

    // Inspect all universes to find external or non-targeted references pointing to targetIds
    const allUniverses = await this.pkuStore.listUniverses();
    const universeIdsToScan = Array.from(
      new Set([request.projectUniverseId, ...allUniverses.map((u) => u.id)])
    );

    const allActiveObjects: KnowledgeObject[] = [];
    for (const uid of universeIdsToScan) {
      const q = await this.pkuStore.queryKnowledge({
        projectUniverseIds: [uid],
        includeArchived: true,
      });
      allActiveObjects.push(...q.items);
    }

    for (const candidateId of targetIds) {
      const obj = await this.pkuStore.getKnowledge(candidateId);
      if (!obj) continue;

      // 1. Check relations pointing to/from candidateId
      const rels = this.pkuStore.getRelations
        ? await this.pkuStore.getRelations(candidateId)
        : [];

      for (const rel of rels) {
        const otherId = rel.fromId === candidateId ? rel.toId : rel.fromId;
        if (targetIds.has(otherId)) {
          continue;
        }
        const otherObj = await this.pkuStore.getKnowledge(otherId);
        if (!otherObj || otherObj.lifecycleStatus === 'purged') {
          continue;
        }

        // If otherObj is in a DIFFERENT universe, or if otherObj depends_on / reuses / derived_from candidateId
        const isCrossUniverse = otherObj.projectUniverseId !== request.projectUniverseId;
        const isInboundDependency = rel.toId === candidateId && rel.fromId === otherId;

        if (isCrossUniverse || isInboundDependency) {
          protectedKnowledgeIds.add(candidateId);
          externalReferences.push(
            `${otherObj.projectUniverseId}:${otherObj.id} (${rel.relationType} -> ${candidateId})`
          );
        }
      }

      // 2. Also scan other objects' metadata (`reusedFromKnowledgeId`, `forkedFromKnowledgeId`)
      for (const otherObj of allActiveObjects) {
        if (targetIds.has(otherObj.id)) continue;
        const reusedFrom = otherObj.metadata?.['reusedFromKnowledgeId'];
        const forkedFrom = otherObj.metadata?.['forkedFromKnowledgeId'];
        if (reusedFrom === candidateId || forkedFrom === candidateId) {
          protectedKnowledgeIds.add(candidateId);
          const refLabel = `${otherObj.projectUniverseId}:${otherObj.id} (metadata ref -> ${candidateId})`;
          if (!externalReferences.includes(refLabel)) {
            externalReferences.push(refLabel);
          }
        }
      }

      // 3. Check shared tree node membership if pruning/detaching specific tree nodes
      if (
        (request.operation === 'prune' || request.operation === 'detach') &&
        targetTreeNodeIds.size > 0
      ) {
        const nonTargetTreeNodes = (obj.treeNodeIds ?? []).filter(
          (tid) => !targetTreeNodeIds.has(tid)
        );
        if (nonTargetTreeNodes.length > 0 || rels.length > 0) {
          protectedKnowledgeIds.add(candidateId);
        }
      }
    }

    const requiresExplicitConfirmation =
      request.operation === 'purge' ||
      request.operation === 'soft_delete' ||
      request.operation === 'prune' ||
      request.operation === 'merge';

    const irreversible = request.operation === 'purge';

    return {
      request,
      affectedKnowledgeIds: Array.from(targetIds),
      ...(targetTreeNodeIds.size > 0
        ? { affectedTreeNodeIds: Array.from(targetTreeNodeIds) }
        : {}),
      protectedKnowledgeIds: Array.from(protectedKnowledgeIds),
      externalReferences,
      requiresExplicitConfirmation,
      irreversible,
    };
  }

  /**
   * Executes a validated `MemoryLifecyclePlan` with safety checks and immutable audit logging.
   */
  public async execute(
    plan: MemoryLifecyclePlan,
    confirmationToken?: string
  ): Promise<void> {
    const { request } = plan;

    if (request.dryRun) {
      await this.recordLifecycleAuditEvent(plan, 'dry_run');
      return;
    }

    if (plan.requiresExplicitConfirmation) {
      if (!confirmationToken || !confirmationToken.trim()) {
        throw new LifecycleSafetyError(
          `Operation "${request.operation}" requires an explicit confirmationToken.`
        );
      }
    }

    // Critical Safeguard (PKU-017): Block purge when external references or protected dependencies exist
    // unless `includeSharedDependencies === true` was explicitly authorized in the request.
    if (request.operation === 'purge') {
      if (
        (plan.externalReferences.length > 0 || plan.protectedKnowledgeIds.length > 0) &&
        request.includeSharedDependencies !== true
      ) {
        throw new LifecycleSafetyError(
          `Cannot purge knowledge objects [${plan.protectedKnowledgeIds.join(', ')}]: blocked by active external references [${plan.externalReferences.join('; ')}]. Resolve references first or explicitly authorize shared dependency policy.`
        );
      }
    }

    switch (request.operation) {
      case 'archive':
        await this.transitionObjectsStatus(plan.affectedKnowledgeIds, 'archived', request);
        break;

      case 'soft_delete':
        await this.transitionObjectsStatus(plan.affectedKnowledgeIds, 'deleted', request);
        break;

      case 'restore':
        await this.restoreObjects(plan.affectedKnowledgeIds, request);
        break;

      case 'purge':
        await this.purgeObjects(plan.affectedKnowledgeIds, request);
        break;

      case 'prune':
      case 'detach':
        await this.detachFromTreeNodes(
          request.projectUniverseId,
          plan.affectedTreeNodeIds ?? [],
          plan.affectedKnowledgeIds
        );
        break;

      case 'reuse': {
        if (!request.destinationUniverseId) {
          throw new LifecycleSafetyError(
            'Operation "reuse" requires destinationUniverseId in MemoryLifecycleRequest.'
          );
        }
        await this.pmuService.reuseKnowledgeAcrossProjects({
          sourceUniverseId: request.projectUniverseId,
          targetUniverseId: request.destinationUniverseId,
          sourceKnowledgeIds: plan.affectedKnowledgeIds,
          mode: 'reference',
          requestedBy: request.requestedBy,
        });
        break;
      }

      case 'fork': {
        const destKey = request.destinationUniverseId ?? `${request.projectUniverseId}_fork`;
        await this.pmuService.forkProjectUniverse({
          sourceUniverseId: request.projectUniverseId,
          newProjectKey: destKey,
          newDisplayName: `Fork of ${request.projectUniverseId}`,
          description: request.reason,
          requestedBy: request.requestedBy,
        });
        break;
      }

      case 'merge': {
        if (!request.destinationUniverseId) {
          throw new LifecycleSafetyError(
            'Operation "merge" requires destinationUniverseId in MemoryLifecycleRequest.'
          );
        }
        await this.pmuService.reuseKnowledgeAcrossProjects({
          sourceUniverseId: request.projectUniverseId,
          targetUniverseId: request.destinationUniverseId,
          sourceKnowledgeIds: plan.affectedKnowledgeIds,
          mode: 'copy',
          requestedBy: request.requestedBy,
          allowNonReusableOverride: true,
        });
        break;
      }

      case 'export':
        // Export is read-only; audit event recorded below
        break;
    }

    await this.recordLifecycleAuditEvent(plan, 'executed');
  }

  /**
   * Transitions specific objects to `dormant` or `reusable` status.
   */
  public async setLifecycleStatus(
    projectUniverseId: ProjectUniverseId,
    targetIds: KnowledgeId[],
    status: Extract<KnowledgeLifecycleStatus, 'active' | 'dormant' | 'archived' | 'reusable'>,
    requestedBy: string,
    reason: string
  ): Promise<void> {
    await this.transitionObjectsStatus(targetIds, status, {
      projectUniverseId,
      operation: status === 'archived' ? 'archive' : 'restore',
      targetIds,
      requestedBy,
      reason,
    });
  }

  private async transitionObjectsStatus(
    targetIds: KnowledgeId[],
    newStatus: KnowledgeLifecycleStatus,
    request: MemoryLifecycleRequest
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    for (const id of targetIds) {
      const existing = await this.pkuStore.getKnowledge(id);
      if (!existing) continue;
      if (existing.lifecycleStatus === 'purged') {
        throw new LifecycleSafetyError(
          `Cannot transition KnowledgeObject "${id}" from irreversible "purged" state.`
        );
      }

      const updatedMetadata: Record<string, unknown> = {
        ...(existing.metadata ?? {}),
        previousLifecycleStatus: existing.lifecycleStatus,
        lastLifecycleOperation: request.operation,
        lastLifecycleReason: request.reason,
        lastLifecycleBy: request.requestedBy,
        lastLifecycleAt: nowIso,
      };

      const updated: KnowledgeObject = {
        ...existing,
        lifecycleStatus: newStatus,
        ...(newStatus === 'reusable' ? { reusable: true } : {}),
        metadata: updatedMetadata,
        updatedAt: nowIso,
      };

      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.lifecycle',
        scopeId: existing.projectUniverseId,
        sourceType: 'LifecycleTransition',
        sourceRecordId: `${id}:${newStatus}:${nowIso}`,
        contentHash: computeContentHash(updated, this.customSecrets),
      });

      await this.pkuStore.putKnowledge(updated, idemKey);
    }
  }

  /**
   * Restores soft-deleted (`deleted`), `archived`, or `dormant` objects back to `active`
   * with full original data and provenance intact (`PKU-016`).
   */
  private async restoreObjects(
    targetIds: KnowledgeId[],
    request: MemoryLifecycleRequest
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    for (const id of targetIds) {
      const existing = await this.pkuStore.getKnowledge(id);
      if (!existing) continue;

      if (existing.lifecycleStatus === 'purged') {
        throw new LifecycleSafetyError(
          `Cannot restore KnowledgeObject "${id}": object has been permanently purged.`
        );
      }

      const updatedMetadata: Record<string, unknown> = {
        ...(existing.metadata ?? {}),
        restoredFromStatus: existing.lifecycleStatus,
        restoredBy: request.requestedBy,
        restoredReason: request.reason,
        restoredAt: nowIso,
      };

      const updated: KnowledgeObject = {
        ...existing,
        lifecycleStatus: 'active',
        metadata: updatedMetadata,
        updatedAt: nowIso,
      };

      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.lifecycle',
        scopeId: existing.projectUniverseId,
        sourceType: 'LifecycleRestore',
        sourceRecordId: `${id}:active:${nowIso}`,
        contentHash: computeContentHash(updated, this.customSecrets),
      });

      await this.pkuStore.putKnowledge(updated, idemKey);
    }
  }

  /**
   * Permanently purges target objects (`lifecycleStatus: 'purged'`), scrubbing payload content
   * while retaining an audit tombstone (`PKU-017`).
   */
  private async purgeObjects(
    targetIds: KnowledgeId[],
    request: MemoryLifecycleRequest
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    for (const id of targetIds) {
      const existing = await this.pkuStore.getKnowledge(id);
      if (!existing) continue;

      const tombstoneContent = {
        purged: true,
        purgedAt: nowIso,
        purgedBy: request.requestedBy,
        reason: request.reason,
      };

      const purgedObj: KnowledgeObject = {
        ...existing,
        title: `[PURGED] ${existing.id}`,
        summary: 'Object payload permanently purged by authorized lifecycle operation.',
        content: tombstoneContent,
        lifecycleStatus: 'purged',
        reusable: false,
        treeNodeIds: [],
        tags: ['purged'],
        metadata: {
          purgedAt: nowIso,
          purgedBy: request.requestedBy,
          purgeReason: request.reason,
        },
        updatedAt: nowIso,
      };

      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.lifecycle',
        scopeId: existing.projectUniverseId,
        sourceType: 'LifecyclePurge',
        sourceRecordId: `${id}:purged:${nowIso}`,
        contentHash: computeContentHash(purgedObj, this.customSecrets),
      });

      await this.pkuStore.putKnowledge(purgedObj, idemKey);
    }
  }

  /**
   * Detaches `targetIds` from `treeNodeIds` without deleting the underlying `KnowledgeObject`s (`PKU-015`).
   */
  private async detachFromTreeNodes(
    projectUniverseId: ProjectUniverseId,
    treeNodeIds: TreeNodeId[],
    targetIds: KnowledgeId[]
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const targetIdSet = new Set(targetIds);
    const treeNodeIdSet = new Set(treeNodeIds);

    if (this.pkuStore.listTreeNodes && this.pkuStore.putTreeNode) {
      const allNodes = await this.pkuStore.listTreeNodes(projectUniverseId);
      for (const node of allNodes) {
        if (treeNodeIdSet.size === 0 || treeNodeIdSet.has(node.nodeId)) {
          const remainingKids = node.knowledgeIds.filter((kid) => !targetIdSet.has(kid));
          if (remainingKids.length !== node.knowledgeIds.length) {
            const updatedNode: KnowledgeTreeNode = {
              ...node,
              knowledgeIds: remainingKids,
              updatedAt: nowIso,
            };
            await this.pkuStore.putTreeNode(
              updatedNode,
              deriveIdempotencyKey({
                sourceSystem: 'almudaya.lifecycle',
                scopeId: projectUniverseId,
                sourceType: 'DetachTreeNode',
                sourceRecordId: `${node.nodeId}:${nowIso}`,
                contentHash: computeContentHash(updatedNode, this.customSecrets),
              })
            );
          }
        }
      }
    }

    for (const id of targetIds) {
      const obj = await this.pkuStore.getKnowledge(id);
      if (!obj) continue;
      const remainingTreeNodeIds =
        treeNodeIdSet.size === 0
          ? []
          : (obj.treeNodeIds ?? []).filter((tid) => !treeNodeIdSet.has(tid));

      const updatedObj: KnowledgeObject = {
        ...obj,
        treeNodeIds: remainingTreeNodeIds,
        updatedAt: nowIso,
      };
      await this.pkuStore.putKnowledge(
        updatedObj,
        deriveIdempotencyKey({
          sourceSystem: 'almudaya.lifecycle',
          scopeId: projectUniverseId,
          sourceType: 'DetachKnowledgeObject',
          sourceRecordId: `${id}:${nowIso}`,
          contentHash: computeContentHash(updatedObj, this.customSecrets),
        })
      );
    }
  }

  /**
   * Exports a portable, secret-redacted bundle of a `ProjectMemoryUniverse`.
   */
  public async exportUniverse(
    projectUniverseId: ProjectUniverseId,
    requestedBy: string = 'SYSTEM'
  ): Promise<ExportedUniverseBundle> {
    const plan = await this.plan({
      projectUniverseId,
      operation: 'export',
      requestedBy,
      reason: 'Export ProjectMemoryUniverse bundle',
    });
    await this.execute(plan);

    const universe = await this.pkuStore.getUniverse(projectUniverseId);
    const queryRes = await this.pkuStore.queryKnowledge({
      projectUniverseIds: [projectUniverseId],
      includeArchived: true,
    });
    const treeNodes = this.pkuStore.listTreeNodes
      ? await this.pkuStore.listTreeNodes(projectUniverseId)
      : [];
    const events = this.pkuStore.listEvents
      ? await this.pkuStore.listEvents(projectUniverseId)
      : [];

    const relationsMap = new Map<string, KnowledgeRelation>();
    if (this.pkuStore.getRelations) {
      for (const obj of queryRes.items) {
        const rels = await this.pkuStore.getRelations(obj.id);
        for (const r of rels) {
          relationsMap.set(r.relationId, r);
        }
      }
    }

    return redactRecursively(
      {
        exportedAt: new Date().toISOString(),
        universe,
        knowledgeObjects: queryRes.items,
        treeNodes,
        relations: Array.from(relationsMap.values()),
        events,
      },
      this.customSecrets
    ) as ExportedUniverseBundle;
  }

  private async recordLifecycleAuditEvent(
    plan: MemoryLifecyclePlan,
    phase: 'dry_run' | 'executed'
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const { request } = plan;
    const eventType = `lifecycle.${request.operation}.${phase}`;
    const eventId = deriveMemoryEventId({
      sourceSystem: 'almudaya.lifecycle',
      sessionId: request.projectUniverseId,
      sourceType: eventType,
      sourceRecordId: `${request.operation}:${nowIso}`,
    });
    const idemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.lifecycle',
      scopeId: request.projectUniverseId,
      sourceType: eventType,
      sourceRecordId: `${request.operation}:${nowIso}`,
    });

    const event: MemoryEvent = {
      id: eventId,
      eventType,
      identity: {
        projectUniverseId: request.projectUniverseId,
        principalId: request.requestedBy,
        registerKind: 'global',
      },
      payload: {
        operation: request.operation,
        phase,
        reason: request.reason,
        affectedKnowledgeIds: plan.affectedKnowledgeIds,
        protectedKnowledgeIds: plan.protectedKnowledgeIds,
        externalReferences: plan.externalReferences,
      },
      occurredAt: nowIso,
      recordedAt: nowIso,
      idempotencyKey: idemKey,
      provenance: {
        sourceSystem: 'almudaya.lifecycle',
        sourceType: 'MemoryLifecycleOperation',
        sourceId: request.operation,
        createdBy: request.requestedBy,
        createdAt: nowIso,
        ingestedAt: nowIso,
        originProjectUniverseId: request.projectUniverseId,
      },
    };

    await this.pkuStore.appendEvent(event, idemKey);
  }
}
