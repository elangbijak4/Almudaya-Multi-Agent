import type { BotRecord } from '../../bot/schema.js';
import { isProcessRunning } from '../../core/lock.js';
import type {
  IProtocol,
  ProtocolDecision,
  ProtocolEvaluation,
} from '../contracts.js';
import {
  PROTOCOL_SCHEMA_VERSION,
  type ProtocolConfig,
} from '../schema.js';
import { ProtocolStore } from '../store.js';

export type ReattachDisposition = 'REATTACH' | 'RESPAWN' | 'ALREADY_STOPPED';

export interface ReattachCandidate {
  botId: string;
  displayName: string;
  pid?: number;
  status: BotRecord['status'];
  disposition: ReattachDisposition;
  reason: string;
}

export interface PrReattachContext {
  sessionId: string;
  registeredBots: BotRecord[];
  processChecker?: (pid: number) => boolean;
  config?: ProtocolConfig;
}

/**
 * PrReattach: Safe session resume / reconnect protocol.
 * Uses OS PID liveness checks to avoid duplicate Master/Worker spawning on resume.
 */
export class PrSessionReattachProtocol
  implements IProtocol<PrReattachContext, ProtocolDecision>
{
  public readonly protocolId = 'PrReattach' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private enabled = true;
  private readonly store?: ProtocolStore;

  constructor(store?: ProtocolStore) {
    this.store = store;
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (typeof limits.prReattachEnabled === 'boolean') {
      this.enabled = limits.prReattachEnabled;
    }
  }

  public classifyBots(
    bots: BotRecord[],
    processChecker: (pid: number) => boolean = isProcessRunning
  ): ReattachCandidate[] {
    return bots.map((bot) => {
      const terminalStates: Set<BotRecord['status']> = new Set([
        'stopped',
        'recycled',
        'failed',
        'stale',
      ]);

      if (terminalStates.has(bot.status)) {
        return {
          botId: bot.bot_id,
          displayName: bot.display_name,
          pid: bot.pid,
          status: bot.status,
          disposition: 'ALREADY_STOPPED',
          reason: `Bot ${bot.bot_id} is in terminal/stopped state (${bot.status}).`,
        };
      }

      const alive = bot.pid !== undefined && processChecker(bot.pid);
      if (alive) {
        return {
          botId: bot.bot_id,
          displayName: bot.display_name,
          pid: bot.pid,
          status: bot.status,
          disposition: 'REATTACH',
          reason: `PID ${bot.pid} is still alive; reattaching without spawning duplicate.`,
        };
      }

      return {
        botId: bot.bot_id,
        displayName: bot.display_name,
        pid: bot.pid,
        status: bot.status,
        disposition: 'RESPAWN',
        reason: `Bot ${bot.bot_id} marked ${bot.status} but PID ${bot.pid ?? 'none'} is dead; safe to respawn.`,
      };
    });
  }

  public async evaluate(
    ctx: PrReattachContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const config =
      ctx.config ?? (this.store ? await this.store.getConfig(ctx.sessionId) : undefined);
    const active = config?.prReattachEnabled ?? this.enabled;
    const candidates = this.classifyBots(ctx.registeredBots, ctx.processChecker);

    const reattachCount = candidates.filter((c) => c.disposition === 'REATTACH').length;
    const respawnCount = candidates.filter((c) => c.disposition === 'RESPAWN').length;
    const triggered = active && (reattachCount > 0 || respawnCount > 0);

    return {
      protocolId: this.protocolId,
      triggered,
      priority: 0,
      decision: {
        allowed: true,
        protocol: this.protocolId,
        action: respawnCount > 0 && reattachCount === 0 ? 'RESPAWNED' : 'REATTACHED',
        reason: `PrReattach scanned ${candidates.length} bot(s): ${reattachCount} live reattach, ${respawnCount} dead respawn.`,
        metadata: {
          candidates,
          reattachCount,
          respawnCount,
        },
      },
    };
  }

  public async enforce(
    decision: ProtocolDecision,
    ctx: PrReattachContext
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.recordEvent(ctx.sessionId, {
      protocolId: this.protocolId,
      action: decision.action,
      actorBotId: 'BOT000',
      reason: decision.reason,
      metadata: decision.metadata ?? {},
    });
  }

  public getStateSnapshot(): Record<string, unknown> {
    return {
      protocolId: this.protocolId,
      prReattachEnabled: this.enabled,
    };
  }
}
