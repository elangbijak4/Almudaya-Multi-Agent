import type { BotRecord } from '../bot/schema.js';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import { BudgetTracker, type BudgetCheckResult } from './budget-tracker.js';
import { TaskCheckpointManager } from './checkpoint.js';
import type { ProtocolDecision, ProtocolEvaluation } from './contracts.js';
import { DynamicRulesService } from './dynamic-rules.js';
import { GoalLedgerService } from './goal-ledger.js';
import {
  PrBotGlobalCeilingProtocol,
  type PrBotGlobalContext,
} from './protocols/pr-bot-global.protocol.js';
import { PrBotSpawnQuotaProtocol, type PrBotContext } from './protocols/pr-bot.protocol.js';
import {
  PrDeadEndMediationProtocol,
  type PrDeContext,
} from './protocols/pr-de.protocol.js';
import {
  PrObjectiveGateProtocol,
  type WorkspaceFileVerifier,
} from './protocols/pr-gate.protocol.js';
import {
  PrIterasiHandoverProtocol,
  type PrIterasiContext,
} from './protocols/pr-iterasi.protocol.js';
import {
  PrMasterFailoverProtocol,
  type PrMasterFailoverContext,
} from './protocols/pr-master-failover.protocol.js';
import {
  PrMessageEndRoutingProtocol,
  type PrMeEndContext,
} from './protocols/pr-me-end.protocol.js';
import { PrModeratorArbitrationProtocol } from './protocols/pr-moderator.protocol.js';
import {
  PrSessionReattachProtocol,
  type ReattachCandidate,
} from './protocols/pr-reattach.protocol.js';
import {
  PrTaskTokenTransferProtocol,
  type BuildTransferInput,
} from './protocols/pr-transfer.protocol.js';
import { MasterInterventionQueue, ProtocolRegistry } from './registry.js';
import {
  createDefaultProtocolConfig,
  createDefaultRuntimeState,
  type CapabilityToken,
  type PrTransferEnvelope,
  type ProtocolConfig,
  type ProtocolRuntimeState,
} from './schema.js';
import { ProtocolStore } from './store.js';
import { VERSION } from '../core/version.js';

export interface ProtocolSupervisorOptions {
  storage: IBlackboardStorage;
  budgetTracker?: BudgetTracker;
  checkpoints?: TaskCheckpointManager;
}

/**
 * Unified orchestration facade wiring all 10 Atomic IProtocol classes,
 * GoalLedgerService, DynamicRulesService, BudgetTracker, TaskCheckpointManager,
 * and MasterInterventionQueue into the Almudaya agent lifecycle.
 */
export class ProtocolSupervisor {
  public readonly store: ProtocolStore;
  public readonly ledger: GoalLedgerService;
  public readonly rules: DynamicRulesService;
  public readonly budget: BudgetTracker;
  public readonly checkpoints: TaskCheckpointManager;
  public readonly queue: MasterInterventionQueue;
  public readonly registry: ProtocolRegistry;

  public readonly prBot: PrBotSpawnQuotaProtocol;
  public readonly prBotGlobal: PrBotGlobalCeilingProtocol;
  public readonly prIterasi: PrIterasiHandoverProtocol;
  public readonly prDe: PrDeadEndMediationProtocol;
  public readonly prMeEnd: PrMessageEndRoutingProtocol;
  public readonly prModerator: PrModeratorArbitrationProtocol;
  public readonly prTransfer: PrTaskTokenTransferProtocol;
  public readonly prMasterFailover: PrMasterFailoverProtocol;
  public readonly prGate: PrObjectiveGateProtocol;
  public readonly prReattach: PrSessionReattachProtocol;

