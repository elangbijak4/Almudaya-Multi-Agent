import type { IAIModelProvider } from '../ai/provider.js';
import { FailoverAIProvider } from '../ai/failover-provider.js';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import { AutonomousAgentLoop } from '../bot/agent-loop.js';
import { ExecutionModeController } from '../bot/execution-mode.js';
import { BotService } from '../bot/service.js';
import { MessagingService } from '../messaging/service.js';
import { SharedContextService } from '../shared/service.js';
import type { ProtocolDecision, ProtocolEvaluation } from './contracts.js';
import type { CreateGoalTaskInput } from './goal-ledger.js';
import type { WorkspaceFileVerifier } from './protocols/pr-gate.protocol.js';
import type { ReattachCandidate } from './protocols/pr-reattach.protocol.js';
import type { InterventionQueueItem } from './registry.js';
import type { GoalLedger, ModelSpec, ProtocolConfig } from './schema.js';
import { SpawnManager, type SpawnWorkerOutcome } from './spawn-manager.js';
import { ProtocolSupervisor } from './supervisor.js';

export interface MasterOrchestratorOptions {
  storage: IBlackboardStorage;
  sessionId: string;
  workspaceRoots: string[];
  provider?: IAIModelProvider;
  providerFactory?: (spec: ModelSpec) => Promise<IAIModelProvider> | IAIModelProvider;
  configOverrides?: Partial<ProtocolConfig>;
  lazyMaster?: boolean;
  botService?: BotService;
  messagingService?: MessagingService;
  sharedContextService?: SharedContextService;
  supervisor?: ProtocolSupervisor;
  spawnManager?: SpawnManager;
  executionModeController?: ExecutionModeController;
  dryRunSpawn?: boolean;
  onHitlEscalation?: (item: InterventionQueueItem) => Promise<void> | void;
}

/**
 * Coordinates the Unified Natural Lifecycle for Master Bot (BOT000), supporting
 * eager vs lazy Master startup, PrReattach session resume, blueprint decomposition,
 * priority intervention handling (P0..P5), and PrGate completion verification.
 */
export class MasterAgentOrchestrator {
  public readonly storage: IBlackboardStorage;
  public readonly sessionId: string;
  public readonly workspaceRoots: string[];
  public readonly botService: BotService;
  public readonly messagingService: MessagingService;
  public readonly sharedContextService: SharedContextService;
  public readonly supervisor: ProtocolSupervisor;
  public readonly spawnManager: SpawnManager;
  public readonly executionModeController: ExecutionModeController;

  private readonly providerFactory?: (
    spec: ModelSpec
  ) => Promise<IAIModelProvider> | IAIModelProvider;
  private readonly lazyMaster: boolean;
  private readonly configOverrides?: Partial<ProtocolConfig>;
  private readonly dryRunSpawn: boolean;
  private readonly onHitlEscalation?: (
    item: InterventionQueueItem
  ) => Promise<void> | void;

  private masterProvider?: IAIModelProvider;
  private masterAgentLoop?: AutonomousAgentLoop;
  private masterActive = false;

  constructor(options: MasterOrchestratorOptions) {
    this.storage = options.storage;
    this.sessionId = options.sessionId;
    this.workspaceRoots = options.workspaceRoots;
    this.botService = options.botService ?? new BotService(this.storage);
    this.messagingService =
      options.messagingService ?? new MessagingService(this.storage, this.botService);
    this.sharedContextService =
      options.sharedContextService ?? new SharedContextService(this.storage);
    this.supervisor =
      options.supervisor ?? new ProtocolSupervisor({ storage: this.storage });
    this.spawnManager =
      options.spawnManager ??
      new SpawnManager({
        botService: this.botService,
        supervisor: this.supervisor,
      });
    this.executionModeController =
      options.executionModeController ?? new ExecutionModeController('TURBO');
    this.providerFactory = options.providerFactory;
    this.masterProvider = options.provider;
    this.lazyMaster = Boolean(options.lazyMaster);
    this.configOverrides = options.configOverrides;
    this.dryRunSpawn = Boolean(options.dryRunSpawn);
    this.onHitlEscalation = options.onHitlEscalation;
  }

  public isMasterBrainActive(): boolean {
    return this.masterActive;
  }

  public getMasterAgentLoop(): AutonomousAgentLoop | undefined {
    return this.masterAgentLoop;
  }

