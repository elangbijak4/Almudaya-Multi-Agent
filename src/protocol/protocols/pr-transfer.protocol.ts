import { TaskCheckpointManager } from '../checkpoint.js';
import type {
  IProtocol,
  ProtocolDecision,
  ProtocolEvaluation,
} from '../contracts.js';
import { GoalLedgerService } from '../goal-ledger.js';
import {
  LastWorkPositionLogSchema,
  PROTOCOL_SCHEMA_VERSION,
  PrTransferEnvelopeSchema,
  generateProtocolId,
  type CapabilityToken,
  type LastWorkPositionLog,
  type PrTransferEnvelope,
  type ProtocolConfig,
  type TouchedFileStatus,
} from '../schema.js';
import { ProtocolStore } from '../store.js';
import { PrModeratorArbitrationProtocol } from './pr-moderator.protocol.js';

export interface PrTransferContext {
  sessionId: string;
  envelope: PrTransferEnvelope;
}

export interface BuildTransferInput {
  sessionId: string;
  taskId: string;
  fromBotId: string;
  toBotId: string;
  transferKind?: PrTransferEnvelope['transferKind'];
  lastCompletedStep: string;
  pendingNextStep: string;
  touchedFiles?: TouchedFileStatus[];
  testsPassedCount?: number;
  existingTokenId?: string;
  allowedPaths?: string[];
  checkpointIdToRestore?: string;
  workspaceRoots?: string[];
}

/**
 * Computes objective non-self-reported progress score (>= 0) for anti-circular checks.
 */
export function computeProgressDeltaScore(input: {
  touchedFiles?: TouchedFileStatus[];
  testsPassedCount?: number;
  lastCompletedStep?: string;
}): number {
  const cleanFiles = (input.touchedFiles ?? []).filter((f) => f.status !== 'NEEDS_REVERT').length;
  const tests = Math.max(0, input.testsPassedCount ?? 0);
  const score = cleanFiles + tests * 2;
  return score;
}

/**
 * PrTransfer: Enforces structured handover packages (`PrTransferEnvelope`) carrying
 * both the factual `LastWorkPositionLog` and transferred/new `CapabilityToken`.
 */
