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

export interface PrDeContext {
  sessionId: string;
  threadId: string;
  senderBotId?: string;
  recipientBotId?: string;
  exchangeCount?: number;
  progressDeltaScore?: number;
  config?: ProtocolConfig;
  state?: ProtocolRuntimeState;
}

/**
 * PrDE: Dead-End Negotiation & Circular Zero-Progress Relay protocol.
 * Replaces arbitrary ping-pong loops with Master mediation or HITL escalation.
 */
export class PrDeadEndMediationProtocol
  implements IProtocol<PrDeContext, ProtocolDecision>
{
  public readonly protocolId = 'PrDE' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private exchangeLimit = 10;
  private escalationLimit = 10;
  private noProgressLimit = 5;
  private readonly store?: ProtocolStore;

  constructor(store?: ProtocolStore) {
    this.store = store;
  }

  public get isEnabled(): boolean {
    return true;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (typeof limits.prDeLimit === 'number') {
      this.exchangeLimit = Math.max(1, limits.prDeLimit);
    }
    if (typeof limits.prDeEscalationLimit === 'number') {
      this.escalationLimit = Math.max(1, limits.prDeEscalationLimit);
    }
    if (typeof limits.prNoProgressLimit === 'number') {
      this.noProgressLimit = Math.max(1, limits.prNoProgressLimit);
    }
  }

  public async evaluate(ctx: PrDeContext): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const config =
      ctx.config ?? (this.store ? await this.store.getConfig(ctx.sessionId) : undefined);
    const state =
      ctx.state ??
      (this.store ? await this.store.getRuntimeState(ctx.sessionId) : undefined);

    const maxExchanges = config?.prDeLimit ?? this.exchangeLimit;
    const maxEscalations = config?.prDeEscalationLimit ?? this.escalationLimit;
    const maxNoProgress = config?.prNoProgressLimit ?? this.noProgressLimit;

    const existingThread = state?.threads[ctx.threadId];
    const nextExchangeCount = ctx.exchangeCount ?? (existingThread?.exchangeCount ?? 0) + 1;

    const zeroProgressIncrement = ctx.progressDeltaScore === 0 ? 1 : 0;
    const currentNoProgress =
      ctx.progressDeltaScore !== undefined && ctx.progressDeltaScore > 0
        ? 0
        : (state?.noProgressHandoffCount ?? 0) + zeroProgressIncrement;

    const exchangeDeadEnd = nextExchangeCount >= maxExchanges;
    const circularNoProgress =
      ctx.progressDeltaScore === 0 && currentNoProgress >= maxNoProgress;

    if (!exchangeDeadEnd && !circularNoProgress) {
      return {
        protocolId: this.protocolId,
        triggered: false,
        priority: 2,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'CONTINUE',
          reason: `Thread ${ctx.threadId} within PrDE thresholds (exchanges=${nextExchangeCount}/${maxExchanges}).`,
          metadata: {
            threadId: ctx.threadId,
            nextExchangeCount,
            currentNoProgress,
          },
        },
      };
    }

    const totalTriggers = (state?.totalPrDeTriggers ?? 0) + 1;
    const reasonTag = circularNoProgress ? 'CIRCULAR_ZERO_PROGRESS' : 'EXCHANGE_LIMIT';

    if (totalTriggers >= maxEscalations) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 2,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'ESCALATE_HITL',
          reason: `PrDE session escalation limit reached (${totalTriggers}/${maxEscalations}) via ${reasonTag}.`,
          metadata: {
            threadId: ctx.threadId,
            reasonTag,
            totalTriggers,
            maxEscalations,
          },
        },
      };
    }

    return {
      protocolId: this.protocolId,
      triggered: true,
      priority: 2,
      decision: {
        allowed: false,
        protocol: this.protocolId,
        action: 'MASTER_MEDIATION',
        reason: `PrDE triggered (${reasonTag}) on thread ${ctx.threadId}; escalating to Master Bot mediation.`,
        metadata: {
          threadId: ctx.threadId,
          reasonTag,
          nextExchangeCount,
          currentNoProgress,
          totalTriggers,
        },
      },
    };
  }

  public async enforce(decision: ProtocolDecision, ctx: PrDeContext): Promise<void> {
    if (!this.store) {
      return;
    }

    const now = new Date().toISOString();
    await this.store.updateRuntimeState(ctx.sessionId, (current) => {
      const existing = current.threads[ctx.threadId];
      const participantSet = new Set(existing?.participants ?? []);
      if (ctx.senderBotId) participantSet.add(ctx.senderBotId);
      if (ctx.recipientBotId) participantSet.add(ctx.recipientBotId);

      const nextStatus = !decision.allowed
        ? decision.action === 'ESCALATE_HITL'
          ? 'ESCALATED_HITL'
          : 'MEDIATING'
        : 'ACTIVE';

      const noProgressCount =
        ctx.progressDeltaScore === undefined
          ? current.noProgressHandoffCount
          : ctx.progressDeltaScore > 0
            ? 0
            : current.noProgressHandoffCount + 1;

      const updatedThread = {
        threadId: ctx.threadId,
        participants: Array.from(participantSet),
        exchangeCount: ctx.exchangeCount ?? (existing?.exchangeCount ?? 0) + 1,
        startedAt: existing?.startedAt ?? now,
        lastMessageAt: now,
        status: nextStatus as 'ACTIVE' | 'MEDIATING' | 'RESOLVED' | 'ESCALATED_HITL',
        resolution: !decision.allowed ? decision.reason : existing?.resolution,
      };

      return {
        ...current,
        noProgressHandoffCount: noProgressCount,
        totalPrDeTriggers: !decision.allowed
          ? current.totalPrDeTriggers + 1
          : current.totalPrDeTriggers,
        macroLoopStatus:
          decision.action === 'ESCALATE_HITL' ? 'PAUSED_HITL' : current.macroLoopStatus,
        threads: {
          ...current.threads,
          [ctx.threadId]: updatedThread,
        },
      };
    });

    if (!decision.allowed) {
      await this.store.recordEvent(ctx.sessionId, {
        protocolId: this.protocolId,
        action: decision.action,
        actorBotId: ctx.senderBotId,
        threadId: ctx.threadId,
        reason: decision.reason,
        metadata: decision.metadata ?? {},
      });
    }
  }

  public getStateSnapshot(): Record<string, unknown> {
    return {
      protocolId: this.protocolId,
      prDeLimit: this.exchangeLimit,
      prDeEscalationLimit: this.escalationLimit,
      prNoProgressLimit: this.noProgressLimit,
    };
  }
}