  constructor(options: ProtocolSupervisorOptions) {
    this.store = new ProtocolStore(options.storage);
    this.ledger = new GoalLedgerService(this.store);
    this.rules = new DynamicRulesService(this.store);
    this.budget = options.budgetTracker ?? new BudgetTracker(this.store);
    this.checkpoints = options.checkpoints ?? new TaskCheckpointManager(this.store);
    this.queue = new MasterInterventionQueue();
    this.registry = new ProtocolRegistry(this.queue);

    this.prBot = new PrBotSpawnQuotaProtocol(this.store);
    this.prBotGlobal = new PrBotGlobalCeilingProtocol(this.store, this.budget);
    this.prIterasi = new PrIterasiHandoverProtocol(this.store, this.ledger);
    this.prDe = new PrDeadEndMediationProtocol(this.store);
    this.prMeEnd = new PrMessageEndRoutingProtocol(this.store, this.ledger);
    this.prModerator = new PrModeratorArbitrationProtocol(this.store);
    this.prTransfer = new PrTaskTokenTransferProtocol(
      this.store,
      this.prModerator,
      this.ledger,
      this.checkpoints
    );
    this.prMasterFailover = new PrMasterFailoverProtocol(this.store);
    this.prGate = new PrObjectiveGateProtocol(this.store, this.ledger);
    this.prReattach = new PrSessionReattachProtocol(this.store);

    this.registry.register(this.prBot);
    this.registry.register(this.prBotGlobal);
    this.registry.register(this.prIterasi);
    this.registry.register(this.prDe);
    this.registry.register(this.prMeEnd);
    this.registry.register(this.prModerator);
    this.registry.register(this.prTransfer);
    this.registry.register(this.prMasterFailover);
    this.registry.register(this.prGate);
    this.registry.register(this.prReattach);
  }

  public async initializeSession(
    sessionId: string,
    configOverrides: Partial<ProtocolConfig> = {}
  ): Promise<{ config: ProtocolConfig; state: ProtocolRuntimeState }> {
    const config = createDefaultProtocolConfig(configOverrides);
    const resolvedCap = this.budget.resolveHardwareBotCap(config);
    this.registry.configureAll(config);

    await this.store.saveConfig(sessionId, config);
    const state = await this.store.saveRuntimeState(
      sessionId,
      createDefaultRuntimeState({
        resolvedHardwareBotCap: resolvedCap,
        activeModeratorBotId: config.moderatorBotId,
        macroLoopStatus: 'RUNNING',
      })
    );

    await this.store.getGoalLedger(sessionId).then((l) => this.store.saveGoalLedger(sessionId, l));
    await this.store.getModeratorState(sessionId);

    await this.store.recordEvent(sessionId, {
      protocolId: 'SYSTEM',
      action: 'INITIALIZE_PROTOCOL_SESSION',
      actorBotId: 'BOT000',
      reason: `Initialized v${VERSION} Unified Natural Lifecycle session (cap=${resolvedCap}, spawnMode=${config.spawnMode}).`,
      metadata: {
        resolvedHardwareBotCap: resolvedCap,
        spawnMode: config.spawnMode,
      },
    });

    return { config, state };
  }

  public async isSessionInitialized(sessionId: string): Promise<boolean> {
    return await this.store.hasProtocolConfig(sessionId);
  }

  public async checkSpawnPermission(
    sessionId: string,
    ctx: {
      requesterBotId?: string;
      activeBotCount?: number;
      registeredBots?: BotRecord[];
      requestedSpawns?: number;
      enforceOnAllow?: boolean;
    }
  ): Promise<ProtocolDecision> {
    const config = await this.store.getConfig(sessionId);
    const state = await this.store.getRuntimeState(sessionId);

    const globalCtx: PrBotGlobalContext = {
      sessionId,
      requesterBotId: ctx.requesterBotId,
      config,
      state,
      activeBotCount: ctx.activeBotCount,
      registeredBots: ctx.registeredBots,
    };

    // P0: Evaluate PrBotGlobal first (hardware/token/time ceiling + recycle check)
    const globalEval = await this.registry.evaluate('PrBotGlobal', globalCtx, {
      enforce: true,
    });
    if (!globalEval.decision.allowed) {
      return globalEval.decision;
    }

    // If PrBotGlobal solved ceiling via idle bot recycling, return ALLOW with recycle target
    if (globalEval.decision.metadata?.recycleCandidateBotId) {
      return globalEval.decision;
    }

    // P5: Evaluate cumulative PrBot limit
    const botCtx: PrBotContext = {
      sessionId,
      requesterBotId: ctx.requesterBotId,
      config,
      state,
      requestedSpawns: ctx.requestedSpawns,
    };
    const botEval = await this.registry.evaluate('PrBot', botCtx, {
      enforce: ctx.enforceOnAllow !== false,
    });

    return botEval.decision;
  }

  public async checkWriteAccess(
    sessionId: string,
    input: {
      botId: string;
      tokenId?: string;
      fenceEpoch?: number;
      targetPath?: string;
      requireToken?: boolean;
    }
  ): Promise<ProtocolDecision> {
    const evalRes = await this.registry.evaluate(
      'PrModerator',
      {
        sessionId,
        operation: 'WRITE_CHECK',
        actorBotId: input.botId,
        tokenId: input.tokenId,
        fenceEpoch: input.fenceEpoch,
        targetPath: input.targetPath,
        requireToken: input.requireToken,
      },
      { enforce: true, enqueueIntervention: false }
    );
    return evalRes.decision;
  }