export class PrTaskTokenTransferProtocol
  implements IProtocol<PrTransferContext, ProtocolDecision>
{
  public readonly protocolId = 'PrTransfer' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private readonly store: ProtocolStore;
  private readonly moderator: PrModeratorArbitrationProtocol;
  private readonly ledger: GoalLedgerService;
  private readonly checkpoints?: TaskCheckpointManager;

  constructor(
    store: ProtocolStore,
    moderator?: PrModeratorArbitrationProtocol,
    ledger?: GoalLedgerService,
    checkpoints?: TaskCheckpointManager
  ) {
    this.store = store;
    this.moderator = moderator ?? new PrModeratorArbitrationProtocol(store);
    this.ledger = ledger ?? new GoalLedgerService(store);
    this.checkpoints = checkpoints;
  }

  public get isEnabled(): boolean {
    return true;
  }

  public configure(_limits: Partial<ProtocolConfig>): void {
    // PrTransfer integrity checks are always mandatory when enabled.
  }

  /**
   * Kernel auto-enrichment builder: guarantees small local LLMs never fail
   * handover JSON formatting while still enforcing real CapabilityToken transfer.
   */
  public async createAndCommitTransfer(
    input: BuildTransferInput
  ): Promise<PrTransferEnvelope> {
    const now = new Date().toISOString();
    const touchedFiles = input.touchedFiles ?? [];
    const progressDeltaScore = computeProgressDeltaScore({
      touchedFiles,
      testsPassedCount: input.testsPassedCount,
      lastCompletedStep: input.lastCompletedStep,
    });

    const workLog: LastWorkPositionLog = LastWorkPositionLogSchema.parse({
      taskId: input.taskId,
      lastCompletedStep: input.lastCompletedStep.trim() || 'Task step completed.',
      pendingNextStep: input.pendingNextStep.trim() || 'Continue next milestone.',
      touchedFiles,
      progressDeltaScore,
      recordedAt: now,
    });

    let checkpointRestored = false;
    if (
      input.transferKind === 'PR_ITERASI_TAKEOVER' &&
      input.checkpointIdToRestore &&
      this.checkpoints &&
      input.workspaceRoots &&
      input.workspaceRoots.length > 0
    ) {
      await this.checkpoints.restoreCheckpoint(
        input.sessionId,
        input.checkpointIdToRestore,
        input.workspaceRoots
      );
      checkpointRestored = true;
    }

    let transferredToken: CapabilityToken;
    if (input.existingTokenId) {
      const res = await this.moderator.transferToken(
        input.sessionId,
        input.existingTokenId,
        input.fromBotId,
        input.toBotId
      );
      transferredToken = res.nextToken;
    } else {
      transferredToken = await this.moderator.issueToken(input.sessionId, {
        taskId: input.taskId,
        holderBotId: input.toBotId,
        allowedPaths: input.allowedPaths ?? ['**/*'],
        accessMode: 'EXCLUSIVE_WRITE',
      });
    }

    const envelope = PrTransferEnvelopeSchema.parse({
      transferId: generateProtocolId('XFER'),
      fromBotId: input.fromBotId,
      toBotId: input.toBotId,
      transferKind: input.transferKind ?? 'NORMAL_HANDOFF',
      capabilityToken: transferredToken,
      lastWorkPositionLog: workLog,
      checkpointRestored,
    });

    // Sync GoalLedger if task exists (preserve DONE on normal/TASK_0 completion handoffs)
    const existingTask = await this.ledger.getTask(input.sessionId, input.taskId);
    if (existingTask) {
      const targetStatus =
        existingTask.status === 'DONE' &&
        (!input.transferKind || input.transferKind === 'NORMAL_HANDOFF')
          ? 'DONE'
          : 'PENDING';
      await this.ledger.updateTaskStatus(input.sessionId, input.taskId, targetStatus, {
        assignedBotId: input.toBotId,
        lastWorkPositionLog: workLog,
      });
    }

    await this.store.updateRuntimeState(input.sessionId, (rt) => ({
      ...rt,
      noProgressHandoffCount:
        progressDeltaScore > 0 ? 0 : rt.noProgressHandoffCount + 1,
    }));

    await this.store.recordEvent(input.sessionId, {
      protocolId: this.protocolId,
      action: 'COMMIT_TRANSFER',
      actorBotId: input.fromBotId,
      taskId: input.taskId,
      tokenId: transferredToken.tokenId,
      fenceEpoch: transferredToken.fenceEpoch,
      reason: `Transferred task ${input.taskId} from ${input.fromBotId} to ${input.toBotId} (${envelope.transferKind}).`,
      metadata: {
        transferId: envelope.transferId,
        progressDeltaScore,
        checkpointRestored,
      },
    });

    return envelope;
  }

  public async evaluate(
    ctx: PrTransferContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const parsed = PrTransferEnvelopeSchema.safeParse(ctx.envelope);
    if (!parsed.success) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 4,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `Invalid PrTransferEnvelope: ${parsed.error.message}`,
        },
      };
    }

    const env = parsed.data;
    if (
      !env.lastWorkPositionLog.lastCompletedStep.trim() ||
      !env.lastWorkPositionLog.pendingNextStep.trim()
    ) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 4,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: 'PrTransfer requires non-empty lastCompletedStep and pendingNextStep in LastWorkPositionLog.',
        },
      };
    }

    if (env.capabilityToken.holderBotId !== env.toBotId) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 4,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `CapabilityToken holder mismatch: expected ${env.toBotId}, got ${env.capabilityToken.holderBotId}.`,
        },
      };
    }

    return {
      protocolId: this.protocolId,
      triggered: false,
      priority: 4,
      decision: {
        allowed: true,
        protocol: this.protocolId,
        action: 'ALLOW',
        reason: `PrTransferEnvelope ${env.transferId} verified for ${env.fromBotId} -> ${env.toBotId}.`,
        metadata: {
          transferId: env.transferId,
          tokenId: env.capabilityToken.tokenId,
          fenceEpoch: env.capabilityToken.fenceEpoch,
          progressDeltaScore: env.lastWorkPositionLog.progressDeltaScore,
        },
      },
    };
  }

  public async enforce(
    decision: ProtocolDecision,
    ctx: PrTransferContext
  ): Promise<void> {
    await this.store.recordEvent(ctx.sessionId, {
      protocolId: this.protocolId,
      action: decision.action,
      actorBotId: ctx.envelope.fromBotId,
      taskId: ctx.envelope.lastWorkPositionLog.taskId,
      tokenId: ctx.envelope.capabilityToken.tokenId,
      fenceEpoch: ctx.envelope.capabilityToken.fenceEpoch,
      reason: decision.reason,
      metadata: decision.metadata ?? {},
    });
  }

  public getStateSnapshot(): Record<string, unknown> {
    return {
      protocolId: this.protocolId,
    };
  }
}
