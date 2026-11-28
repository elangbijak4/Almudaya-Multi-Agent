import readline from 'node:readline';
import process from 'node:process';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import type { BotRuntime } from './runtime.js';
import type { AutonomousAgentLoop } from './agent-loop.js';
import type { IAIModelProvider } from '../ai/provider.js';
import {
  createAIProvider,
  discoverModels,
  inferProviderForModel,
  type CatalogProviderId,
} from '../ai/catalog.js';
import {
  detectHardwareProfile,
  formatHardwareAdvisorReport,
  formatPullProgress,
  pullOllamaModel,
  recommendModelsForHardware,
} from '../ai/hardware-advisor.js';
import { ExecutionModeController } from './execution-mode.js';
import { BotService } from './service.js';
import { MessagingService } from '../messaging/service.js';
import { SharedContextService } from '../shared/service.js';
import { WorkLogService } from '../shared/work-log.js';
import { SkillService } from '../skills/service.js';
import { generateMessageId, type DirectMessage } from '../messaging/schema.js';
import { VERSION } from '../core/version.js';
import type { ProtocolSupervisor } from '../protocol/supervisor.js';
import { ProtocolSupervisor as RuntimeProtocolSupervisor } from '../protocol/supervisor.js';
import type { SpawnManager } from '../protocol/spawn-manager.js';
import type { McpClientManager } from '../mcp/manager.js';
import { McpConfigStore } from '../mcp/config-store.js';
import { OperationManifoldService } from '../operation/manifold-engine.js';
import { OperationRegistry } from '../operation/registry.js';
import { validateOperationPackage } from '../operation/validator.js';

export interface BotConsoleOptions {
  runtime: BotRuntime;
  agentLoop?: AutonomousAgentLoop;
  storage: IBlackboardStorage;
  executionModeController?: ExecutionModeController;
  aiProvider?: IAIModelProvider;
  protocolSupervisor?: ProtocolSupervisor;
  spawnManager?: SpawnManager;
  mcpManager?: McpClientManager;
  mcpConfigPath?: string;
  isMasterConsole?: boolean;
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
  onExit?: () => Promise<void>;
}

/**
 * All-in-One Interactive Bot Console REPL (v0.3.0+).
 * Provides a non-blocking interactive command prompt for each bot process,
 * supporting slash commands (/msg, /broadcast, /peers, /roots, /log, /mode, /skill, /help, /clear, /exit),
 * direct natural language AI instructions, and non-destructive TTY rendering.
 */
export class BotConsole {
  public readonly runtime: BotRuntime;
  public readonly agentLoop?: AutonomousAgentLoop;
  public readonly storage: IBlackboardStorage;
  public readonly executionModeController: ExecutionModeController;
  public aiProvider?: IAIModelProvider;
  public readonly inputStream: NodeJS.ReadableStream;
  public readonly outputStream: NodeJS.WritableStream;
  public readonly isTTY: boolean;

  public readonly botId: string;
  public readonly botDisplayName: string;
  public readonly sessionId: string;
  public readonly promptString: string;

  private rl?: readline.Interface;
  private closed: boolean = false;
  private isAskingQuestion: boolean = false;
  private isProcessingInput: boolean = false;
  private readonly inputQueue: string[] = [];

  private readonly onExitCallback?: () => Promise<void>;
  private readonly botService: BotService;
  private readonly messagingService: MessagingService;
  private readonly sharedContextService: SharedContextService;
  private readonly workLogService: WorkLogService;
  private readonly skillService: SkillService;
  private readonly protocolSupervisor?: ProtocolSupervisor;
  private readonly spawnManager?: SpawnManager;
  private readonly mcpManager?: McpClientManager;
  private readonly mcpConfigPath?: string;
  public readonly isMasterConsole: boolean;

  private closeResolver?: () => void;
  private closePromise?: Promise<void>;

  constructor(options: BotConsoleOptions) {
    this.runtime = options.runtime;
    this.agentLoop = options.agentLoop;
    this.storage = options.storage;
    this.executionModeController =
      options.executionModeController ?? new ExecutionModeController('REQUEST_REVIEW');
    this.aiProvider = options.aiProvider;
    this.protocolSupervisor = options.protocolSupervisor;
    this.spawnManager = options.spawnManager;
    this.mcpManager = options.mcpManager ?? options.agentLoop?.getMcpManager();
    this.mcpConfigPath = options.mcpConfigPath;

    this.inputStream = options.inputStream ?? process.stdin;
    this.outputStream = options.outputStream ?? process.stdout;
    this.isTTY = Boolean((this.outputStream as { isTTY?: boolean }).isTTY);

    this.botId = options.runtime.botId;
    this.botDisplayName = options.runtime.displayName || options.runtime.botId || 'Bot';
    this.sessionId = options.runtime.sessionId;
    this.isMasterConsole = Boolean(options.isMasterConsole || this.botId === 'BOT000');
    this.promptString = this.isMasterConsole
      ? `HITL [MASTER]> `
      : `${this.botDisplayName}> `;

    this.onExitCallback = options.onExit;
    this.botService = new BotService(this.storage);
    this.messagingService = new MessagingService(this.storage, this.botService);
    this.sharedContextService = new SharedContextService(this.storage);
    this.workLogService = new WorkLogService(this.storage);
    this.skillService = new SkillService({ storage: this.storage });

    // Wire up Human-in-the-Loop review prompt handler
    this.executionModeController.setPromptHandler(async (question: string) => {
      return await this.askQuestion(question);
    });
  }

