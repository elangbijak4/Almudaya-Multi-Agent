import fs from 'node:fs/promises';
import path from 'node:path';
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

export type WorkspaceFileVerifier = (
  targetFile: string,
  workspaceRoots: string[]
) => Promise<{ exists: boolean; sizeBytes: number }>;

export interface PrGateContext {
  sessionId: string;
  workspaceRoots: string[];
  actorBotId?: string;
  fileVerifier?: WorkspaceFileVerifier;
  config?: ProtocolConfig;
}

async function defaultVerifyTargetFile(
  targetFile: string,
  workspaceRoots: string[]
): Promise<{ exists: boolean; sizeBytes: number }> {
  if (path.isAbsolute(targetFile)) {
    try {
      const stat = await fs.stat(targetFile);
      return { exists: true, sizeBytes: stat.size };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }

  for (const root of workspaceRoots) {
    const candidate = path.resolve(root, targetFile);
    try {
      const stat = await fs.stat(candidate);
      return { exists: true, sizeBytes: stat.size };
    } catch {
      // try next workspace root
    }
  }
  return { exists: false, sizeBytes: 0 };
}

/**
 * PrGate: Objective Completion Gate guarding `GOAL_ACHIEVED`.
 * Requires every GoalLedger task to be DONE/CANCELLED AND every declared
 * `targetFiles[]` artifact to physically exist on disk with non-zero bytes.
 */
export class PrObjectiveGateProtocol
  implements IProtocol<PrGateContext, ProtocolDecision>
{
  public readonly protocolId = 'PrGate' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private enabled = true;
  private readonly store: ProtocolStore;
  private readonly ledger: GoalLedgerService;

  constructor(store: ProtocolStore, ledger?: GoalLedgerService) {
    this.store = store;
    this.ledger = ledger ?? new GoalLedgerService(store);
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (typeof limits.prGateEnabled === 'boolean') {
      this.enabled = limits.prGateEnabled;
    }
  }

  public async evaluate(ctx: PrGateContext): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const config = ctx.config ?? (await this.store.getConfig(ctx.sessionId));
    const active = config.prGateEnabled ?? this.enabled;
    if (!active) {
      return {
        protocolId: this.protocolId,
        triggered: false,
        priority: 3,
        decision: {
          allowed: true,
          protocol: this.protocolId,
          action: 'GOAL_ACHIEVED',
          reason: 'PrGate disabled by configuration; allowing completion.',
        },
      };
    }

    const goalLedger = await this.ledger.getLedger(ctx.sessionId);
    const incompleteTasks = goalLedger.tasks.filter(
      (t) => t.status !== 'DONE' && t.status !== 'CANCELLED'
    );

    const missingFiles: Array<{ taskId: string; file: string; reason: string }> = [];
    const verifier = ctx.fileVerifier ?? defaultVerifyTargetFile;

    for (const task of goalLedger.tasks) {
      if (task.status !== 'DONE') continue;
      for (const file of task.targetFiles) {
        const res = await verifier(file, ctx.workspaceRoots);
        if (!res.exists) {
          missingFiles.push({ taskId: task.taskId, file, reason: 'FILE_NOT_FOUND' });
        } else if (res.sizeBytes <= 0) {
          missingFiles.push({ taskId: task.taskId, file, reason: 'EMPTY_FILE' });
        }
      }
    }

    if (incompleteTasks.length > 0 || missingFiles.length > 0) {
      return {
        protocolId: this.protocolId,
        triggered: true,
        priority: 3,
        decision: {
          allowed: false,
          protocol: this.protocolId,
          action: 'GATE_FAILED',
          reason: `PrGate verification failed: ${incompleteTasks.length} incomplete task(s), ${missingFiles.length} missing/empty target file(s).`,
          metadata: {
            incompleteTaskIds: incompleteTasks.map((t) => t.taskId),
            missingFiles,
          },
        },
      };
    }

    return {
      protocolId: this.protocolId,
      triggered: false,
      priority: 3,
      decision: {
        allowed: true,
        protocol: this.protocolId,
        action: 'GOAL_ACHIEVED',
        reason: `PrGate passed all checks (${goalLedger.tasks.length} ledger task(s) verified on disk).`,
        metadata: { verifiedTasks: goalLedger.tasks.length },
      },
    };
  }

  public async enforce(decision: ProtocolDecision, ctx: PrGateContext): Promise<void> {
    if (decision.allowed && decision.action === 'GOAL_ACHIEVED') {
      await this.store.updateRuntimeState(ctx.sessionId, (rt) => ({
        ...rt,
        macroLoopStatus: 'GOAL_ACHIEVED',
      }));
    }

    await this.store.recordEvent(ctx.sessionId, {
      protocolId: this.protocolId,
      action: decision.action,
      actorBotId: ctx.actorBotId ?? 'BOT000',
      reason: decision.reason,
      metadata: decision.metadata ?? {},
    });
  }

  public getStateSnapshot(): Record<string, unknown> {
    return {
      protocolId: this.protocolId,
      prGateEnabled: this.enabled,
    };
  }
}
