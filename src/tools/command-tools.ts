import type { ToolDefinition } from '../ai/provider.js';
import { ExecutionController } from '../execution/controller.js';
import type { ExecutionContext, CommandExecutionRequest } from '../execution/types.js';

export interface RunCommandArgs {
  command: string;
  timeout_ms?: number;
  working_dir?: string;
}

export interface RunCommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  isolationType?: string;
  deniedByPolicy?: boolean;
}

/**
 * Executes a shell command inside the sandboxed project root via central ExecutionController.
 * Enforces ACG authorization, environment sanitization, OS isolation, timeout, and output redaction.
 */
export async function executeRunCommand(
  projectRoots: string[],
  args: RunCommandArgs,
  context?: Partial<ExecutionContext>
): Promise<RunCommandResult> {
  const controller = ExecutionController.getInstance();
  const execContext: ExecutionContext = {
    projectRoots,
    sessionId: context?.sessionId,
    botId: context?.botId,
    botDisplayName: context?.botDisplayName,
    isTurbo: context?.isTurbo,
  };

  const execRequest: CommandExecutionRequest = {
    command: args.command,
    workingDir: args.working_dir,
    timeoutMs: args.timeout_ms,
  };

  return await controller.executeCommand(execContext, execRequest);
}

// ============================================================================
// Tool Definition for AI Model Function Calling
// ============================================================================

export const RUN_COMMAND_TOOL: ToolDefinition = {
  name: 'run_command',
  description:
    'Execute a system shell command (e.g., test runners, compilers, git, npm, python) in the sandboxed project root directory.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.'
      },
      timeout_ms: {
        type: 'number',
        description:
          'Maximum allowed execution time in milliseconds (defaults to 30000 ms).'
      },
      working_dir: {
        type: 'string',
        description:
          'Relative working directory within the sandboxed project root (defaults to ".").'
      }
    },
    required: ['command']
  }
};
