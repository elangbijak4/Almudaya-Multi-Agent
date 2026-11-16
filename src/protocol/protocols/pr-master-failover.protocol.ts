import type {
  IProtocol,
  ProtocolDecision,
  ProtocolEvaluation,
} from '../contracts.js';
import {
  PROTOCOL_SCHEMA_VERSION,
  type ModelSpec,
  type ProtocolConfig,
} from '../schema.js';
import { ProtocolStore } from '../store.js';

export interface PrMasterFailoverContext {
  sessionId: string;
  currentModel: ModelSpec;
  failedModelRefs?: string[];
  errorStatusCode?: number;
  errorMessage?: string;
  config?: ProtocolConfig;
}

function modelKey(spec: ModelSpec): string {
  return `${spec.provider}:${spec.model}`;
}

/**
 * Checks whether a Master provider error warrants automatic failover.
 */
export function isFailoverWorthyError(
  statusCode?: number,
  errorMessage?: string
): boolean {
  if (statusCode !== undefined) {
    if (statusCode === 401 || statusCode === 402 || statusCode === 403 || statusCode === 404 || statusCode === 429 || statusCode >= 500) {
      return true;
    }
  }
  if (!errorMessage) return false;
  return /401|402|403|404|429|500|502|503|504|timeout|rate.?limit|quota|econnrefused|unauthorized|credit|balance/i.test(
    errorMessage
  );
}

/**
 * PrMasterFailover: Protects Master Bot brain continuity by walking
 * `masterFailoverChain` on provider errors before falling back to HITL.
 */
export class PrMasterFailoverProtocol
  implements IProtocol<PrMasterFailoverContext, ProtocolDecision>
{
  public readonly protocolId = 'PrMasterFailover' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private failoverChain: ModelSpec[] = [];
  private readonly store?: ProtocolStore;

  constructor(store?: ProtocolStore, initialChain: ModelSpec[] = []) {
    this.store = store;
    this.failoverChain = initialChain;
  }

  public get isEnabled(): boolean {
    return true;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (limits.masterFailoverChain) {
      this.failoverChain = limits.masterFailoverChain;
    }
  }

  public async evaluate(
    ctx: PrMasterFailoverContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const failedSet = new Set(ctx.failedModelRefs ?? []);
    failedSet.add(modelKey(ctx.currentModel));

    const config =
      ctx.config ?? (this.store ? await this.store.getConfig(ctx.sessionId) : undefined);
    const chain =
      config && config.masterFailoverChain.length > 0
        ? config.masterFailoverChain
        : this.failoverChain;

    const worthy = isFailoverWorthyError(ctx.errorStatusCode, ctx.errorMessage);
    if (!worthy && !ctx.errorMessage) {
      return {
        protocolId: this.protocolId,
        triggered: false,
        priority: 0,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'CONTINUE',
          reason: 'Master provider healthy.',
        },
      };
    }

    const nextCandidate = chain.find((spec) => !failedSet.has(modelKey(spec)));
    if (nextCandidate) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 0,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'FAILOVER_SWITCH',
          reason: `Switching Master brain from ${modelKey(ctx.currentModel)} to fallback ${modelKey(nextCandidate)}.`,
          metadata: {
            fromModel: ctx.currentModel,
            nextMasterModel: nextCandidate,
            errorStatusCode: ctx.errorStatusCode,
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
        reason: `All Master Bot models exhausted (${Array.from(failedSet).join(', ')}); pausing session for HITL rescue.`,
        metadata: {
          failedModels: Array.from(failedSet),
          errorMessage: ctx.errorMessage,
        },
      },
    };
  }

  public async enforce(
    decision: ProtocolDecision,
    ctx: PrMasterFailoverContext
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    if (!decision.allowed && decision.action === 'ESCALATE_HITL') {
      await this.store.updateRuntimeState(ctx.sessionId, (rt) => ({
        ...rt,
        macroLoopStatus: 'PAUSED_MASTER_UNAVAILABLE',
      }));
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
      failoverChainLength: this.failoverChain.length,
    };
  }
}