  /**
   * Starts the interactive REPL prompt.
   */
  public async start(): Promise<void> {
    if (this.closed) return;

    this.closePromise = new Promise<void>((resolve) => {
      this.closeResolver = resolve;
    });

    this.rl = readline.createInterface({
      input: this.inputStream as NodeJS.ReadableStream,
      output: this.outputStream as NodeJS.WritableStream,
      terminal: this.isTTY,
    });

    this.rl.on('line', async (line: string) => {
      if (this.isAskingQuestion || this.closed) return;
      this.inputQueue.push(line);
      if (this.isProcessingInput) return;

      this.isProcessingInput = true;
      try {
        while (this.inputQueue.length > 0 && !this.closed && !this.isAskingQuestion) {
          let nextLine = this.inputQueue.shift()!;
          // Coalesce rapid multi-line pasted natural-language instructions (APP-BUG-07)
          if (!nextLine.trim().startsWith('/')) {
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
            while (
              this.inputQueue.length > 0 &&
              !this.inputQueue[0]!.trim().startsWith('/')
            ) {
              nextLine += '\n' + this.inputQueue.shift()!;
            }
          }
          await this.handleInput(nextLine);
        }
      } finally {
        this.isProcessingInput = false;
        if (!this.closed && !this.isAskingQuestion && this.rl) {
          this.rl.prompt();
        }
      }
    });

    this.rl.on('close', async () => {
      if (this.closed) return;
      if (this.isTTY) {
        await this.stop();
      }
    });

    this.rl.on('SIGINT', async () => {
      this.writeLine('\n[Console] Menerima sinyal SIGINT. Menghentikan bot...');
      await this.stop();
    });

    this.printBanner();
    this.rl.setPrompt(this.promptString);
    this.rl.prompt();
  }

  /**
   * Returns a promise that resolves when the console REPL closes.
   */
  public async waitForClose(): Promise<void> {
    return this.closePromise ?? Promise.resolve();
  }

  /**
   * Writes a line of text directly to the console output stream.
   */
  public writeLine(text: string): void {
    this.outputStream.write(`${text}\n`);
  }

  /**
   * Prints an incoming notification (broadcast or direct message) without corrupting
   * the operator's active input typing buffer (ADR-301 Non-Destructive TTY Rendering).
   */
  public printNotification(text: string): void {
    if (this.closed) return;

    if (this.isTTY && this.rl) {
      // 1. \r: cursor to start of line
      // 2. \x1b[K: clear active line
      // 3. write notification text with newline
      // 4. re-prompt preserving typed line buffer
      this.outputStream.write(`\r\x1b[K${text}\n`);
      this.rl.prompt(true);
    } else {
      this.outputStream.write(`${text}\n`);
    }
  }

  /**
   * Prefixed live stream output helper for `--spawn-mode multiplexed`.
   */
  public printMultiplexedWorkerLog(
    workerBotId: string,
    stream: 'stdout' | 'stderr',
    line: string
  ): void {
    const tag = stream === 'stderr' ? `!${workerBotId}` : workerBotId;
    this.printNotification(`[${tag}] ${line}`);
  }

  /**
   * Prompts the operator with an interactive question (used for Human-in-the-Loop review).
   */
  public async askQuestion(questionText: string): Promise<string> {
    if (this.closed) return 'n';
    if (!this.rl) {
      this.writeLine(questionText);
      return 'n';
    }

    return new Promise<string>((resolve) => {
      this.isAskingQuestion = true;
      this.rl!.question(questionText, (answer) => {
        this.isAskingQuestion = false;
        if (this.rl && !this.closed) {
          this.rl.setPrompt(this.promptString);
        }
        resolve(answer.trim());
      });
    });
  }

  /**
   * Routes raw user input from the console prompt.
   */
  public async handleInput(rawLine: string): Promise<void> {
    const line = rawLine.trim();
    if (!line) return;

    if (line.startsWith('/')) {
      await this.dispatchSlashCommand(line);
    } else {
      await this.handleNaturalLanguageInstruction(line);
    }
  }

