import path from 'node:path';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import { BotService } from './service.js';
import type { BotRecord } from './schema.js';
import { MessagingService } from '../messaging/service.js';
import { SharedContextService } from '../shared/service.js';
import type { ProjectRootRecord } from '../shared/schema.js';
import type { DirectMessage } from '../messaging/schema.js';
import type {
  IAIModelProvider,
  AIMessage,
  AIResponse,
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
} from '../ai/provider.js';
import { RateLimitPauseError } from '../ai/provider.js';
import { sleepWithSignal } from '../ai/gemini.js';
import {
  buildDynamicSystemPrompt,
  formatOperatorInstruction,
  formatUntrustedDirectMessage,
} from '../ai/prompts.js';
import { FILE_TOOLS, executeFileTool } from '../tools/file-tools.js';
import { RUN_COMMAND_TOOL, executeRunCommand, type RunCommandArgs } from '../tools/command-tools.js';
import { GET_WORK_LOG_TOOL, executeGetWorkLog } from '../tools/work-log-tool.js';
import { SEND_MESSAGE_TOOL, executeSendMessage } from '../tools/messaging-tools.js';
import { USE_SKILL_TOOL, executeUseSkill } from '../tools/skill-tools.js';
import { QUERY_PKU_MEMORY_TOOL, executeQueryPkuMemory } from '../tools/pku-tools.js';
import {
  WEB_TOOLS,
  executeInspectWebUi,
  executeWebFetch,
  type InspectWebUiArgs,
  type WebFetchArgs,
} from '../tools/web-tools.js';
import type { McpClientManager } from '../mcp/manager.js';
import {
  WORKER_PROTOCOL_TOOLS,
  executeRequestSpawnBot,
  executeSubmitTaskHandoff,
  executeUpdateGoalTask,
} from '../tools/goal-tools.js';
import {
  MASTER_PROTOCOL_TOOLS,
  executeMasterProtocolTool,
} from '../tools/master-tools.js';
import type { TouchedFileStatus } from '../protocol/schema.js';
import type { SpawnManager } from '../protocol/spawn-manager.js';
import { ProtocolSupervisor } from '../protocol/supervisor.js';
import { OperationManifoldService } from '../operation/manifold-engine.js';
import { SkillService } from '../skills/service.js';
import { WorkLogService, type WorkActionType } from '../shared/work-log.js';
import { isPathInsideRoot } from '../tools/sandbox.js';
import { ExecutionModeController } from './execution-mode.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  computeContentHash,
  createCodebaseIndexerForStorage,
  createWorkspaceMemoryRuntime,
  deriveIdempotencyKey,
  deriveProjectUniverseId,
  type MemoryRuntime,
  type ProjectCodebaseIndexer,
} from '../memory_modules/index.js';

export interface AgentStepEvent {
  iteration: number;
  thought?: string;
  toolCalls?: ToolCallRequest[];
  toolResults?: ToolCallResult[];
}

export interface AgentLoopOptions {
  sessionId: string;
  botId: string;
  storage: IBlackboardStorage;
  provider: IAIModelProvider;
  executionModeController?: ExecutionModeController;
  maxIterations?: number;
  botService?: BotService;
  messagingService?: MessagingService;
  sharedContextService?: SharedContextService;
  skillService?: SkillService;
  memoryRuntime?: MemoryRuntime;
  enablePkuSync?: boolean;
  protocolSupervisor?: ProtocolSupervisor;
  spawnManager?: SpawnManager;
  activeTaskId?: string;
  activeTokenId?: string;
  dryRunSpawn?: boolean;
  mcpManager?: McpClientManager;
  onStep?: (event: AgentStepEvent) => Promise<void> | void;
  onStatus?: (statusMessage: string) => Promise<void> | void;
}

/**
 * Autonomous ReAct Agent Loop for multi-bot software engineering (ADR-204 & FR-216).
 * Routes inbox messages to AI inference, dispatches tools within sandboxed roots,
 * enforces safety modes (Request Review vs Turbo), logs Blackboard audit trail (FR-217),
 * and autonomously replies to peer bots.
 */
export class AutonomousAgentLoop {
  public readonly sessionId: string;
  public readonly botId: string;
  private readonly storage: IBlackboardStorage;
  private provider: IAIModelProvider;
  private readonly executionModeController: ExecutionModeController;
  private readonly maxIterations: number;

