import readline from 'node:readline';
import process from 'node:process';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import type { BotRuntime } from './runtime.js';
import type { AutonomousAgentLoop } from './agent-loop.js';
import type { IAIModelProvider } from '../ai/provider.js';
import { ExecutionModeController } from './execution-mode.js';
import { BotService } from './service.js';
import { MessagingService } from '../messaging/service.js';
import { SharedContextService } from '../shared/service.js';
import { WorkLogService } from '../shared/work-log.js';
import { generateMessageId, type DirectMessage } from '../messaging/schema.js';

export interface BotConsoleOptions {
  runtime: BotRuntime;
  agentLoop?: AutonomousAgentLoop;
  storage: IBlackboardStorage;
  executionModeController?: ExecutionModeController;
  aiProvider?: IAIModelProvider;
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
  onExit?: () => Promise<void>;
}

/**
 * All-in-One Interactive Bot Console REPL (v0.3.0).
 * Provides a non-blocking interactive command prompt for each bot process,
 * supporting slash commands (/msg, /broadcast, /peers, /roots, /log, /mode, /help, /clear, /exit),
 * direct natural language AI instructions, and non-destructive TTY rendering.
 */
export class BotConsole {
  public readonly runtime: BotRuntime;
  public readonly agentLoop?: AutonomousAgentLoop;
  public readonly storage: IBlackboardStorage;
  public readonly executionModeController: ExecutionModeController;
  public readonly aiProvider?: IAIModelProvider;
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

  private readonly onExitCallback?: () => Promise<void>;
  private readonly botService: BotService;
  private readonly messagingService: MessagingService;
  private readonly sharedContextService: SharedContextService;
  private readonly workLogService: WorkLogService;

  private closeResolver?: () => void;
  private closePromise?: Promise<void>;

  constructor(options: BotConsoleOptions) {
    this.runtime = options.runtime;
    this.agentLoop = options.agentLoop;
    this.storage = options.storage;
    this.executionModeController =
      options.executionModeController ?? new ExecutionModeController('REQUEST_REVIEW');
    this.aiProvider = options.aiProvider;

    this.inputStream = options.inputStream ?? process.stdin;
    this.outputStream = options.outputStream ?? process.stdout;
    this.isTTY = Boolean((this.outputStream as { isTTY?: boolean }).isTTY);

    this.botId = options.runtime.botId;
    this.botDisplayName = options.runtime.displayName || options.runtime.botId || 'Bot';
    this.sessionId = options.runtime.sessionId;
    this.promptString = `${this.botDisplayName}> `;

    this.onExitCallback = options.onExit;
    this.botService = new BotService(this.storage);
    this.messagingService = new MessagingService(this.storage, this.botService);
    this.sharedContextService = new SharedContextService(this.storage);
    this.workLogService = new WorkLogService(this.storage);

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
      await this.handleInput(line);
      if (!this.closed && !this.isAskingQuestion && this.rl) {
        this.rl.prompt();
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
   * Dispatches slash commands (/msg, /broadcast, /peers, /roots, /log, /mode, /status, /clear, /help, /exit).
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

      case '/help': {
        this.writeLine(`[Console] Daftar Perintah Interaktif:`);
        this.writeLine(`  /msg <targetBot> <pesan>  Kirim pesan langsung ke rekan bot`);
        this.writeLine(`  /broadcast <pesan>        Kirim pesan broadcast ke seluruh rekan bot`);
        this.writeLine(`  /peers                    Tampilkan daftar rekan bot di session`);
        this.writeLine(`  /roots                    Tampilkan daftar project roots terdaftar`);
        this.writeLine(`  /log [limit] [root]       Tampilkan linimasa memori kerja sesi`);
        this.writeLine(`  /mode [review|turbo]      Tampilkan atau ubah mode eksekusi keamanan`);
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
      const syntheticMsg: DirectMessage = {
        message_id: generateMessageId(),
        session_id: this.sessionId,
        sender_bot_id: 'OPERATOR',
        recipient_bot_id: this.botId,
        timestamp: new Date().toISOString(),
        message_type: 'DIRECT',
        content: line,
        status: 'read',
        metadata: { source: 'console_repl' },
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

    if (this.closeResolver) {
      this.closeResolver();
      this.closeResolver = undefined;
    }
  }

  private printBanner(): void {
    this.writeLine(`================================================================`);
    this.writeLine(` Almudaya Multi-Agent v0.3.0 — Interactive Bot Console REPL`);
    this.writeLine(` Bot: "${this.botDisplayName}" [${this.botId}] | Session: ${this.sessionId}`);
    this.writeLine(` Mode: ${this.executionModeController.getMode()} | Provider: ${this.aiProvider ? `${this.aiProvider.providerId} (${this.aiProvider.modelName})` : 'Disabled (Messaging only)'}`);
    this.writeLine(` Ketik /help untuk daftar perintah slash atau ketik instruksi langsung.`);
    this.writeLine(`================================================================`);
  }
}