  /**
   * Initializes session state, reattaches live bots via PrReattach (preventing duplicate
   * Master/Worker spawns), and eagerly or lazily readies BOT000 (MASTER).
   */
  public async initializeStartup(): Promise<{
    config: ProtocolConfig;
    reattachCandidates: ReattachCandidate[];
    masterStatus: 'ACTIVE_EAGER' | 'STANDBY_LAZY' | 'REATTACHED';
  }> {
    const alreadyConfigured = await this.supervisor.isSessionInitialized(this.sessionId);
    const { config } = alreadyConfigured
      ? { config: await this.supervisor.store.getConfig(this.sessionId) }
      : await this.supervisor.initializeSession(this.sessionId, this.configOverrides);

    if (alreadyConfigured && this.configOverrides) {
      await this.supervisor.store.updateConfig(this.sessionId, (curr) => ({
        ...curr,
        ...this.configOverrides,
      }));
    }

    const existingBots = await this.botService.listBots(this.sessionId);
    const { candidates } = await this.supervisor.reconcileSessionReattach(
      this.sessionId,
      existingBots
    );

    const masterBot = existingBots.find((b) => b.bot_id === 'BOT000');
    const masterReattach = candidates.find((c) => c.botId === 'BOT000');

    if (masterBot && masterReattach?.disposition === 'REATTACH') {
      if (!this.lazyMaster) {
        await this.activateMasterBrain(config);
      }
      return {
        config,
        reattachCandidates: candidates,
        masterStatus: 'REATTACHED',
      };
    }

    if (!masterBot) {
      await this.botService.registerBot(this.sessionId, {
        botId: 'BOT000',
        displayName: 'MASTER',
        description:
          'Master Bot Coordinator & PrModerator Arbitration Seat (Unified Natural Lifecycle)',
        status: this.lazyMaster ? 'idle' : 'active',
        role: 'master',
        isModerator: true,
        modelRef: `${config.masterModel.provider}:${config.masterModel.model}`,
      });
    } else {
      await this.botService.updateStatus(
        this.sessionId,
        'BOT000',
        this.lazyMaster ? 'idle' : 'active'
      );
    }

    if (this.lazyMaster) {
      return {
        config,
        reattachCandidates: candidates,
        masterStatus: 'STANDBY_LAZY',
      };
    }

    await this.activateMasterBrain(config);
    return {
      config,
      reattachCandidates: candidates,
      masterStatus: 'ACTIVE_EAGER',
    };
  }

  /**
   * Brings Master Bot's AI brain & AutonomousAgentLoop online (used directly in eager
   * mode or triggered seamlessly in lazy mode when an objective/escalation arrives).
   */
  public async activateMasterBrain(
    existingConfig?: ProtocolConfig
  ): Promise<AutonomousAgentLoop | undefined> {
    if (this.masterActive && this.masterAgentLoop) {
      return this.masterAgentLoop;
    }

    const config = existingConfig ?? (await this.supervisor.store.getConfig(this.sessionId));
    await this.botService.updateStatus(this.sessionId, 'BOT000', 'active');

    if (!this.masterProvider && this.providerFactory) {
      const chainSpecs: ModelSpec[] = [
        config.masterModel,
        ...config.masterFailoverChain,
      ];
      if (chainSpecs.length > 1) {
        this.masterProvider = new FailoverAIProvider({
          candidates: chainSpecs.map((spec) => ({ spec })),
          providerFactory: this.providerFactory,
          sessionId: this.sessionId,
          prMasterFailover: this.supervisor.prMasterFailover,
        });
      } else {
        this.masterProvider = await this.providerFactory(config.masterModel);
      }
    }

    if (this.masterProvider) {
      this.masterAgentLoop = new AutonomousAgentLoop({
        sessionId: this.sessionId,
        botId: 'BOT000',
        storage: this.storage,
        provider: this.masterProvider,
        executionModeController: this.executionModeController,
        botService: this.botService,
        messagingService: this.messagingService,
        sharedContextService: this.sharedContextService,
        protocolSupervisor: this.supervisor,
        spawnManager: this.spawnManager,
        dryRunSpawn: this.dryRunSpawn,
        maxIterations: config.prIterasiLimit,
      });
    }

    this.masterActive = true;
    return this.masterAgentLoop;
  }

  /**
   * Initializes GoalLedger blueprint tasks for an objective (activating Master if lazy).
   */
  public async decomposeObjectiveToBlueprint(
    objective: string,
    tasks?: CreateGoalTaskInput[]
  ): Promise<GoalLedger> {
    await this.activateMasterBrain();

    const effectiveTasks: CreateGoalTaskInput[] =
      tasks && tasks.length > 0
        ? tasks
        : [
            {
              title: objective.slice(0, 80),
              description: objective,
              status: 'PENDING',
            },
          ];

    const ledger = await this.supervisor.ledger.initializeBlueprint(
      this.sessionId,
      objective,
      effectiveTasks
    );

    await this.supervisor.store.recordEvent(this.sessionId, {
      protocolId: 'SYSTEM',
      action: 'BLUEPRINT_INITIALIZED',
      actorBotId: 'BOT000',
      reason: `Master decomposed objective into ${ledger.tasks.length} GoalLedger task(s).`,
      metadata: {
        taskCount: ledger.tasks.length,
        taskIds: ledger.tasks.map((t) => t.taskId),
      },
    });

    return ledger;
  }

