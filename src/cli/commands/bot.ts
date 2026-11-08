import { Command } from 'commander';
import process from 'node:process';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { BotService } from '../../bot/service.js';
import { BotRuntime } from '../../bot/runtime.js';
import { AutonomousAgentLoop } from '../../bot/agent-loop.js';
import { ExecutionModeController, type ExecutionMode } from '../../bot/execution-mode.js';
import { BotConsole } from '../../bot/console.js';
import { GeminiProvider } from '../../ai/gemini.js';
import { MockAIProvider } from '../../ai/mock-provider.js';
import type { IAIModelProvider } from '../../ai/provider.js';
import { ValidationError } from '../../core/errors.js';

export function registerBotCommands(program: Command): void {
  const bot = program
    .command('bot')
    .description('Manage bots within an Almudaya collaboration session');

  bot
    .command('join')
    .alias('start')
    .description('Register and join a bot into an existing session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Explicit stable Bot ID (e.g. BOT001)')
    .option('-n, --name <displayName>', 'Human-readable display name')
    .option('--display-name <displayName>', 'Alias for display name')
    .option('-d, --description <description>', 'Bot description or role')
    .option('-r, --role <role>', 'Alias for bot role/description')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (options: {
      session: string;
      bot?: string;
      name?: string;
      displayName?: string;
      description?: string;
      role?: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new BotService(storage);

        const botDisplayName = options.displayName ?? options.name;
        const botDescription = options.role ?? options.description;

        const botRecord = await service.registerBot(options.session, {
          botId: options.bot,
          displayName: botDisplayName,
          description: botDescription,
        });

        console.log(`Bot joined session successfully!`);
        console.log(`  Session ID:   ${botRecord.session_id}`);
        console.log(`  Bot ID:       ${botRecord.bot_id}`);
        console.log(`  Display Name: ${botRecord.display_name}`);
        if (botRecord.description) {
          console.log(`  Description:  ${botRecord.description}`);
        }
        console.log(`  Status:       ${botRecord.status}`);
        console.log(`  PID:          ${botRecord.pid ?? 'N/A'}`);
        console.log(`  Joined At:    ${botRecord.joined_at}`);
      } catch (error: unknown) {
        console.error(`Error joining session: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  bot
    .command('run')
    .description('Run a bot runtime process with active heartbeat loop and autonomous AI loop')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Explicit stable Bot ID (e.g. BOT001)')
    .option('-n, --name <displayName>', 'Human-readable display name')
    .option('--display-name <displayName>', 'Alias for display name')
    .option('-d, --description <description>', 'Bot description or role')
    .option('-r, --role <role>', 'Alias for bot role/description')
    .option('--interval <ms>', 'Heartbeat interval in ms (default: 2000)')
    .option('--auto-ack', 'Automatically acknowledge incoming direct messages', true)
    .option('--no-auto-ack', 'Disable auto-acknowledgement of direct messages')
    .option('--provider <provider>', 'AI model provider ("gemini" | "mock")')
    .option('--model <model>', 'AI model name (defaults to "gemini-2.5-flash")')
    .option('--api-key <key>', 'Explicit AI model API key (memory-only, Invariant 7)')
    .option('-m, --mode <mode>', 'Safety execution mode ("review" | "turbo", default: "review")')
    .option('--max-iterations <count>', 'Maximum tool calling iterations per message (default: 10)')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (options: {
      session: string;
      bot?: string;
      name?: string;
      displayName?: string;
      description?: string;
      role?: string;
      interval?: string;
      autoAck?: boolean;
      provider?: string;
      model?: string;
      apiKey?: string;
      mode?: string;
      maxIterations?: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const botDisplayName = options.displayName ?? options.name;
        const botDescription = options.role ?? options.description;

        // Numeric argument validation (§19, BP §5.21)
        const heartbeatIntervalMs = options.interval ? parseInt(options.interval, 10) : 2000;
        if (options.interval && (isNaN(heartbeatIntervalMs) || heartbeatIntervalMs <= 0)) {
          throw new ValidationError(`Invalid heartbeat interval "${options.interval}". Must be a positive integer.`);
        }

        const maxIter = options.maxIterations ? parseInt(options.maxIterations, 10) : 10;
        if (options.maxIterations && (isNaN(maxIter) || maxIter <= 0)) {
          throw new ValidationError(`Invalid max-iterations "${options.maxIterations}". Must be a positive integer.`);
        }

        // Secret sanitization audit warning (NT-02, REQ-CLI-SECRET-01)
        if (options.apiKey) {
          console.warn(
            '[SECURITY WARNING] Passing secrets via CLI arguments (--api-key) is insecure as it exposes credentials to process listings and shell history. Use the GEMINI_API_KEY environment variable instead (NT-02).'
          );
        }

        // Configure AI Model Provider (FR-201, FR-202, FR-218)
        let aiProvider: IAIModelProvider | undefined;
        const providerName = options.provider?.toLowerCase();

        if (providerName) {
          if (!['gemini', 'mock'].includes(providerName)) {
            throw new ValidationError(`Unknown provider "${options.provider}". Valid providers: "gemini", "mock".`);
          }
        }

        if (providerName === 'gemini') {
          aiProvider = new GeminiProvider({
            apiKey: options.apiKey,
            modelName: options.model ?? 'gemini-2.5-flash'
          });
        } else if (providerName === 'mock') {
          aiProvider = new MockAIProvider('mock-model', [
            { text: 'Tugas telah diproses oleh Mock AI.' }
          ]);
        } else if ((process.env.GEMINI_API_KEY || options.apiKey) && !providerName) {
          // Auto-enable Gemini if API key is present
          aiProvider = new GeminiProvider({
            apiKey: options.apiKey,
            modelName: options.model ?? 'gemini-2.5-flash'
          });
        }

        // Configure Safety Execution Mode (FR-213, FR-214, FR-215)
        if (options.mode) {
          const modeLower = options.mode.toLowerCase();
          if (!['review', 'turbo'].includes(modeLower)) {
            throw new ValidationError(`Unknown execution mode "${options.mode}". Valid modes: "review", "turbo".`);
          }
        }

        const executionMode: ExecutionMode =
          options.mode?.toLowerCase() === 'turbo' ? 'TURBO' : 'REQUEST_REVIEW';
        const executionModeController = new ExecutionModeController(executionMode);

        let agentLoop: AutonomousAgentLoop | undefined;
        let consoleInstance: BotConsole | undefined;

        const runtime = new BotRuntime(storage, {
          sessionId: options.session,
          botId: options.bot,
          displayName: botDisplayName,
          description: botDescription,
          heartbeatIntervalMs,
          autoAcknowledge: options.autoAck ?? true,
          onMessage: async (msg) => {
            const notif = `📨 [BOT ${runtime.botId}] Pesan masuk dari ${msg.sender_bot_id}: "${msg.content}"`;
            if (consoleInstance) {
              consoleInstance.printNotification(notif);
            } else {
              console.log(`\n${notif}`);
            }

            if (agentLoop && aiProvider) {
              const startMsg = `🤖 Menjalankan ReAct Agent Loop (${aiProvider.providerId} | Mode: ${executionModeController.getMode()})...`;
              if (consoleInstance) {
                consoleInstance.printNotification(startMsg);
              } else {
                console.log(startMsg);
              }

              try {
                const reply = await agentLoop.handleMessage(msg);
                const replyMsg = `✅ [BOT ${runtime.botId}] Balasan otonom terkirim:\n   "${reply.slice(0, 160)}${reply.length > 160 ? '...' : ''}"`;
                if (consoleInstance) {
                  consoleInstance.printNotification(replyMsg);
                } else {
                  console.log(replyMsg);
                }
              } catch (err: unknown) {
                const errMsg = `❌ [BOT ${runtime.botId}] Gagal memproses pesan: ${(err as Error).message}`;
                if (consoleInstance) {
                  consoleInstance.printNotification(errMsg);
                } else {
                  console.error(errMsg);
                }
                throw err;
              }
            }
          },
          onBroadcast: async (evt) => {
            const bcastMsg = `📢 [BOT ${runtime.botId}] Broadcast dari ${evt.sender_bot_id} [${evt.category}]: ${evt.content}`;
            if (consoleInstance) {
              consoleInstance.printNotification(bcastMsg);
            } else {
              console.log(bcastMsg);
            }
          },
        });

        const botRecord = await runtime.start();

        // Initialize agent loop with registered bot identity
        if (aiProvider) {
          agentLoop = new AutonomousAgentLoop({
            sessionId: options.session,
            botId: botRecord.bot_id,
            storage,
            provider: aiProvider,
            executionModeController,
            maxIterations: maxIter,
            onStatus: (msg) => {
              if (consoleInstance) {
                consoleInstance.printNotification(msg);
              } else {
                console.log(msg);
              }
            },
          });
        }

        // Launch All-in-One Interactive Bot Console REPL (FR-301..310, ADR-301)
        consoleInstance = new BotConsole({
          runtime,
          agentLoop,
          storage,
          executionModeController,
          aiProvider,
        });

        await consoleInstance.start();
        await consoleInstance.waitForClose();
      } catch (error: unknown) {
        console.error(`Error running bot runtime: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  bot
    .command('list')
    .description('List all bots registered in a session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output list as JSON')
    .action(async (options: { session: string; workspace?: string; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new BotService(storage);

        // Reconcile stale bot liveness before listing
        const bots = await service.reconcileBotLiveness(options.session);

        if (options.json) {
          console.log(JSON.stringify(bots, null, 2));
          return;
        }

        if (bots.length === 0) {
          console.log(`No bots currently registered in session: ${options.session}`);
          return;
        }

        console.log(`Bots in Session [${options.session}]:\n`);
        for (const b of bots) {
          console.log(`  - [${b.bot_id}] "${b.display_name}" (${b.status})`);
          if (b.description) {
            console.log(`      Role: ${b.description}`);
          }
          console.log(`      PID: ${b.pid ?? 'N/A'}, Joined: ${b.joined_at}`);
        }
      } catch (error: unknown) {
        console.error(`Error listing bots: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  bot
    .command('inspect [botIdOrName]')
    .description('Inspect details of a specific bot in a session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botIdOrName>', 'Bot ID or display name to inspect')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output details as JSON')
    .action(async (botIdOrName: string | undefined, options: { session: string; bot?: string; workspace?: string; json?: boolean }) => {
      try {
        const targetBot = botIdOrName ?? options.bot;
        if (!targetBot) {
          console.error('Error: Bot ID or name is required (e.g. almudaya bot inspect <botId> or --bot <botId>)');
          process.exitCode = 1;
          return;
        }

        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new BotService(storage);

        const botData = await service.getBot(options.session, targetBot);

        if (options.json) {
          console.log(JSON.stringify(botData, null, 2));
          return;
        }

        console.log(`Bot Details:`);
        console.log(`  Bot ID:       ${botData.bot_id}`);
        console.log(`  Session ID:   ${botData.session_id}`);
        console.log(`  Display Name: ${botData.display_name}`);
        console.log(`  Description:  ${botData.description ?? 'None'}`);
        console.log(`  Status:       ${botData.status}`);
        console.log(`  PID:          ${botData.pid ?? 'N/A'}`);
        console.log(`  Joined At:    ${botData.joined_at}`);
        console.log(`  Last Seen At: ${botData.last_seen_at}`);
      } catch (error: unknown) {
        console.error(`Error inspecting bot: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  bot
    .command('rename [botId] [newDisplayName]')
    .description("Rename a bot's display name without altering its stable Bot ID")
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Bot ID to rename')
    .option('-n, --new-name <newDisplayName>', 'New display name')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (botId: string | undefined, newDisplayName: string | undefined, options: { session: string; bot?: string; newName?: string; workspace?: string }) => {
      try {
        const targetBot = botId ?? options.bot;
        const targetNewName = newDisplayName ?? options.newName;

        if (!targetBot || !targetNewName) {
          console.error('Error: Both Bot ID and new display name are required (e.g. almudaya bot rename <botId> <newName> or --bot <id> --new-name <name>)');
          process.exitCode = 1;
          return;
        }

        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new BotService(storage);

        const updated = await service.renameBot(options.session, targetBot, targetNewName);

        console.log(`Bot renamed successfully!`);
        console.log(`  Bot ID:           ${updated.bot_id}`);
        console.log(`  New Display Name: ${updated.display_name}`);
        console.log(`  Session ID:       ${updated.session_id}`);
      } catch (error: unknown) {
        console.error(`Error renaming bot: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });
}
