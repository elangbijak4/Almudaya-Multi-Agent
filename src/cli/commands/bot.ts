import { Command } from 'commander';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { BotService } from '../../bot/service.js';

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
    .option('-d, --description <description>', 'Bot description or role')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (options: {
      session: string;
      bot?: string;
      name?: string;
      description?: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new BotService(storage);

        const botRecord = await service.registerBot(options.session, {
          botId: options.bot,
          displayName: options.name,
          description: options.description,
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

        const bots = await service.listBots(options.session);

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
    .command('inspect <botIdOrName>')
    .description('Inspect details of a specific bot in a session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output details as JSON')
    .action(async (botIdOrName: string, options: { session: string; workspace?: string; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new BotService(storage);

        const botData = await service.getBot(options.session, botIdOrName);

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
    .command('rename <botId> <newDisplayName>')
    .description("Rename a bot's display name without altering its stable Bot ID")
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (botId: string, newDisplayName: string, options: { session: string; workspace?: string }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new BotService(storage);

        const updated = await service.renameBot(options.session, botId, newDisplayName);

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
