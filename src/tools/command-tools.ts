import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../ai/provider.js';
import {
  validateSandboxedPath,
  sanitizeChildEnv,
  redactSensitiveOutput
} from './sandbox.js';

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
}

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB cap to prevent buffer explosion

/**
 * Executes a shell command inside the sandboxed project root.
 * Captures stdout, stderr, exit code, and enforces execution timeout.
 */
export async function executeRunCommand(
  projectRoots: string[],
  args: RunCommandArgs
): Promise<RunCommandResult> {
  const workingDirArg = args.working_dir || '.';
  const resolvedWorkingDir = validateSandboxedPath(projectRoots, workingDirArg);

  const timeoutMs = Math.max(1000, args.timeout_ms ?? DEFAULT_TIMEOUT_MS);
  const startTime = Date.now();

  return new Promise<RunCommandResult>((resolve, reject) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;

    // Use platform-appropriate shell execution
    const isWin = process.platform === 'win32';
    const shellExecutable = isWin
      ? process.env.COMSPEC || 'cmd.exe'
      : '/bin/sh';

    const shellArgs = isWin
      ? ['/d', '/s', '/c', args.command]
      : ['-c', args.command];

    let child;
    try {
      child = spawn(shellExecutable, shellArgs, {
        cwd: resolvedWorkingDir,
        env: sanitizeChildEnv(process.env),
        windowsVerbatimArguments: isWin,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      return reject(err);
    }

    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        if (isWin) {
          // On Windows, use taskkill to terminate process tree cleanly
          try {
            spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore'
            });
          } catch {
            child.kill('SIGKILL');
          }
        } else {
          try {
            child.kill('SIGKILL');
          } catch {
            // Process might already be dead
          }
        }
      }
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      if (stdoutBuffer.length < MAX_OUTPUT_BYTES) {
        stdoutBuffer += data.toString('utf8');
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      if (stderrBuffer.length < MAX_OUTPUT_BYTES) {
        stderrBuffer += data.toString('utf8');
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (exitCode) => {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      resolve({
        command: args.command,
        exitCode: timedOut ? null : exitCode,
        stdout: redactSensitiveOutput(stdoutBuffer.trim()),
        stderr: redactSensitiveOutput(stderrBuffer.trim()),
        durationMs,
        timedOut
      });
    });
  });
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
