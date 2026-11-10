import { redactRecursively } from '../../execution/environment.js';
import {
  computeContentHash,
  deriveIdempotencyKey,
  deriveKnowledgeId,
  deriveMemoryEventId,
  deriveProjectUniverseId,
  deriveRelationId,
  deriveTreeNodeId,
} from '../contracts/identity.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  type KnowledgeId,
  type KnowledgeObject,
  type KnowledgeRelation,
  type KnowledgeRelationType,
  type KnowledgeScope,
  type KnowledgeTreeDomain,
  type KnowledgeTreeNode,
  type MemoryEvent,
  type ProjectMemoryUniverse,
  type ProjectUniverseId,
  type TreeNodeId,
} from '../contracts/types.js';
import type { IPKUStore } from '../ports/pku-store.js';

export const STANDARD_PMU_TOP_DOMAINS: readonly KnowledgeTreeDomain[] = [
  'Identity',
  'Requirements',
  'Architecture',
  'Development',
  'Experiments',
  'Decisions',
  'Tests',
  'Roadmap',
] as const;

export const STANDARD_ARCHITECTURE_SUBDOMAINS: readonly KnowledgeTreeDomain[] = [
  'Architecture/Modules',
  'Architecture/Components',
  'Architecture/Interfaces',
] as const;

export interface CreateProjectUniverseInput {
  projectKey: string;
  displayName: string;
  description?: string;
  reusable?: boolean;
  parentUniverseId?: ProjectUniverseId;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

export interface PruneTreeBranchResult {
  projectUniverseId: ProjectUniverseId;
  prunedDomainPath: KnowledgeTreeDomain;
  prunedTreeNodeIds: TreeNodeId[];
  detachedKnowledgeIds: KnowledgeId[];
  preservedSharedKnowledgeIds: KnowledgeId[];
}

export interface CrossProjectReuseInput {
  sourceUniverseId: ProjectUniverseId;
  targetUniverseId: ProjectUniverseId;
  sourceKnowledgeIds: KnowledgeId[];
  mode?: 'reference' | 'copy';
  targetTreeDomain?: KnowledgeTreeDomain;
  requestedBy: string;
  allowNonReusableOverride?: boolean;
}

export interface CrossProjectReuseResult {
  reusedObjects: KnowledgeObject[];
  relations: KnowledgeRelation[];
}

export interface ForkProjectUniverseInput {
  sourceUniverseId: ProjectUniverseId;
  newProjectKey: string;
  newDisplayName: string;
  description?: string;
  onlyReusable?: boolean;
  requestedBy: string;
}

export interface ForkProjectUniverseResult {
  universe: ProjectMemoryUniverse;
  forkedKnowledgeCount: number;
  forkedKnowledgeIds: KnowledgeId[];
  lineageRelations: KnowledgeRelation[];
}

/**
 * Project Memory Universe (PMU) Service (Phase 7 — Spec v0.2 §2.5, §5.2, §9.3, PKU-014, PKU-015).
 *
 * Responsibilities:
 * - Isolated per-project namespace management (`ProjectMemoryUniverse`) (`PKU-014`)
 * - 8-domain hierarchical tree initialization and branch attachment
 * - Structural tree pruning strictly separated from graph/object deletion (`PKU-015`)
 * - Knowledge graph linking and dependency inspection
 * - Controlled cross-project knowledge reuse (`reference` / `copy`) and PMU forking with provenance lineage
 */
export class ProjectMemoryUniverseService {
  private readonly pkuStore: IPKUStore;
  private readonly customSecrets: string[];

  constructor(pkuStore: IPKUStore, options: { customSecrets?: string[] } = {}) {
    this.pkuStore = pkuStore;
    this.customSecrets = options.customSecrets ?? [];
  }

