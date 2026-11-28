import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import { BotService } from '../bot/service.js';
import { OperationManifoldService } from '../operation/manifold-engine.js';
import type {
  CapabilityToken,
  ModelSpec,
  ProtocolConfig,
  SpawnMode,
} from './schema.js';
import { isGlobalWildcardPath } from './protocols/pr-moderator.protocol.js';
import type { ReattachCandidate } from './protocols/pr-reattach.protocol.js';
import { ProtocolSupervisor } from './supervisor.js';

export interface OsTerminalLaunchSpec {
  command: string;
  args: string[];
  detached: boolean;
  stdio: 'ignore' | 'pipe';
}

export interface ManagedBotProcess {
  botId: string;
  pid?: number;
  spawnMode: SpawnMode;
  model: ModelSpec;
  process?: ChildProcess;
  startedAt: string;
}

export interface SpawnWorkerInput {
  sessionId: string;
  botId?: string;
  displayName?: string;
  role?: 'worker' | 'moderator';
  roleArchetype?: string;
  description?: string;
  requesterBotId?: string;
  model: ModelSpec;
  failoverChain?: ModelSpec[];
  taskId?: string;
  allowedPaths?: string[];
  workspaceRoots: string[];
  blackboardRoot?: string;
  mcpConfigPath?: string;
  cliEntrypoint?: string;
  dryRun?: boolean;
}

export interface SpawnWorkerOutcome {
  action: 'SPAWNED' | 'RECYCLED' | 'DENIED';
  botId?: string;
  pid?: number;
  spawnMode?: SpawnMode;
  capabilityToken?: CapabilityToken;
  reason: string;
}

export type ProcessLauncher = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore' | 'pipe'; cwd?: string; env?: NodeJS.ProcessEnv }
) => Pick<ChildProcess, 'pid' | 'kill' | 'stdout' | 'stderr' | 'on' | 'unref'>;

/**
 * Pure cross-platform command builder for `windows` spawn mode (default on interactive OS)
 * vs headless `multiplexed` background worker mode.
 */
export function buildOsTerminalLaunchSpec(input: {
  platform?: NodeJS.Platform;
  spawnMode: SpawnMode;
  title: string;
  cliEntrypoint: string;
  cliArgs: string[];
  nodeExecutable?: string;
}): OsTerminalLaunchSpec {
  const platform = input.platform ?? process.platform;
  const nodeExec = input.nodeExecutable ?? process.execPath;

  if (input.spawnMode === 'multiplexed') {
    return {
      command: nodeExec,
      args: [input.cliEntrypoint, ...input.cliArgs],
      detached: false,
      stdio: 'pipe',
    };
  }

  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: [
        '/c',
        'start',
        input.title,
        'cmd.exe',
        '/k',
        nodeExec,
        input.cliEntrypoint,
        ...input.cliArgs,
      ],
      detached: true,
      stdio: 'ignore',
    };
  }

  if (platform === 'darwin') {
    const escaped = [nodeExec, input.cliEntrypoint, ...input.cliArgs]
      .map((a) => `"${a.replace(/"/g, '\\"')}"`)
      .join(' ');
    return {
      command: 'osascript',
      args: [
        '-e',
        `tell application "Terminal" to do script "${escaped.replace(/"/g, '\\"')}"`,
      ],
      detached: true,
      stdio: 'ignore',
    };
  }

  // Linux / Unix desktop fallback
  return {
    command: 'x-terminal-emulator',
    args: ['-T', input.title, '-e', nodeExec, input.cliEntrypoint, ...input.cliArgs],
    detached: true,
    stdio: 'ignore',
  };
}

/**
 * Manages OS process lifecycle for Master & Worker bots in `windows` or `multiplexed`
 * mode while enforcing PrBotGlobal, PrBot, PrModerator tokens, and PrReattach safety.
 */
export class SpawnManager {
  private readonly botService: BotService;
  private readonly supervisor: ProtocolSupervisor;
  private readonly launcher: ProcessLauncher;
  private readonly platform: NodeJS.Platform;
  private readonly managed = new Map<string, ManagedBotProcess>();
  private readonly blackboardRoot?: string;
  private readonly mcpConfigPath?: string;
  private readonly onMultiplexedLog?: (botId: string, stream: 'stdout' | 'stderr', line: string) => void;