  public async issueTaskToken(
    sessionId: string,
    input: {
      taskId: string;
      holderBotId: string;
      allowedPaths?: string[];
      allowedComponents?: string[];
      accessMode?: 'EXCLUSIVE_WRITE' | 'SHARED_READ' | 'REVIEW_ONLY';
      allowWildcardScope?: boolean;
      allowMasterWrite?: boolean;
    }
  ): Promise<CapabilityToken> {
    return await this.prModerator.issueToken(sessionId, input);
  }

  public async recordUsageAndCheckBudget(
    sessionId: string,
    tokensDelta: number,
    nowMs?: number
  ): Promise<BudgetCheckResult> {
    const state = await this.budget.recordTokenUsage(sessionId, tokensDelta);
    const config = await this.store.getConfig(sessionId);
    const check = this.budget.evaluateBudget(config, state, nowMs);
    if (!check.allowed) {
      await this.store.updateRuntimeState(sessionId, (rt) => ({
        ...rt,
        macroLoopStatus: 'PAUSED_HITL',
      }));
      this.queue.enqueue({
        priority: 0,
        protocolId: 'PrBotGlobal',
        sessionId,
        action: 'ESCALATE_HITL',
        summary: check.reason,
        payload: check.metrics,
      });
    }
    return check;
  }

  public async evaluatePrIterasi(
    ctx: PrIterasiContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    return await this.registry.evaluate('PrIterasi', ctx, { enforce: true });
  }

  public async evaluatePrDe(
    ctx: PrDeContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    return await this.registry.evaluate('PrDE', ctx, { enforce: true });
  }

  public async evaluatePrMeEnd(
    ctx: PrMeEndContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    return await this.registry.evaluate('PrMEend', ctx, { enforce: true });
  }

  public async commitTaskTransfer(
    input: BuildTransferInput
  ): Promise<PrTransferEnvelope> {
    return await this.prTransfer.createAndCommitTransfer(input);
  }

  public async verifyObjectiveGate(
    sessionId: string,
    workspaceRoots: string[],
    options?: { actorBotId?: string; fileVerifier?: WorkspaceFileVerifier }
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    return await this.registry.evaluate(
      'PrGate',
      {
        sessionId,
        workspaceRoots,
        actorBotId: options?.actorBotId,
        fileVerifier: options?.fileVerifier,
      },
      { enforce: true }
    );
  }

  public async evaluateMasterFailover(
    ctx: PrMasterFailoverContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    return await this.registry.evaluate('PrMasterFailover', ctx, { enforce: true });
  }

  public async reconcileSessionReattach(
    sessionId: string,
    registeredBots: BotRecord[],
    processChecker?: (pid: number) => boolean
  ): Promise<{ evaluation: ProtocolEvaluation<ProtocolDecision>; candidates: ReattachCandidate[] }> {
    const evaluation = await this.registry.evaluate(
      'PrReattach',
      { sessionId, registeredBots, processChecker },
      { enforce: true, enqueueIntervention: false }
    );
    const candidates = (evaluation.decision.metadata?.candidates ?? []) as ReattachCandidate[];
    return { evaluation, candidates };
  }

  public async getStatusSummary(sessionId: string): Promise<{
    config: ProtocolConfig;
    runtimeState: ProtocolRuntimeState;
    activeRulesCount: number;
    openTasksCount: number;
    totalTasksCount: number;
    activeModeratorBotId: string;
    currentFenceEpoch: number;
    queuedInterventions: number;
    protocolSnapshots: Record<string, Record<string, unknown>>;
  }> {
    const [config, runtimeState, rules, ledger, modState] = await Promise.all([
      this.store.getConfig(sessionId),
      this.store.getRuntimeState(sessionId),
      this.rules.listRules(sessionId, { activeOnly: true }),
      this.ledger.getLedger(sessionId),
      this.prModerator.getModeratorState(sessionId),
    ]);

    return {
      config,
      runtimeState,
      activeRulesCount: rules.length,
      openTasksCount: ledger.tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').length,
      totalTasksCount: ledger.tasks.length,
      activeModeratorBotId: modState.activeModeratorBotId,
      currentFenceEpoch: modState.globalFenceEpoch,
      queuedInterventions: this.queue.size(),
      protocolSnapshots: this.registry.getAllSnapshots(),
    };
  }
}