  /**
   * Creates an isolated `ProjectMemoryUniverse` along with its `L0` root `KnowledgeObject`
   * and standard 8-domain hierarchical knowledge tree (`Identity`, `Requirements`, `Architecture` +
   * subdomains, `Development`, `Experiments`, `Decisions`, `Tests`, `Roadmap`).
   */
  public async createProjectUniverse(
    input: CreateProjectUniverseInput
  ): Promise<{
    universe: ProjectMemoryUniverse;
    rootKnowledge: KnowledgeObject;
    treeNodes: KnowledgeTreeNode[];
  }> {
    const pmuId = deriveProjectUniverseId(input.projectKey);
    const nowIso = new Date().toISOString();

    const rootNodeId = deriveKnowledgeId({
      sourceSystem: 'almudaya.pmu',
      projectUniverseId: pmuId,
      sourceType: 'pmu.root',
      sourceRecordId: 'root',
    });

    const universe: ProjectMemoryUniverse = {
      id: pmuId,
      projectKey: input.projectKey.trim(),
      displayName: input.displayName.trim(),
      ...(input.description ? { description: input.description } : {}),
      rootNodeId,
      status: 'active',
      reusable: input.reusable ?? true,
      ...(input.parentUniverseId ? { parentUniverseId: input.parentUniverseId } : {}),
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: redactRecursively(input.metadata ?? {}, this.customSecrets) as Record<
        string,
        unknown
      >,
    };

    await this.pkuStore.createUniverse(universe);

    const identityTreeNodeId = deriveTreeNodeId(pmuId, 'Identity');
    const rootContent = {
      projectKey: universe.projectKey,
      displayName: universe.displayName,
      description: universe.description ?? '',
      parentUniverseId: universe.parentUniverseId ?? null,
    };
    const rootHash = computeContentHash(rootContent, this.customSecrets);

    const rootKnowledge: KnowledgeObject = {
      id: rootNodeId,
      projectUniverseId: pmuId,
      type: 'pmu.root',
      scope: 'project',
      hierarchyLevel: 'L0',
      title: `${universe.displayName} — Project Root Index`,
      summary: universe.description ?? `Root index for Project Memory Universe ${universe.projectKey}`,
      content: rootContent,
      provenance: {
        sourceSystem: 'almudaya.pmu',
        sourceType: 'pmu.root',
        sourceId: universe.projectKey,
        createdBy: input.createdBy ?? 'SYSTEM',
        createdAt: nowIso,
        ingestedAt: nowIso,
        contentHash: rootHash,
        originProjectUniverseId: pmuId,
      },
      relationIds: [],
      treeNodeIds: [identityTreeNodeId],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      reusable: universe.reusable,
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      tags: ['pmu', 'root', universe.projectKey],
    };

    await this.pkuStore.putKnowledge(
      rootKnowledge,
      deriveIdempotencyKey({
        sourceSystem: 'almudaya.pmu',
        scopeId: pmuId,
        sourceType: 'pmu.root',
        sourceRecordId: 'root',
        contentHash: rootHash,
      })
    );

    const treeNodes = await this.initializeStandardTree(pmuId, rootNodeId, nowIso);

    return {
      universe,
      rootKnowledge,
      treeNodes,
    };
  }

