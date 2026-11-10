import { AlmudayaError } from '../../core/errors.js';
import type {
  ExecutionCheckpoint,
  HandoffContext,
  KnowledgeId,
  KnowledgeObject,
  KnowledgeQuery,
  KnowledgeQueryResult,
  MemoryEvent,
  MemoryIdentity,
  MemoryPermissionContext,
  MemoryWriteResult,
  RegisterSnapshot,
} from '../contracts/types.js';
import type { IPKUStore } from '../ports/pku-store.js';
import type { IRegisterPersistence } from '../ports/registers.js';

export class MemoryAccessDeniedError extends AlmudayaError {
  constructor(message: string) {
    super(message, 'MEMORY_ACCESS_DENIED');
    this.name = 'MemoryAccessDeniedError';
  }
}

/**
 * Evaluates whether the caller's `MemoryPermissionContext` is permitted to read
 * a specific `KnowledgeObject` (Spec §7.2, §11 — PKU-009, PKU-014).
 */
export function canReadKnowledgeObject(
  object: KnowledgeObject,
  permission: MemoryPermissionContext
): boolean {
  const isAdmin = permission.capabilities.includes('memory.admin.read_all');
  if (isAdmin) {
    return true;
  }

  // 1. Project universe isolation (PKU-014)
  if (!permission.projectUniverseIds.includes(object.projectUniverseId)) {
    // Allow cross-project read only if explicitly shared and scope permits
    const explicitlyShared = Boolean(
      permission.explicitSharedKnowledgeIds?.includes(object.id)
    );
    if (
      !explicitlyShared ||
      !permission.scopes.includes('cross_project') ||
      !object.reusable
    ) {
      return false;
    }
  }

  // 2. Scope check
  if (!permission.scopes.includes(object.scope)) {
    return false;
  }

  // 3. Individual agent memory isolation (PKU-009):
  // If scope is 'agent', only the owning bot or a recipient with an explicit shared grant may read it.
  if (object.scope === 'agent') {
    const isOwner =
      Boolean(permission.botId && object.ownerId === permission.botId) ||
      object.ownerId === permission.principalId;
    const isExplicitlyShared = Boolean(
      permission.explicitSharedKnowledgeIds?.includes(object.id)
    );
    if (!isOwner && !isExplicitlyShared) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates whether the caller's `MemoryPermissionContext` is permitted to write
 * a specific `KnowledgeObject`.
 */
export function canWriteKnowledgeObject(
  object: KnowledgeObject,
  permission: MemoryPermissionContext
): boolean {
  const isAdmin = permission.capabilities.includes('memory.admin.write_all');
  if (isAdmin) {
    return true;
  }

  if (!permission.projectUniverseIds.includes(object.projectUniverseId)) {
    return false;
  }

  if (!permission.scopes.includes(object.scope)) {
    return false;
  }

  if (object.scope === 'agent') {
    const isOwner =
      Boolean(permission.botId && object.ownerId === permission.botId) ||
      object.ownerId === permission.principalId;
    if (!isOwner) {
      return false;
    }
  }

  return true;
}

/**
 * Scoped Memory Client (Phase 4 — INTEGRATION_MAP.md, PKU-009, PKU-014).
 *
 * Provided to a bot only after canonical bot identity is established.
 * Enforces project, session, and individual bot permission boundaries on every
 * PKU and Register operation.
 */
export class ScopedMemoryClient {
  public readonly identity: MemoryIdentity;
  public readonly permission: MemoryPermissionContext;
  private readonly store: IPKUStore & IRegisterPersistence;

  constructor(
    store: IPKUStore & IRegisterPersistence,
    identity: MemoryIdentity,
    permission: MemoryPermissionContext
  ) {
    if (identity.registerKind === 'individual' && (!identity.botId || !identity.botId.trim())) {
      throw new MemoryAccessDeniedError(
        'Cannot create an individual ScopedMemoryClient before canonical botId is initialized.'
      );
    }
    this.store = store;
    this.identity = identity;
    this.permission = permission;
  }

  /**
   * Retrieves a single KnowledgeObject by ID, throwing `MemoryAccessDeniedError`
   * if the caller lacks permission (PKU-009).
   */
  public async getKnowledge<T = unknown>(
    knowledgeId: KnowledgeId
  ): Promise<KnowledgeObject<T> | null> {
    const obj = await this.store.getKnowledge<T>(knowledgeId);
    if (!obj) {
      return null;
    }
    if (!canReadKnowledgeObject(obj, this.permission)) {
      throw new MemoryAccessDeniedError(
        `Principal "${this.permission.principalId}" (bot="${this.permission.botId ?? 'none'}") is denied access to KnowledgeObject "${knowledgeId}" (scope="${obj.scope}", owner="${obj.ownerId ?? 'none'}", universe="${obj.projectUniverseId}").`
      );
    }
    return obj;
  }

  /**
   * Queries knowledge objects while enforcing universe and per-bot privacy filters (PKU-009, PKU-014).
   */
  public async queryKnowledge(query: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    const isAdmin = this.permission.capabilities.includes('memory.admin.read_all');
    if (!isAdmin) {
      const unauthorizedUniverse = query.projectUniverseIds.find(
        (uid) => !this.permission.projectUniverseIds.includes(uid)
      );
      if (unauthorizedUniverse && !this.permission.scopes.includes('cross_project')) {
        throw new MemoryAccessDeniedError(
          `Principal "${this.permission.principalId}" is not authorized to query ProjectMemoryUniverse "${unauthorizedUniverse}".`
        );
      }

      // If querying another bot's private 'agent' scope explicitly without admin or shared grant, reject
      if (
        query.scopes?.includes('agent') &&
        query.ownerId &&
        query.ownerId !== this.permission.botId &&
        query.ownerId !== this.permission.principalId
      ) {
        const hasSharedGrants =
          (this.permission.explicitSharedKnowledgeIds?.length ?? 0) > 0;
        if (!hasSharedGrants) {
          throw new MemoryAccessDeniedError(
            `Bot "${this.permission.botId ?? this.permission.principalId}" cannot query private agent memory of "${query.ownerId}" without explicit shared permission.`
          );
        }
      }
    }

    const rawResult = await this.store.queryKnowledge(query);
    const authorizedItems = rawResult.items.filter((item) =>
      canReadKnowledgeObject(item, this.permission)
    );

    const evidenceCount = authorizedItems.filter((item) =>
      Boolean(item.provenance.sourcePath || item.provenance.sourceId)
    ).length;

    return {
      items: authorizedItems,
      total: authorizedItems.length,
      nextCursor: rawResult.nextCursor,
      evidenceCoverage: authorizedItems.length > 0 ? evidenceCount / authorizedItems.length : 1,
      traversedRelations: rawResult.traversedRelations,
    };
  }

  /**
   * Writes a KnowledgeObject after verifying caller write permissions.
   */
  public async putKnowledge<T>(
    object: KnowledgeObject<T>,
    idempotencyKey: string
  ): Promise<MemoryWriteResult> {
    if (!canWriteKnowledgeObject(object, this.permission)) {
      throw new MemoryAccessDeniedError(
        `Principal "${this.permission.principalId}" is not authorized to write KnowledgeObject "${object.id}" (scope="${object.scope}", owner="${object.ownerId ?? 'none'}", universe="${object.projectUniverseId}").`
      );
    }
    return await this.store.putKnowledge(object, idempotencyKey);
  }

  /**
   * Loads a RegisterSnapshot after enforcing individual register isolation (PKU-009, PKU-011).
   */
  public async loadSnapshot<TState = unknown>(
    targetIdentity: MemoryIdentity = this.identity
  ): Promise<RegisterSnapshot<TState> | null> {
    this.verifySnapshotAccess(targetIdentity, 'read');
    return await this.store.loadSnapshot<TState>(targetIdentity);
  }

  /**
   * Saves a RegisterSnapshot after enforcing individual register isolation.
   */
  public async saveSnapshot<TState = unknown>(
    snapshot: RegisterSnapshot<TState>,
    idempotencyKey: string
  ): Promise<void> {
    this.verifySnapshotAccess(snapshot.identity, 'write');
    await this.store.saveSnapshot(snapshot, idempotencyKey);
  }

  /**
   * Appends a MemoryEvent under the client's authorized identity.
   */
  public async appendEvent(event: MemoryEvent, idempotencyKey: string): Promise<void> {
    this.verifySnapshotAccess(event.identity, 'write');
    await this.store.appendEvent(event, idempotencyKey);
  }

  public createCheckpointDescriptor<TContext = unknown>(params: {
    checkpointId: string;
    taskId?: string;
    sourceMessageId?: string;
    iteration: number;
    maxIterations: number;
    status: ExecutionCheckpoint['status'];
    summary: string;
    workingContext: TContext;
    knowledgeRefs?: KnowledgeId[];
    schemaVersion: string;
    nowIso?: string;
  }): ExecutionCheckpoint<TContext> {
    const now = params.nowIso ?? new Date().toISOString();
    return {
      checkpointId: params.checkpointId,
      identity: this.identity,
      taskId: params.taskId,
      sourceMessageId: params.sourceMessageId,
      iteration: params.iteration,
      maxIterations: params.maxIterations,
      status: params.status,
      summary: params.summary,
      workingContext: params.workingContext,
      knowledgeRefs: params.knowledgeRefs ?? [],
      schemaVersion: params.schemaVersion,
      createdAt: now,
      updatedAt: now,
    };
  }

  public createHandoffDescriptor(params: {
    handoffId: string;
    targetBotId: string;
    checkpointId?: string;
    sharedKnowledgeIds: KnowledgeId[];
    instructions: string;
    nowIso?: string;
  }): HandoffContext {
    if (!this.identity.sessionId || !this.identity.botId) {
      throw new MemoryAccessDeniedError(
        'HandoffContext requires a ScopedMemoryClient with initialized sessionId and botId.'
      );
    }
    return {
      handoffId: params.handoffId,
      sessionId: this.identity.sessionId,
      projectUniverseId: this.identity.projectUniverseId,
      sourceBotId: this.identity.botId,
      targetBotId: params.targetBotId,
      checkpointId: params.checkpointId,
      sharedKnowledgeIds: params.sharedKnowledgeIds,
      instructions: params.instructions,
      createdAt: params.nowIso ?? new Date().toISOString(),
    };
  }

  private verifySnapshotAccess(target: MemoryIdentity, mode: 'read' | 'write'): void {
    const adminCap = mode === 'read' ? 'memory.admin.read_all' : 'memory.admin.write_all';
    if (this.permission.capabilities.includes(adminCap)) {
      return;
    }

    if (!this.permission.projectUniverseIds.includes(target.projectUniverseId)) {
      throw new MemoryAccessDeniedError(
        `Principal "${this.permission.principalId}" cannot ${mode} register in unauthorized universe "${target.projectUniverseId}".`
      );
    }

    if (target.registerKind === 'individual') {
      if (target.botId !== this.permission.botId && target.botId !== this.permission.principalId) {
        throw new MemoryAccessDeniedError(
          `Bot "${this.permission.botId ?? this.permission.principalId}" is denied ${mode} access to Individual Register of bot "${target.botId ?? 'unknown'}" (PKU-009).`
        );
      }
      if (
        this.permission.sessionId &&
        target.sessionId &&
        target.sessionId !== this.permission.sessionId
      ) {
        throw new MemoryAccessDeniedError(
          `Bot "${this.permission.botId}" in session "${this.permission.sessionId}" cannot ${mode} Individual Register from session "${target.sessionId}" (PKU-011).`
        );
      }
    }
  }
}
