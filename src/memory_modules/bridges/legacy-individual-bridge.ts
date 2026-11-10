import type { IBlackboardStorage } from '../../blackboard/interface.js';
import type { BotRecord } from '../../bot/schema.js';
import { redactRecursively } from '../../execution/environment.js';
import type { BroadcastCursor, DirectMessage } from '../../messaging/schema.js';
import type { WorkLogEntry } from '../../shared/work-log.js';
import {
  computeContentHash,
  deriveKnowledgeId,
  deriveProjectUniverseId,
} from '../contracts/identity.js';
import { validateRegisterSnapshot } from '../contracts/schemas.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  type ExecutionCheckpoint,
  type HandoffContext,
  type RegisterSnapshot,
} from '../contracts/types.js';
import type { IIndividualRegisterBridge } from '../ports/registers.js';

export interface LegacyIndividualBotState {
  sessionId: string;
  botId: string;
  botRecord: BotRecord | null;
  inboxMessages: DirectMessage[];
  broadcastCursor: BroadcastCursor;
  authoredWorkLogs: WorkLogEntry[];
}

export interface ReadOnlyIndividualBridgeOptions {
  defaultSessionId?: string;
  customSecrets?: string[];
}

/**
 * Capability-Based Read-Only Individual Register Bridge (Phase 2 — Spec §2.3, §7).
 *
 * Adapts the actual per-bot state present in Almudaya v0.3.3 (`BotRecord`, `InboxStore`,
 * `BroadcastCursor`, and bot-authored `WorkLogEntry` records) without inventing a
 * non-existent legacy ACMA class.
 */
export class ReadOnlyIndividualRegisterBridge implements IIndividualRegisterBridge {
  private readonly storage: IBlackboardStorage;
  private readonly options: ReadOnlyIndividualBridgeOptions;

  constructor(storage: IBlackboardStorage, options: ReadOnlyIndividualBridgeOptions = {}) {
    this.storage = storage;
    this.options = options;
  }

  /**
   * Reports only the verified individual-state capabilities present in the v0.3.3 codebase.
   */
  public async discoverCapabilities(): Promise<string[]> {
    return [
      'bot_identity',
      'direct_inbox',
      'broadcast_cursor',
      'session_work_log_slice',
    ];
  }

  /**
   * Loads a read-only view of a bot's individual operational state from `IBlackboardStorage`.
   */
  public async loadIndividualState(
    botId: string,
    sessionId?: string
  ): Promise<LegacyIndividualBotState | null> {
    const resolvedSessionId = sessionId ?? this.options.defaultSessionId;
    if (!resolvedSessionId) {
      return null;
    }

    if (!(await this.storage.sessionExists(resolvedSessionId))) {
      return null;
    }

    const customSecrets = this.options.customSecrets ?? [];
    let botRecord: BotRecord | null = null;
    try {
      botRecord = await this.storage.getBot(resolvedSessionId, botId);
    } catch {
      botRecord = null;
    }

    const canonicalBotId = botRecord?.bot_id ?? botId;
    const inbox = await this.storage.getInbox(resolvedSessionId, canonicalBotId);
    const broadcastCursor = await this.storage.getBroadcastCursor(resolvedSessionId, canonicalBotId);

    let authoredWorkLogs: WorkLogEntry[] = [];
    try {
      const allLogs = await this.storage.readWorkLogs(resolvedSessionId);
      authoredWorkLogs = allLogs.filter(
        (entry) => entry.bot_id.toLowerCase() === canonicalBotId.toLowerCase()
      );
    } catch {
      authoredWorkLogs = [];
    }

    if (!botRecord && inbox.messages.length === 0 && authoredWorkLogs.length === 0) {
      return null;
    }

    return redactRecursively(
      {
        sessionId: resolvedSessionId,
        botId: canonicalBotId,
        botRecord,
        inboxMessages: inbox.messages,
        broadcastCursor,
        authoredWorkLogs,
      },
      customSecrets
    );
  }

  /**
   * Exports a validated canonical `RegisterSnapshot` (`registerKind: 'individual'`)
   * for the specified bot without modifying any legacy files.
   */
  public async exportIndividualSnapshot(
    botId: string,
    sessionId: string,
    projectUniverseId?: string
  ): Promise<RegisterSnapshot<LegacyIndividualBotState> | null> {
    const state = await this.loadIndividualState(botId, sessionId);
    if (!state) {
      return null;
    }

    const customSecrets = this.options.customSecrets ?? [];
    const pmuId =
      projectUniverseId ?? deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);

    const persistedKnowledgeIds: string[] = [];
    if (state.botRecord) {
      persistedKnowledgeIds.push(
        deriveKnowledgeId({
          sourceSystem: 'almudaya.blackboard',
          projectUniverseId: pmuId,
          sessionId,
          sourceType: 'BotRecord',
          sourceRecordId: state.botRecord.bot_id,
        })
      );
    }

    for (const log of state.authoredWorkLogs) {
      persistedKnowledgeIds.push(
        deriveKnowledgeId({
          sourceSystem: 'almudaya.blackboard',
          projectUniverseId: pmuId,
          sessionId,
          sourceType: 'WorkLogEntry',
          sourceRecordId: log.entry_id,
        })
      );
    }

    const nowIso = new Date().toISOString();
    return validateRegisterSnapshot<LegacyIndividualBotState>({
      id: `snap_ind_${sessionId}_${state.botId}`,
      identity: {
        projectUniverseId: pmuId,
        sessionId,
        botId: state.botId,
        principalId: state.botId,
        registerKind: 'individual',
      },
      state,
      syncStatus: 'persisted',
      sourceRevision: computeContentHash(state, customSecrets).slice(0, 16),
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      createdAt: state.botRecord?.joined_at ?? nowIso,
      updatedAt: state.botRecord?.last_seen_at ?? nowIso,
      persistedKnowledgeIds,
    });
  }

  /**
   * No-op in Phase 2 read-only mode.
   */
  public async persistIndividualEvent(
    _botId: string,
    _eventType: string,
    _payload: unknown,
    _idempotencyKey: string
  ): Promise<void> {
    // No-op in Phase 2 read-only mode
  }

  public async saveCheckpoint(
    _checkpoint: ExecutionCheckpoint,
    _idempotencyKey: string
  ): Promise<void> {
    // No-op in Phase 2 read-only mode
  }

  public async recordHandoff(_handoff: HandoffContext, _idempotencyKey: string): Promise<void> {
    // No-op in Phase 2 read-only mode
  }
}