  private async initializeStandardTree(
    projectUniverseId: ProjectUniverseId,
    rootKnowledgeId: KnowledgeId,
    nowIso: string
  ): Promise<KnowledgeTreeNode[]> {
    const createdNodes: KnowledgeTreeNode[] = [];
    const archNodeId = deriveTreeNodeId(projectUniverseId, 'Architecture');
    const archSubNodeIds = STANDARD_ARCHITECTURE_SUBDOMAINS.map((sub) =>
      deriveTreeNodeId(projectUniverseId, sub)
    );

    for (const domain of STANDARD_PMU_TOP_DOMAINS) {
      const nodeId = deriveTreeNodeId(projectUniverseId, domain);
      const node: KnowledgeTreeNode = {
        nodeId,
        projectUniverseId,
        parentNodeId: null,
        domainPath: domain,
        label: domain,
        knowledgeIds: domain === 'Identity' ? [rootKnowledgeId] : [],
        childNodeIds: domain === 'Architecture' ? archSubNodeIds : [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      createdNodes.push(node);
      if (this.pkuStore.putTreeNode) {
        await this.pkuStore.putTreeNode(
          node,
          deriveIdempotencyKey({
            sourceSystem: 'almudaya.pmu',
            scopeId: projectUniverseId,
            sourceType: 'KnowledgeTreeNode',
            sourceRecordId: domain,
            contentHash: computeContentHash(node, this.customSecrets),
          })
        );
      }
    }

    for (const subDomain of STANDARD_ARCHITECTURE_SUBDOMAINS) {
      const subNodeId = deriveTreeNodeId(projectUniverseId, subDomain);
      const label = subDomain.split('/').pop() ?? subDomain;
      const subNode: KnowledgeTreeNode = {
        nodeId: subNodeId,
        projectUniverseId,
        parentNodeId: archNodeId,
        domainPath: subDomain,
        label,
        knowledgeIds: [],
        childNodeIds: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      createdNodes.push(subNode);
      if (this.pkuStore.putTreeNode) {
        await this.pkuStore.putTreeNode(
          subNode,
          deriveIdempotencyKey({
            sourceSystem: 'almudaya.pmu',
            scopeId: projectUniverseId,
            sourceType: 'KnowledgeTreeNode',
            sourceRecordId: subDomain,
            contentHash: computeContentHash(subNode, this.customSecrets),
          })
        );
      }
    }

    return createdNodes;
  }

  /**
   * Stores a `KnowledgeObject` scoped to `projectUniverseId` using deterministic local ID scoping (`PKU-014`)
   * and optionally attaches it to one or more hierarchical tree domains (`domainPaths`).
   */
  public async putProjectKnowledge<TContent = unknown>(params: {
    projectUniverseId: ProjectUniverseId;
    localRecordId: string;
    type: string;
    scope?: KnowledgeScope;
    title: string;
    summary?: string;
    content: TContent;
    domainPaths?: KnowledgeTreeDomain[];
    hierarchyLevel?: 'L0' | 'L1' | 'L2' | 'L3';
    reusable?: boolean;
    ownerId?: string;
    tags?: string[];
    sourcePath?: string;
  }): Promise<KnowledgeObject<TContent>> {
    const nowIso = new Date().toISOString();
    const koId = deriveKnowledgeId({
      sourceSystem: 'almudaya.pmu',
      projectUniverseId: params.projectUniverseId,
      sourceType: params.type,
      sourceRecordId: params.localRecordId,
    });

    const sanitizedContent = redactRecursively(params.content, this.customSecrets) as TContent;
    const contentHash = computeContentHash(sanitizedContent, this.customSecrets);

    const domainPaths = params.domainPaths ?? [];
    const treeNodeIds = domainPaths.map((d) =>
      deriveTreeNodeId(params.projectUniverseId, d)
    );

    const existing = await this.pkuStore.getKnowledge<TContent>(koId);
    const mergedTreeNodeIds = Array.from(
      new Set([...(existing?.treeNodeIds ?? []), ...treeNodeIds])
    );

    const obj: KnowledgeObject<TContent> = {
      id: koId,
      projectUniverseId: params.projectUniverseId,
      type: params.type,
      scope: params.scope ?? 'project',
      ...(params.ownerId ? { ownerId: params.ownerId } : {}),
      title: params.title,
      ...(params.summary ? { summary: params.summary } : {}),
      hierarchyLevel: params.hierarchyLevel ?? 'L2',
      content: sanitizedContent,
      provenance: {
        sourceSystem: 'almudaya.pmu',
        sourceType: params.type,
        sourceId: params.localRecordId,
        ...(params.sourcePath ? { sourcePath: params.sourcePath } : {}),
        ...(params.ownerId ? { createdBy: params.ownerId } : {}),
        createdAt: existing?.createdAt ?? nowIso,
        ingestedAt: nowIso,
        contentHash,
        originProjectUniverseId:
          existing?.provenance.originProjectUniverseId ?? params.projectUniverseId,
      },
      relationIds: existing?.relationIds ?? [],
      treeNodeIds: mergedTreeNodeIds,
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      reusable: params.reusable ?? true,
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      tags: params.tags ?? [],
      metadata: {
        localRecordId: params.localRecordId,
      },
    };

    const idemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.pmu',
      scopeId: params.projectUniverseId,
      sourceType: params.type,
      sourceRecordId: params.localRecordId,
      contentHash,
    });

    await this.pkuStore.putKnowledge(obj, idemKey);

    for (const domainPath of domainPaths) {
      await this.attachKnowledgeToTreeDomain(params.projectUniverseId, domainPath, koId);
    }

    return obj;
  }

  /**
   * Attaches an existing `KnowledgeObject` to a `KnowledgeTreeNode` domain path within `projectUniverseId`.
   */
  public async attachKnowledgeToTreeDomain(
    projectUniverseId: ProjectUniverseId,
    domainPath: KnowledgeTreeDomain,
    knowledgeId: KnowledgeId
  ): Promise<KnowledgeTreeNode> {
    const nodeId = deriveTreeNodeId(projectUniverseId, domainPath);
    const nowIso = new Date().toISOString();

    let node = this.pkuStore.getTreeNode
      ? await this.pkuStore.getTreeNode(nodeId)
      : null;

    if (!node) {
      node = {
        nodeId,
        projectUniverseId,
        parentNodeId: domainPath.includes('/')
          ? deriveTreeNodeId(projectUniverseId, domainPath.split('/')[0]!)
          : null,
        domainPath,
        label: domainPath.split('/').pop() ?? domainPath,
        knowledgeIds: [knowledgeId],
        childNodeIds: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    } else if (!node.knowledgeIds.includes(knowledgeId)) {
      node = {
        ...node,
        knowledgeIds: [...node.knowledgeIds, knowledgeId],
        updatedAt: nowIso,
      };
    }

    if (this.pkuStore.putTreeNode) {
      await this.pkuStore.putTreeNode(
        node,
        deriveIdempotencyKey({
          sourceSystem: 'almudaya.pmu',
          scopeId: projectUniverseId,
          sourceType: 'KnowledgeTreeNode',
          sourceRecordId: `${domainPath}:${node.knowledgeIds.join(',')}`,
          contentHash: computeContentHash(node, this.customSecrets),
        })
      );
    }

    const obj = await this.pkuStore.getKnowledge(knowledgeId);
    if (obj && !(obj.treeNodeIds ?? []).includes(nodeId)) {
      const updatedObj: KnowledgeObject = {
        ...obj,
        treeNodeIds: [...(obj.treeNodeIds ?? []), nodeId],
        updatedAt: nowIso,
      };
      await this.pkuStore.putKnowledge(
        updatedObj,
        deriveIdempotencyKey({
          sourceSystem: 'almudaya.pmu',
          scopeId: projectUniverseId,
          sourceType: obj.type,
          sourceRecordId: `${obj.id}:tree:${nodeId}`,
          contentHash: computeContentHash(updatedObj, this.customSecrets),
        })
      );
    }

    return node;
  }

  /**
   * Links two `KnowledgeObject` nodes in the Knowledge Graph and updates their `relationIds`.
   */
  public async linkKnowledgeObjects(params: {
    projectUniverseId: ProjectUniverseId;
    fromId: KnowledgeId;
    toId: KnowledgeId;
    relationType: KnowledgeRelationType;
    weight?: number;
    metadata?: Record<string, unknown>;
  }): Promise<KnowledgeRelation> {
    const nowIso = new Date().toISOString();
    const relId = deriveRelationId(params.fromId, params.relationType, params.toId);
    const relation: KnowledgeRelation = {
      relationId: relId,
      projectUniverseId: params.projectUniverseId,
      fromId: params.fromId,
      toId: params.toId,
      relationType: params.relationType,
      weight: params.weight ?? 1.0,
      createdAt: nowIso,
      ...(params.metadata ? { metadata: params.metadata } : {}),
    };

    const idemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.pmu',
      scopeId: params.projectUniverseId,
      sourceType: 'KnowledgeRelation',
      sourceRecordId: relId,
      contentHash: computeContentHash(relation, this.customSecrets),
    });

    await this.pkuStore.putRelation(relation, idemKey);

    for (const endpointId of [params.fromId, params.toId]) {
      const endpointObj = await this.pkuStore.getKnowledge(endpointId);
      if (endpointObj && !endpointObj.relationIds.includes(relId)) {
        const updatedEndpoint: KnowledgeObject = {
          ...endpointObj,
          relationIds: [...endpointObj.relationIds, relId],
          updatedAt: nowIso,
        };
        await this.pkuStore.putKnowledge(
          updatedEndpoint,
          deriveIdempotencyKey({
            sourceSystem: 'almudaya.pmu',
            scopeId: endpointObj.projectUniverseId,
            sourceType: endpointObj.type,
            sourceRecordId: `${endpointObj.id}:rel:${relId}`,
            contentHash: computeContentHash(updatedEndpoint, this.customSecrets),
          })
        );
      }
    }

    return relation;
  }

