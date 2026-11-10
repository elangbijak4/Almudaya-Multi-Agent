import type { IBlackboardStorage } from '../../blackboard/interface.js';
import type { BotRecord } from '../../bot/schema.js';
import { redactRecursively } from '../../execution/environment.js';
import type { BroadcastCursor } from '../../messaging/schema.js';
import {
  ReadOnlyIndividualRegisterBridge,
  type LegacyIndividualBotState,
} from '../bridges/legacy-individual-bridge.js';
import {
  computeContentHash,
  deriveIdempotencyKey,
  deriveKnowledgeId,
  deriveMemoryEventId,
  deriveProjectUniverseId,
} from '../contracts/identity.js';
import {
  HandoffContextSchema,
  validateContract,
  validateExecutionCheckpoint,
  validateKnowledgeObject,
  validateRegisterSnapshot,
} from '../contracts/schemas.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  type ACMAMemoryDomain,
  type ExecutionCheckpoint,
  type HandoffContext,
  type KnowledgeObject,
  type ProjectUniverseId,
  type RegisterSyncStatus,
} from '../contracts/types.js';
import { DurableOutboxQueue } from '../pku/shadow-ingestion.js';
import type { IPKUStore } from '../ports/pku-store.js';
import type {
  IIndividualRegisterBridge,
  IRegisterPersistence,
} from '../ports/registers.js';
import { MemoryAccessDeniedError, type ScopedMemoryClient } from './memory-client.js';

export interface ReconstructedIndividualRegisterState {
  sessionId: string;
  botId: string;
  projectUniverseId: ProjectUniverseId;
  syncStatus: RegisterSyncStatus;
  botRecord: BotRecord | null;
  broadcastCursor: BroadcastCursor;
  inboxDeliveryState: Array<{
    message_id: string;
    status: string;
    delivery_state: string;
    attempt_count: number;
    max_attempts: number;
    fence_token: number;
    lease_owner: string | null;
    lease_expires_at: string | null;
  }>;
  cognitiveMemory: Record<ACMAMemoryDomain, KnowledgeObject[]>;
  checkpoints: ExecutionCheckpoint[];
  handoffs: HandoffContext[];
  reconstructedAt: string;
}

/**
 * ACMA Individual Register Bridge (Phase 4 — Spec §7, §13, PKU-009, PKU-011).
 *
 * Bridges existing v0.3.3 per-bot state (`BotRecord`, `InboxStore`, `BroadcastCursor`,
 * authored `WorkLogEntry`) via `ReadOnlyIndividualRegisterBridge` AND provides the
 * PKU-backed ACMA Individual Register subsystem (`working`, `semantic`, `episodic`,
 * `procedural`, `retrieval`, `prospective`, `checkpoint`, `handoff`) with strict
 * bot/session isolation and outage resilience.
 */
export class ACMAIndividualRegisterBridge implements IIndividualRegisterBridge {
  public readonly storage: IBlackboardStorage;
  private readonly pkuStore: IPKUStore & IRegisterPersistence;
  private readonly legacyIndividualBridge: ReadOnlyIndividualRegisterBridge;
  private readonly outbox: DurableOutboxQueue;
  private enabled: boolean;

