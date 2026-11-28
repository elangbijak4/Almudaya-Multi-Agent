import process from 'node:process';
import { Command } from 'commander';
import { VERSION, CLI_NAME } from '../core/version.js';
import { registerSessionCommands } from './commands/session.js';
import { registerBotCommands } from './commands/bot.js';
import { registerMessagingCommands } from './commands/messaging.js';
import { registerContextCommands } from './commands/context.js';
import { registerCapabilityCommands } from './commands/capability.js';
import { registerSkillCommands } from './commands/skill.js';
import { registerMcpCommands } from './commands/mcp.js';
import { registerOperationCommands } from './commands/operation.js';
import { registerUpCommand } from './commands/up.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description('Almudaya Multi-Agent CLI — Session-centric multi-process bot collaboration foundation')
    .version(VERSION, '-v, --version', 'Output the current version');

  registerUpCommand(program);
  registerSessionCommands(program);
  registerBotCommands(program);
  registerMessagingCommands(program);
  registerContextCommands(program);
  registerCapabilityCommands(program);
  registerSkillCommands(program);
  registerMcpCommands(program);
  registerOperationCommands(program);

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}