  /**
   * Prunes a hierarchical tree branch (`domainPath` and any sub-branches under it) (`PKU-015`).
   *
   * CRITICAL ARCHITECTURAL INVARIANT (`PKU-015`):
   * Structural tree pruning detaches `KnowledgeObject` memberships from the pruned `KnowledgeTreeNode`s
   * ONLY. It NEVER deletes, archives, or corrupts the underlying `KnowledgeObject` records or
   * `KnowledgeRelation` graph edges. Any shared graph nodes referenced by other tree branches,
   * other owners, or graph relations remain 100% available and intact.
   */
  public async pruneTreeBranch(
    projectUniverseId: ProjectUniverseId,
    domainPath: KnowledgeTreeDomain,
    requestedBy: string = 'SYSTEM'
  ): Promise<PruneTreeBranchResult> {
    const allTreeNodes = this.pkuStore.listTreeNodes
      ? await this.pkuStore.listTreeNodes(projectUniverseId)
      : [];

    const prefix = domainPath.trim().toLowerCase();
    const targetNodes = allTreeNodes.filter(
      (n) =>
        n.domainPath.toLowerCase() === prefix ||
        n.domainPath.toLowerCase().startsWith(`${prefix}/`)
    );

    const prunedTreeNodeIds = targetNodes.map((n) => n.nodeId);
    const prunedNodeSet = new Set<string>(prunedTreeNodeIds);
    const detachedKnowledgeSet = new Set<KnowledgeId>();
    const preservedSharedSet = new Set<KnowledgeId>();
    const nowIso = new Date().toISOString();

    for (const node of targetNodes) {
      for (const kid of node.knowledgeIds) {
        detachedKnowledgeSet.add(kid);
      }

      const clearedNode: KnowledgeTreeNode = {
        ...node,
        knowledgeIds: [],
        updatedAt: nowIso,
      };

      if (this.pkuStore.putTreeNode) {
        await this.pkuStore.putTreeNode(
          clearedNode,
          deriveIdempotencyKey({
            sourceSystem: 'almudaya.pmu',
            scopeId: projectUniverseId,
            sourceType: 'PruneTreeNode',
            sourceRecordId: `${node.nodeId}:${nowIso}`,
            contentHash: computeContentHash(clearedNode, this.customSecrets),
          })
        );
      }
    }

    // Update each detached KnowledgeObject's treeNodeIds while keeping its lifecycleStatus='active' and relationIds intact
    for (const kid of detachedKnowledgeSet) {
      const obj = await this.pkuStore.getKnowledge(kid);
      if (!obj) continue;

      const remainingTreeNodes = (obj.treeNodeIds ?? []).filter(
        (tid) => !prunedNodeSet.has(tid)
      );

      const relations = this.pkuStore.getRelations
        ? await this.pkuStore.getRelations(kid)
        : [];

      if (remainingTreeNodes.length > 0 || relations.length > 0 || obj.relationIds.length > 0) {
        preservedSharedSet.add(kid);
      }

      const updatedObj: KnowledgeObject = {
        ...obj,
        treeNodeIds: remainingTreeNodes,
        updatedAt: nowIso,
      };

      await this.pkuStore.putKnowledge(
        updatedObj,
        deriveIdempotencyKey({
          sourceSystem: 'almudaya.pmu',
          scopeId: projectUniverseId,
          sourceType: obj.type,
          sourceRecordId: `${obj.id}:prune:${domainPath}:${nowIso}`,
          contentHash: computeContentHash(updatedObj, this.customSecrets),
        })
      );
    }

    // Record audit event for structural tree prune
    const eventId = deriveMemoryEventId({
      sourceSystem: 'almudaya.pmu',
      sessionId: projectUniverseId,
      sourceType: 'pmu.tree_branch_pruned',
      sourceRecordId: `${domainPath}:${nowIso}`,
    });
    const pruneEvent: MemoryEvent = {
      id: eventId,
      eventType: 'pmu.tree_branch_pruned',
      identity: {
        projectUniverseId,
        principalId: requestedBy,
        registerKind: 'global',
      },
      payload: {
        domainPath,
        prunedTreeNodeIds,
        detachedKnowledgeIds: Array.from(detachedKnowledgeSet),
        preservedSharedKnowledgeIds: Array.from(preservedSharedSet),
      },
      occurredAt: nowIso,
      recordedAt: nowIso,
      idempotencyKey: deriveIdempotencyKey({
        sourceSystem: 'almudaya.pmu',
        scopeId: projectUniverseId,
        sourceType: 'pmu.tree_branch_pruned',
        sourceRecordId: `${domainPath}:${nowIso}`,
      }),
      provenance: {
        sourceSystem: 'almudaya.pmu',
        sourceType: 'TreePruneOperation',
        sourceId: domainPath,
        createdBy: requestedBy,
        createdAt: nowIso,
        ingestedAt: nowIso,
        originProjectUniverseId: projectUniverseId,
      },
    };
    await this.pkuStore.appendEvent(pruneEvent, pruneEvent.idempotencyKey);

    return {
      projectUniverseId,
      prunedDomainPath: domainPath,
      prunedTreeNodeIds,
      detachedKnowledgeIds: Array.from(detachedKnowledgeSet),
      preservedSharedKnowledgeIds: Array.from(preservedSharedSet),
    };
  }

