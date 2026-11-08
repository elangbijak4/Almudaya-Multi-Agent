import { spawn } from 'node:child_process';
import type { IIsolationBackend, IsolationSpawnOptions, IsolationSpawnResult } from './interface.js';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Linux Process Group Management Backend (AUD-01, REQ-01, ADR-003, Section 7.2).
 * Spawns execution in a detached process group and terminates the group on timeout.
 * 
 * SECURITY INVARIANT & THREAT MODEL NOTICE (AUD-01, Invariant 2):
 * This backend provides detached process group signal management and timeout termination.
 * It does NOT create Linux namespaces (user, pid, mnt, net), chroot, seccomp filters, or cgroups.
 * It does NOT provide filesystem, network, or OS-level security sandboxing.
 * Therefore, capabilities requiring OS-level sandboxing ('filesystem_sandbox', 'network_sandbox',
 * 'os_isolation_required') are truthfully reported as UNSUPPORTED.
 */
export class LinuxProcessGroupIsolationBackend implements IIsolationBackend {
  public readonly platform = 'linux';
  public readonly isolationType = 'linux_process_group';

  private readonly supportedCapabilities = new Set([
    'process_isolation',
    'process_group_termination',
  ]);

  public isAvailable(): boolean {
    return process.platform === 'linux';
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

    return new Promise<IsolationSpawnResult>((resolve, reject) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;

      let child;
      try {
        child = spawn('/bin/sh', ['-c', command], {
          cwd: options.cwd,
          env: options.env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        return reject(err);
      }

      timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          try {
            // Kill entire process group
            process.kill(-child.pid, 'SIGKILL');
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
 * Backward compatibility alias for LinuxNamespaceIsolationBackend (AUD-01).
 * @deprecated Use LinuxProcessGroupIsolationBackend instead.
 */
export const LinuxNamespaceIsolationBackend = LinuxProcessGroupIsolationBackend;
export type LinuxNamespaceIsolationBackend = LinuxProcessGroupIsolationBackend;
