import type {
  IProtocol,
  ProtocolDecision,
  ProtocolEvaluation,
} from '../contracts.js';
import {
  PROTOCOL_SCHEMA_VERSION,
  type ProtocolConfig,
  type ProtocolRuntimeState,
} from '../schema.js';
import { ProtocolStore } from '../store.js';

export interface PrBotContext {
  sessionId: string;
  requesterBotId?: string;
  config?: ProtocolConfig;
  state?: ProtocolRuntimeState;
  requestedSpawns?: number;
}

/**
 * PrBot: Atomic protocol enforcing cumulative worker spawn quota per session.
 */
export class PrBotSpawnQuotaProtocol
  implements IProtocol<PrBotContext, ProtocolDecision>
{
  public readonly protocolId = 'PrBot' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private limit: number;
  private readonly store?: ProtocolStore;

  constructor(store?: ProtocolStore, initialLimit = 10) {
    this.store = store;
    this.limit = Math.max(1, initialLimit);
  }

  public get isEnabled(): boolean {
    return true;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (typeof limits.prBotLimit === 'number') {
      this.limit = Math.max(1, limits.prBotLimit);
    }
  }

  public async evaluate(ctx: PrBotContext): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const config =
      ctx.config ?? (this.store ? await this.store.getConfig(ctx.sessionId) : undefined);
    const state =
      ctx.state ??
      (this.store ? await this.store.getRuntimeState(ctx.sessionId) : undefined);

    const effectiveLimit = config?.prBotLimit ?? this.limit;
    const currentSpawned = state?.totalSpawnedWorkers ?? 0;
    const requested = Math.max(1, ctx.requestedSpawns ?? 1);
    const projected = currentSpawned + requested;

    if (projected > effectiveLimit) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 5,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `Cumulative worker spawn limit reached (${currentSpawned}/${effectiveLimit}).`,
          metadata: {
            currentSpawned,
            effectiveLimit,
            requested,
            requesterBotId: ctx.requesterBotId,
          },
        },
      };
    }

    return {
      protocolId: this.protocolId,
      triggered: false,
      priority: 5,
      decision: {
        allowed: true,
        protocol: this.protocolId,
        action: 'ALLOW',
        reason: `Cumulative worker spawn quota available (${projected}/${effectiveLimit}).`,
        metadata: { currentSpawned, effectiveLimit, projected },
      },
    };
  }

  public async enforce(decision: ProtocolDecision, ctx: PrBotContext): Promise<void> {
    if (!this.store) {
      return;
    }

    if (decision.allowed) {
      const increment = Math.max(1, ctx.requestedSpawns ?? 1);
      await this.store.updateRuntimeState(ctx.sessionId, (current) => ({
        ...current,
        totalSpawnedWorkers: current.totalSpawnedWorkers + increment,
      }));
    }

    await this.store.recordEvent(ctx.sessionId, {
      protocolId: this.protocolId,
      action: decision.action,
      actorBotId: ctx.requesterBotId,
      reason: decision.reason,
      metadata: decision.metadata ?? {},
    });
  }

  public getStateSnapshot(): Record<string, unknown> {
    return {
      protocolId: this.protocolId,
      prBotLimit: this.limit,
    };
  }
}