  /**
   * Reuses validated knowledge objects from `sourceUniverseId` into `targetUniverseId`
   * via controlled `reference` or `copy` mode (`Spec §2.5 & §9.3`).
   */
  public async reuseKnowledgeAcrossProjects(
    input: CrossProjectReuseInput
  ): Promise<CrossProjectReuseResult> {
    const mode = input.mode ?? 'reference';
    const reusedObjects: KnowledgeObject[] = [];
    const relations: KnowledgeRelation[] = [];
    const nowIso = new Date().toISOString();

    for (const sourceId of input.sourceKnowledgeIds) {
      const sourceObj = await this.pkuStore.getKnowledge(sourceId);
      if (!sourceObj) {
        throw new Error(`Cannot reuse KnowledgeObject "${sourceId}": not found.`);
      }
      if (sourceObj.projectUniverseId !== input.sourceUniverseId) {
        throw new Error(
          `KnowledgeObject "${sourceId}" does not belong to source universe "${input.sourceUniverseId}".`
        );
      }
      if (
        sourceObj.lifecycleStatus === 'deleted' ||
        sourceObj.lifecycleStatus === 'purged'
      ) {
        throw new Error(
          `Cannot reuse KnowledgeObject "${sourceId}" in lifecycle state "${sourceObj.lifecycleStatus}".`
        );
      }
      if (
        !input.allowNonReusableOverride &&
        sourceObj.reusable === false &&
        sourceObj.scope !== 'shared' &&
        sourceObj.scope !== 'cross_project'
      ) {
        throw new Error(
          `KnowledgeObject "${sourceId}" is marked non-reusable in universe "${input.sourceUniverseId}".`
        );
      }

      const targetKoId = deriveKnowledgeId({
        sourceSystem: 'almudaya.pmu.reuse',
        projectUniverseId: input.targetUniverseId,
        sourceType: sourceObj.type,
        sourceRecordId: `${input.sourceUniverseId}:${sourceObj.id}:${mode}`,
      });

      const relId = deriveRelationId(targetKoId, 'reuses', sourceObj.id);
      const originPmuId =
        sourceObj.provenance.originProjectUniverseId ?? input.sourceUniverseId;

      const targetContent =
        mode === 'reference'
          ? {
              reuseMode: 'reference',
              sourceUniverseId: input.sourceUniverseId,
              sourceKnowledgeId: sourceObj.id,
              sourceVersion: sourceObj.version,
              snapshotSummary: sourceObj.summary ?? sourceObj.title,
              snapshotContent: sourceObj.content,
            }
          : JSON.parse(JSON.stringify(sourceObj.content));

      const contentHash = computeContentHash(targetContent, this.customSecrets);
      const targetTreeNodeIds = input.targetTreeDomain
        ? [deriveTreeNodeId(input.targetUniverseId, input.targetTreeDomain)]
        : [];

      const reusedObj: KnowledgeObject = {
        id: targetKoId,
        projectUniverseId: input.targetUniverseId,
        type: sourceObj.type,
        scope: 'cross_project',
        ownerId: input.requestedBy,
        title: sourceObj.title,
        summary: sourceObj.summary,
        hierarchyLevel: sourceObj.hierarchyLevel,
        content: targetContent,
        provenance: {
          sourceSystem: 'almudaya.pmu.reuse',
          sourceType: mode === 'reference' ? 'CrossProjectReference' : 'CrossProjectCopy',
          sourceId: sourceObj.id,
          sourcePath: sourceObj.provenance.sourcePath,
          createdBy: input.requestedBy,
          createdAt: nowIso,
          ingestedAt: nowIso,
          contentHash,
          originProjectUniverseId: originPmuId,
        },
        relationIds: [relId],
        treeNodeIds: targetTreeNodeIds,
        validationStatus: sourceObj.validationStatus,
        lifecycleStatus: 'active',
        reusable: true,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        tags: Array.from(
          new Set([...(sourceObj.tags ?? []), 'cross_project_reuse', `reuse:${mode}`])
        ),
        metadata: {
          ...(sourceObj.metadata ?? {}),
          reusedFromUniverseId: input.sourceUniverseId,
          reusedFromKnowledgeId: sourceObj.id,
          reuseMode: mode,
        },
      };

      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.pmu.reuse',
        scopeId: input.targetUniverseId,
        sourceType: sourceObj.type,
        sourceRecordId: targetKoId,
        contentHash,
      });

