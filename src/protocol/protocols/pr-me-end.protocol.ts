import type {
  IProtocol,
  ProtocolDecision,
  ProtocolEvaluation,
} from '../contracts.js';
import { GoalLedgerService } from '../goal-ledger.js';
import {
  PROTOCOL_SCHEMA_VERSION,
  type ProtocolConfig,
} from '../schema.js';
import { ProtocolStore } from '../store.js';

export interface PrMeEndContext {
  sessionId: string;
  senderBotId: string;
  recipientBotId?: string;
  recipientExists?: boolean;
  isTaskZero?: boolean;
  messageContent?: string;
  hasSentLoopMessage?: boolean;
  hasOpenGoalTasks?: boolean;
  config?: ProtocolConfig;
}

/**
 * PrMEend: 2-layer end-of-turn & deadlock message router.
 * Layer 1 (0-token programmatic filter): passes clean direct loop messages with valid recipients.
 * Layer 2 (Master interception): catches missing recipients, UNKNOWN destinations, or premature TASK_0.
 */
export class PrMessageEndRoutingProtocol
  implements IProtocol<PrMeEndContext, ProtocolDecision>
{
  public readonly protocolId = 'PrMEend' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private enabled = true;
  private readonly store?: ProtocolStore;
  private readonly ledger?: GoalLedgerService;

  constructor(store?: ProtocolStore, ledger?: GoalLedgerService) {
    this.store = store;
    this.ledger = ledger ?? (store ? new GoalLedgerService(store) : undefined);
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (typeof limits.prMeEndEnabled === 'boolean') {
      this.enabled = limits.prMeEndEnabled;
    }
  }

  public async evaluate(
    ctx: PrMeEndContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const config =
      ctx.config ?? (this.store ? await this.store.getConfig(ctx.sessionId) : undefined);
    const active = config?.prMeEndEnabled ?? this.enabled;

    if (!active) {
      return {
        protocolId: this.protocolId,
        triggered: false,
        priority: 3,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'CONTINUE',
          reason: 'PrMEend disabled by config.',
        },
      };
    }

    const normalizedRecipient = ctx.recipientBotId?.trim().toUpperCase();
    const isTaskZero =
      ctx.isTaskZero === true ||
      Boolean(ctx.messageContent && /\bTASK_0\b/i.test(ctx.messageContent));

    const missingLoopMessage =
      ctx.hasSentLoopMessage === false && !normalizedRecipient && !isTaskZero;

    const unknownRecipient =
      !isTaskZero &&
      (normalizedRecipient === 'UNKNOWN' ||
        normalizedRecipient === '' ||
        (normalizedRecipient !== undefined && ctx.recipientExists === false) ||
        missingLoopMessage);

    // Layer 1 fast-path: valid known recipient & not TASK_0 -> 0-token pass + CC: MASTER
    if (!isTaskZero && !unknownRecipient && normalizedRecipient) {
      return {
        protocolId: this.protocolId,
        triggered: false,
        priority: 3,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'CONTINUE',
          reason: `Layer-1 fast-path: valid loop message from ${ctx.senderBotId} to ${ctx.recipientBotId} (CC: MASTER).`,
          metadata: {
            layer: 1,
            ccMaster: true,
            recipientBotId: ctx.recipientBotId,
          },
        },
      };
    }

    // Layer 2 evaluation needed
    if (unknownRecipient) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 3,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'MASTER_MIGRATE',
          reason: `PrMEend Layer-2 triggered: unresolved/missing loop destination from ${ctx.senderBotId}; Master migration required.`,
          metadata: {
            layer: 2,
            migrationReason: missingLoopMessage
              ? 'MISSING_END_MESSAGE'
              : 'UNKNOWN_RECIPIENT',
            ccMaster: true,
            suggestSpawnIfNoMatch: true,
          },
        },
      };
    }

    const hasOpenTasks =
      ctx.hasOpenGoalTasks !== undefined
        ? ctx.hasOpenGoalTasks
        : this.ledger
          ? await this.ledger.hasOpenTasks(ctx.sessionId)
          : false;

    if (hasOpenTasks) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 3,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'MASTER_MIGRATE',
          reason: `PrMEend rejected premature TASK_0 from ${ctx.senderBotId}: GoalLedger still has open tasks.`,
          metadata: {
            layer: 2,
            migrationReason: 'PREMATURE_TASK_0',
            hasOpenTasks: true,
            ccMaster: true,
          },
        },
      };
    }

    return {
      protocolId: this.protocolId,
      triggered: true,
      priority: 3,
      decision: {
        allowed: true,
        protocol: this.protocolId,
        action: 'CONTINUE',
        reason: `TASK_0 received with no open GoalLedger tasks; handing off to PrGate objective check.`,
        metadata: {
          layer: 2,
          isTaskZero: true,
          hasOpenTasks: false,
          triggerPrGate: true,
          ccMaster: true,
        },
      },
    };
  }

  public async enforce(decision: ProtocolDecision, ctx: PrMeEndContext): Promise<void> {
    if (!this.store) {
      return;
    }

    const isLayer2 = decision.metadata?.layer === 2;
    if (isLayer2) {
      await this.store.updateRuntimeState(ctx.sessionId, (current) => ({
        ...current,
        totalPrMeEndTriggers: current.totalPrMeEndTriggers + 1,
      }));
    }

    await this.store.recordEvent(ctx.sessionId, {
      protocolId: this.protocolId,
      action: decision.action,
      actorBotId: ctx.senderBotId,
      reason: decision.reason,
      metadata: decision.metadata ?? {},
    });
  }

  public getStateSnapshot(): Record<string, unknown> {
    return {
      protocolId: this.protocolId,
      prMeEndEnabled: this.enabled,
    };
  }
}
