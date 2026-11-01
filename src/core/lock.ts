import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { LockTimeoutError, LockAcquisitionError } from './errors.js';
import { ensureDir, pathExists } from './fs-utils.js';

export interface LockOptions {
  timeoutMs?: number;
  staleThresholdMs?: number;
  holderName?: string;
  pollIntervalMs?: number;
}

interface LockRecord {
  pid: number;
  locked_at: string;
  holder: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_THRESHOLD_MS = 30000;
const DEFAULT_POLL_INTERVAL_MS = 50;

/**
 * Checks if a process with the specified PID is currently running.
 */
export function isProcessRunning(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    return code === 'EPERM'; // Running but no permission to signal
  }
}

/**
 * Acquires a cooperative lock on a target directory.
 * Returns an unlock function that releases the lock.
 */
export async function acquireLock(
  targetDir: string,
  options: LockOptions = {}
): Promise<() => Promise<void>> {
  await ensureDir(targetDir);
  const lockFilePath = path.join(targetDir, '.lock');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  const holder = options.holderName ?? `pid:${process.pid}`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const lockPayload: LockRecord = {
        pid: process.pid,
        locked_at: new Date().toISOString(),
        holder,
      };

      const handle = await fs.open(lockFilePath, 'wx');
      try {
        await handle.writeFile(JSON.stringify(lockPayload, null, 2), 'utf-8');
      } finally {
        await handle.close();
      }

      // Lock acquired successfully. Return release function.
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          if (await pathExists(lockFilePath)) {
            // Verify ownership before deleting
            try {
              const content = await fs.readFile(lockFilePath, 'utf-8');
              const data = JSON.parse(content) as LockRecord;
              if (data.pid === process.pid) {
                await fs.unlink(lockFilePath);
              }
            } catch {
              // If file is unreadable, force unlink
              await fs.unlink(lockFilePath).catch(() => {});
            }
          }
        } catch {
          // Ignore release errors on shutdown
        }
      };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'EEXIST') {
        // Lock file exists. Check for staleness.
        try {
          const content = await fs.readFile(lockFilePath, 'utf-8');
          const record = JSON.parse(content) as LockRecord;
          const lockedAt = new Date(record.locked_at).getTime();
          const ageMs = Date.now() - lockedAt;

          const isStale = ageMs > staleThresholdMs || !isProcessRunning(record.pid);
          if (isStale) {
            // Safe to break stale lock
            try {
              await fs.unlink(lockFilePath);
              continue; // Immediate retry
            } catch {
              // Unlink conflict, proceed to sleep
            }
          }
        } catch {
          // Lock file might be corrupt, partially written, or already deleted
          try {
            await fs.unlink(lockFilePath);
            continue;
          } catch {
            // Ignore and retry
          }
        }

        // Bounded sleep with slight jitter
        const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        const jitter = Math.floor(Math.random() * 20);
        await new Promise((resolve) => setTimeout(resolve, pollMs + jitter));
        continue;
      }

      throw new LockAcquisitionError(lockFilePath, (err as Error).message);
    }
  }

  throw new LockTimeoutError(lockFilePath, timeoutMs);
}

/**
 * Runs an asynchronous action while holding the cooperative lock.
 */
export async function withLock<T>(
  targetDir: string,
  action: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  const release = await acquireLock(targetDir, options);
  try {
    return await action();
  } finally {
    await release();
  }
}
