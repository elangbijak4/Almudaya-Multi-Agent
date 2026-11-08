import { spawn } from 'node:child_process';
import type { IIsolationBackend, IsolationSpawnOptions, IsolationSpawnResult } from './interface.js';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB cap

/**
 * Windows Process Tree Management Backend (AUD-01, REQ-01, ADR-003, Section 7.2).
 * Implements process tree lifecycle encapsulation and resource reclamation via taskkill /T /F.
 * 
 * SECURITY INVARIANT & THREAT MODEL NOTICE (AUD-01, Invariant 2):
 * This backend provides process lifecycle management, timeouts, and process-tree termination.
 * It does NOT create Win32 Job Objects, Restricted Tokens, or AppContainers.
 * It does NOT provide filesystem, network, or OS-level security sandboxing.
 * Therefore, capabilities requiring OS-level sandboxing ('filesystem_sandbox', 'network_sandbox',
 * 'os_isolation_required') are truthfully reported as UNSUPPORTED.
 */
export class WindowsProcessTreeBackend implements IIsolationBackend {
  public readonly platform = 'win32';
  public readonly isolationType = 'windows_process_tree';

  private readonly supportedCapabilities = new Set([
    'process_isolation',
    'process_tree_termination',
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

/**
 * Backward compatibility alias for WindowsJobIsolationBackend (AUD-01).
 * @deprecated Use WindowsProcessTreeBackend instead.
 */
export const WindowsJobIsolationBackend = WindowsProcessTreeBackend;
export type WindowsJobIsolationBackend = WindowsProcessTreeBackend;
