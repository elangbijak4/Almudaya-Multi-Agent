import type { IBlackboardStorage } from '../../blackboard/interface.js';
import type { BotRecord } from '../../bot/schema.js';
import type { BroadcastEvent } from '../../messaging/schema.js';
import type { SessionMetadata } from '../../session/schema.js';
import type {
  EnvironmentMetadata,
  ProjectRootRecord,
  SdlcDocumentRecord,
} from '../../shared/schema.js';
import type { WorkLogEntry } from '../../shared/work-log.js';
import {
  ReadOnlyBlackboardCompatibilityBridge,
  type LegacySessionExportBundle,
  type ReadOnlyBlackboardBridgeOptions,
} from '../bridges/legacy-blackboard-bridge.js';
import {
  computeContentHash,
  deriveMemoryEventId,
  deriveProjectUniverseId,
} from '../contracts/identity.js';
import type {
  ProjectUniverseId,
  RegisterSyncStatus,
} from '../contracts/types.js';
import {
  DurableOutboxQueue,
  ShadowIngestionService,
  type ShadowIngestionResult,
} from '../pku/shadow-ingestion.js';
import type { IPKUStore } from '../ports/pku-store.js';
import type {
  IGlobalRegisterBridge,
  IRegisterPersistence,
} from '../ports/registers.js';

export interface ReconstructedGlobalRegisterState {
  sessionId: string;
  projectUniverseId: ProjectUniverseId;
  syncStatus: RegisterSyncStatus;
  session: SessionMetadata | null;
  projectRoots: ProjectRootRecord[];
  bots: BotRecord[];
  environmentMetadata: EnvironmentMetadata | null;
  sdlcDocuments: SdlcDocumentRecord[];
  broadcastEvents: BroadcastEvent[];
  workLogEntries: WorkLogEntry[];
  reconstructedAt: string;
}

export interface GlobalRegisterDiagnostics {
  mode: 'read_only' | 'capture' | 'read_through';
  enabled: boolean;
  syncStatus: RegisterSyncStatus;
  capturedEventCount: number;
  outageCount: number;
  lastError?: string;
}

/**
 * Blackboard Global Register Bridge (Phase 4 — Spec §6, §13, PKU-004, PKU-010, PKU-019).
 *
 * Wraps `IBlackboardStorage` without altering existing Blackboard APIs or storage paths.
 * Supports:
 * - `read_only`: inspects and exports sessions without writing to PKU.
 * - `capture`: shadows qualifying Global Register mutations and snapshots into PKU with outage safety.
 * - `read_through`: enables reconstructing Global Register state from PKU (`PKU-010`).
 */
export class BlackboardGlobalRegisterBridge implements IGlobalRegisterBridge {
  public readonly storage: IBlackboardStorage;
  private currentMode: 'read_only' | 'capture' | 'read_through';
  private enabled: boolean;
  private readonly pkuStore: IPKUStore & IRegisterPersistence;
  private readonly readOnlyBridge: ReadOnlyBlackboardCompatibilityBridge;
  private readonly outbox: DurableOutboxQueue;
  private syncStatus: RegisterSyncStatus = 'persisted';
  private capturedEventCount = 0;
  private outageCount = 0;
  private lastError?: string;

  constructor(
    storage: IBlackboardStorage,
    pkuStore: IPKUStore & IRegisterPersistence,
    options: {
      mode?: 'read_only' | 'capture' | 'read_through';
      enabled?: boolean;
      outbox?: DurableOutboxQueue;
      bridgeOptions?: ReadOnlyBlackboardBridgeOptions;
    } = {}
  ) {
    this.storage = storage;
    this.pkuStore = pkuStore;
    this.currentMode = options.mode ?? 'capture';
    this.enabled = options.enabled ?? true;
    this.outbox = options.outbox ?? new DurableOutboxQueue();
    this.readOnlyBridge = new ReadOnlyBlackboardCompatibilityBridge(
      storage,
      options.bridgeOptions
    );
  }

  public get mode(): 'read_only' | 'capture' | 'read_through' {
    return this.currentMode;
  }

