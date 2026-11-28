import path from 'node:path';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import {
  atomicWriteJson,
  ensureDir,
  pathExists,
  readJsonValidated,
} from '../core/fs-utils.js';
import { appendJsonlRecord, readJsonlFile } from '../core/jsonl.js';
import { redactRecursively, redactSecrets } from '../execution/environment.js';
import {
  DynamicRulesStoreSchema,
  GoalLedgerSchema,
  ModeratorStateSchema,
  ProtocolConfigSchema,
  ProtocolEventSchema,
  ProtocolRuntimeStateSchema,
  createDefaultGoalLedger,
  createDefaultModeratorState,
  createDefaultProtocolConfig,
  createDefaultRuntimeState,
  generateProtocolId,
  type DynamicRulesStore,
  type GoalLedger,
  type ModeratorState,
  type ProtocolConfig,
  type ProtocolEvent,
  type ProtocolRuntimeState,
} from './schema.js';

/**
 * Atomic persistence layer for all v0.3.5 protocol artifacts under
 * `<sessionDir>/protocol/`.
 */
export class ProtocolStore {
  private readonly storage: IBlackboardStorage;

  constructor(storage: IBlackboardStorage) {
    this.storage = storage;
  }

  public getStorage(): IBlackboardStorage {
    return this.storage;
  }

  public getProtocolDir(sessionId: string): string {
    return path.join(this.storage.getSessionDir(sessionId), 'protocol');
  }

  public getWorkspaceRoot(): string | undefined {
    const candidate = this.storage as { workspaceRoot?: unknown };
    return typeof candidate.workspaceRoot === 'string' ? candidate.workspaceRoot : undefined;
  }

  public getCheckpointsDir(sessionId: string): string {
    return path.join(this.getProtocolDir(sessionId), 'checkpoints');
  }

  private getConfigPath(sessionId: string): string {
    return path.join(this.getProtocolDir(sessionId), 'config.json');
  }

  private getStatePath(sessionId: string): string {
    return path.join(this.getProtocolDir(sessionId), 'state.json');
  }

  private getGoalLedgerPath(sessionId: string): string {
    return path.join(this.getProtocolDir(sessionId), 'goal_ledger.json');
  }

  private getDynamicRulesPath(sessionId: string): string {
    return path.join(this.getProtocolDir(sessionId), 'dynamic_rules.json');
  }

  private getModeratorStatePath(sessionId: string): string {
    return path.join(this.getProtocolDir(sessionId), 'moderator_state.json');
  }

  private getEventsPath(sessionId: string): string {
    return path.join(this.getProtocolDir(sessionId), 'events.jsonl');
  }

  public async hasProtocolConfig(sessionId: string): Promise<boolean> {
    return await pathExists(this.getConfigPath(sessionId));
  }

  public async getConfig(sessionId: string): Promise<ProtocolConfig> {
    const filePath = this.getConfigPath(sessionId);
    if (!(await pathExists(filePath))) {
      return createDefaultProtocolConfig();
    }
    return await readJsonValidated(filePath, ProtocolConfigSchema);
  }

  public async saveConfig(sessionId: string, config: ProtocolConfig): Promise<ProtocolConfig> {
    const validated = ProtocolConfigSchema.parse(config);
    return await this.storage.withSessionLock(sessionId, async () => {
      await ensureDir(this.getProtocolDir(sessionId));
      await atomicWriteJson(this.getConfigPath(sessionId), validated);
      return validated;
    });
  }

  public async updateConfig(
    sessionId: string,
    updater: (current: ProtocolConfig) => ProtocolConfig
  ): Promise<ProtocolConfig> {
    return await this.storage.withSessionLock(sessionId, async () => {
      const current = await this.getConfig(sessionId);
      const next = ProtocolConfigSchema.parse(updater(current));
      await ensureDir(this.getProtocolDir(sessionId));
      await atomicWriteJson(this.getConfigPath(sessionId), next);
      return next;
    });
  }

  public async getRuntimeState(sessionId: string): Promise<ProtocolRuntimeState> {
    const filePath = this.getStatePath(sessionId);
    if (!(await pathExists(filePath))) {
      return createDefaultRuntimeState();
    }
    return await readJsonValidated(filePath, ProtocolRuntimeStateSchema);
  }

  public async saveRuntimeState(
    sessionId: string,
    state: ProtocolRuntimeState
  ): Promise<ProtocolRuntimeState> {
    const validated = ProtocolRuntimeStateSchema.parse(state);
    return await this.storage.withSessionLock(sessionId, async () => {
      await ensureDir(this.getProtocolDir(sessionId));
      await atomicWriteJson(this.getStatePath(sessionId), validated);
      return validated;
    });
  }

