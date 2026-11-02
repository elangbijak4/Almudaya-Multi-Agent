import { Command } from 'commander';
import process from 'node:process';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { BotService } from '../../bot/service.js';
import { BotRuntime } from '../../bot/runtime.js';
import { AutonomousAgentLoop } from '../../bot/agent-loop.js';
import { ExecutionModeController, type ExecutionMode } from '../../bot/execution-mode.js';
import { GeminiProvider } from '../../ai/gemini.js';
import { MockAIProvider } from '../../ai/mock-provider.js';
import type { IAIModelProvider } from '../../ai/provider.js';

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
      mode?: string;
      maxIterations?: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const botDisplayName = options.displayName ?? options.name;
        const botDescription = options.role ?? options.description;
        const heartbeatIntervalMs = options.interval ? parseInt(options.interval, 10) : 2000;
        const maxIter = options.maxIterations ? parseInt(options.maxIterations, 10) : 10;

        // Configure AI Model Provider (FR-201, FR-202, FR-218)
        let aiProvider: IAIModelProvider | undefined;
        const providerName = options.provider?.toLowerCase();

        if (providerName === 'gemini') {
          aiProvider = new GeminiProvider({
            modelName: options.model ?? 'gemini-2.5-flash'
          });
        } else if (providerName === 'mock') {
          aiProvider = new MockAIProvider('mock-model', [
            { text: 'Tugas telah diproses oleh Mock AI.' }
          ]);
        } else if (process.env.GEMINI_API_KEY && !providerName) {
          // Auto-enable Gemini if API key is present in environment
          aiProvider = new GeminiProvider({
            modelName: options.model ?? 'gemini-2.5-flash'
          });
        }

        // Configure Safety Execution Mode (FR-213, FR-214, FR-215)
        const executionMode: ExecutionMode =
          options.mode?.toLowerCase() === 'turbo' ? 'TURBO' : 'REQUEST_REVIEW';
        const executionModeController = new ExecutionModeController(executionMode);

        let agentLoop: AutonomousAgentLoop | undefined;

        const runtime = new BotRuntime(storage, {
          sessionId: options.session,
          botId: options.bot,
          displayName: botDisplayName,
          description: botDescription,
          heartbeatIntervalMs,
          autoAcknowledge: options.autoAck ?? true,
          onMessage: async (msg) => {
            console.log(`\n📨 [BOT ${runtime.botId}] Pesan masuk dari ${msg.sender_bot_id}: "${msg.content}"`);

            if (agentLoop && aiProvider) {
              console.log(
                `🤖 Menjalankan ReAct Agent Loop (${aiProvider.providerId} | Mode: ${executionModeController.getMode()})...`
              );
              try {
                const reply = await agentLoop.handleMessage(msg);
                console.log(`✅ [BOT ${runtime.botId}] Balasan otonom terkirim:`);
                console.log(`   "${reply.slice(0, 160)}${reply.length > 160 ? '...' : ''}"\n`);
              } catch (err: unknown) {
                console.error(
                  `❌ [BOT ${runtime.botId}] Gagal memproses pesan: ${(err as Error).message}`
                );
              }
            }
          },
          onBroadcast: async (evt) => {
            console.log(
              `📢 [BOT ${runtime.botId}] Broadcast dari ${evt.sender_bot_id} [${evt.category}]: ${evt.content}`
            );
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
            maxIterations: maxIter
          });
        }

        console.log(`Bot runtime started successfully!`);
        console.log(`  Session ID:     ${botRecord.session_id}`);
        console.log(`  Bot ID:         ${botRecord.bot_id}`);
        console.log(`  Display Name:   ${botRecord.display_name}`);
        console.log(`  PID:            ${process.pid}`);
        console.log(`  AI Provider:    ${aiProvider ? `${aiProvider.providerId} (${aiProvider.modelName})` : 'Disabled (Messaging only)'}`);
        console.log(`  Execution Mode: ${executionMode}`);
        console.log(`Press Ctrl+C to terminate bot process.`);

        // Keep process running until interrupted
        await new Promise<void>(() => {});
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
