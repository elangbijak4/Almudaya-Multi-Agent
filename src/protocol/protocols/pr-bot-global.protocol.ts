import type { BotRecord } from '../../bot/schema.js';
import { BudgetTracker, type BudgetCheckResult } from '../budget-tracker.js';
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

export interface PrBotGlobalContext {
  sessionId: string;
  requesterBotId?: string;
  config?: ProtocolConfig;
  state?: ProtocolRuntimeState;
  /** Current active global bot count (Master + active/starting/idle workers). */
  activeBotCount?: number;
  /** Optional list of registered bots to inspect for idle recycling. */
  registeredBots?: BotRecord[];
  allowRecycle?: boolean;
  nowMs?: number;
}

/**
 * Selects an idle non-master worker eligible for bot recycling when concurrency ceiling is reached.
 */
export function findRecyclableIdleBot(bots: BotRecord[]): BotRecord | undefined {
  return bots.find(
    (b) => b.role !== 'master' && b.bot_id !== 'BOT000' && b.status === 'idle'
  );
}

/**
 * PrBotGlobal: Global concurrency & budget gate (laptop hardware specs + tokens + wall time).
 * Triggers HITL escalation whenever global limits prevent further spawning.
 */
export class PrBotGlobalCeilingProtocol
  implements IProtocol<PrBotGlobalContext, ProtocolDecision>
{
  public readonly protocolId = 'PrBotGlobal' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private readonly store?: ProtocolStore;
  private readonly budgetTracker?: BudgetTracker;
  private maxGlobalOverride: 'auto' | number = 'auto';

  constructor(store?: ProtocolStore, budgetTracker?: BudgetTracker) {
    this.store = store;
    this.budgetTracker = budgetTracker ?? (store ? new BudgetTracker(store) : undefined);
  }

  public get isEnabled(): boolean {
    return true;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (limits.prBotGlobalMax !== undefined) {
      this.maxGlobalOverride = limits.prBotGlobalMax;
    }
  }

  public async evaluate(
    ctx: PrBotGlobalContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const config =
      ctx.config ?? (this.store ? await this.store.getConfig(ctx.sessionId) : undefined);
    const state =
      ctx.state ??
      (this.store ? await this.store.getRuntimeState(ctx.sessionId) : undefined);

    if (!config || !state) {
      return {
        protocolId: this.protocolId,
        triggered: false,
        priority: 0,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'ALLOW',
          reason: 'No protocol config/state loaded; allowing default execution.',
        },
      };
    }

    const effectiveConfig: ProtocolConfig = {
      ...config,
      prBotGlobalMax:
        this.maxGlobalOverride !== 'auto'
          ? this.maxGlobalOverride
          : config.prBotGlobalMax,
    };

    const tracker = this.budgetTracker;
    const budgetCheck: BudgetCheckResult = tracker
      ? tracker.evaluateBudget(effectiveConfig, state, ctx.nowMs)
      : {
          allowed: true,
          reason: 'No budget tracker configured',
          metrics: {
            totalTokensUsed: 0,
            tokenBudget: effectiveConfig.tokenBudget,
            elapsedMs: 0,
            freeRamMb: 1024,
            minFreeMemoryMb: effectiveConfig.minFreeMemoryMb,
          },
        };

    if (!budgetCheck.allowed) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 0,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'ESCALATE_HITL',
          reason: budgetCheck.reason,
          metadata: {
            limitType: budgetCheck.limitType,
            ...budgetCheck.metrics,
          },
        },
      };
    }

    const effectiveCap = tracker
      ? tracker.resolveHardwareBotCap(effectiveConfig)
      : typeof effectiveConfig.prBotGlobalMax === 'number'
        ? effectiveConfig.prBotGlobalMax
        : state.resolvedHardwareBotCap;

    const currentActive = ctx.activeBotCount ?? state.activeGlobalBotCount;
    if (currentActive >= effectiveCap) {
      const recycleCandidate =
        ctx.allowRecycle !== false && ctx.registeredBots
          ? findRecyclableIdleBot(ctx.registeredBots)
          : undefined;

      if (recycleCandidate) {
        return {
          protocolId: this.protocolId,
          triggered: true,
          priority: 0,
          decision: {
            allowed: true,
            protocol: this.protocolId,
            action: 'ALLOW',
            reason: `Global ceiling (${currentActive}/${effectiveCap}) reached; recycling idle worker ${recycleCandidate.bot_id}.`,
            metadata: {
              currentActive,
              effectiveCap,
              recycleCandidateBotId: recycleCandidate.bot_id,
            },
          },
        };
      }

      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 0,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'ESCALATE_HITL',
          reason: `PrBotGlobal active bot ceiling reached (${currentActive}/${effectiveCap}) and no idle bot is recyclable.`,
          metadata: {
            limitType: 'HARDWARE_CONCURRENCY',
            currentActive,
            effectiveCap,
          },
        },
      };
    }

    return {
      protocolId: this.protocolId,
      triggered: false,
      priority: 0,
      decision: {
        allowed: true,
        protocol: this.protocolId,
        action: 'ALLOW',
        reason: `PrBotGlobal within ceiling (${currentActive}/${effectiveCap}).`,
        metadata: { currentActive, effectiveCap, ...budgetCheck.metrics },
      },
    };
  }

  public async enforce(
    decision: ProtocolDecision,
    ctx: PrBotGlobalContext
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    if (!decision.allowed && decision.action === 'ESCALATE_HITL') {
      await this.store.updateRuntimeState(ctx.sessionId, (current) => ({
        ...current,
        macroLoopStatus: 'PAUSED_HITL',
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
      maxGlobalOverride: this.maxGlobalOverride,
      hardware: this.budgetTracker?.getHardwareSnapshot(),
    };
  }
}