  constructor(
    storage: IBlackboardStorage,
    pkuStore: IPKUStore & IRegisterPersistence,
    options: {
      defaultSessionId?: string;
      customSecrets?: string[];
      outbox?: DurableOutboxQueue;
      enabled?: boolean;
    } = {}
  ) {
    this.storage = storage;
    this.pkuStore = pkuStore;
    this.legacyIndividualBridge = new ReadOnlyIndividualRegisterBridge(storage, {
      defaultSessionId: options.defaultSessionId,
      customSecrets: options.customSecrets,
    });
    this.outbox = options.outbox ?? new DurableOutboxQueue();
    this.enabled = options.enabled ?? true;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public async discoverCapabilities(): Promise<string[]> {
    const legacyCaps = await this.legacyIndividualBridge.discoverCapabilities();
    return [
      ...legacyCaps,
      'acma.working',
      'acma.semantic',
      'acma.episodic',
      'acma.procedural',
      'acma.retrieval',
      'acma.prospective',
      'acma.checkpoint',
      'acma.handoff',
    ];
  }

  public async loadIndividualState(
    botId: string,
    sessionId?: string
  ): Promise<LegacyIndividualBotState | null> {
    return await this.legacyIndividualBridge.loadIndividualState(botId, sessionId);
  }

  /**
   * Records a cognitive memory entry in one of the 8 ACMA domains for a specific bot.
   * Requires canonical `botId` and `sessionId` to be initialized.
   */
  public async recordCognitiveMemory<TContent = unknown>(params: {
    sessionId: string;
    botId: string;
    projectUniverseId?: ProjectUniverseId;
    domain: ACMAMemoryDomain;
    recordKey: string;
    title: string;
    summary?: string;
    content: TContent;
    tags?: string[];
  }): Promise<KnowledgeObject<TContent> | null> {
    if (!params.botId || !params.botId.trim()) {
      throw new MemoryAccessDeniedError(
        'Cannot record ACMA individual memory before canonical botId is initialized.'
      );
    }
    if (!this.enabled) {
      return null;
    }

    const pmuId =
      params.projectUniverseId ??
      deriveProjectUniverseId(`session_${params.sessionId.toLowerCase()}`);
    const nowIso = new Date().toISOString();
    const sanitizedContent = redactRecursively(params.content);
    const contentHash = computeContentHash(sanitizedContent);

    const koId = deriveKnowledgeId({
      sourceSystem: 'almudaya.acma',
      projectUniverseId: pmuId,
      sessionId: params.sessionId,
      sourceType: `acma.${params.domain}`,
      sourceRecordId: `${params.botId}:${params.recordKey}`,
    });

    const ko = validateKnowledgeObject<TContent>({
      id: koId,
      projectUniverseId: pmuId,
      type: `acma.${params.domain}`,
      scope: 'agent',
      ownerId: params.botId,
      title: params.title,
      summary: params.summary ?? params.title,
      hierarchyLevel: params.domain === 'working' ? 'L3' : 'L2',
      content: sanitizedContent,
      provenance: {
        sourceSystem: 'almudaya.acma',
        sourceType: `acma.${params.domain}`,
        sourceId: `${params.botId}:${params.recordKey}`,
        createdBy: params.botId,
        createdAt: nowIso,
        ingestedAt: nowIso,
        contentHash,
        originProjectUniverseId: pmuId,
      },
      relationIds: [],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      reusable: params.domain === 'procedural' || params.domain === 'semantic',
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      tags: ['acma', params.domain, ...(params.tags ?? [])],
      metadata: {
        sessionId: params.sessionId,
        botId: params.botId,
        acmaDomain: params.domain,
      },
    });

    const idemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.acma',
      scopeId: `${params.sessionId}:${params.botId}`,
      sourceType: `acma.${params.domain}`,
      sourceRecordId: params.recordKey,
      contentHash,
    });

