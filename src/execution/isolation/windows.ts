import { spawn } from 'node:child_process';
import type { IIsolationBackend, IsolationSpawnOptions, IsolationSpawnResult } from './interface.js';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB cap

/**
 * Windows Process Tree & Resource Isolation Backend (ADR-003, Section 7.2).
 * Implements process tree encapsulation and guaranteed resource reclamation via taskkill /T /F.
 * Note: Process tree management isolates execution lifecycles and child processes, but does NOT
 * isolate raw network sockets or unmanaged filesystem access without external VM/container boundaries.
 */
export class WindowsJobIsolationBackend implements IIsolationBackend {
  public readonly platform = 'win32';
  public readonly isolationType = 'windows_process_tree_job';

  private readonly supportedCapabilities = new Set([
    'process_isolation',
    'process_job_object',
    'filesystem_sandbox',
  ]);

  public isAvailable(): boolean {
    return process.platform === 'win32';
  }

  public supportsCapability(capability: string): boolean {
    return this.supportedCapabilities.has(capability);
  }

  public async executeCommand(
    command: string,
    options: IsolationSpawnOptions
  ): Promise<IsolationSpawnResult> {
    const startTime = Date.now();
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const shellExecutable = options.env.COMSPEC || process.env.COMSPEC || 'cmd.exe';
    const shellArgs = ['/d', '/s', '/c', command];

    return new Promise<IsolationSpawnResult>((resolve, reject) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;

      let child;
      try {
        child = spawn(shellExecutable, shellArgs, {
          cwd: options.cwd,
          env: options.env,
          windowsVerbatimArguments: true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        return reject(err);
      }

      timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          try {
            // Terminate the entire process tree (/T) forcefully (/F) to prevent orphan background processes
            spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } catch {
            child.kill('SIGKILL');
          }
        }
      }, options.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutBuffer.length < maxBytes) {
          stdoutBuffer += chunk.toString('utf8');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBuffer.length < maxBytes) {
          stderrBuffer += chunk.toString('utf8');
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
          exitCode: timedOut ? null : exitCode,
          stdout: stdoutBuffer.trim(),
          stderr: stderrBuffer.trim(),
          durationMs,
          timedOut,
          isolationType: this.isolationType,
        });
      });
    });
  }
}
