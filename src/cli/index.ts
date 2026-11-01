import process from 'node:process';
import { Command } from 'commander';
import { VERSION, CLI_NAME } from '../core/version.js';
import { registerSessionCommands } from './commands/session.js';
import { registerBotCommands } from './commands/bot.js';
import { registerMessagingCommands } from './commands/messaging.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description('Almudaya Multi-Agent CLI — Session-centric multi-process bot collaboration foundation')
    .version(VERSION, '-v, --version', 'Output the current version');

  registerSessionCommands(program);
  registerBotCommands(program);
  registerMessagingCommands(program);

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}
