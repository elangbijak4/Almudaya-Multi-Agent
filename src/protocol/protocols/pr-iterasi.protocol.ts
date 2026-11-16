import type {
  IProtocol,
  ProtocolDecision,
  ProtocolEvaluation,
} from '../contracts.js';
import { GoalLedgerService } from '../goal-ledger.js';
import {
  PROTOCOL_SCHEMA_VERSION,
  type ModelSpec,
  type ProtocolConfig,
} from '../schema.js';
import { ProtocolStore } from '../store.js';

export interface ModelSelectionResult {
  model: ModelSpec;
  singleModelPoolFallback: boolean;
  reason: string;
}

export interface PrIterasiContext {
  sessionId: string;
  botId: string;
  taskId?: string;
  iteration: number;
  elapsedMs?: number;
  quotaExhausted?: boolean;
  fatalError?: string;
  currentModel?: ModelSpec;
  triedModels?: string[];
  handoverCount?: number;
  config?: ProtocolConfig;
}

/**
 * Formats a canonical model identifier for comparison and history tracking.
 */
export function formatModelRef(spec: ModelSpec): string {
  return `${spec.provider}:${spec.model}`;
}

/**
 * Selects the next model for PrIterasi handover using 3-tier priority:
 * 1) Untried model from pool
 * 2) Single/exhausted pool rotation (distinct-bot fallback)
 * 3) Empty pool -> undefined (Master takeover / HITL)
 */
export function selectNextDistinctModel(
  pool: ModelSpec[],
  triedModels: string[],
  currentModel?: ModelSpec
): ModelSelectionResult | undefined {
  if (pool.length === 0) {
    return undefined;
  }

  const currentRef = currentModel ? formatModelRef(currentModel) : undefined;
  const triedSet = new Set(triedModels);
  if (currentRef) {
    triedSet.add(currentRef);
  }

  const untriedDifferent = pool.find(
    (candidate) =>
      !triedSet.has(formatModelRef(candidate)) &&
      formatModelRef(candidate) !== currentRef
  );
  if (untriedDifferent) {
    return {
      model: untriedDifferent,
      singleModelPoolFallback: false,
      reason: `Selected distinct untried model ${formatModelRef(untriedDifferent)}.`,
    };
  }

  const alternateCandidate = pool.find(
    (candidate) => formatModelRef(candidate) !== currentRef
  );
  if (alternateCandidate) {
    return {
      model: alternateCandidate,
      singleModelPoolFallback: false,
      reason: `All models tried once; rotating to alternate model ${formatModelRef(alternateCandidate)}.`,
    };
  }

  const fallback = pool[0];
  if (!fallback) {
    return undefined;
  }

  return {
    model: fallback,
    singleModelPoolFallback: true,
    reason: `Only single model ${formatModelRef(fallback)} available; using distinct-bot pool fallback.`,
  };
}

/**
 * PrIterasi: Task iteration/timeout/quota guard that orchestrates Master takeover,
 * workspace checkpoint restore signal, and distinct-model handover.
 */
