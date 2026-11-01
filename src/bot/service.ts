import type { IBlackboardStorage } from '../blackboard/interface.js';
import type {
  BotRecord,
  BotStatus,
  RegisterBotInput,
} from './schema.js';
import {
  generateNextBotId,
  generateNextDisplayName,
  validateBotId,
  validateDisplayName,
} from './schema.js';
import {
  BotAlreadyRegisteredError,
  BotNotFoundError,
  DisplayNameConflictError,
} from '../core/errors.js';
import { isProcessRunning } from '../core/lock.js';
import process from 'node:process';

export class BotService {
  private readonly storage: IBlackboardStorage;

  constructor(storage: IBlackboardStorage) {
    this.storage = storage;
  }

  /**
   * Registers a bot in the given session with safe ID and display-name allocation under lock.
   */
  public async registerBot(
    sessionId: string,
    input: RegisterBotInput = {}
  ): Promise<BotRecord> {
    const session = await this.storage.getSession(sessionId);

    return await this.storage.withSessionLock(sessionId, async () => {
      const registry = await this.storage.getBotRegistry(sessionId);
      const existingBotIds = registry.bots.map((b) => b.bot_id);
      const existingDisplayNames = registry.bots.map((b) => b.display_name);

      // Determine stable Bot ID
      let botId: string;
      if (input.botId && input.botId.trim().length > 0) {
        botId = validateBotId(input.botId);
        if (existingBotIds.includes(botId)) {
          throw new BotAlreadyRegisteredError(botId, sessionId);
        }
      } else {
        botId = generateNextBotId(existingBotIds);
      }

      // Determine display name
      let displayName: string;
      if (input.displayName && input.displayName.trim().length > 0) {
        displayName = validateDisplayName(input.displayName);
        const conflict = existingDisplayNames.some(
          (name) => name.toLowerCase() === displayName.toLowerCase()
        );
        if (conflict) {
          throw new DisplayNameConflictError(displayName, sessionId);
        }
      } else {
        displayName = generateNextDisplayName(session.session_name, existingDisplayNames);
      }

      const now = new Date().toISOString();
      const botRecord: BotRecord = {
        bot_id: botId,
        session_id: sessionId,
        display_name: displayName,
        description: input.description?.trim(),
        status: input.status ?? 'active',
        pid: input.pid ?? process.pid,
        joined_at: now,
        last_seen_at: now,
        metadata: input.metadata ?? {},
      };

      registry.bots.push(botRecord);
      registry.updated_at = now;

      await this.storage.saveBotRegistry(sessionId, registry);
      return botRecord;
    });
  }

  /**
   * Discovers peers in a session. Returns all registered bots.
   */
  public async listBots(sessionId: string): Promise<BotRecord[]> {
    return await this.storage.listBots(sessionId);
  }

  /**
   * Retrieves a specific bot by either its stable Bot ID or display name.
   */
  public async getBot(sessionId: string, botIdOrDisplayName: string): Promise<BotRecord> {
    return await this.storage.getBot(sessionId, botIdOrDisplayName);
  }

  /**
   * Resolves a peer identifier (which can be a display name or Bot ID) to a canonical stable Bot ID.
   */
  public async resolveBotId(sessionId: string, identifier: string): Promise<string> {
    const bot = await this.getBot(sessionId, identifier);
    return bot.bot_id;
  }

  /**
   * Renames a bot's display name without changing its stable Bot ID.
   */
  public async renameBot(
    sessionId: string,
    botId: string,
    newDisplayName: string
  ): Promise<BotRecord> {
    const validId = validateBotId(botId);
    const validName = validateDisplayName(newDisplayName);

    return await this.storage.withSessionLock(sessionId, async () => {
      const registry = await this.storage.getBotRegistry(sessionId);
      const targetIndex = registry.bots.findIndex((b) => b.bot_id === validId);

      if (targetIndex === -1) {
        throw new BotNotFoundError(validId, sessionId);
      }

      // Check for name conflicts with other bots
      const conflict = registry.bots.some(
        (b, idx) => idx !== targetIndex && b.display_name.toLowerCase() === validName.toLowerCase()
      );
      if (conflict) {
        throw new DisplayNameConflictError(validName, sessionId);
      }

      const existing = registry.bots[targetIndex]!;
      const now = new Date().toISOString();
      const updated: BotRecord = {
        ...existing,
        display_name: validName,
        last_seen_at: now,
      };

      registry.bots[targetIndex] = updated;
      registry.updated_at = now;

      await this.storage.saveBotRegistry(sessionId, registry);
      return updated;
    });
  }

  /**
   * Updates a bot's status (active, idle, stopped, failed, stale).
   */
  public async updateStatus(
    sessionId: string,
    botId: string,
    status: BotStatus,
    metadata?: Record<string, unknown>
  ): Promise<BotRecord> {
    const validId = validateBotId(botId);

    return await this.storage.withSessionLock(sessionId, async () => {
      const registry = await this.storage.getBotRegistry(sessionId);
      const targetIndex = registry.bots.findIndex((b) => b.bot_id === validId);

      if (targetIndex === -1) {
        throw new BotNotFoundError(validId, sessionId);
      }

      const existing = registry.bots[targetIndex]!;
      const now = new Date().toISOString();
      const updated: BotRecord = {
        ...existing,
        status,
        last_seen_at: now,
        metadata: metadata ? { ...existing.metadata, ...metadata } : existing.metadata,
      };

      registry.bots[targetIndex] = updated;
      registry.updated_at = now;

      await this.storage.saveBotRegistry(sessionId, registry);
      return updated;
    });
  }

  /**
   * Updates a bot's heartbeat timestamp (last_seen_at).
   */
  public async touchHeartbeat(sessionId: string, botId: string): Promise<BotRecord> {
    const validId = validateBotId(botId);

    return await this.storage.withSessionLock(sessionId, async () => {
      const registry = await this.storage.getBotRegistry(sessionId);
      const targetIndex = registry.bots.findIndex((b) => b.bot_id === validId);

      if (targetIndex === -1) {
        throw new BotNotFoundError(validId, sessionId);
      }

      const existing = registry.bots[targetIndex]!;
      const now = new Date().toISOString();
      const updated: BotRecord = {
        ...existing,
        last_seen_at: now,
      };

      registry.bots[targetIndex] = updated;
      registry.updated_at = now;

      await this.storage.saveBotRegistry(sessionId, registry);
      return updated;
    });
  }

  /**
   * Reconciles bot liveness in a session: marks bots as 'stale' if their PID is dead
   * or heartbeat has expired beyond staleThresholdMs.
   */
  public async reconcileBotLiveness(
    sessionId: string,
    staleThresholdMs: number = 10000
  ): Promise<BotRecord[]> {
    return await this.storage.withSessionLock(sessionId, async () => {
      const registry = await this.storage.getBotRegistry(sessionId);
      const now = Date.now();
      let changed = false;

      for (let i = 0; i < registry.bots.length; i++) {
        const bot = registry.bots[i]!;
        if (bot.status === 'active') {
          const lastSeen = new Date(bot.last_seen_at).getTime();
          const isTimeout = now - lastSeen > staleThresholdMs;
          const isPidDead = bot.pid ? !isProcessRunning(bot.pid) : false;

          if (isTimeout || isPidDead) {
            bot.status = 'stale';
            changed = true;
          }
        }
      }

      if (changed) {
        registry.updated_at = new Date().toISOString();
        await this.storage.saveBotRegistry(sessionId, registry);
      }

      return registry.bots;
    });
  }
}