  /**
   * Dispatches slash commands (/msg, /broadcast, /peers, /roots, /log, /mode, /skill, /status, /clear, /help, /exit).
   */
  public async dispatchSlashCommand(line: string): Promise<void> {
    const [cmdToken, ...argTokens] = line.split(/\s+/);
    const command = cmdToken!.toLowerCase();
    const argsString = line.slice(cmdToken!.length).trim();

    switch (command) {
      case '/msg':
      case '/send': {
        const match = argsString.match(/^([^\s]+)\s+(.+)$/s);
        if (!match) {
          this.writeLine('[Console] Penggunaan: /msg <targetBot> <pesan>');
          return;
        }
        const targetBot = match[1]!;
        const content = match[2]!;

        try {
          await this.messagingService.sendDirectMessage(this.sessionId, {
            senderBotId: this.botId,
            recipient: targetBot,
            content,
          });
          this.writeLine(`[Console] Pesan terkirim ke "${targetBot}": "${content}"`);
        } catch (err: unknown) {
          this.writeLine(`[Console] Gagal mengirim pesan: ${(err as Error).message}`);
        }
        break;
      }

      case '/broadcast':
      case '/shout': {
        if (!argsString) {
          this.writeLine('[Console] Penggunaan: /broadcast <pesan>');
          return;
        }

        try {
          await this.messagingService.publishBroadcast(this.sessionId, {
            senderBotId: this.botId,
            content: argsString,
            category: 'ACTIVITY',
          });
          this.writeLine(`[Console] Broadcast dipublikasikan: "${argsString}"`);
        } catch (err: unknown) {
          this.writeLine(`[Console] Gagal mempublikasikan broadcast: ${(err as Error).message}`);
        }
        break;
      }

      case '/peers': {
        try {
          const bots = await this.botService.reconcileBotLiveness(this.sessionId);
          if (bots.length === 0) {
            this.writeLine(`[Console] Tidak ada rekan bot terdaftar dalam sesi "${this.sessionId}".`);
            return;
          }
          this.writeLine(`[Console] Rekan Bot dalam Sesi [${this.sessionId}]:`);
          for (const b of bots) {
            const isSelf = b.bot_id === this.botId ? ' (bot ini)' : '';
            const role = b.description ? ` - Role: ${b.description}` : '';
            const pid = b.pid ? ` - PID: ${b.pid}` : '';
            this.writeLine(`  - [${b.bot_id}] "${b.display_name}" (${b.status})${isSelf}${role}${pid}`);
          }
        } catch (err: unknown) {
          this.writeLine(`[Console] Gagal membaca daftar bot: ${(err as Error).message}`);
        }
        break;
      }

      case '/roots': {
        try {
          const roots = await this.sharedContextService.listProjectRoots(this.sessionId);
          if (roots.length === 0) {
            this.writeLine(`[Console] Belum ada project root terdaftar dalam sesi "${this.sessionId}".`);
            return;
          }
          this.writeLine(`[Console] Project Roots Terdaftar [${this.sessionId}]:`);
          for (const r of roots) {
            const desc = r.description ? ` (${r.description})` : '';
            this.writeLine(`  - [${r.root_id}] "${r.name}" (${r.root_type}): ${r.path}${desc}`);
          }
        } catch (err: unknown) {
          this.writeLine(`[Console] Gagal membaca project roots: ${(err as Error).message}`);
        }
        break;
      }

      case '/log': {
        let limit = 10;
        let rootId: string | undefined = undefined;

        if (argTokens.length > 0) {
          const firstNum = parseInt(argTokens[0]!, 10);
          if (!isNaN(firstNum) && firstNum > 0) {
            limit = firstNum;
            if (argTokens.length > 1) {
              rootId = argTokens[1];
            }
          } else {
            rootId = argTokens[0];
            if (argTokens.length > 1) {
              const secondNum = parseInt(argTokens[1]!, 10);
              if (!isNaN(secondNum) && secondNum > 0) {
                limit = secondNum;
              }
            }
          }
        }

        try {
          const logs = await this.workLogService.readWorkLogs(this.sessionId, { limit, rootId });
          if (logs.length === 0) {
            this.writeLine(`[Console] Belum ada riwayat kerja yang dicatat dalam sesi ini.`);
            return;
          }
          this.writeLine(`[Console] Riwayat Kerja Sesi (menampilkan ${logs.length} entri):`);
          for (const entry of logs) {
            const rootDisplay = entry.target_root_name || entry.target_root_id;
            const pathSuffix = entry.relative_path ? ` (${entry.relative_path})` : '';
            const timeFormatted = entry.timestamp.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
            this.writeLine(`  - [${timeFormatted}] ${entry.bot_name} [${entry.action_type}] root "${rootDisplay}"${pathSuffix}: ${entry.summary}`);
          }
        } catch (err: unknown) {
          this.writeLine(`[Console] Gagal membaca work log: ${(err as Error).message}`);
        }
        break;
      }

      case '/mode': {
        if (argTokens.length === 0) {
          this.writeLine(`[Console] Mode eksekusi saat ini: ${this.executionModeController.getMode()}`);
          return;
        }

        const targetMode = argTokens[0]!.toLowerCase();
        if (targetMode === 'review' || targetMode === 'request_review') {
          this.executionModeController.setMode('REQUEST_REVIEW');
          this.writeLine('[Console] Mode eksekusi diubah menjadi: REQUEST_REVIEW (Human-in-the-Loop review aktif)');
        } else if (targetMode === 'turbo') {
          this.executionModeController.setMode('TURBO');
          this.writeLine('[Console] Mode eksekusi diubah menjadi: TURBO (Eksekusi otonom cepat tanpa konfirmasi)');
        } else {
          this.writeLine('[Console] Mode tidak dikenal. Pilihan valid: /mode review atau /mode turbo');
        }
        break;
      }

      case '/skill':
      case '/skills': {
        const sub = (argTokens[0] ?? 'list').toLowerCase();
        try {
          if (sub === 'list') {
            const installed = await this.skillService.listSkills();
            const bindings = await this.skillService.getSessionSkills(this.sessionId, this.botId, false);
            this.writeLine(`[Console] Modul Skill Terpasang (${installed.length}):`);
            for (const s of installed) {
              this.writeLine(
                `  * ${s.skill_id} (v${s.version}) — ${s.styles_count} styles, ${s.platforms_count} platforms, ${s.modalities_count} modalities`
              );
            }
            if (bindings.length > 0) {
              this.writeLine(`[Console] Konfigurasi Skill pada Sesi [${this.sessionId}]:`);
              for (const b of bindings) {
                const target = b.bot_id ? `Bot ${b.bot_id}` : 'Seluruh Sesi';
                const cfg = [
                  b.config.primary_style ? `style=${b.config.primary_style}` : '',
                  b.config.platform ? `platform=${b.config.platform}` : '',
                  b.config.entry_point ? `entry=${b.config.entry_point}` : '',
                ]
                  .filter(Boolean)
                  .join(', ');
                this.writeLine(`  - [${b.status.toUpperCase()}] ${b.skill_id} (${target}) ${cfg ? `[${cfg}]` : ''}`);
              }
            }
          } else if (sub === 'styles') {
            const family = argTokens[1];
            const styles = await this.skillService.listStyles(family);
            this.writeLine(`[Console] AVDS Visual Styles (${styles.length}):`);
            for (const st of styles) {
              this.writeLine(`  - ${st.id} [${st.family}]: ${st.name}`);
            }
          } else if (sub === 'platforms') {
            const platforms = await this.skillService.listPlatforms();
            this.writeLine(`[Console] AVDS Platform Profiles (${platforms.length}):`);
            for (const p of platforms) {
              this.writeLine(`  - ${p.id}: ${p.title}`);
            }
          } else if (sub === 'modalities') {
            const modalities = await this.skillService.listModalities();
            this.writeLine(`[Console] AVDS Interaction Modalities (${modalities.length}):`);
            for (const m of modalities) {
              this.writeLine(`  - ${m.id}: ${m.description}`);
            }
          } else if (sub === 'enable') {
            const skillId = argTokens[1] ?? 'almudaya-visual-design';
            const primaryStyle = argTokens[2];
            const platform = argTokens[3];
            const binding = await this.skillService.enableSkill(this.sessionId, {
              skillId,
              botId: this.botId,
              config: {
                primary_style: primaryStyle,
                platform,
              },
              updatedBy: this.botId,
            });
            this.writeLine(
              `[Console] Skill "${binding.skill_id}" diaktifkan untuk Bot "${this.botDisplayName}" [${this.botId}].`
            );
          } else if (sub === 'disable') {
            const skillId = argTokens[1] ?? 'almudaya-visual-design';
            const binding = await this.skillService.disableSkill(
              this.sessionId,
              skillId,
              this.botId,
              this.botId
            );
            this.writeLine(
              `[Console] Skill "${binding.skill_id}" dinonaktifkan untuk Bot "${this.botDisplayName}" [${this.botId}].`
            );
          } else {
            this.writeLine(
              '[Console] Penggunaan: /skill [list | styles [family] | platforms | modalities | enable [skillId] [style] [platform] | disable [skillId]]'
            );
          }
        } catch (err: unknown) {
          this.writeLine(`[Console] Gagal menjalankan perintah skill: ${(err as Error).message}`);
        }
        break;
      }

      case '/status': {
        this.writeLine(`[Console] Status Bot "${this.botDisplayName}" [${this.botId}]:`);
        this.writeLine(`  Session ID:     ${this.sessionId}`);
        this.writeLine(`  Status:         ${this.runtime.running ? 'active' : 'stopped'}`);
        this.writeLine(`  Execution Mode: ${this.executionModeController.getMode()}`);
        this.writeLine(`  AI Provider:    ${this.aiProvider ? `${this.aiProvider.providerId} (${this.aiProvider.modelName})` : 'Disabled'}`);
        this.writeLine(`  Process PID:    ${process.pid}`);
        break;
      }

      case '/clear': {
        if (this.isTTY) {
          this.outputStream.write('\x1B[2J\x1B[0;0H');
        } else {
          this.writeLine('--- CLEAR SCREEN ---');
        }
        break;
      }

      case '/model': {
        const firstArg = argTokens[0]?.toLowerCase();
        if (firstArg === 'recommend' || firstArg === 'advisor') {
          this.writeLine('[Console] Memeriksa spesifikasi hardware & mencari rekomendasi model...');
          try {
            const profile = await detectHardwareProfile();
            const report = await recommendModelsForHardware(profile);
            for (const reportLine of formatHardwareAdvisorReport(report)) {
              this.writeLine(reportLine);
            }
          } catch (err: unknown) {
            this.writeLine(`[Console] Gagal menganalisis hardware/model: ${(err as Error).message}`);
          }
          return;
        }

        if (firstArg === 'pull') {
          const pullModelId = argTokens[1];
          if (!pullModelId) {
            this.writeLine('[Console] Penggunaan: /model pull <modelId> (contoh: /model pull qwen2.5-coder:7b)');
            return;
          }
          this.writeLine(`[Console] Mengunduh model "${pullModelId}" melalui Ollama...`);
          let lastPrinted = '';
          try {
            const res = await pullOllamaModel(pullModelId, {
              onProgress: (status, completed, total) => {
                const formatted = formatPullProgress(status, completed, total);
                if (formatted !== lastPrinted) {
                  lastPrinted = formatted;
                  this.writeLine(`  [Ollama] ${formatted}`);
                }
              },
            });
            this.writeLine(`[Console] Model "${res.modelId}" selesai diunduh (${res.status}).`);
            this.writeLine(`[Console] Aktifkan sekarang dengan: /model ${res.modelId} ollama`);
          } catch (err: unknown) {
            this.writeLine(`[Console] Gagal mengunduh model "${pullModelId}": ${(err as Error).message}`);
          }
          return;
        }

        if (argTokens.length === 0 || firstArg === 'list' || firstArg === 'refresh') {
          const includeLive = firstArg === 'refresh' || argTokens.length === 0 || firstArg === 'list';
          let filterProvider: CatalogProviderId | 'all' = 'all';
          if (argTokens[1]) {
            const candidate = argTokens[1].toLowerCase();
            if (!['all', 'ollama', 'nvidia', '9router', 'openrouter', 'gemini'].includes(candidate)) {
              this.writeLine(
                `[Console] Provider "${argTokens[1]}" tidak dikenal. Pilihan: all, ollama, nvidia, 9router, openrouter, gemini.`
              );
              return;
            }
            filterProvider = candidate as CatalogProviderId | 'all';
          }
          const models = await discoverModels({
            provider: filterProvider,
            includeLiveDiscovery: includeLive,
          });
          const currentProvider = this.aiProvider?.providerId ?? 'none';
          const currentModel = this.aiProvider?.modelName ?? 'none';
          const displayLimit = filterProvider === 'all' ? 25 : 50;

          this.writeLine(`[Console] Model AI Aktif: ${currentProvider}:${currentModel}`);
          this.writeLine(`[Console] Daftar Model Tersedia (${models.length}):`);
          for (const m of models.slice(0, displayLimit)) {
            const isCurrent =
              this.aiProvider?.providerId === m.provider &&
              this.aiProvider?.modelName === m.id;
            const marker = isCurrent ? '*' : ' ';
            const keyTag = m.requiresApiKey ? 'Key' : 'No-Key';
            this.writeLine(`  ${marker} [${m.provider}] ${m.id} (${m.tier}, ${keyTag})`);
          }
          if (models.length > displayLimit) {
            this.writeLine(
              `  ... (${models.length - displayLimit} model lainnya; jalankan 'almudaya bot models' untuk daftar penuh)`
            );
          }
          this.writeLine(
            `[Console] Gunakan: /model <modelId> [ollama|nvidia|9router|openrouter|gemini] | /model list [provider] | /model recommend | /model pull <modelId>`
          );
          return;
        }

        const targetModelId = argTokens[0]!;
        const explicitProvider = argTokens[1]?.toLowerCase() as CatalogProviderId | undefined;
        if (explicitProvider && !['ollama', '9router', 'openrouter', 'nvidia', 'gemini'].includes(explicitProvider)) {
          this.writeLine(
            `[Console] Provider "${argTokens[1]}" tidak dikenal. Pilihan: ollama, nvidia, 9router, openrouter, gemini.`
          );
          return;
        }

        const providerChoice: CatalogProviderId =
          explicitProvider ?? inferProviderForModel(targetModelId);

        const nextProvider = createAIProvider({
          provider: providerChoice,
          modelName: targetModelId,
        });

        this.aiProvider = nextProvider;
        if (this.agentLoop) {
          this.agentLoop.setProvider(nextProvider);
        }
        try {
          await this.botService.updateStatus(this.sessionId, this.botId, 'active', {
            model_ref: `${nextProvider.providerId}:${nextProvider.modelName}`,
          });
        } catch {
          // Best-effort registry model sync
        }
        this.writeLine(
          `[Console] Model bot "${this.botDisplayName}" diganti ke: ${nextProvider.providerId}:${nextProvider.modelName}`
        );
        return;
      }

      case '/mcp': {
        if (!this.mcpManager) {
          this.writeLine('[MCP] McpClientManager tidak aktif di konsol ini. Gunakan CLI `almudaya mcp add/preset`.');
          break;
        }
        const sub = (argTokens[0] ?? 'list').toLowerCase();
        const workspaceRoot =
          'workspaceRoot' in this.storage &&
          typeof (this.storage as { workspaceRoot?: unknown }).workspaceRoot === 'string'
            ? String((this.storage as { workspaceRoot?: unknown }).workspaceRoot)
            : undefined;
        const mcpStore = workspaceRoot ? new McpConfigStore({ workspaceRoot }) : undefined;

        if (sub === 'list' || sub === 'status') {
          const statuses = this.mcpManager.getStatuses();
          if (statuses.length === 0) {
            this.writeLine('[MCP] Belum ada server MCP terhubung saat ini.');
            break;
          }
          this.writeLine(`[MCP] Status Server Terhubung (${statuses.length}):`);
          for (const st of statuses) {
            const state = st.connected ? 'CONNECTED' : `DISCONNECTED (${st.error ?? 'closed'})`;
            this.writeLine(`  - [${st.name}] (${st.transport}) ${state} — ${st.toolCount} tool(s)`);
          }
        } else if (sub === 'tools') {
          const tools = this.mcpManager.getRegisteredTools();
          if (tools.length === 0) {
            this.writeLine('[MCP] Belum ada tool MCP terdaftar.');
            break;
          }
          this.writeLine(`[MCP] Perkakas MCP Aktif (${tools.length}):`);
          for (const t of tools) {
            this.writeLine(`  - ${t.namespacedName} (${t.serverName}:${t.toolName})`);
          }
        } else if (sub === 'connect' && argTokens[1]) {
          if (!mcpStore) {
            this.writeLine('[MCP] Tidak dapat membaca McpConfigStore pada storage non-filesystem.');
            break;
          }
          const targetName = argTokens[1];
          const servers = await mcpStore.resolveEffectiveServers({
            sessionId: this.sessionId,
            externalConfigPath: this.mcpConfigPath,
            includeDisabled: true,
          });
          const cfg = servers.find((s) => s.name === targetName);
          if (!cfg) {
            this.writeLine(`[MCP] Konfigurasi server "${targetName}" tidak ditemukan.`);
            break;
          }
          const res = await this.mcpManager.connectServer(cfg);
          this.writeLine(
            res.connected
              ? `[MCP] Terhubung ke "${res.name}" (${res.toolCount} tool tersedia).`
              : `[MCP] Gagal terhubung ke "${res.name}": ${res.error ?? 'Unknown error'}`
          );
        } else if (sub === 'disconnect' && argTokens[1]) {
          const ok = await this.mcpManager.disconnectServer(argTokens[1]);
          this.writeLine(
            ok ? `[MCP] Koneksi server "${argTokens[1]}" diputus.` : `[MCP] Server "${argTokens[1]}" tidak aktif.`
          );
        } else if (sub === 'reload') {
          if (!mcpStore) {
            this.writeLine('[MCP] Tidak dapat membaca McpConfigStore pada storage non-filesystem.');
            break;
          }
          const servers = await mcpStore.resolveEffectiveServers({
            sessionId: this.sessionId,
            externalConfigPath: this.mcpConfigPath,
          });
          await this.mcpManager.disposeAll();
          const results = await this.mcpManager.connectAll(servers);
          this.writeLine(
            `[MCP] Reload selesai: ${results.filter((r) => r.connected).length}/${results.length} server terhubung.`
          );
        } else {
          this.writeLine(
            '[MCP] Penggunaan: /mcp [list | tools | connect <nama> | disconnect <nama> | reload]'
          );
        }
        break;
      }

      case '/protocol': {
        if (!this.protocolSupervisor) {
          this.writeLine('[Protocol] ProtocolSupervisor belum diinisialisasi di konsol ini.');
          break;
        }
        const summary = await this.protocolSupervisor.getStatusSummary(this.sessionId);
        this.writeLine(`[Protocol v${VERSION} Unified Natural Lifecycle — Session ${this.sessionId}]:`);
        this.writeLine(`  Status Loop       : ${summary.runtimeState.macroLoopStatus}`);
        this.writeLine(`  Spawn Mode        : ${summary.config.spawnMode} (maxWindows=${summary.config.maxWindows})`);
        this.writeLine(`  Active Moderator  : ${summary.activeModeratorBotId} (Fence Epoch=${summary.currentFenceEpoch})`);
        this.writeLine(`  PrBot / Global    : ${summary.runtimeState.totalSpawnedWorkers}/${summary.config.prBotLimit} | Active=${summary.runtimeState.activeGlobalBotCount}/${summary.runtimeState.resolvedHardwareBotCap}`);
        this.writeLine(`  Tokens Used       : ${summary.runtimeState.totalTokensUsed} / ${summary.config.tokenBudget}`);
        this.writeLine(`  GoalLedger Tasks  : ${summary.openTasksCount} open / ${summary.totalTasksCount} total`);
        this.writeLine(`  Dynamic Rules     : ${summary.activeRulesCount} aktif | Queued Interventions: ${summary.queuedInterventions}`);
        break;
      }

      case '/blueprint': {
        if (!this.protocolSupervisor) {
          this.writeLine('[Blueprint] ProtocolSupervisor tidak aktif.');
          break;
        }
        const md = await this.protocolSupervisor.ledger.formatSummaryMarkdown(this.sessionId);
        this.writeLine(md ? `[Blueprint GoalLedger]:\n${md}` : '[Blueprint] GoalLedger masih kosong.');
        break;
      }

      case '/rules': {
        if (!this.protocolSupervisor) {
          this.writeLine('[Rules] ProtocolSupervisor tidak aktif.');
          break;
        }
        const sub = (argTokens[0] ?? 'list').toLowerCase();
        if (sub === 'add' && argTokens.length >= 2) {
          const maybeSev = argTokens[1]?.toUpperCase();
          const hasExplicitSev = maybeSev === 'ADVISORY' || maybeSev === 'MANDATORY' || maybeSev === 'HARD_STOP';
          const statement = (hasExplicitSev ? argTokens.slice(2) : argTokens.slice(1)).join(' ');
          if (!statement.trim()) {
            this.writeLine('[Rules] Penggunaan: /rules add [HARD_STOP|MANDATORY|ADVISORY] <pernyataan aturan>');
            break;
          }
          const created = await this.protocolSupervisor.rules.addRule(this.sessionId, {
            statement,
            severity: hasExplicitSev ? (maybeSev as 'ADVISORY' | 'MANDATORY' | 'HARD_STOP') : 'MANDATORY',
            createdBy: this.botId,
          });
          this.writeLine(`[Rules] Aturan ditambahkan: [${created.ruleId}] (${created.severity}) ${created.statement}`);
        } else if ((sub === 'rm' || sub === 'remove' || sub === 'deactivate') && argTokens[1]) {
          const ok = await this.protocolSupervisor.rules.deactivateRule(this.sessionId, argTokens[1]);
          this.writeLine(ok ? `[Rules] Aturan ${argTokens[1]} dinonaktifkan.` : `[Rules] Aturan ${argTokens[1]} tidak ditemukan.`);
        } else {
          const text = await this.protocolSupervisor.rules.formatRulesForPrompt(this.sessionId);
          this.writeLine(text ? `[Dynamic Rules Aktif]:\n${text}` : '[Rules] Tidak ada Dynamic Rule aktif.');
        }
        break;
      }

      case '/bots': {
        const bots = await this.botService.reconcileBotLiveness(this.sessionId);
        this.writeLine(`[Bots] Daftar Bot & Peran (${bots.length}):`);
        for (const b of bots) {
          this.writeLine(
            `  - [${b.bot_id}] "${b.display_name}" status=${b.status} role=${b.role ?? 'worker'} model=${b.model_ref ?? 'default'} pid=${b.pid ?? 'none'}`
          );
        }
        break;
      }

      case '/spawn-mode': {
        if (!this.protocolSupervisor) {
          this.writeLine('[SpawnMode] ProtocolSupervisor tidak aktif.');
          break;
        }
        const nextMode = argTokens[0]?.toLowerCase();
        if (nextMode === 'windows' || nextMode === 'multiplexed') {
          const updated = await this.protocolSupervisor.store.updateConfig(this.sessionId, (c) => ({
            ...c,
            spawnMode: nextMode,
          }));
          this.writeLine(`[SpawnMode] Spawn mode diperbarui ke: ${updated.spawnMode}`);
        } else {
          const cfg = await this.protocolSupervisor.store.getConfig(this.sessionId);
          this.writeLine(`[SpawnMode] Spawn mode aktif: ${cfg.spawnMode} (maxWindows=${cfg.maxWindows}). Ubah: /spawn-mode <windows|multiplexed>`);
        }
        break;
      }

      case '/moderator': {
        if (!this.protocolSupervisor) {
          this.writeLine('[Moderator] ProtocolSupervisor tidak aktif.');
          break;
        }
        const sub = argTokens[0]?.toLowerCase();
        if (sub === 'delegate' && argTokens[1]) {
          const st = await this.protocolSupervisor.prModerator.delegateModerator(
            this.sessionId,
            argTokens[1],
            this.botId
          );
          this.writeLine(`[Moderator] Hak PrModerator didelegasikan ke ${st.activeModeratorBotId}.`);
        } else if (sub === 'reclaim') {
          const st = await this.protocolSupervisor.prModerator.reclaimModerator(
            this.sessionId,
            this.botId
          );
          this.writeLine(`[Moderator] Hak PrModerator ditarik kembali ke ${st.activeModeratorBotId}.`);
        } else {
          const st = await this.protocolSupervisor.prModerator.getModeratorState(this.sessionId);
          const activeToks = Object.values(st.tokens).filter((t) => t.status === 'ACTIVE').length;
          this.writeLine(`[Moderator] Pemegang: ${st.activeModeratorBotId} | Global Fence Epoch: ${st.globalFenceEpoch} | Token Aktif: ${activeToks}`);
        }
        break;
      }

      case '/operation': {
        const sub = (argTokens[0] ?? 'status').toLowerCase();
        const wsRoot =
          'workspaceRoot' in this.storage &&
          typeof (this.storage as { workspaceRoot?: unknown }).workspaceRoot === 'string'
            ? String((this.storage as { workspaceRoot?: unknown }).workspaceRoot)
            : undefined;
        const sup =
          this.protocolSupervisor ?? new RuntimeProtocolSupervisor({ storage: this.storage });
        const registry = new OperationRegistry({ workspaceRoot: wsRoot });
        const manifold = new OperationManifoldService({
          storage: this.storage,
          supervisor: sup,
          skillService: this.skillService,
          registry,
        });

        try {
          if (sub === 'list') {
            const ops = await registry.listOperations();
            this.writeLine(`[Operation] Daftar Agentic Operations (${ops.length}):`);
            for (const p of ops) {
              const alias = p.op.identity.alias ? ` (${p.op.identity.alias})` : '';
              this.writeLine(
                `  - ${p.op.identity.id}@${p.op.identity.version}${alias} [${p.op.manifold.orchestration_regime}/${p.op.manifold.topology_shape}]`
              );
            }
          } else if (sub === 'inspect' && argTokens[1]) {
            const pkg = await registry.resolveOperation(argTokens[1]);
            const op = pkg.op;
            this.writeLine(
              `[Operation] ${op.identity.name} (${op.identity.id}@${op.identity.version})`
            );
            this.writeLine(`  Objektif: ${op.mission.objective}`);
            this.writeLine(
              `  Manifold: regime=${op.manifold.orchestration_regime}, topology=${op.manifold.topology_shape}, l1_fallback=${op.manifold.continuity.l1_single_agent_fallback}`
            );
            this.writeLine(
              `  Roles   : ${op.manifold.roles.map((r) => `${r.id}(${r.kind})`).join(', ')}`
            );
          } else if (sub === 'validate') {
            if (argTokens[1]) {
              const pkg = await registry.resolveOperation(argTokens[1]);
              const all = await registry.listOperations();
              const errs = await validateOperationPackage(
                pkg.opDir,
                new Map(all.map((p) => [p.op.identity.id, p]))
              );
              this.writeLine(
                errs.length === 0
                  ? `[Operation] ${pkg.op.identity.id} VALID (0 galat).`
                  : `[Operation] Validasi GAGAL (${errs.length}): ${errs.join('; ')}`
              );
            } else {
              const res = await registry.validateAll();
              this.writeLine(
                res.valid
                  ? `[Operation] Seluruh ${res.checkedCount} Operation VALID (0 galat).`
                  : `[Operation] Validasi GAGAL (${res.errors.length}): ${res.errors.join('; ')}`
              );
            }
          } else if (sub === 'apply' && argTokens[1]) {
            const inst = await manifold.applyOperation(this.sessionId, argTokens[1], {
              actorBotId: this.botId,
            });
            this.writeLine(
              `[Operation] Diterapkan: ${inst.operationId}@${inst.operationVersion} (${inst.orchestrationRegime}/${inst.topologyShape}, seededTasks=${inst.seededTaskIds.length}, rules=${inst.appliedDynamicRuleIds.length}).`
            );
          } else if (sub === 'evaluate') {
            const verdict = await manifold.evaluateBehavior(this.sessionId);
            this.writeLine(
              `[Operation] OBS Verdict (${verdict.operationId}, status=${verdict.status}): termination=${JSON.stringify(verdict.termination)}`
            );
            for (const lp of verdict.loops) {
              this.writeLine(
                `  Loop ${lp.id} [${lp.scope}]: continue=${lp.continuation} accept=${lp.acceptance} rollback=${lp.rollback}`
              );
            }
          } else if (sub === 'crystallize') {
            const targetId = argTokens[1];
            const res = await manifold.crystallizeActiveOperation(this.sessionId, {
              targetId,
              force: true,
              actorBotId: this.botId,
            });
            this.writeLine(
              `[Operation] Dikristalisasi: ${res.operationId}@${res.version} -> ${res.outputDir}`
            );
          } else {
            const inst = await manifold.getActiveInstance(this.sessionId);
            if (!inst) {
              this.writeLine(
                '[Operation] Belum ada #Operation aktif pada sesi ini. Gunakan: /operation list | /operation apply <id>'
              );
            } else {
              this.writeLine(
                `[Operation] Aktif: ${inst.operationId}@${inst.operationVersion} | Status: ${inst.status} | Regime: ${inst.orchestrationRegime} (${inst.topologyShape})`
              );
              this.writeLine(
                `  Realisasi Aktif: ${JSON.stringify(inst.roleRealizationMap)}`
              );
            }
          }
        } catch (err: unknown) {
          this.writeLine(`[Operation] Galat: ${(err as Error).message}`);
        }
        break;
      }

      case '/help': {
        this.writeLine(`[Console] Daftar Perintah Interaktif:`);
        this.writeLine(`  /msg <targetBot> <pesan>  Kirim pesan langsung ke rekan bot`);
        this.writeLine(`  /broadcast <pesan>        Kirim pesan broadcast ke seluruh rekan bot`);
        this.writeLine(`  /peers                    Tampilkan daftar rekan bot di session`);
        this.writeLine(`  /roots                    Tampilkan daftar project roots terdaftar`);
        this.writeLine(`  /log [limit] [root]       Tampilkan linimasa memori kerja sesi`);
        this.writeLine(`  /mode [review|turbo]      Tampilkan atau ubah mode eksekusi keamanan`);
        this.writeLine(`  /model [id] [provider]    Lihat daftar model (Ollama/NVIDIA/9router/OpenRouter/Gemini), ganti model, /model recommend, atau /model pull <id>`);
        this.writeLine(`  /skill [subcommand]       Kelola modul skill & AVDS (list, styles, platforms, modalities, enable, disable)`);
        this.writeLine(`  /mcp [subcommand]         Kelola koneksi & perkakas server MCP (list, tools, connect, disconnect, reload)`);
        this.writeLine(`  /operation [subcommand]   Kelola #Operation v0.3 & Dynamic Swarm Manifold (list, status, inspect, validate, apply, evaluate, crystallize)`);
        this.writeLine(`  /protocol                 Status 10 protokol v${VERSION}, kuota token, & GoalLedger`);
        this.writeLine(`  /blueprint                Tampilkan GoalLedger blueprint tasks aktif`);
        this.writeLine(`  /rules [add|rm] [...]     Kelola Dynamic Rules sesi saat berjalan`);
        this.writeLine(`  /bots                     Lihat status & model semua worker/master bot`);
        this.writeLine(`  /spawn-mode [windows|multiplexed]  Atur mode jendela spawn worker`);
        this.writeLine(`  /moderator [delegate|reclaim]      Lihat/kelola kursi PrModerator`);
        this.writeLine(`  /status                   Tampilkan ringkasan status bot lokal`);
        this.writeLine(`  /clear                    Bersihkan tampilan layar terminal`);
        this.writeLine(`  /exit, /quit              Hentikan bot dan keluar dari konsol`);
        this.writeLine(`  <instruksi teks>          Kirim instruksi langsung ke penalaran AI bot lokal`);
        break;
      }

      case '/exit':
      case '/quit': {
        this.writeLine('[Console] Menghentikan bot dan keluar dari konsol...');
        await this.stop();
        break;
      }

      default: {
        this.writeLine(`[Console] Perintah "${cmdToken}" tidak dikenal. Ketik /help untuk daftar perintah yang tersedia.`);
        break;
      }
    }
  }