      await this.pkuStore.putKnowledge(reusedObj, idemKey);

      const rel = await this.linkKnowledgeObjects({
        projectUniverseId: input.targetUniverseId,
        fromId: targetKoId,
        toId: sourceObj.id,
        relationType: 'reuses',
        metadata: {
          sourceUniverseId: input.sourceUniverseId,
          targetUniverseId: input.targetUniverseId,
          reuseMode: mode,
        },
      });

      if (input.targetTreeDomain) {
        await this.attachKnowledgeToTreeDomain(
          input.targetUniverseId,
          input.targetTreeDomain,
          targetKoId
        );
      }

      reusedObjects.push(reusedObj);
      relations.push(rel);
    }

    return { reusedObjects, relations };
  }

  /**
   * Forks an existing `ProjectMemoryUniverse` (`sourceUniverseId`) into a new independent
   * `ProjectMemoryUniverse` with full provenance lineage (`parentUniverseId` and `derived_from` relations).
   */
  public async forkProjectUniverse(
    input: ForkProjectUniverseInput
  ): Promise<ForkProjectUniverseResult> {
    const sourceUniverse = await this.pkuStore.getUniverse(input.sourceUniverseId);
    if (!sourceUniverse) {
      throw new Error(`Source ProjectMemoryUniverse "${input.sourceUniverseId}" does not exist.`);
    }

    const { universe: targetUniverse } = await this.createProjectUniverse({
      projectKey: input.newProjectKey,
      displayName: input.newDisplayName,
      description:
        input.description ?? `Forked from ${sourceUniverse.displayName} (${sourceUniverse.projectKey})`,
      reusable: sourceUniverse.reusable,
      parentUniverseId: sourceUniverse.id,
      createdBy: input.requestedBy,
      metadata: {
        forkedFromUniverseId: sourceUniverse.id,
        forkedAt: new Date().toISOString(),
      },
    });

    const sourceQuery = await this.pkuStore.queryKnowledge({
      projectUniverseIds: [input.sourceUniverseId],
      includeArchived: false,
    });

    const sourceTreeNodes = this.pkuStore.listTreeNodes
      ? await this.pkuStore.listTreeNodes(input.sourceUniverseId)
      : [];

    const onlyReusable = input.onlyReusable ?? true;
    const forkedKnowledgeIds: KnowledgeId[] = [];
    const lineageRelations: KnowledgeRelation[] = [];

    for (const srcObj of sourceQuery.items) {
      if (srcObj.type === 'pmu.root') {
        continue;
      }
      if (onlyReusable && srcObj.reusable === false) {
        continue;
      }

      // Find which domainPaths srcObj belonged to in the source universe
      const memberDomains = sourceTreeNodes
        .filter((n) => n.knowledgeIds.includes(srcObj.id))
        .map((n) => n.domainPath);

      const localRecordId =
        typeof srcObj.metadata?.['localRecordId'] === 'string'
          ? (srcObj.metadata['localRecordId'] as string)
          : srcObj.provenance.sourceId ?? srcObj.id;

      const forkedObj = await this.putProjectKnowledge({
        projectUniverseId: targetUniverse.id,
        localRecordId,
        type: srcObj.type,
        scope: srcObj.scope,
        title: srcObj.title ?? srcObj.id,
        summary: srcObj.summary,
        content: JSON.parse(JSON.stringify(srcObj.content)),
        domainPaths: memberDomains,
        hierarchyLevel: srcObj.hierarchyLevel,
        reusable: srcObj.reusable,
        ownerId: srcObj.ownerId ?? input.requestedBy,
        tags: [...(srcObj.tags ?? []), `forked_from:${sourceUniverse.id}`],
        sourcePath: srcObj.provenance.sourcePath,
      });

      // Preserve original originProjectUniverseId
      const originPmuId =
        srcObj.provenance.originProjectUniverseId ?? sourceUniverse.id;
      const updatedForkedObj: KnowledgeObject = {
        ...forkedObj,
        provenance: {
          ...forkedObj.provenance,
          originProjectUniverseId: originPmuId,
        },
        metadata: {
          ...(forkedObj.metadata ?? {}),
          forkedFromUniverseId: sourceUniverse.id,
          forkedFromKnowledgeId: srcObj.id,
        },
      };

      await this.pkuStore.putKnowledge(
        updatedForkedObj,
        deriveIdempotencyKey({
          sourceSystem: 'almudaya.pmu.fork',
          scopeId: targetUniverse.id,
          sourceType: updatedForkedObj.type,
          sourceRecordId: updatedForkedObj.id,
          contentHash: computeContentHash(updatedForkedObj, this.customSecrets),
        })
      );

      const rel = await this.linkKnowledgeObjects({
        projectUniverseId: targetUniverse.id,
        fromId: updatedForkedObj.id,
        toId: srcObj.id,
        relationType: 'derived_from',
        metadata: {
          forkedFromUniverseId: sourceUniverse.id,
        },
      });

      forkedKnowledgeIds.push(updatedForkedObj.id);
      lineageRelations.push(rel);
    }

    return {
      universe: targetUniverse,
      forkedKnowledgeCount: forkedKnowledgeIds.length,
      forkedKnowledgeIds,
      lineageRelations,
    };
  }
}
