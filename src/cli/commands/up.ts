import { Command } from 'commander';
import path from 'node:path';
import process from 'node:process';
import { createAIProvider, type CatalogProviderId } from '../../ai/catalog.js';
import { FailoverAIProvider } from '../../ai/failover-provider.js';
import { GeminiProvider } from '../../ai/gemini.js';
import { MockAIProvider } from '../../ai/mock-provider.js';
import type { IAIModelProvider } from '../../ai/provider.js';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { BotConsole } from '../../bot/console.js';
import { ExecutionModeController, type ExecutionMode } from '../../bot/execution-mode.js';
import { BotRuntime } from '../../bot/runtime.js';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { ValidationError } from '../../core/errors.js';
import { VERSION } from '../../core/version.js';
import { ExecutionController } from '../../execution/controller.js';
import { McpClientManager, McpConfigStore } from '../../mcp/index.js';
import { createWorkspaceMemoryRuntime } from '../../memory_modules/index.js';
import { MasterAgentOrchestrator } from '../../protocol/master-agent.js';
import {
  ProtocolConfigSchema,
  type ModelSpec,
  type ProtocolConfig,
  type SpawnMode,
} from '../../protocol/schema.js';
import { SessionService } from '../../session/service.js';
import { SharedContextService } from '../../shared/service.js';

export interface UpCliOptions {
  session?: string;
  root?: string[];
  workspace?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  masterFailover?: string;
  pool?: string;
  spawnMode?: string;
  maxWindows?: string;
  lazyMaster?: boolean;
  prBot?: string;
  prBotGlobal?: string;
  prIterasi?: string;
  prDe?: string;
  tokenBudget?: string;
  timeLimit?: string;
  moderator?: string;
  prMeEnd?: boolean;
  prGate?: boolean;
  reattach?: boolean;
  allowMasterWrite?: boolean;
  mcpConfig?: string;
  mcp?: boolean;
  turbo?: boolean;
  mode?: string;
  nonInteractive?: boolean;
}

/**
 * Parses comma-separated `provider:model` entries into validated ModelSpec[].
 * Preserves colons inside model names such as `ollama:qwen2.5-coder:7b`.
 */
export function parseModelSpecList(raw?: string): ModelSpec[] {
  if (!raw || !raw.trim()) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      if (idx <= 0) {
        return { provider: 'ollama', model: entry };
      }
      return {
        provider: entry.slice(0, idx).trim().toLowerCase(),
        model: entry.slice(idx + 1).trim(),
      };
    });
}

function parsePositiveIntOption(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError(`Invalid --${name} "${raw}". Must be a positive integer.`);
  }
  return parsed;
}

/**
 * Resolves a single IAIModelProvider instance from a ModelSpec.
 */
export function instantiateProviderFromSpec(spec: ModelSpec): IAIModelProvider {
  const prov = spec.provider.toLowerCase();
  if (prov === 'mock') {
    return new MockAIProvider(spec.model || 'mock-master', [
      { text: 'Master Bot standby & coordination active.' },
    ]);
  }
  if (prov === 'gemini') {
    return new GeminiProvider({ modelName: spec.model || 'gemini-2.5-flash' });
  }
  if (['nvidia', 'openrouter', '9router', 'ollama'].includes(prov)) {
    return createAIProvider({
      provider: prov as CatalogProviderId,
      modelName: spec.model,
      baseUrl: spec.baseUrl,
    });
  }
  throw new ValidationError(`Unknown provider "${spec.provider}" in ModelSpec.`);
}