  /**
   * Forwards natural language operator instructions to the local bot's AutonomousAgentLoop.
   */
  public async handleNaturalLanguageInstruction(line: string): Promise<void> {
    if (!this.agentLoop || !this.aiProvider) {
      this.writeLine('⚠️ [Console] AI Provider tidak aktif untuk bot ini. Gunakan /msg untuk mengirim pesan ke bot lain atau jalankan bot dengan opsi --provider.');
      return;
    }

    this.writeLine(`🤖 [${this.botDisplayName}] Memproses instruksi operator: "${line}"...`);
    try {
      const nowIso = new Date().toISOString();
      const syntheticMsg: DirectMessage = {
        message_id: generateMessageId(),
        session_id: this.sessionId,
        sender_bot_id: 'OPERATOR',
        recipient_bot_id: this.botId,
        timestamp: nowIso,
        message_type: 'DIRECT',
        content: line,
        status: 'read',
        metadata: { source: 'console_repl' },
        delivery_state: 'PROCESSING',
        attempt_count: 1,
        max_attempts: 1,
        fence_token: 1,
        lease_owner: `operator-repl:${this.botId}`,
        lease_expires_at: null,
        last_attempt_at: nowIso,
        last_error: null,
      };

      const reply = await this.agentLoop.handleMessage(syntheticMsg);
      this.writeLine(`\n✅ [${this.botDisplayName}]:\n${reply}\n`);
    } catch (err: unknown) {
      this.writeLine(`❌ [${this.botDisplayName}] Gagal memproses instruksi: ${(err as Error).message}`);
    }
  }