  constructor(options: {
    botService: BotService;
    supervisor: ProtocolSupervisor;
    blackboardRoot?: string;
    mcpConfigPath?: string;
    launcher?: ProcessLauncher;
    platform?: NodeJS.Platform;
    onMultiplexedLog?: (botId: string, stream: 'stdout' | 'stderr', line: string) => void;
  }) {
    this.botService = options.botService;
    this.supervisor = options.supervisor;
    this.blackboardRoot = options.blackboardRoot ?? options.supervisor.store.getWorkspaceRoot();
    this.mcpConfigPath = options.mcpConfigPath;
    this.platform = options.platform ?? process.platform;
    this.onMultiplexedLog = options.onMultiplexedLog;
    this.launcher =
      options.launcher ??
      ((command, args, opts) =>
        spawn(command, args, {
          detached: opts.detached,
          stdio: opts.stdio,
          cwd: opts.cwd,
          env: opts.env,
          windowsHide: opts.stdio === 'pipe',
        }));
  }

  public getManagedProcesses(): ManagedBotProcess[] {
    return Array.from(this.managed.values());
  }

  public resolveEffectiveSpawnMode(
    config: ProtocolConfig,
    hasTty = Boolean(process.stdout.isTTY)
  ): SpawnMode {
    if (config.spawnMode === 'multiplexed') {
      return 'multiplexed';
    }
    if (!hasTty && this.platform !== 'win32' && !process.env.DISPLAY) {
      return 'multiplexed';
    }
    const currentWindows = Array.from(this.managed.values()).filter(
      (m) => m.spawnMode === 'windows'
    ).length;
    if (config.maxWindows > 0 && currentWindows >= config.maxWindows) {
      return 'multiplexed';
    }
    return 'windows';
  }