  public async updateRuntimeState(
    sessionId: string,
    updater: (current: ProtocolRuntimeState) => ProtocolRuntimeState
  ): Promise<ProtocolRuntimeState> {
    return await this.storage.withSessionLock(sessionId, async () => {
      const current = await this.getRuntimeState(sessionId);
      const next = ProtocolRuntimeStateSchema.parse(updater(current));
      await ensureDir(this.getProtocolDir(sessionId));
      await atomicWriteJson(this.getStatePath(sessionId), next);
      return next;
    });
  }

  public async getGoalLedger(sessionId: string): Promise<GoalLedger> {
    const filePath = this.getGoalLedgerPath(sessionId);
    if (!(await pathExists(filePath))) {
      return createDefaultGoalLedger(sessionId);
    }
    return await readJsonValidated(filePath, GoalLedgerSchema);
  }

  public async saveGoalLedger(sessionId: string, ledger: GoalLedger): Promise<GoalLedger> {
    const validated = GoalLedgerSchema.parse(ledger);
    return await this.storage.withSessionLock(sessionId, async () => {
      await ensureDir(this.getProtocolDir(sessionId));
      await atomicWriteJson(this.getGoalLedgerPath(sessionId), validated);
      return validated;
    });
  }

  public async updateGoalLedger(
    sessionId: string,
    updater: (current: GoalLedger) => GoalLedger
  ): Promise<GoalLedger> {
    return await this.storage.withSessionLock(sessionId, async () => {
      const current = await this.getGoalLedger(sessionId);
      const next = GoalLedgerSchema.parse(updater(current));
      await ensureDir(this.getProtocolDir(sessionId));
      await atomicWriteJson(this.getGoalLedgerPath(sessionId), next);
      return next;
    });
  }

  public async getDynamicRulesStore(sessionId: string): Promise<DynamicRulesStore> {
    const filePath = this.getDynamicRulesPath(sessionId);
    if (!(await pathExists(filePath))) {
      return {
        sessionId,
        rules: [],
        updatedAt: new Date().toISOString(),
      };
    }
    return await readJsonValidated(filePath, DynamicRulesStoreSchema);
  }

  public async updateDynamicRulesStore(
    sessionId: string,
    updater: (current: DynamicRulesStore) => DynamicRulesStore
  ): Promise<DynamicRulesStore> {
    return await this.storage.withSessionLock(sessionId, async () => {
      const current = await this.getDynamicRulesStore(sessionId);
      const next = DynamicRulesStoreSchema.parse(updater(current));
      await ensureDir(this.getProtocolDir(sessionId));
      await atomicWriteJson(this.getDynamicRulesPath(sessionId), next);
      return next;
    });
  }

  public async getModeratorState(sessionId: string): Promise<ModeratorState> {
    const filePath = this.getModeratorStatePath(sessionId);
    if (!(await pathExists(filePath))) {
      const cfg = await this.getConfig(sessionId);
      return createDefaultModeratorState(cfg.moderatorBotId);
    }
    return await readJsonValidated(filePath, ModeratorStateSchema);
  }

  public async updateModeratorState(
    sessionId: string,
    updater: (current: ModeratorState) => ModeratorState
  ): Promise<ModeratorState> {
    return await this.storage.withSessionLock(sessionId, async () => {
      const current = await this.getModeratorState(sessionId);
      const next = ModeratorStateSchema.parse(updater(current));
      await ensureDir(this.getProtocolDir(sessionId));
      await atomicWriteJson(this.getModeratorStatePath(sessionId), next);
      return next;
    });
  }

  public async recordEvent(
    sessionId: string,
    input: Omit<ProtocolEvent, 'eventId' | 'timestamp' | 'sessionId' | 'metadata'> & {
      metadata?: Record<string, unknown>;
    }
  ): Promise<ProtocolEvent> {
    const event: ProtocolEvent = ProtocolEventSchema.parse({
      eventId: generateProtocolId('PEVT'),
      timestamp: new Date().toISOString(),
      sessionId,
      protocolId: input.protocolId,
      action: input.action,
      actorBotId: input.actorBotId,
      taskId: input.taskId,
      threadId: input.threadId,
      tokenId: input.tokenId,
      fenceEpoch: input.fenceEpoch,
      reason: redactSecrets(input.reason),
      metadata: redactRecursively(input.metadata ?? {}),
    });

    await this.storage.withSessionLock(sessionId, async () => {
      await appendJsonlRecord(this.getEventsPath(sessionId), event, ProtocolEventSchema);
    });

    return event;
  }

  public async readEvents(sessionId: string, limit?: number): Promise<ProtocolEvent[]> {
    const res = await readJsonlFile(this.getEventsPath(sessionId), ProtocolEventSchema);
    if (limit && limit > 0) {
      return res.records.slice(-limit);
    }
    return res.records;
  }
}