  public setMode(mode: 'read_only' | 'capture' | 'read_through'): void {
    this.currentMode = mode;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public getDiagnostics(): GlobalRegisterDiagnostics {
    return {
      mode: this.currentMode,
      enabled: this.enabled,
      syncStatus: this.syncStatus,
      capturedEventCount: this.capturedEventCount,
      outageCount: this.outageCount,
      lastError: this.lastError,
    };
  }

  /**
   * Exports a legacy session using the underlying read-only compatibility bridge.
   */
  public async exportSession(
    sessionId: string,
    options?: ReadOnlyBlackboardBridgeOptions
  ): Promise<LegacySessionExportBundle> {
    return await this.readOnlyBridge.exportSession(sessionId, options);
  }

  /**
   * Captures a full session state snapshot and its qualifying records into PKU.
   * If PKU is disabled or experiences an outage, fails open and preserves legacy coordination (`PKU-004`, `PKU-019`).
   */
  public async syncSessionToPKU(
    sessionId: string,
    options?: ReadOnlyBlackboardBridgeOptions
  ): Promise<ShadowIngestionResult | null> {
    if (!this.enabled || this.currentMode === 'read_only') {
      return null;
    }

    try {
      const bundle = await this.readOnlyBridge.exportSession(sessionId, options);
      const ingestion = new ShadowIngestionService(this.pkuStore, this.outbox);
      const res = await ingestion.ingestExportBundle(bundle);
      this.syncStatus = 'persisted';
      this.lastError = undefined;
      return res;
    } catch (err: unknown) {
      this.outageCount++;
      this.syncStatus = 'synchronization_failed';
      this.lastError = (err as Error).message;
      return null;
    }
  }

  /**
   * Captures an individual Global Register event into PKU.
   * Never throws on PKU outage so legacy Blackboard operations remain 100% unaffected (`PKU-004`).
   */
  public async captureEvent(
    sessionId: string,
    eventType: string,
    payload: unknown,
    idempotencyKey: string
  ): Promise<void> {
    if (!this.enabled || this.currentMode === 'read_only') {
      return;
    }

    const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);
    const nowIso = new Date().toISOString();
    const evtId = deriveMemoryEventId({
      sourceSystem: 'almudaya.blackboard',
      sessionId,
      sourceType: eventType,
      sourceRecordId: idempotencyKey,
    });

    const eventRecord = {
      id: evtId,
      eventType,
      identity: {
        projectUniverseId: pmuId,
        sessionId,
        principalId: 'SYSTEM',
        registerKind: 'global' as const,
      },
      payload,
      occurredAt: nowIso,
      recordedAt: nowIso,
      idempotencyKey,
      provenance: {
        sourceSystem: 'almudaya.blackboard',
        sourceType: eventType,
        sourceId: evtId,
        createdAt: nowIso,
        ingestedAt: nowIso,
        contentHash: computeContentHash(payload),
        originProjectUniverseId: pmuId,
      },
    };

    try {
      await this.pkuStore.appendEvent(eventRecord, idempotencyKey);
      this.capturedEventCount++;
      this.syncStatus = 'persisted';
      this.lastError = undefined;
    } catch (err: unknown) {
      this.outageCount++;
      this.syncStatus = 'synchronization_failed';
      this.lastError = (err as Error).message;
      this.outbox.enqueue(idempotencyKey, 'append_event', eventRecord);
    }
  }

  /**
   * Reconstructs the Global Register state from PKU snapshots, knowledge objects,
   * and event streams (`PKU-010`).
   */
  public async reconstructGlobalRegister(
    sessionId: string,
    projectUniverseId?: ProjectUniverseId
  ): Promise<ReconstructedGlobalRegisterState> {
    // Resolve target PMU(s) associated with this session
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

    // Query all KnowledgeObjects across the session's universes
    const koResult = await this.pkuStore.queryKnowledge({
      projectUniverseIds: targetUniverseIds,
      includeArchived: true,
      limit: 1000,
    });

    let sessionMeta: SessionMetadata | null = null;
    const projectRoots: ProjectRootRecord[] = [];
    const bots: BotRecord[] = [];
    let environmentMetadata: EnvironmentMetadata | null = null;
    const sdlcDocuments: SdlcDocumentRecord[] = [];

    for (const obj of koResult.items) {
      if (obj.type === 'session.metadata' && obj.ownerId === sessionId) {
        sessionMeta = obj.content as SessionMetadata;
      } else if (obj.type === 'project.root') {
        projectRoots.push(obj.content as ProjectRootRecord);
      } else if (obj.type === 'agent.identity') {
        const bot = obj.content as BotRecord;
        if (bot.session_id === sessionId) {
          bots.push(bot);
        }
      } else if (obj.type === 'session.environment' && obj.ownerId === sessionId) {
        environmentMetadata = obj.content as EnvironmentMetadata;
      } else if (obj.type === 'sdlc.document') {
        sdlcDocuments.push(obj.content as SdlcDocumentRecord);
      }
    }

    // Fallback to Global RegisterSnapshot if session.metadata object wasn't found directly
    if (!sessionMeta) {
      const snap = await this.pkuStore.loadSnapshot<{ session?: SessionMetadata }>({
        projectUniverseId: primaryPmuId,
        sessionId,
        principalId: 'SYSTEM',
        registerKind: 'global',
      });
      if (snap?.state?.session) {
        sessionMeta = snap.state.session;
      }
    }

    // Reconstruct ordered BroadcastEvents and WorkLogEntries from the PKU event log
    const broadcastEvents: BroadcastEvent[] = [];
    const workLogEntries: WorkLogEntry[] = [];

    if (this.pkuStore.listEvents) {
      for (const uid of targetUniverseIds) {
        const events = await this.pkuStore.listEvents(uid);
        for (const evt of events) {
          if (evt.identity.sessionId !== sessionId) continue;
          if (evt.eventType.startsWith('broadcast.')) {
            broadcastEvents.push(evt.payload as BroadcastEvent);
          } else if (evt.eventType.startsWith('work_log.')) {
            workLogEntries.push(evt.payload as WorkLogEntry);
          }
        }
      }
    }

    // Sort deterministically to preserve exact source sequence/timestamp ordering (PKU-010)
    projectRoots.sort((a, b) => a.root_id.localeCompare(b.root_id));
    bots.sort((a, b) => a.bot_id.localeCompare(b.bot_id));
    sdlcDocuments.sort((a, b) => a.document_id.localeCompare(b.document_id));

    return {
      sessionId,
      projectUniverseId: primaryPmuId,
      syncStatus: 'reconstructed',
      session: sessionMeta,
      projectRoots,
      bots,
      environmentMetadata,
      sdlcDocuments,
      broadcastEvents,
      workLogEntries,
      reconstructedAt: new Date().toISOString(),
    };
  }
}