export function resolveDefaultMasterSpec(options: UpCliOptions): ModelSpec {
  if (options.provider) {
    const p = options.provider.toLowerCase();
    const defaultModel =
      options.model ??
      (p === 'gemini'
        ? 'gemini-2.5-flash'
        : p === 'nvidia'
          ? 'nvidia/nemotron-3.5-super-vl-120b-a12b'
          : p === 'ollama'
            ? 'qwen2.5-coder:7b'
            : p === 'openrouter'
              ? 'deepseek/deepseek-chat-v3-0324:free'
              : 'mock-master');
    return { provider: p, model: defaultModel, baseUrl: options.baseUrl };
  }

  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', model: options.model ?? 'gemini-2.5-flash' };
  }
  if (process.env.NVIDIA_API_KEY) {
    return {
      provider: 'nvidia',
      model: options.model ?? 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      model: options.model ?? 'deepseek/deepseek-chat-v3-0324:free',
    };
  }
  if (process.env.OLLAMA_BASE_URL) {
    return { provider: 'ollama', model: options.model ?? 'qwen2.5-coder:7b' };
  }
  return { provider: 'mock', model: options.model ?? 'mock-master' };
}

/**
 * Translates CLI flags into a validated Partial<ProtocolConfig>.
 */
export function buildProtocolConfigFromCliOptions(
  options: UpCliOptions
): Partial<ProtocolConfig> {
  const spawnMode = (options.spawnMode?.toLowerCase() ?? 'windows') as SpawnMode;
  if (spawnMode !== 'windows' && spawnMode !== 'multiplexed') {
    throw new ValidationError(
      `Invalid --spawn-mode "${options.spawnMode}". Must be "windows" or "multiplexed".`
    );
  }

  let maxWindows = 0;
  if (options.maxWindows !== undefined) {
    const parsed = Number.parseInt(options.maxWindows, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError(`Invalid --max-windows "${options.maxWindows}".`);
    }
    maxWindows = parsed;
  }

  let prBotGlobalMax: 'auto' | number = 'auto';
  if (options.prBotGlobal && options.prBotGlobal.toLowerCase() !== 'auto') {
    prBotGlobalMax = parsePositiveIntOption(options.prBotGlobal, 'pr-bot-global')!;
  }

  let globalTimeoutMs: 'infinite' | number = 'infinite';
  if (options.timeLimit && options.timeLimit.toLowerCase() !== 'infinite') {
    globalTimeoutMs = parsePositiveIntOption(options.timeLimit, 'time-limit')!;
  }

  const masterModel = resolveDefaultMasterSpec(options);
  const masterFailoverChain = parseModelSpecList(options.masterFailover);
  const modelPool = parseModelSpecList(options.pool);

  const partial: Partial<ProtocolConfig> = {
    spawnMode,
    maxWindows,
    prBotLimit: parsePositiveIntOption(options.prBot, 'pr-bot') ?? 10,
    prBotGlobalMax,
    prIterasiLimit: parsePositiveIntOption(options.prIterasi, 'pr-iterasi') ?? 25,
    prDeLimit: parsePositiveIntOption(options.prDe, 'pr-de') ?? 10,
    tokenBudget: parsePositiveIntOption(options.tokenBudget, 'token-budget') ?? 10000000,
    globalTimeoutMs,
    moderatorBotId: options.moderator ?? 'BOT000',
    prMeEndEnabled: options.prMeEnd !== false,
    prGateEnabled: options.prGate !== false,
    prReattachEnabled: options.reattach !== false,
    masterStrictOrchestrator: !options.allowMasterWrite,
    masterModel,
    masterFailoverChain,
    modelPool: modelPool.length > 0 ? modelPool : [masterModel],
  };

  return ProtocolConfigSchema.parse(partial);
}