  private readonly botService: BotService;
  private readonly messagingService: MessagingService;
  private readonly sharedContextService: SharedContextService;
  private readonly workLogService: WorkLogService;
  private readonly skillService: SkillService;
  private readonly memoryRuntime?: MemoryRuntime;
  private readonly codebaseIndexer?: ProjectCodebaseIndexer;
  private readonly syncedRoots = new Set<string>();
  private readonly protocolSupervisor?: ProtocolSupervisor;
  private readonly spawnManager?: SpawnManager;
  private readonly activeTaskId?: string;
  private readonly activeTokenId?: string;
  private readonly dryRunSpawn?: boolean;
  private readonly blackboardRoot?: string;
  private mcpManager?: McpClientManager;
  private readonly onStepCallback?: (event: AgentStepEvent) => Promise<void> | void;
  private readonly onStatusCallback?: (statusMessage: string) => Promise<void> | void;
  private abortController: AbortController = new AbortController();

  constructor(options: AgentLoopOptions) {
    this.sessionId = options.sessionId;
    this.botId = options.botId;
    this.storage = options.storage;
    this.provider = options.provider;
    this.executionModeController =
      options.executionModeController ?? new ExecutionModeController('REQUEST_REVIEW');
    this.maxIterations = options.maxIterations ?? 25;

    this.botService = options.botService ?? new BotService(this.storage);
    this.messagingService =
      options.messagingService ?? new MessagingService(this.storage, this.botService);
    this.sharedContextService =
      options.sharedContextService ?? new SharedContextService(this.storage);
    this.workLogService = new WorkLogService(this.storage);
    this.memoryRuntime =
      options.memoryRuntime ??
      (options.enablePkuSync !== false ? createWorkspaceMemoryRuntime(this.storage) ?? undefined : undefined);
    this.codebaseIndexer =
      createCodebaseIndexerForStorage(this.storage, this.memoryRuntime?.pkuStore) ?? undefined;
    this.skillService =
      options.skillService ??
      new SkillService({ storage: this.storage, pkuStore: this.memoryRuntime?.pkuStore });
    this.protocolSupervisor = options.protocolSupervisor;
    this.spawnManager = options.spawnManager;
    this.activeTaskId = options.activeTaskId;
    this.activeTokenId = options.activeTokenId;
    this.dryRunSpawn = options.dryRunSpawn;
    const maybeFsStorage = options.storage as { workspaceRoot?: unknown };
    this.blackboardRoot =
      typeof maybeFsStorage.workspaceRoot === 'string' ? maybeFsStorage.workspaceRoot : undefined;
    this.mcpManager = options.mcpManager;
    this.onStepCallback = options.onStep;
    this.onStatusCallback = options.onStatus;
  }

  public getMcpManager(): McpClientManager | undefined {
    return this.mcpManager;
  }

  public setMcpManager(manager?: McpClientManager): void {
    this.mcpManager = manager;
  }

  public getProvider(): IAIModelProvider {
    return this.provider;
  }

  public setProvider(nextProvider: IAIModelProvider): void {
    this.provider.dispose?.();
    this.provider = nextProvider;
  }

  public stop(): void {
    this.abortController.abort();
    this.provider.dispose?.();
  }

  private async resolveActiveProtocolSupervisor(): Promise<ProtocolSupervisor | undefined> {
    if (this.protocolSupervisor) {
      return this.protocolSupervisor;
    }
    const candidate = new ProtocolSupervisor({ storage: this.storage });
    if (await candidate.isSessionInitialized(this.sessionId)) {
      return candidate;
    }
    return undefined;
  }

