import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { LockTimeoutError, LockAcquisitionError } from './errors.js';
import { ensureDir, pathExists } from './fs-utils.js';

export interface LockOptions {
  timeoutMs?: number;
  staleThresholdMs?: number;
  holderName?: string;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
}

export interface LockRecord {
  lock_id: string;
  owner_token: string;
  pid: number;
  holder: string;
  locked_at: string;
  lease_expires_at: string;
  fencing_token: number;
}

export interface LockHandle {
  (): Promise<void>;
  release: () => Promise<void>;
  renewLease: (additionalDurationMs?: number) => Promise<void>;
  lockId: string;
  ownerToken: string;
  fencingToken: number;
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
 * Atomically generates and increments the monotonic fencing token for a target directory.
 * Must only be called while holding the filesystem lock on targetDir.
 */
async function getNextFencingToken(targetDir: string): Promise<number> {
  const fencingFile = path.join(targetDir, '.fencing_token');
  let currentToken = 0;
  try {
    const raw = await fs.readFile(fencingFile, 'utf-8');
    const parsed = parseInt(raw.trim(), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      currentToken = parsed;
    }
  } catch {
    // Counter file doesn't exist yet
  }
  const nextToken = currentToken + 1;
  await fs.writeFile(fencingFile, nextToken.toString(), 'utf-8');
  return nextToken;
}

/**
 * Acquires a cooperative lock on a target directory.
 * Returns a callable LockHandle that releases the lock and exposes ownership/fencing tokens.
 *
 * Enforces CONC-01:
 * - Cryptographically unique lock ID and owner token.
 * - Monotonically increasing fencing token.
 * - Lease expiry and renewal semantics.
 * - Ownership-verified release (prevents old/stale owner from releasing new owner's lock).
 * - Safe stale-lock and corrupt-lock recovery with evidence preservation.
 */
export async function acquireLock(
  targetDir: string,
  options: LockOptions = {}
): Promise<LockHandle> {
  await ensureDir(targetDir);
  const lockFilePath = path.join(targetDir, '.lock');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  const leaseDurationMs = options.leaseDurationMs ?? staleThresholdMs;
  const holder = options.holderName ?? `pid:${process.pid}`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const lockId = crypto.randomUUID();
      const ownerToken = crypto.randomUUID();
      const now = Date.now();
      const lockedAt = new Date(now).toISOString();
      const leaseExpiresAt = new Date(now + leaseDurationMs).toISOString();

      // Kernel-level atomic file creation (O_CREAT | O_EXCL via 'wx')
      const handle = await fs.open(lockFilePath, 'wx');
      let fencingToken = 1;
      try {
        fencingToken = await getNextFencingToken(targetDir);
        const lockPayload: LockRecord = {
          lock_id: lockId,
          owner_token: ownerToken,
          pid: process.pid,
          holder,
          locked_at: lockedAt,
          lease_expires_at: leaseExpiresAt,
          fencing_token: fencingToken,
        };
        await handle.writeFile(JSON.stringify(lockPayload, null, 2), 'utf-8');
      } finally {
        await handle.close();
      }

      // Lock acquired successfully. Construct release and renewal handlers.
      let released = false;

      const releaseFn = async (): Promise<void> => {
        if (released) return;
        released = true;
        try {
          if (await pathExists(lockFilePath)) {
            try {
              const content = await fs.readFile(lockFilePath, 'utf-8');
              const data = JSON.parse(content) as Partial<LockRecord>;

              // Strict ownership verification:
              // Only release if the lock on disk matches our exact owner_token and lock_id
              if (data.owner_token && data.owner_token === ownerToken && data.lock_id === lockId) {
                await fs.unlink(lockFilePath);
              } else if (!data.owner_token && data.pid === process.pid) {
                // Backward compatibility for legacy lock without owner_token
                await fs.unlink(lockFilePath);
              }
              // If owner_token does NOT match, do NOT delete; lock was acquired by another owner.
            } catch {
              // If lock is unreadable during our release attempt, do not blindly unlink.
            }
          }
        } catch {
          // Ignore release errors on shutdown
        }
      };

      const renewLease = async (additionalDurationMs?: number): Promise<void> => {
        if (released) {
          throw new Error('Cannot renew lease: lock has already been released.');
        }
        const duration = additionalDurationMs ?? leaseDurationMs;
        if (!(await pathExists(lockFilePath))) {
          throw new Error('Cannot renew lease: lock file does not exist.');
        }
        const content = await fs.readFile(lockFilePath, 'utf-8');
        const currentRecord = JSON.parse(content) as LockRecord;
        if (currentRecord.owner_token !== ownerToken || currentRecord.lock_id !== lockId) {
          throw new Error('Cannot renew lease: lock ownership was lost or acquired by another process.');
        }
        currentRecord.lease_expires_at = new Date(Date.now() + duration).toISOString();
        await fs.writeFile(lockFilePath, JSON.stringify(currentRecord, null, 2), 'utf-8');
      };

      const lockHandle = Object.assign(releaseFn, {
        release: releaseFn,
        renewLease,
        lockId,
        ownerToken,
        fencingToken,
      });

      return lockHandle as LockHandle;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // EEXIST: lock exists. EPERM / EBUSY / EACCES: file in use or locked on Windows.
      if (code === 'EEXIST' || code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
        try {
          const content = await fs.readFile(lockFilePath, 'utf-8');
          const record = JSON.parse(content) as Partial<LockRecord>;
          const lockedAt = record.locked_at ? new Date(record.locked_at).getTime() : 0;
          const leaseExpires = record.lease_expires_at
            ? new Date(record.lease_expires_at).getTime()
            : lockedAt + staleThresholdMs;
          const ageMs = Date.now() - lockedAt;

          const isExpired = Date.now() > leaseExpires;
          const isProcessDead = record.pid !== undefined && !isProcessRunning(record.pid);
          const isStale = ageMs > staleThresholdMs || isExpired || isProcessDead;

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
          // Lock file might be corrupt, partially written, or undergoing atomic creation
          try {
            const stats = await fs.stat(lockFilePath);
            const fileAgeMs = Date.now() - stats.mtimeMs;
            if (fileAgeMs > staleThresholdMs) {
              // Preserve corrupt evidence before recovery
              const corruptBackup = path.join(targetDir, `.lock.corrupt.${Date.now()}`);
              try {
                await fs.rename(lockFilePath, corruptBackup);
              } catch {
                await fs.unlink(lockFilePath).catch(() => {});
              }
              continue;
            }
          } catch {
            // Stat failed (e.g. concurrent unlink)
          }
        }

        // Bounded sleep with randomized jitter
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
 * Automatically releases the lock when the action completes or throws.
 */
export async function withLock<T>(
  targetDir: string,
  action: (handle: LockHandle) => Promise<T>,
  options?: LockOptions
): Promise<T> {
  const handle = await acquireLock(targetDir, options);
  try {
    return await action(handle);
  } finally {
    await handle();
  }
}
