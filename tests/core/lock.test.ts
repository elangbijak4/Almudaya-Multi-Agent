import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, withLock } from '../../src/core/lock.js';
import { LockTimeoutError } from '../../src/core/errors.js';

describe('Lock Mechanism', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-lock-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup
    }
  });

  it('should acquire and release lock cleanly', async () => {
    const lockFile = path.join(tmpDir, '.lock');
    const release = await acquireLock(tmpDir);

    const exists = await fs.access(lockFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    await release();

    const existsAfter = await fs.access(lockFile).then(() => true).catch(() => false);
    expect(existsAfter).toBe(false);
  });

  it('should execute action within withLock and auto-release', async () => {
    let executed = false;
    await withLock(tmpDir, async () => {
      executed = true;
      const exists = await fs.access(path.join(tmpDir, '.lock')).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    expect(executed).toBe(true);
    const existsAfter = await fs.access(path.join(tmpDir, '.lock')).then(() => true).catch(() => false);
    expect(existsAfter).toBe(false);
  });

  it('should timeout if lock is held and not released within timeoutMs', async () => {
    const release = await acquireLock(tmpDir);

    await expect(
      acquireLock(tmpDir, { timeoutMs: 150, pollIntervalMs: 25 })
    ).rejects.toThrow(LockTimeoutError);

    await release();
  });

  it('should recover from a stale lock if holder PID does not exist', async () => {
    const lockFile = path.join(tmpDir, '.lock');
    // Write a mock stale lock with a non-existent dead PID (e.g. 9999999)
    const deadLockPayload = {
      pid: 9999999,
      locked_at: new Date(Date.now() - 100000).toISOString(),
      holder: 'dead-process',
    };
    await fs.writeFile(lockFile, JSON.stringify(deadLockPayload, null, 2), 'utf-8');

    // acquireLock should detect stale lock, unlink it, and acquire successfully
    const release = await acquireLock(tmpDir, { timeoutMs: 500, staleThresholdMs: 1000 });
    const content = await fs.readFile(lockFile, 'utf-8');
    const record = JSON.parse(content);
    expect(record.pid).toBe(process.pid);

    await release();
  });
});