    try {
      await this.pkuStore.putKnowledge(ko, idemKey);
      return ko;
    } catch {
      this.outbox.enqueue(idemKey, 'put_knowledge', ko);
      return ko;
    }
  }

  public async persistIndividualEvent(
    botId: string,
    eventType: string,
    payload: unknown,
    idempotencyKey: string,
    sessionId?: string,
    projectUniverseId?: ProjectUniverseId
  ): Promise<void> {
    if (!botId || !botId.trim()) {
      throw new MemoryAccessDeniedError(
        'Cannot persist individual register event before canonical botId is initialized.'
      );
    }
    if (!this.enabled) {
      return;
    }

    const resolvedSessionId = sessionId ?? 'global';
    const pmuId =
      projectUniverseId ??
      deriveProjectUniverseId(`session_${resolvedSessionId.toLowerCase()}`);
    const nowIso = new Date().toISOString();
    const sanitizedPayload = redactRecursively(payload);
    const evtId = deriveMemoryEventId({
      sourceSystem: 'almudaya.acma',
      sessionId: resolvedSessionId,
      sourceType: eventType,
      sourceRecordId: `${botId}:${idempotencyKey}`,
    });

    const eventRecord = {
      id: evtId,
      eventType,
      identity: {
        projectUniverseId: pmuId,
        sessionId: resolvedSessionId,
        botId,
        principalId: botId,
        registerKind: 'individual' as const,
      },
      payload: sanitizedPayload,
      occurredAt: nowIso,
      recordedAt: nowIso,
      idempotencyKey,
      provenance: {
        sourceSystem: 'almudaya.acma',
        sourceType: eventType,
        sourceId: evtId,
        createdBy: botId,
        createdAt: nowIso,
        ingestedAt: nowIso,
        contentHash: computeContentHash(sanitizedPayload),
        originProjectUniverseId: pmuId,
      },
    };

    try {
      await this.pkuStore.appendEvent(eventRecord, idempotencyKey);
    } catch {
      this.outbox.enqueue(idempotencyKey, 'append_event', eventRecord);
    }
  }

  public async saveCheckpoint(
    checkpoint: ExecutionCheckpoint,
    idempotencyKey: string
  ): Promise<void> {
    const validated = validateExecutionCheckpoint(redactRecursively(checkpoint));
    if (!this.enabled) return;

    await this.recordCognitiveMemory({
      sessionId: validated.identity.sessionId ?? 'global',
      botId: validated.identity.botId!,
      projectUniverseId: validated.identity.projectUniverseId,
      domain: 'checkpoint',
      recordKey: validated.checkpointId,
      title: `Checkpoint ${validated.checkpointId} (iter ${validated.iteration}/${validated.maxIterations})`,
      summary: validated.summary,
      content: validated,
      tags: ['checkpoint', validated.status],
    });

    await this.persistIndividualEvent(
      validated.identity.botId!,
      'acma.checkpoint_saved',
      validated,
      idempotencyKey,
      validated.identity.sessionId,
      validated.identity.projectUniverseId
    );
  }

  public async recordHandoff(
    handoff: HandoffContext,
    idempotencyKey: string
  ): Promise<void> {
    const validated = validateContract(
      'HandoffContext',
      HandoffContextSchema,
      redactRecursively(handoff)
    );
    if (!this.enabled) return;

    await this.recordCognitiveMemory({
      sessionId: validated.sessionId,
      botId: validated.sourceBotId,
      projectUniverseId: validated.projectUniverseId,
      domain: 'handoff',
      recordKey: validated.handoffId,
      title: `Handoff ${validated.sourceBotId} -> ${validated.targetBotId}`,
      summary: validated.instructions,
      content: validated,
      tags: ['handoff', validated.targetBotId],
    });

    await this.persistIndividualEvent(
      validated.sourceBotId,
      'acma.handoff_recorded',
      validated,
      idempotencyKey,
      validated.sessionId,
      validated.projectUniverseId
    );
  }

  /**
   * Captures and persists the bot's live operational state (`BotRecord`, `BroadcastCursor`,
   * `InboxStore` delivery/lease/fencing metadata) into a PKU `RegisterSnapshot` (`registerKind: 'individual'`).
   */
  public async syncIndividualSnapshotToPKU(
    botId: string,
    sessionId: string,
    projectUniverseId?: ProjectUniverseId
  ): Promise<void> {
    if (!this.enabled) return;
    const pmuId =
      projectUniverseId ??
      deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);

    const legacyState = await this.legacyIndividualBridge.loadIndividualState(botId, sessionId);
    if (!legacyState) return;

    const nowIso = new Date().toISOString();
    const statePayload = {
      botRecord: legacyState.botRecord,
      broadcastCursor: legacyState.broadcastCursor,
      inboxDeliveryState: legacyState.inboxMessages.map((m) => ({
        message_id: m.message_id,
        status: m.status,
        delivery_state: m.delivery_state,
        attempt_count: m.attempt_count,
        max_attempts: m.max_attempts,
        fence_token: m.fence_token,
        lease_owner: m.lease_owner ?? null,
        lease_expires_at: m.lease_expires_at ?? null,
      })),
    };

    const snapshot = validateRegisterSnapshot({
      id: `snap_ind_${sessionId}_${botId}`,
      identity: {
        projectUniverseId: pmuId,
        sessionId,
        botId,
        principalId: botId,
        registerKind: 'individual',
      },
      state: statePayload,
      syncStatus: 'persisted',
      sourceRevision: computeContentHash(statePayload).slice(0, 16),
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      createdAt: legacyState.botRecord?.joined_at ?? nowIso,
      updatedAt: legacyState.botRecord?.last_seen_at ?? nowIso,
      persistedKnowledgeIds: [],
    });

    const idemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.acma',
      scopeId: `${sessionId}:${botId}`,
      sourceType: 'RegisterSnapshot.Individual',
      sourceRecordId: snapshot.id,
      contentHash: snapshot.sourceRevision,
    });

    try {
      await this.pkuStore.saveSnapshot(snapshot, idemKey);
    } catch {
      this.outbox.enqueue(idemKey, 'save_snapshot', snapshot);
    }
  }

  /**
   * Reconstructs the Individual Register for `botId` in `sessionId` from PKU storage (`PKU-011`).
   * Enforces strict bot and session scoping so another bot's private memories or checkpoints
   * never leak into the reconstructed state (`PKU-009`, `PKU-011`).
   */
  public async reconstructIndividualRegister(
    botId: string,
    sessionId: string,
    projectUniverseId?: ProjectUniverseId,
    callerClient?: ScopedMemoryClient
  ): Promise<ReconstructedIndividualRegisterState> {
    if (callerClient) {
      const isAdmin = callerClient.permission.capabilities.includes('memory.admin.read_all');
      if (
        !isAdmin &&
        callerClient.permission.botId !== botId &&
        callerClient.permission.principalId !== botId
      ) {
        throw new MemoryAccessDeniedError(
          `Bot "${callerClient.permission.botId ?? callerClient.permission.principalId}" is not authorized to reconstruct the Individual Register of "${botId}" (PKU-009).`
        );
      }
    }

    const allUniverses = await this.pkuStore.listUniverses();
    const matchingUniverses = allUniverses.filter(
      (u) =>
        (projectUniverseId && u.id === projectUniverseId) ||
        u.metadata?.['sessionId'] === sessionId ||
        u.id === deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`)
    );

    const defaultSessionPmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);
    const targetUniverseIds = Array.from(
      new Set([
        ...(projectUniverseId ? [projectUniverseId] : []),
        ...matchingUniverses.map((u) => u.id),
        defaultSessionPmuId,
      ])
    );
    const primaryPmuId = projectUniverseId ?? matchingUniverses[0]?.id ?? defaultSessionPmuId;

    // 1. Load individual RegisterSnapshot
    const snap = await this.pkuStore.loadSnapshot<{
      botRecord?: BotRecord | null;
      broadcastCursor?: BroadcastCursor;
      inboxDeliveryState?: ReconstructedIndividualRegisterState['inboxDeliveryState'];
    }>({
      projectUniverseId: primaryPmuId,
      sessionId,
      botId,
      principalId: botId,
      registerKind: 'individual',
    });

    let botRecord: BotRecord | null = snap?.state?.botRecord ?? null;
    const broadcastCursor: BroadcastCursor = snap?.state?.broadcastCursor ?? {
      last_read_event_id: null,
      last_read_timestamp: null,
      category_cursors: {},
      acknowledged_event_ids: [],
    };
    const inboxDeliveryState = snap?.state?.inboxDeliveryState ?? [];

    // 2. Query only this bot's 'agent'-scoped KnowledgeObjects across target universes
    const queryResult = await this.pkuStore.queryKnowledge({
      projectUniverseIds: targetUniverseIds,
      scopes: ['agent'],
      ownerId: botId,
      includeArchived: true,
      limit: 1000,
    });

    const cognitiveMemory: Record<ACMAMemoryDomain, KnowledgeObject[]> = {
      working: [],
      semantic: [],
      episodic: [],
      procedural: [],
      retrieval: [],
      prospective: [],
      checkpoint: [],
      handoff: [],
    };
    const checkpoints: ExecutionCheckpoint[] = [];
    const handoffs: HandoffContext[] = [];

    for (const obj of queryResult.items) {
      // Strict double-check: never leak objects owned by another bot or another session (PKU-011)
      if (obj.ownerId !== botId) continue;
      const objSessionId =
        (obj.metadata?.['sessionId'] as string | undefined) ??
        (obj.content as { session_id?: string; sessionId?: string })?.session_id ??
        (obj.content as { sessionId?: string })?.sessionId ??
        (obj.content as { identity?: { sessionId?: string } })?.identity?.sessionId;

      if (objSessionId && objSessionId !== sessionId) {
        continue;
      }

      if (obj.type === 'agent.identity' && !botRecord) {
        botRecord = obj.content as BotRecord;
      } else if (obj.type.startsWith('acma.')) {
        const domain = obj.type.slice('acma.'.length) as ACMAMemoryDomain;
        if (domain in cognitiveMemory) {
          cognitiveMemory[domain].push(obj);
        }
        if (domain === 'checkpoint') {
          checkpoints.push(obj.content as ExecutionCheckpoint);
        } else if (domain === 'handoff') {
          handoffs.push(obj.content as HandoffContext);
        }
      }
    }

    return {
      sessionId,
      botId,
      projectUniverseId: primaryPmuId,
      syncStatus: 'reconstructed',
      botRecord,
      broadcastCursor,
      inboxDeliveryState,
      cognitiveMemory,
      checkpoints,
      handoffs,
      reconstructedAt: new Date().toISOString(),
    };
  }
}