  /**
   * Gracefully shuts down the console, closes readline, stops the runtime, and cleans up.
   */
  public async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }

    if (this.onExitCallback) {
      try {
        await this.onExitCallback();
      } catch {
        // Ignore exit callback failure
      }
    }

    if (this.runtime.running) {
      await this.runtime.stop();
    }

    if (this.mcpManager) {
      try {
        await this.mcpManager.disposeAll();
      } catch {
        // Ignore MCP shutdown errors
      }
    }

    this.spawnManager?.reapAll();

    if (this.closeResolver) {
      this.closeResolver();
      this.closeResolver = undefined;
    }
  }

  private printBanner(): void {
    this.writeLine(`================================================================`);
    if (this.isMasterConsole) {
      this.writeLine(` Almudaya Multi-Agent v${VERSION} — HITL + MASTER (BOT000) Unified Console`);
    } else {
      this.writeLine(` Almudaya Multi-Agent v${VERSION} — Interactive Bot Console REPL`);
    }
    this.writeLine(` Bot: "${this.botDisplayName}" [${this.botId}] | Session: ${this.sessionId}`);
    this.writeLine(` Mode: ${this.executionModeController.getMode()} | Provider: ${this.aiProvider ? `${this.aiProvider.providerId} (${this.aiProvider.modelName})` : 'Standby (HITL Ready)'}`);
    this.writeLine(` Ketik /help untuk daftar perintah (/protocol, /blueprint, /rules, /bots) atau ketik instruksi langsung.`);
    this.writeLine(`================================================================`);
  }
}