  public async spawnWorker(input: SpawnWorkerInput): Promise<SpawnWorkerOutcome> {
    const config = await this.supervisor.store.getConfig(input.sessionId);
    const registeredBots = await this.botService.listBots(input.sessionId);
    const activeBots = registeredBots.filter(
      (b) => b.status === 'active' || b.status === 'starting' || b.status === 'idle' || b.status === 'paused'
    );

    const permission = await this.supervisor.checkSpawnPermission(input.sessionId, {
      requesterBotId: input.requesterBotId ?? 'BOT000',
      activeBotCount: activeBots.length,
      registeredBots,
      requestedSpawns: 1,
      enforceOnAllow: false,
    });

    if (!permission.allowed) {
      return {
        action: 'DENIED',
        reason: permission.reason,
      };
    }

    const manifoldService = new OperationManifoldService({
      storage: this.supervisor.store.getStorage(),
      supervisor: this.supervisor,
    });
    const prep = await manifoldService.prepareWorkerRealization(input.sessionId, {
      requestedRole: input.roleArchetype ?? input.description ?? input.displayName,
      displayName: input.displayName,
      registeredBots,
      candidateRecycleBotId: permission.metadata?.recycleCandidateBotId as string | undefined,
    });

    if (prep.deniedReason) {
      return {
        action: 'DENIED',
        reason: prep.deniedReason,
      };
    }

    let inheritedPaths = input.allowedPaths;
    if (input.taskId && (!inheritedPaths || inheritedPaths.length === 0)) {
      const task = await this.supervisor.ledger.getTask(input.sessionId, input.taskId);
      if (task?.targetFiles && task.targetFiles.length > 0) {
        inheritedPaths = task.targetFiles;
      }
    }
    if (
      (!inheritedPaths || inheritedPaths.length === 0) &&
      prep.inheritedAllowedPaths &&
      prep.inheritedAllowedPaths.length > 0
    ) {
      inheritedPaths = prep.inheritedAllowedPaths;
    }

    const effectiveAccessMode =
      prep.defaultAccessMode === 'REVIEW_ONLY'
        ? 'REVIEW_ONLY'
        : inheritedPaths &&
            inheritedPaths.length > 0 &&
            !inheritedPaths.some((p) => isGlobalWildcardPath(p))
          ? prep.defaultAccessMode ?? 'EXCLUSIVE_WRITE'
          : 'REVIEW_ONLY';

    let recycleBotId = permission.metadata?.recycleCandidateBotId as string | undefined;
    if (recycleBotId && prep.matched && prep.rejectRecycleCandidate) {
      if (prep.alternativeRecycleBotId) {
        recycleBotId = prep.alternativeRecycleBotId;
      } else {
        const resolvedCap =
          (permission.metadata?.effectiveCap as number | undefined) ??
          this.supervisor.budget.resolveHardwareBotCap(config);
        if (activeBots.length < resolvedCap) {
          recycleBotId = undefined;
        } else {
          return {
            action: 'DENIED',
            reason:
              prep.antiAffinityReason ??
              `Idle worker ${recycleBotId} rejected by Operation anti_affinity and global ceiling (${activeBots.length}/${resolvedCap}) reached.`,
          };
        }
      }
    }

    if (recycleBotId) {
      await this.botService.updateStatus(input.sessionId, recycleBotId, 'active');
      let token: CapabilityToken | undefined;
      if (input.taskId) {
        token = await this.supervisor.issueTaskToken(input.sessionId, {
          taskId: input.taskId,
          holderBotId: recycleBotId,
          allowedPaths: inheritedPaths,
          accessMode: effectiveAccessMode,
        });
      }
      if (prep.matched && prep.roleArchetype) {
        await manifoldService.commitWorkerRealization(
          input.sessionId,
          recycleBotId,
          prep.roleArchetype.id
        );
      }
      return {
        action: 'RECYCLED',
        botId: recycleBotId,
        capabilityToken: token,
        reason: `Recycled idle worker ${recycleBotId} under PrBotGlobal ceiling.`,
      };
    }

    const runtimeStateBeforeSpawn = await this.supervisor.store.getRuntimeState(input.sessionId);
    const prBotEval = await this.supervisor.registry.evaluate(
      'PrBot',
      {
        sessionId: input.sessionId,
        requesterBotId: input.requesterBotId ?? 'BOT000',
        config,
        state: runtimeStateBeforeSpawn,
        requestedSpawns: 1,
      },
      { enforce: true }
    );
    if (!prBotEval.decision.allowed) {
      return {
        action: 'DENIED',
        reason: prBotEval.decision.reason,
      };
    }

    const botRecord = await this.botService.registerBot(input.sessionId, {
      botId: input.botId,
      displayName: input.displayName ?? input.role ?? 'Worker',
      description: input.description,
      status: 'starting',
      role: input.role ?? 'worker',
      spawnedBy: input.requesterBotId ?? 'BOT000',
      modelRef: `${input.model.provider}:${input.model.model}`,
    });

    const effectiveMode = this.resolveEffectiveSpawnMode(config, !input.dryRun);
    let token: CapabilityToken | undefined;
    if (input.taskId) {
      token = await this.supervisor.issueTaskToken(input.sessionId, {
        taskId: input.taskId,
        holderBotId: botRecord.bot_id,
        allowedPaths: inheritedPaths,
        accessMode: effectiveAccessMode,
      });
    }

    if (input.dryRun) {
      await this.botService.updateStatus(input.sessionId, botRecord.bot_id, 'active');
      if (prep.matched && prep.roleArchetype) {
        await manifoldService.commitWorkerRealization(
          input.sessionId,
          botRecord.bot_id,
          prep.roleArchetype.id
        );
      }
      this.managed.set(botRecord.bot_id, {
        botId: botRecord.bot_id,
        pid: process.pid,
        spawnMode: effectiveMode,
        model: input.model,
        startedAt: new Date().toISOString(),
      });
      return {
        action: 'SPAWNED',
        botId: botRecord.bot_id,
        pid: process.pid,
        spawnMode: effectiveMode,
        capabilityToken: token,
        reason: `Registered worker ${botRecord.bot_id} (${effectiveMode}, dry-run).`,
      };
    }

    const effectiveBlackboardRoot =
      input.blackboardRoot ?? this.blackboardRoot ?? input.workspaceRoots[0] ?? process.cwd();
    const effectiveMcpConfigPath = input.mcpConfigPath ?? this.mcpConfigPath;

    const failoverCandidates = (
      input.failoverChain && input.failoverChain.length > 0
        ? input.failoverChain
        : config.modelPool.filter(
            (m) => !(m.provider === input.model.provider && m.model === input.model.model)
          )
    ).map((m) => `${m.provider}:${m.model}`);

    const cliEntry = input.cliEntrypoint ?? process.argv[1] ?? 'dist/cli/bin.js';
    const cliArgs = [
      'bot',
      'run',
      '--session',
      input.sessionId,
      '--bot',
      botRecord.bot_id,
      '--name',
      botRecord.display_name,
      '--provider',
      input.model.provider,
      '--model',
      input.model.model,
      '--mode',
      'turbo',
      '--max-iterations',
      String(config.prIterasiLimit),
      '--timeout',
      String(config.taskTimeoutMs),
      '--workspace',
      effectiveBlackboardRoot,
    ];
    if (input.description) {
      cliArgs.push('--role', input.description);
    }
    if (input.model.baseUrl) {
      cliArgs.push('--base-url', input.model.baseUrl);
    }
    if (failoverCandidates.length > 0) {
      cliArgs.push('--failover', failoverCandidates.join(','));
    }
    if (effectiveMcpConfigPath) {
      cliArgs.push('--mcp-config', effectiveMcpConfigPath);
    }

    const launchSpec = buildOsTerminalLaunchSpec({
      platform: this.platform,
      spawnMode: effectiveMode,
      title: `Almudaya ${botRecord.bot_id} (${input.model.model})`,
      cliEntrypoint: cliEntry,
      cliArgs,
    });

    const child = this.launcher(launchSpec.command, launchSpec.args, {
      detached: launchSpec.detached,
      stdio: launchSpec.stdio,
      cwd: input.workspaceRoots[0] ?? effectiveBlackboardRoot,
      env: process.env,
    });

    if (launchSpec.detached && typeof child.unref === 'function') {
      child.unref();
    }

    if (effectiveMode === 'multiplexed' && this.onMultiplexedLog) {
      const logFn = this.onMultiplexedLog;
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
          if (line.trim()) logFn(botRecord.bot_id, 'stdout', line);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
          if (line.trim()) logFn(botRecord.bot_id, 'stderr', line);
        }
      });
    }

    await this.botService.updateStatus(
      input.sessionId,
      botRecord.bot_id,
      'active',
      child.pid ? { pid: child.pid } : undefined
    );

    if (prep.matched && prep.roleArchetype) {
      await manifoldService.commitWorkerRealization(
        input.sessionId,
        botRecord.bot_id,
        prep.roleArchetype.id
      );
    }

    this.managed.set(botRecord.bot_id, {
      botId: botRecord.bot_id,
      pid: child.pid,
      spawnMode: effectiveMode,
      model: input.model,
      process: child as ChildProcess,
      startedAt: new Date().toISOString(),
    });

    return {
      action: 'SPAWNED',
      botId: botRecord.bot_id,
      pid: child.pid,
      spawnMode: effectiveMode,
      capabilityToken: token,
      reason: `Spawned ${botRecord.bot_id} in ${effectiveMode} mode (model=${input.model.provider}:${input.model.model}).`,
    };
  }

  public async hotSwapBotModel(
    sessionId: string,
    botId: string,
    nextModel: ModelSpec,
    options?: {
      taskId?: string;
      workspaceRoots?: string[];
      dryRun?: boolean;
    }
  ): Promise<SpawnWorkerOutcome> {
    this.reapBotProcess(botId);
    const bot = await this.botService.getBot(sessionId, botId);
    if (!bot) {
      throw new Error(`Bot not found for hot-swap: ${botId}`);
    }
    await this.botService.updateStatus(sessionId, botId, 'recycled');

    return await this.spawnWorker({
      sessionId,
      displayName: `${bot.display_name}-v2`,
      description: bot.description,
      requesterBotId: 'BOT000',
      model: nextModel,
      taskId: options?.taskId,
      workspaceRoots: options?.workspaceRoots ?? [process.cwd()],
      dryRun: options?.dryRun ?? true,
    });
  }

  public async reconcileWithPrReattach(
    sessionId: string,
    processChecker?: (pid: number) => boolean
  ): Promise<ReattachCandidate[]> {
    const bots = await this.botService.listBots(sessionId);
    const { candidates } = await this.supervisor.reconcileSessionReattach(
      sessionId,
      bots,
      processChecker
    );

    for (const candidate of candidates) {
      if (candidate.disposition === 'RESPAWN') {
        await this.botService.updateStatus(sessionId, candidate.botId, 'stale');
      }
    }
    return candidates;
  }

  public reapBotProcess(botId: string): boolean {
    const handle = this.managed.get(botId);
    if (!handle) {
      return false;
    }
    if (handle.process) {
      try {
        handle.process.kill();
      } catch {
        // ignore already exited child
      }
    }
    this.managed.delete(botId);
    return true;
  }

  public reapAll(): void {
    for (const botId of Array.from(this.managed.keys())) {
      this.reapBotProcess(botId);
    }
  }
}

export type { ModelSpec, SpawnMode };