  /**
   * Spawns or reuses a worker for a GoalLedger task with an issued CapabilityToken.
   */
  public async dispatchTaskToNewWorker(input: {
    taskId: string;
    displayName: string;
    roleDescription?: string;
    model: ModelSpec;
    allowedPaths?: string[];
  }): Promise<SpawnWorkerOutcome> {
    await this.activateMasterBrain();
    const outcome = await this.spawnManager.spawnWorker({
      sessionId: this.sessionId,
      displayName: input.displayName,
      description: input.roleDescription,
      requesterBotId: 'BOT000',
      model: input.model,
      taskId: input.taskId,
      allowedPaths: input.allowedPaths,
      workspaceRoots: this.workspaceRoots,
      dryRun: this.dryRunSpawn,
    });

    if (outcome.botId && outcome.action !== 'DENIED') {
      await this.supervisor.ledger.updateTaskStatus(
        this.sessionId,
        input.taskId,
        'IN_PROGRESS',
        { assignedBotId: outcome.botId }
      );
    }
    return outcome;
  }

  /**
   * Pops and resolves the highest-priority pending item on MasterInterventionQueue (P0..P5).
   */
  public async processNextIntervention(options?: {
    fallbackModel?: ModelSpec;
    redirectTargetBotId?: string;
  }): Promise<InterventionQueueItem | undefined> {
    const item = this.supervisor.queue.dequeue();
    if (!item) {
      return undefined;
    }

    await this.activateMasterBrain();

    if (item.action === 'ESCALATE_HITL') {
      await this.onHitlEscalation?.(item);
      return item;
    }

    if (item.protocolId === 'PrIterasi' && item.action === 'MASTER_TAKEOVER') {
      const taskId = item.payload.taskId ? String(item.payload.taskId) : undefined;
      const fromBotId = item.payload.botId ? String(item.payload.botId) : 'BOT001';
      const nextModel =
        (item.payload.nextModel as ModelSpec | undefined) ??
        options?.fallbackModel ??
        (await this.supervisor.store.getConfig(this.sessionId)).masterModel;

      const swapOutcome = await this.spawnManager.hotSwapBotModel(
        this.sessionId,
        fromBotId,
        nextModel,
        {
          taskId,
          workspaceRoots: this.workspaceRoots,
          dryRun: this.dryRunSpawn,
        }
      );

      if (taskId && swapOutcome.botId) {
        await this.supervisor.commitTaskTransfer({
          sessionId: this.sessionId,
          taskId,
          fromBotId,
          toBotId: swapOutcome.botId,
          transferKind: 'PR_ITERASI_TAKEOVER',
          lastCompletedStep: `Takeover triggered on ${fromBotId} due to PrIterasi`,
          pendingNextStep: `Continue task ${taskId} cleanly using ${nextModel.model}`,
          checkpointIdToRestore: taskId,
          workspaceRoots: this.workspaceRoots,
        });
      }
      return item;
    }

    if (item.protocolId === 'PrDE' && item.action === 'MASTER_MEDIATION') {
      const threadId = item.payload.threadId ? String(item.payload.threadId) : undefined;
      if (threadId) {
        await this.supervisor.store.updateRuntimeState(this.sessionId, (rt) => {
          const existing = rt.threads[threadId];
          if (!existing) return rt;
          return {
            ...rt,
            threads: {
              ...rt.threads,
              [threadId]: {
                ...existing,
                status: 'RESOLVED',
                resolution: 'Resolved by Master Bot mediation.',
                lastMessageAt: new Date().toISOString(),
              },
            },
          };
        });
      }
      return item;
    }

    if (item.protocolId === 'PrMEend' && item.action === 'MASTER_MIGRATE') {
      if (options?.redirectTargetBotId) {
        await this.messagingService.sendDirectMessage(this.sessionId, {
          senderBotId: 'BOT000',
          recipient: options.redirectTargetBotId,
          messageType: 'REQUEST',
          messageKind: 'ME_END_MIGRATION',
          content: `[PrMEend Migration] ${item.summary}`,
        });
      }
      return item;
    }

    return item;
  }

  public async evaluateObjectiveCompletion(
    fileVerifier?: WorkspaceFileVerifier
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    return await this.supervisor.verifyObjectiveGate(this.sessionId, this.workspaceRoots, {
      actorBotId: 'BOT000',
      fileVerifier,
    });
  }

  public stop(): void {
    this.masterAgentLoop?.stop();
    this.spawnManager.reapAll();
    this.masterActive = false;
  }
}