  /**
   * Processes an incoming direct message through the iterative ReAct loop.
   */
  public async handleMessage(message: DirectMessage, signal?: AbortSignal): Promise<string> {
    const isAborted = () => this.abortController.signal.aborted || signal?.aborted;
    if (isAborted()) {
      throw new Error('Operation aborted');
    }

    // Suppress ping-pong loops triggered by peer escalation notices (APP-BUG-15)
    if (
      message.sender_bot_id !== 'OPERATOR' &&
      typeof message.content === 'string' &&
      message.content.trim().startsWith('[PrBotGlobal Escalation:')
    ) {
      return '[PrBotGlobal Escalation Acknowledged — Auto-reply suppressed to prevent ping-pong.]';
    }

    // 1. Gather dynamic session context
    const currentBot = await this.botService.getBot(this.sessionId, this.botId);
    const peerBots = await this.botService.listBots(this.sessionId);
    const projectRoots = await this.sharedContextService.listProjectRoots(this.sessionId);
    const projectRootPaths = projectRoots.map((r) => r.path);

    const activeSupervisor = await this.resolveActiveProtocolSupervisor();
    const isMasterActor = currentBot.role === 'master' || this.botId === 'BOT000';
    const currentTaskId = message.task_id ?? this.activeTaskId;
    const activeTokenId =
      message.transfer_envelope?.capabilityToken.tokenId ??
      this.activeTokenId ??
      currentBot.active_capability_token_id;
    const activeFenceEpoch = message.transfer_envelope?.capabilityToken.fenceEpoch;

    const protocolConfig = activeSupervisor
      ? await activeSupervisor.store.getConfig(this.sessionId)
      : undefined;
    const hasActiveWorkers = peerBots.some((b) => b.bot_id !== 'BOT000');
    const strictMasterRole =
      Boolean(activeSupervisor) &&
      isMasterActor &&
      (protocolConfig?.masterStrictOrchestrator ?? true) &&
      hasActiveWorkers;

    if (activeSupervisor) {
      this.executionModeController.setCapabilityValidator(async (req) => {
        const rawTarget = req.args['path'] ?? req.args['working_dir'];
        const decision = await activeSupervisor.checkWriteAccess(this.sessionId, {
          botId: this.botId,
          tokenId: activeTokenId,
          fenceEpoch: activeFenceEpoch,
          targetPath: rawTarget ? String(rawTarget) : undefined,
        });
        return { allowed: decision.allowed, reason: decision.reason };
      });
    }

    // Ensure PKU codebase index is incrementally up-to-date on first turn per root (fail-open)
    if (this.codebaseIndexer && this.memoryRuntime?.enabled) {
      for (const root of projectRoots) {
        if (this.syncedRoots.has(root.root_id)) continue;
        this.syncedRoots.add(root.root_id);
        try {
          await this.codebaseIndexer.syncProjectRoot(this.sessionId, root);
        } catch {
          // Fail-open: never block agent turn
        }
      }
    }
    const recentWorkLogsMarkdown = await this.workLogService.getRecentSummaryMarkdown(
      this.sessionId,
      10
    );
    const skillsPromptMarkdown = await this.skillService.buildBotSkillPromptSection(
      this.sessionId,
      this.botId
    );

    const [dynamicRulesMarkdown, goalLedgerMarkdown] = activeSupervisor
      ? await Promise.all([
          activeSupervisor.rules.formatRulesForPrompt(this.sessionId, this.botId, currentTaskId),
          activeSupervisor.ledger.formatSummaryMarkdown(
            this.sessionId,
            isMasterActor ? undefined : this.botId
          ),
        ])
      : ['', ''];

    let capabilityTokenSummary: string | undefined;
    if (activeTokenId) {
      capabilityTokenSummary = `TokenId=${activeTokenId}, FenceEpoch=${activeFenceEpoch ?? 'auto'}, TaskId=${currentTaskId ?? 'N/A'}`;
    } else if (activeSupervisor) {
      const botTokens = await activeSupervisor.prModerator.getActiveTokensForBot(
        this.sessionId,
        this.botId
      );
      if (botTokens.length > 0) {
        capabilityTokenSummary = botTokens
          .map(
            (t) =>
              `TokenId=${t.tokenId} (${t.accessMode}, epoch=${t.fenceEpoch}, paths=[${t.allowedPaths.join(', ')}])`
          )
          .join('\n');
      }
    }

    const mcpToolsSummary = this.mcpManager?.getPromptSummaryMarkdown() || undefined;

    let operationSummaryMarkdown: string | undefined;
    try {
      const opSup = activeSupervisor ?? new ProtocolSupervisor({ storage: this.storage });
      const manifoldSvc = new OperationManifoldService({
        storage: this.storage,
        supervisor: opSup,
        skillService: this.skillService,
      });
      operationSummaryMarkdown =
        (await manifoldSvc.buildPromptContextMarkdown(this.sessionId, this.botId)) || undefined;
    } catch {
      operationSummaryMarkdown = undefined;
    }

    const systemPrompt = buildDynamicSystemPrompt({
      sessionId: this.sessionId,
      botId: currentBot.bot_id,
      displayName: currentBot.display_name,
      role: currentBot.description,
      description: currentBot.description,
      peerBots,
      projectRoots,
      executionMode: this.executionModeController.getMode(),
      recentWorkLogsMarkdown,
      skillsPromptMarkdown,
      operationSummaryMarkdown,
      dynamicRulesMarkdown: dynamicRulesMarkdown || undefined,
      goalLedgerMarkdown: goalLedgerMarkdown || undefined,
      capabilityTokenSummary,
      mcpToolsSummary,
      protocolActive: Boolean(activeSupervisor),
    });

    // 2. Prepare available tools
    const effectiveFileTools = strictMasterRole
      ? FILE_TOOLS.filter((t) => t.name !== 'write_file' && t.name !== 'edit_file')
      : FILE_TOOLS;

    const availableTools: ToolDefinition[] = [
      QUERY_PKU_MEMORY_TOOL,
      ...effectiveFileTools,
      RUN_COMMAND_TOOL,
      ...WEB_TOOLS,
      GET_WORK_LOG_TOOL,
      SEND_MESSAGE_TOOL,
      USE_SKILL_TOOL,
      ...(activeSupervisor ? WORKER_PROTOCOL_TOOLS : []),
      ...(activeSupervisor && isMasterActor ? MASTER_PROTOCOL_TOOLS : []),
      ...(this.mcpManager ? this.mcpManager.getToolDefinitions() : []),
    ];

    // 3. Sender Identity Verification (IDV-01, §18, §5.20)
    let senderDisplayName = message.sender_bot_id;
    try {
      const senderBot = await this.botService.getBot(this.sessionId, message.sender_bot_id);
      senderDisplayName = senderBot.display_name;
    } catch {
      // Retain raw ID if sender bot is not in active registry
    }

    const isOperator = message.sender_bot_id === 'OPERATOR';
    const isIncomingAutoReply = Boolean(
      message.metadata && (message.metadata as Record<string, unknown>)['isAutoReply']
    );

    // Initialize conversation messages cleanly for OPERATOR or with untrusted boundary delimiter for peers (SEC-02, APP-BUG-09)
    const conversation: AIMessage[] = [
      {
        role: 'user',
        content: isOperator
          ? formatOperatorInstruction(message.timestamp, message.content)
          : formatUntrustedDirectMessage(
              senderDisplayName,
              message.sender_bot_id,
              message.timestamp,
              message.content
            ),
      },
    ];

    let finalResponseText = '';
    let iteration = 0;
    let explicitlyMessagedSender = false;
    let explicitlySubmittedHandoff = false;
    let escalatedOrHalted = false;
    const touchedFiles: TouchedFileStatus[] = [];
    const turnStartedMs = Date.now();
    const masterToolNames = new Set(MASTER_PROTOCOL_TOOLS.map((t) => t.name));

    // 4. Bounded ReAct Iteration Loop
    const effectiveSignal = signal ?? this.abortController.signal;

    while (iteration < this.maxIterations) {
      if (isAborted()) {
        throw new Error('Operation aborted');
      }
      iteration++;

      let aiResponse: AIResponse;
      try {
        aiResponse = await this.provider.generateResponse({
          systemPrompt,
          messages: conversation,
          tools: availableTools,
          signal: effectiveSignal,
        });
      } catch (err: unknown) {
        if (err instanceof RateLimitPauseError) {
          if (isAborted()) {
            throw new Error('Operation aborted');
          }
          const delaySec = Math.ceil(err.retryDelaySeconds);
          const providerLabel =
            this.provider.providerId === 'gemini'
              ? 'Gemini'
              : `${this.provider.providerId} (${this.provider.modelName})`;
          const notifyMsg = `⏳ Kuota ${providerLabel} tercapai (429 RESOURCE_EXHAUSTED). Menunggu jeda ${delaySec} detik sebelum mencoba kembali...`;
          if (this.onStatusCallback) {
            await this.onStatusCallback(notifyMsg);
          }
          await sleepWithSignal((delaySec + 1) * 1000, effectiveSignal);
          if (isAborted()) {
            throw new Error('Operation aborted');
          }
          iteration--; // Retry this turn without incrementing bounded counter
          continue;
        }
        throw err;
      }

      const thought = aiResponse.text;
      const toolCalls = aiResponse.toolCalls;

      if (activeSupervisor && aiResponse.usage?.totalTokens) {
        const budgetCheck = await activeSupervisor.recordUsageAndCheckBudget(
          this.sessionId,
          aiResponse.usage.totalTokens
        );
        if (!budgetCheck.allowed) {
          escalatedOrHalted = true;
          finalResponseText = `[PrBotGlobal Escalation: ${budgetCheck.reason}]`;
          try {
            await this.messagingService.publishBroadcast(this.sessionId, {
              senderBotId: this.botId,
              category: 'ALERT',
              content: finalResponseText,
              metadata: budgetCheck.metrics,
            });
          } catch {
            // Best-effort alert broadcast
          }
          break;
        }
      }

      // Notify step observer
      if (this.onStepCallback) {
        await this.onStepCallback({
          iteration,
          thought,
          toolCalls
        });
      }

      // If AI decided to call tools
      if (toolCalls && toolCalls.length > 0) {
        // Record assistant turn with tool calls
        conversation.push({
          role: 'model',
          content: thought,
          toolCalls
        });

        const toolResults: ToolCallResult[] = [];

        for (const toolCall of toolCalls) {
          // Log intended tool invocation to Blackboard events as audit trail (FR-217)
          try {
            await this.messagingService.publishBroadcast(this.sessionId, {
              senderBotId: this.botId,
              category: 'ACTIVITY',
              content: `Bot "${currentBot.display_name}" memanggil perkakas: ${toolCall.name}`,
              metadata: {
                tool: toolCall.name,
                arguments: toolCall.arguments,
                iteration
              }
            });
          } catch {
            // Ignore broadcast failure during high concurrency
          }

          // Evaluate execution safety mode (Request Review vs Turbo)
          const approval = await this.executionModeController.requestApproval({
            toolName: toolCall.name,
            args: toolCall.arguments,
            botName: currentBot.display_name,
            botId: currentBot.bot_id
          });

          if (!approval.approved) {
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.name,
              error: approval.reason ?? 'Aksi dibatalkan oleh operator.'
            });
            continue;
          }

          // Execute tool in sandbox
          try {
            let result: unknown;

            if (toolCall.name === 'query_pku_memory') {
              result = await executeQueryPkuMemory(
                this.memoryRuntime,
                this.sessionId,
                this.botId,
                toolCall.arguments
              );
            } else if (toolCall.name === 'send_message') {
              const targetRecipient = String(
                toolCall.arguments['recipient'] ?? toolCall.arguments['to'] ?? ''
              ).trim();
              if (
                targetRecipient &&
                (targetRecipient === message.sender_bot_id ||
                  targetRecipient.toLowerCase() === senderDisplayName.toLowerCase())
              ) {
                explicitlyMessagedSender = true;
              }
              result = await executeSendMessage(
                this.messagingService,
                this.sessionId,
                this.botId,
                toolCall.arguments
              );
            } else if (activeSupervisor && toolCall.name === 'request_spawn_bot') {
              result = await executeRequestSpawnBot(
                activeSupervisor,
                this.messagingService,
                this.sessionId,
                this.botId,
                toolCall.arguments
              );
            } else if (activeSupervisor && toolCall.name === 'update_goal_task') {
              result = await executeUpdateGoalTask(
                activeSupervisor,
                this.sessionId,
                this.botId,
                toolCall.arguments
              );
            } else if (activeSupervisor && toolCall.name === 'submit_task_handoff') {
              explicitlySubmittedHandoff = true;
              const targetRec = String(toolCall.arguments['recipient'] ?? '').trim();
              if (
                targetRec &&
                (targetRec === message.sender_bot_id ||
                  targetRec.toLowerCase() === senderDisplayName.toLowerCase())
              ) {
                explicitlyMessagedSender = true;
              }
              result = await executeSubmitTaskHandoff(
                activeSupervisor,
                this.messagingService,
                this.sessionId,
                this.botId,
                {
                  ...toolCall.arguments,
                  existing_token_id:
                    toolCall.arguments['existing_token_id'] ?? activeTokenId,
                },
                { touchedFiles, threadId: message.thread_id }
              );
            } else if (activeSupervisor && masterToolNames.has(toolCall.name)) {
              result = await executeMasterProtocolTool(toolCall.name, toolCall.arguments, {
                supervisor: activeSupervisor,
                messagingService: this.messagingService,
                botService: this.botService,
                spawnManager: this.spawnManager,
                workspaceRoots: projectRootPaths,
                sessionId: this.sessionId,
                trustedBotId: this.botId,
                dryRunSpawn: this.dryRunSpawn,
              });
            } else if (toolCall.name === 'get_work_log') {
              result = await executeGetWorkLog(
                this.storage,
                this.sessionId,
                toolCall.arguments
              );
            } else if (toolCall.name === 'use_skill') {
              result = await executeUseSkill(
                this.storage,
                this.sessionId,
                this.botId,
                toolCall.arguments,
                this.skillService.skillRootDir
              );
            } else if (toolCall.name === 'web_fetch') {
              const fetchArgs = toolCall.arguments as unknown as WebFetchArgs;
              const fetchRes = await executeWebFetch(fetchArgs, {
                sessionId: this.sessionId,
                botId: this.botId,
                botDisplayName: currentBot.display_name,
                isTurbo: this.executionModeController.getMode() === 'TURBO',
                projectRoots: projectRootPaths,
                workspaceRoot: this.blackboardRoot,
              });
              result = fetchRes;
              await this.recordToolExecutionWorkLog(
                currentBot,
                projectRoots,
                'WEB_INSPECT',
                undefined,
                `web_fetch ${fetchRes.url} (status ${fetchRes.status})`,
                { url: fetchRes.url, status: fetchRes.status }
              );
            } else if (toolCall.name === 'inspect_web_ui') {
              const inspectArgs = toolCall.arguments as unknown as InspectWebUiArgs;
              const inspectRes = await executeInspectWebUi(projectRootPaths, inspectArgs, {
                sessionId: this.sessionId,
                botId: this.botId,
                botDisplayName: currentBot.display_name,
                isTurbo: this.executionModeController.getMode() === 'TURBO',
                projectRoots: projectRootPaths,
                workspaceRoot: this.blackboardRoot,
              });
              result = inspectRes;
              await this.recordToolExecutionWorkLog(
                currentBot,
                projectRoots,
                'WEB_INSPECT',
                undefined,
                `inspect_web_ui ${inspectRes.url} [${inspectRes.mode}] (overflow=${inspectRes.horizontalOverflowPx}px, blur=${inspectRes.glassmorphismAudit.backdropBlurElements}, consoleErrors=${inspectRes.consoleErrors.length})`,
                {
                  url: inspectRes.url,
                  mode: inspectRes.mode,
                  ok: inspectRes.ok,
                }
              );
            } else if (this.mcpManager && this.mcpManager.isMcpToolName(toolCall.name)) {
              const mcpRes = await this.mcpManager.invokeTool(
                toolCall.name,
                toolCall.arguments,
                {
                  sessionId: this.sessionId,
                  botId: this.botId,
                  botDisplayName: currentBot.display_name,
                  isTurbo: this.executionModeController.getMode() === 'TURBO',
                  projectRoots: projectRootPaths,
                  workspaceRoot: this.blackboardRoot,
                }
              );
              result = mcpRes;
              await this.recordToolExecutionWorkLog(
                currentBot,
                projectRoots,
                'MCP_TOOL_CALL',
                undefined,
                `Called MCP tool ${mcpRes['server']}:${mcpRes['tool']}`,
                {
                  namespaced_tool: toolCall.name,
                  server: mcpRes['server'],
                  tool: mcpRes['tool'],
                }
              );
            } else if (toolCall.name === 'run_command') {
              const cmdArgs: RunCommandArgs = {
                command: String(toolCall.arguments['command'] ?? ''),
                timeout_ms:
                  typeof toolCall.arguments['timeout_ms'] === 'number'
                    ? toolCall.arguments['timeout_ms']
                    : undefined,
                working_dir:
                  typeof toolCall.arguments['working_dir'] === 'string'
                    ? toolCall.arguments['working_dir']
                    : undefined
              };
              const cmdResult = await executeRunCommand(projectRootPaths, cmdArgs, {
                sessionId: this.sessionId,
                botId: this.botId,
                botDisplayName: currentBot.display_name,
                isTurbo: this.executionModeController.getMode() === 'TURBO',
                workspaceRoot: this.blackboardRoot,
              });
              result = cmdResult;

              // Automatic Work Log Recording (FR-313, ADR-302)
              await this.recordToolExecutionWorkLog(
                currentBot,
                projectRoots,
                'COMMAND',
                cmdArgs.working_dir,
                `Ran command: ${cmdArgs.command} (exitCode: ${cmdResult.exitCode})`,
                {
                  command: cmdArgs.command,
                  exit_code: cmdResult.exitCode,
                  stdout_snippet: cmdResult.stdout.slice(0, 200),
                }
              );
            } else {
              if (
                strictMasterRole &&
                (toolCall.name === 'write_file' || toolCall.name === 'edit_file')
              ) {
                throw new Error(
                  `Master Bot (BOT000) operates under strict orchestrator isolation (masterStrictOrchestrator=true): delegate "${toolCall.name}" to the owning worker bot.`
                );
              }

              if (
                activeSupervisor &&
                currentTaskId &&
                (toolCall.name === 'write_file' || toolCall.name === 'edit_file')
              ) {
                const filePath = String(toolCall.arguments['path'] ?? '');
                if (filePath) {
                  const snap = await activeSupervisor.checkpoints.captureBeforeMutation(
                    this.sessionId,
                    currentTaskId,
                    projectRoots,
                    filePath
                  );
                  touchedFiles.push({
                    path: filePath,
                    status: 'CLEAN',
                    checkpointPath: snap,
                  });
                }
              }

              result = await executeFileTool(
                projectRootPaths,
                toolCall.name,
                toolCall.arguments,
                {
                  sessionId: this.sessionId,
                  botId: this.botId,
                  botDisplayName: currentBot.display_name,
                  isTurbo: this.executionModeController.getMode() === 'TURBO',
                  workspaceRoot: this.blackboardRoot,
                }
              );

              // Automatic Work Log Recording + Single-File Incremental PKU Index Update
              if (toolCall.name === 'write_file') {
                const filePath = String(toolCall.arguments['path'] ?? '');
                await this.recordToolExecutionWorkLog(
                  currentBot,
                  projectRoots,
                  'WRITE',
                  filePath,
                  `Wrote file ${filePath}`,
                  {
                    path: filePath,
                    bytes: String(toolCall.arguments['content'] ?? '').length,
                  }
                );
                await this.indexSingleFileSafely(projectRoots, filePath);
              } else if (toolCall.name === 'edit_file') {
                const filePath = String(toolCall.arguments['path'] ?? '');
                await this.recordToolExecutionWorkLog(
                  currentBot,
                  projectRoots,
                  'EDIT',
                  filePath,
                  `Edited file ${filePath}`,
                  {
                    path: filePath,
                  }
                );
                await this.indexSingleFileSafely(projectRoots, filePath);
              }
            }

            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.name,
              result
            });

            // Log tool success to Blackboard (FR-217)
            try {
              await this.messagingService.publishBroadcast(this.sessionId, {
                senderBotId: this.botId,
                category: 'ACTIVITY',
                content: `Bot "${currentBot.display_name}" berhasil mengeksekusi: ${toolCall.name}`,
                metadata: {
                  tool: toolCall.name,
                  success: true
                }
              });
            } catch {
              // Ignore broadcast failure
            }
          } catch (err: unknown) {
            const errorMsg = (err as Error).message;
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.name,
              error: errorMsg
            });
          }
        }

        // Add tool results as tool messages
        for (const tr of toolResults) {
          conversation.push({
            role: 'tool',
            toolResult: tr
          });
        }

        if (this.onStepCallback) {
          await this.onStepCallback({
            iteration,
            toolResults
          });
        }

        // Loop continues to let AI observe results and reason further
        continue;
      }

      // If no tool calls, AI reached final conclusion
      if (thought) {
        finalResponseText = thought;
        conversation.push({
          role: 'model',
          content: thought
        });
      }
      break;
    }

    if (!finalResponseText && iteration >= this.maxIterations) {
      finalResponseText = `[Peringatan: Mencapai batas maksimal ${this.maxIterations} iterasi tool.]`;
      if (activeSupervisor && !isMasterActor) {
        await activeSupervisor.evaluatePrIterasi({
          sessionId: this.sessionId,
          botId: this.botId,
          taskId: currentTaskId,
          iteration,
          elapsedMs: Date.now() - turnStartedMs,
          currentModel: {
            provider: this.provider.providerId,
            model: this.provider.modelName,
          },
        });
      }
    }

    // 5. Send automated reply back to sender bot (FR-216 + v0.3.5 PrDE / PrMEend)
    if (message.sender_bot_id && message.sender_bot_id !== this.botId) {
      try {
        if (
          message.sender_bot_id !== 'OPERATOR' &&
          !explicitlyMessagedSender &&
          !isIncomingAutoReply &&
          !escalatedOrHalted
        ) {
          await this.messagingService.sendDirectMessage(this.sessionId, {
            senderBotId: this.botId,
            recipient: message.sender_bot_id,
            content: finalResponseText || '(Tugas telah diselesaikan.)',
            threadId: message.thread_id,
            taskId: currentTaskId,
            exchangeCount:
              message.exchange_count !== undefined ? message.exchange_count + 1 : undefined,
            ccMaster: activeSupervisor ? true : undefined,
            metadata: { correlationId: message.message_id, isAutoReply: true },
          });
        }

        if (activeSupervisor && message.thread_id && message.sender_bot_id !== 'OPERATOR') {
          await activeSupervisor.evaluatePrDe({
            sessionId: this.sessionId,
            threadId: message.thread_id,
            senderBotId: this.botId,
            recipientBotId: message.sender_bot_id,
            exchangeCount:
              message.exchange_count !== undefined ? message.exchange_count + 1 : undefined,
            progressDeltaScore: touchedFiles.length,
          });
        }

        if (
          activeSupervisor &&
          !isMasterActor &&
          !explicitlySubmittedHandoff &&
          !explicitlyMessagedSender &&
          message.sender_bot_id === 'OPERATOR'
        ) {
          await activeSupervisor.evaluatePrMeEnd({
            sessionId: this.sessionId,
            senderBotId: this.botId,
            recipientBotId: undefined,
            recipientExists: false,
            hasSentLoopMessage: false,
            messageContent: finalResponseText,
          });
        }

        // Log completion decision to Blackboard
        await this.messagingService.publishBroadcast(this.sessionId, {
          senderBotId: this.botId,
          category: 'DECISION',
          content: message.sender_bot_id === 'OPERATOR'
            ? `Bot "${currentBot.display_name}" menyelesaikan instruksi operator.`
            : `Bot "${currentBot.display_name}" menyelesaikan tugas dari "${senderDisplayName}".`,
          metadata: {
            replyToMessageId: message.message_id,
            iterations: iteration
          }
        });
      } catch (err) {
        console.error(`Failed to send autonomous reply message: ${(err as Error).message}`);
      }
    }

    await this.captureTurnMemorySafely(message, iteration, finalResponseText);

    return finalResponseText;
  }

  /**
   * Captures the completed ReAct turn into PKU (session state + individual bot checkpoint)
   * in fail-open mode so PKU outages never disrupt bot execution.
   */
  private async captureTurnMemorySafely(
    message: DirectMessage,
    iteration: number,
    finalResponseText: string
  ): Promise<void> {
    if (!this.memoryRuntime || !this.memoryRuntime.enabled) {
      return;
    }

    try {
      await this.memoryRuntime.captureSessionSafely(this.sessionId);

      const nowIso = new Date().toISOString();
      const projectUniverseId = deriveProjectUniverseId(
        `session_${this.sessionId.toLowerCase()}`
      );
      const checkpointId = `ckpt_${message.message_id}_${iteration}`;
      const summary = (finalResponseText || '(Tugas telah diselesaikan.)').slice(0, 280);
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.acma',
        scopeId: `${this.sessionId}:${this.botId}`,
        sourceType: 'ExecutionCheckpoint',
        sourceRecordId: checkpointId,
        contentHash: computeContentHash({
          messageId: message.message_id,
          iteration,
          summary,
        }),
      });

      await this.memoryRuntime.individualBridge.saveCheckpoint(
        {
          checkpointId,
          identity: {
            principalId: this.botId,
            registerKind: 'individual',
            projectUniverseId,
            sessionId: this.sessionId,
            botId: this.botId,
          },
          sourceMessageId: message.message_id,
          iteration,
          maxIterations: this.maxIterations,
          status: 'completed',
          summary,
          workingContext: {
            senderBotId: message.sender_bot_id,
            replyLength: finalResponseText.length,
          },
          knowledgeRefs: [],
          schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        idemKey
      );
    } catch {
      // Fail-open: never allow PKU persistence errors to break agent turn completion
    }
  }

  /**
   * Incrementally re-indexes ONLY the single modified file into PKU without touching
   * unchanged project files.
   */
  private async indexSingleFileSafely(
    projectRoots: ProjectRootRecord[],
    targetPath: string
  ): Promise<void> {
    if (!this.codebaseIndexer || !this.memoryRuntime?.enabled || !targetPath) {
      return;
    }
    try {
      for (const root of projectRoots) {
        const candidate = path.isAbsolute(targetPath)
          ? path.resolve(targetPath)
          : path.resolve(root.path, targetPath);
        if (isPathInsideRoot(root.path, candidate)) {
          await this.codebaseIndexer.indexSingleFile(this.sessionId, root, candidate);
          break;
        }
      }
    } catch {
      // Fail-open: incremental index failure never interrupts tool execution
    }
  }

  /**
   * Automatically records a work action entry to the shared work log with precise project root resolution.
   */
  private async recordToolExecutionWorkLog(
    currentBot: BotRecord,
    projectRoots: ProjectRootRecord[],
    actionType: WorkActionType,
    targetPathOrDir: string | undefined,
    summary: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    try {
      let targetRoot = projectRoots[0];
      let relPath: string | undefined = undefined;
      let fullPath: string | undefined = undefined;

      if (targetPathOrDir && projectRoots.length > 0) {
        const matched = projectRoots.find((r) =>
          isPathInsideRoot(r.path, targetPathOrDir) ||
          targetPathOrDir.startsWith(r.root_id)
        );

        if (matched) {
          targetRoot = matched;
          if (isPathInsideRoot(matched.path, targetPathOrDir)) {
            relPath = path.relative(matched.path, targetPathOrDir).replace(/\\/g, '/');
            fullPath = path.resolve(targetPathOrDir);
          } else {
            relPath = targetPathOrDir.replace(/\\/g, '/');
          }
        } else if (targetRoot) {
          relPath = targetPathOrDir.replace(/\\/g, '/');
          fullPath = path.resolve(targetRoot.path, targetPathOrDir);
        }
      }

      await this.workLogService.recordWork(this.sessionId, {
        botId: currentBot.bot_id,
        botName: currentBot.display_name,
        actionType,
        targetRootId: targetRoot?.root_id ?? 'default',
        targetRootName: targetRoot?.name ?? 'Project Root',
        targetRootPath: targetRoot?.path ?? '',
        relativePath: relPath,
        fullPath: fullPath,
        summary,
        details,
      });
    } catch {
      // Prevent failure in work log recording from interrupting ReAct agent loop
    }
  }
}