export class PrIterasiHandoverProtocol
  implements IProtocol<PrIterasiContext, ProtocolDecision>
{
  public readonly protocolId = 'PrIterasi' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private iterationLimit = 10;
  private handoverLimit = 3;
  private taskTimeoutMs = 180000;
  private readonly store?: ProtocolStore;
  private readonly ledger?: GoalLedgerService;

  constructor(store?: ProtocolStore, ledger?: GoalLedgerService) {
    this.store = store;
    this.ledger = ledger ?? (store ? new GoalLedgerService(store) : undefined);
  }

  public get isEnabled(): boolean {
    return true;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (typeof limits.prIterasiLimit === 'number') {
      this.iterationLimit = Math.max(1, limits.prIterasiLimit);
    }
    if (typeof limits.prIterasiHandoverLimit === 'number') {
      this.handoverLimit = Math.max(1, limits.prIterasiHandoverLimit);
    }
    if (typeof limits.taskTimeoutMs === 'number') {
      this.taskTimeoutMs = Math.max(100, limits.taskTimeoutMs);
    }
  }

  public async evaluate(
    ctx: PrIterasiContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const config =
      ctx.config ?? (this.store ? await this.store.getConfig(ctx.sessionId) : undefined);
    const maxIter = config?.prIterasiLimit ?? this.iterationLimit;
    const maxHandovers = config?.prIterasiHandoverLimit ?? this.handoverLimit;
    const maxTimeout = config?.taskTimeoutMs ?? this.taskTimeoutMs;

    const iterExceeded = ctx.iteration >= maxIter;
    const timedOut = (ctx.elapsedMs ?? 0) >= maxTimeout;
    const triggerReason = ctx.quotaExhausted
      ? 'QUOTA_EXHAUSTED'
      : timedOut
        ? 'TASK_TIMEOUT'
        : iterExceeded
          ? 'ITERATION_LIMIT'
          : ctx.fatalError
            ? 'ERROR'
            : undefined;

    if (!triggerReason) {
      return {
        protocolId: this.protocolId,
        triggered: false,
        priority: 1,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'CONTINUE',
          reason: `Within PrIterasi limits (iteration ${ctx.iteration}/${maxIter}).`,
        },
      };
    }

    const existingTask =
      ctx.taskId && this.ledger
        ? await this.ledger.getTask(ctx.sessionId, ctx.taskId)
        : undefined;
    const currentHandoverCount = ctx.handoverCount ?? existingTask?.handoverCount ?? 0;

    if (currentHandoverCount >= maxHandovers) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 1,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'ESCALATE_HITL',
          reason: `Task handover limit reached (${currentHandoverCount}/${maxHandovers}) after ${triggerReason}.`,
          metadata: {
            triggerReason,
            handoverCount: currentHandoverCount,
            maxHandovers,
            taskId: ctx.taskId,
          },
        },
      };
    }

    const triedModels = [
      ...(existingTask?.triedModels ?? []),
      ...(ctx.triedModels ?? []),
    ];
    const pool = config?.modelPool ?? [];
    const modelChoice = selectNextDistinctModel(pool, triedModels, ctx.currentModel);

    return {
      protocolId: this.protocolId,
      triggered: true,
      priority: 1,
      decision: {
        allowed: false,
        protocol: this.protocolId,
        action: 'MASTER_TAKEOVER',
        reason: `PrIterasi triggered (${triggerReason}) for bot ${ctx.botId}; requesting Master takeover & handover.`,
        metadata: {
          triggerReason,
          taskId: ctx.taskId,
          botId: ctx.botId,
          iteration: ctx.iteration,
          nextModel: modelChoice?.model,
          singleModelPoolFallback: modelChoice?.singleModelPoolFallback ?? false,
          selectionReason: modelChoice?.reason ?? 'No pool configured; Master decides model.',
          checkpointRestoreRecommended: true,
        },
      },
    };
  }

  public async enforce(decision: ProtocolDecision, ctx: PrIterasiContext): Promise<void> {
    if (!this.store) {
      return;
    }

    if (ctx.taskId && this.ledger) {
      const task = await this.ledger.getTask(ctx.sessionId, ctx.taskId);
      if (task) {
        const nextStatus =
          decision.action === 'ESCALATE_HITL' ? 'BLOCKED_HITL' : 'HANDOVER_WAIT';
        await this.ledger.updateTaskStatus(ctx.sessionId, ctx.taskId, nextStatus);
      }
    }

    await this.store.recordEvent(ctx.sessionId, {
      protocolId: this.protocolId,
      action: decision.action,
      actorBotId: ctx.botId,
      taskId: ctx.taskId,
      reason: decision.reason,
      metadata: decision.metadata ?? {},
    });
  }

  public getStateSnapshot(): Record<string, unknown> {
    return {
      protocolId: this.protocolId,
      prIterasiLimit: this.iterationLimit,
      prIterasiHandoverLimit: this.handoverLimit,
      taskTimeoutMs: this.taskTimeoutMs,
    };
  }
}