export function registerUpCommand(program: Command): void {
  program
    .command('up')
    .alias('start')
    .alias('master')
    .description(
      `Start unified Almudaya Multi-Agent HITL + Master Bot (BOT000) session with v${VERSION} protocols`
    )
    .option('-s, --session <sessionId>', 'Create or resume a session ID')
    .option('-r, --root <paths...>', 'Workspace directory root paths')
    .option('-w, --workspace <path>', 'Blackboard workspace root directory')
    .option('--provider <provider>', 'Master AI provider (gemini|nvidia|openrouter|9router|ollama|mock)')
    .option('--model <model>', 'Master AI model name')
    .option('--base-url <url>', 'Custom OpenAI-compatible base URL')
    .option('--master-failover <specs>', 'Comma-separated failover models (provider:model,...)')
    .option('--pool <specs>', 'Comma-separated worker model pool (provider:model,...)')
    .option('--spawn-mode <mode>', 'Worker terminal spawn mode (windows|multiplexed)', 'windows')
    .option('--max-windows <count>', 'Max concurrent OS worker terminal windows (0=unlimited)', '0')
    .option('--lazy-master', 'Wait in HITL standby until an objective activates Master Bot', false)
    .option('--pr-bot <limit>', 'Cumulative worker spawn limit per session', '10')
    .option('--pr-bot-global <limit>', 'Global concurrent bot ceiling (auto or integer)', 'auto')
    .option('--pr-iterasi <limit>', 'Max ReAct iterations before PrIterasi handover', '25')
    .option('--pr-de <limit>', 'Max thread exchanges before PrDE mediation', '10')
    .option('--token-budget <tokens>', 'Session-wide token ceiling for PrBotGlobal', '10000000')
    .option('--time-limit <ms>', 'Session time budget in ms or "infinite"', 'infinite')
    .option('--moderator <botId>', 'Initial PrModerator holder Bot ID', 'BOT000')
    .option('--no-pr-me-end', 'Disable PrMEend dead-end message routing guard')
    .option('--no-pr-gate', 'Disable PrGate objective completion gate')
    .option('--no-reattach', 'Disable PrReattach PID reconciliation on resume')
    .option('--allow-master-write', 'Allow Master Bot (BOT000) to directly write/edit code even when workers are active', false)
    .option('--mcp-config <path>', 'Optional external mcp.json config file to load MCP servers')
    .option('--no-mcp', 'Disable automatic MCP server connection on startup')
    .option('--turbo', 'Start execution mode in TURBO instead of REQUEST_REVIEW', false)
    .option('--mode <mode>', 'Execution mode (review|turbo)')
    .option('--non-interactive', 'Initialize and exit without starting interactive HITL console', false)
    .action(async (options: UpCliOptions) => {
      try {
        const configOverrides = buildProtocolConfigFromCliOptions(options);
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        ExecutionController.configureWorkspaceRoot(workspaceRoot);
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const sessionService = new SessionService(storage);
        const sharedContext = new SharedContextService(storage);

        let sessionId = options.session;
        if (sessionId) {
          try {
            await sessionService.getSession(sessionId);
          } catch {
            const created = await sessionService.createSession({
              sessionId,
              sessionName: sessionId,
              description: `Almudaya v${VERSION} Unified Natural Lifecycle session`,
            });
            sessionId = created.session_id;
          }
        } else {
          const created = await sessionService.createSession({
            sessionName: 'almudaya-session',
            description: `Almudaya v${VERSION} Unified Natural Lifecycle session`,
          });
          sessionId = created.session_id;
        }

        const rootPaths =
          options.root && options.root.length > 0
            ? options.root.map((p) => path.resolve(p))
            : [workspaceRoot];

        const existingRoots = await sharedContext.listProjectRoots(sessionId);
        for (const rootPath of rootPaths) {
          if (!existingRoots.some((r) => path.resolve(r.path) === rootPath)) {
            await sharedContext.registerProjectRoot(sessionId, {
              name: path.basename(rootPath) || 'workspace',
              path: rootPath,
              rootType: 'primary',
            });
          }
        }

        const execMode: ExecutionMode =
          options.turbo || options.mode?.toLowerCase() === 'turbo'
            ? 'TURBO'
            : 'REQUEST_REVIEW';
        const execController = new ExecutionModeController(execMode);

        let mcpManager: McpClientManager | undefined;
        if (!options.nonInteractive && options.mcp !== false) {
          const mcpStore = new McpConfigStore({ workspaceRoot });
          const effectiveServers = await mcpStore.resolveEffectiveServers({
            sessionId,
            externalConfigPath: options.mcpConfig,
          });
          if (effectiveServers.length > 0) {
            mcpManager = new McpClientManager({ workspaceRoot });
            const statuses = await mcpManager.connectAll(effectiveServers);
            const okCount = statuses.filter((s) => s.connected).length;
            console.log(
              `[MCP] Master connected ${okCount}/${statuses.length} server(s) (${mcpManager.getRegisteredTools().length} tool(s)).`
            );
          }
        }

        const orchestrator = new MasterAgentOrchestrator({
          storage,
          sessionId,
          workspaceRoots: rootPaths,
          configOverrides,
          lazyMaster: Boolean(options.lazyMaster),
          executionModeController: execController,
          mcpConfigPath: options.mcpConfig,
          mcpManager,
          providerFactory: (spec) => instantiateProviderFromSpec(spec),
        });

        const startup = await orchestrator.initializeStartup();

        if (options.nonInteractive) {
          console.log(`Session ready: ${sessionId} (${startup.masterStatus})`);
          orchestrator.stop();
          await mcpManager?.disposeAll();
          return;
        }

        const masterSpec = startup.config.masterModel!;
        const masterChain = [masterSpec, ...(startup.config.masterFailoverChain ?? [])];
        const masterProvider: IAIModelProvider | undefined = options.lazyMaster
          ? undefined
          : masterChain.length > 1
            ? new FailoverAIProvider({
                candidates: masterChain.map((spec) => ({ spec })),
                providerFactory: (spec) => instantiateProviderFromSpec(spec),
                sessionId,
                prMasterFailover: orchestrator.supervisor.prMasterFailover,
              })
            : instantiateProviderFromSpec(masterSpec);

        const memoryRuntime = createWorkspaceMemoryRuntime(storage) ?? undefined;
        let consoleInstance: BotConsole | undefined;

        const masterRuntime = new BotRuntime(storage, {
          sessionId,
          botId: 'BOT000',
          displayName: 'MASTER',
          description: 'Master Bot Coordinator & PrModerator Arbitration Seat',
          modelRef: `${masterSpec.provider}:${masterSpec.model}`,
          autoAcknowledge: true,
          memoryRuntime,
          onMessage: async (msg, signal) => {
            const notif = `📨 [MASTER] Pesan dari ${msg.sender_bot_id}: "${msg.content.slice(0, 120)}"`;
            if (consoleInstance) {
              consoleInstance.printNotification(notif);
            } else {
              console.log(notif);
            }
            const loop = await orchestrator.activateMasterBrain();
            if (loop) {
              const reply = await loop.handleMessage(msg, signal);
              consoleInstance?.printNotification(
                `👑 [MASTER] Diproses: "${reply.slice(0, 140)}${reply.length > 140 ? '...' : ''}"`
              );
            }
          },
          onBroadcast: async (evt) => {
            if (evt.sender_bot_id !== 'BOT000') {
              consoleInstance?.printNotification(
                `📢 [${evt.category}][${evt.sender_bot_id}]: ${evt.content}`
              );
            }
          },
        });

        await masterRuntime.start();
        consoleInstance = new BotConsole({
          runtime: masterRuntime,
          agentLoop: orchestrator.getMasterAgentLoop(),
          storage,
          executionModeController: execController,
          aiProvider: masterProvider,
          protocolSupervisor: orchestrator.supervisor,
          spawnManager: orchestrator.spawnManager,
          mcpManager,
          mcpConfigPath: options.mcpConfig,
          isMasterConsole: true,
          onExit: async () => {
            orchestrator.stop();
          },
        });

        execController.setPromptHandler(
          async (q) => await consoleInstance!.askQuestion(q)
        );
        consoleInstance.start();
        await consoleInstance.waitForClose();
      } catch (err: unknown) {
        console.error(`Failed to start Almudaya v${VERSION} Master session: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
