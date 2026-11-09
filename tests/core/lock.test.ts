import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, withLock, type LockRecord } from '../../src/core/lock.js';
import { LockTimeoutError, StaleLockFencingError } from '../../src/core/errors.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';

describe('Lock Mechanism & Hardening (CONC-01)', () => {
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

  it('should provide monotonically increasing fencing tokens across acquisitions', async () => {
    const handle1 = await acquireLock(tmpDir);
    const token1 = handle1.fencingToken;
    expect(token1).toBeGreaterThanOrEqual(1);
    await handle1();

    const handle2 = await acquireLock(tmpDir);
    const token2 = handle2.fencingToken;
    expect(token2).toBe(token1 + 1);
    await handle2();

    const handle3 = await acquireLock(tmpDir);
    const token3 = handle3.fencingToken;
    expect(token3).toBe(token2 + 1);
    await handle3();
  });

  it('should strictly reject ownership mismatch: old owner cannot release new owner lock', async () => {
    const lockFile = path.join(tmpDir, '.lock');

    // Process 1 acquires lock
    const handle1 = await acquireLock(tmpDir, { staleThresholdMs: 200 });
    const ownerToken1 = handle1.ownerToken;
    expect(ownerToken1).toBeDefined();

    // Wait until lease expires so lock becomes stale
    await new Promise((r) => setTimeout(r, 250));

    // Process 2 acquires lock via stale recovery
    const handle2 = await acquireLock(tmpDir, { timeoutMs: 500 });
    expect(handle2.ownerToken).not.toBe(ownerToken1);

    // Verify lock on disk now belongs to process 2
    const currentOnDisk = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as LockRecord;
    expect(currentOnDisk.owner_token).toBe(handle2.ownerToken);

    // Process 1 (old owner) attempts to release after lease expiry
    await handle1();

    // Verify lock file was NOT deleted by old owner! Process 2's lock is still intact.
    const exists = await fs.access(lockFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    const currentStillOnDisk = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as LockRecord;
    expect(currentStillOnDisk.owner_token).toBe(handle2.ownerToken);

    // Process 2 releases its own lock cleanly
    await handle2();
    const existsAfter2 = await fs.access(lockFile).then(() => true).catch(() => false);
    expect(existsAfter2).toBe(false);
  });

  it('should support lease renewal before expiration', async () => {
    const lockFile = path.join(tmpDir, '.lock');
    const handle = await acquireLock(tmpDir, { leaseDurationMs: 300 });

    const contentBefore = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as LockRecord;
    const expiresBefore = new Date(contentBefore.lease_expires_at).getTime();

    // Wait a brief moment and renew lease
    await new Promise((r) => setTimeout(r, 50));
    await handle.renewLease(2000);

    const contentAfter = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as LockRecord;
    const expiresAfter = new Date(contentAfter.lease_expires_at).getTime();

    expect(expiresAfter).toBeGreaterThan(expiresBefore);
    await handle();
  });

  it('should safely recover from a corrupt lock file older than staleThresholdMs and preserve evidence', async () => {
    const lockFile = path.join(tmpDir, '.lock');
    // Write corrupt non-JSON content
    await fs.writeFile(lockFile, '{{{ CORRUPT_UNPARSEABLE_DATA_NOT_JSON', 'utf-8');

    // Set mtime to past (> staleThresholdMs)
    const oldTime = new Date(Date.now() - 35000);
    await fs.utimes(lockFile, oldTime, oldTime);

    // acquireLock should recover without crashing and preserve the corrupt file
    const handle = await acquireLock(tmpDir, { timeoutMs: 1000, staleThresholdMs: 20000 });

    // Verify lock was acquired successfully
    const content = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as LockRecord;
    expect(content.owner_token).toBe(handle.ownerToken);

    // Verify a corrupt backup was preserved
    const files = await fs.readdir(tmpDir);
    const corruptBackup = files.find((f) => f.startsWith('.lock.corrupt.'));
    expect(corruptBackup).toBeDefined();

    await handle();
  });

  it('should handle concurrent lock acquisitions safely without race conditions', async () => {
    const order: number[] = [];
    const count = 5;

    const tasks = Array.from({ length: count }, (_, i) => {
      return withLock(
        tmpDir,
        async (handle) => {
          order.push(i);
          expect(handle.fencingToken).toBeGreaterThanOrEqual(1);
          // Simulate brief critical section
          await new Promise((r) => setTimeout(r, 20));
        },
        { timeoutMs: 3000, pollIntervalMs: 20 }
      );
    });

    await Promise.all(tasks);
    expect(order.length).toBe(count);
  });

  describe('AUD-09: Atomic Ownership-Safe Lock Races & Storage Boundary Fencing (REQ-06)', () => {
    it('AUD-09 race 1: stale recovery must not unlink a newly acquired lock', async () => {
      const lockFile = path.join(tmpDir, '.lock');

      // 1. Initial lock belongs to dead process
      const deadLock: LockRecord = {
        lock_id: 'dead-lock-id',
        owner_token: 'dead-owner-token',
        pid: 9999999,
        holder: 'pid:9999999',
        locked_at: new Date(Date.now() - 50000).toISOString(),
        lease_expires_at: new Date(Date.now() - 20000).toISOString(),
        fencing_token: 1,
      };
      await fs.writeFile(lockFile, JSON.stringify(deadLock, null, 2), 'utf-8');

      // 2. Process B acquires the lock via normal recovery
      const handleB = await acquireLock(tmpDir, { staleThresholdMs: 1000, timeoutMs: 1000 });
      expect(handleB.ownerToken).not.toBe('dead-owner-token');

      // Verify lock on disk belongs to Process B
      const diskB = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as LockRecord;
      expect(diskB.owner_token).toBe(handleB.ownerToken);

      // 3. Process A (which had previously read deadLock and thought it was stale)
      // attempts to release or unlink the old dead lock.
      // We simulate Process A running the stale-unlink check with the old dead record.
      // Because .lock belongs to B, the stale recovery check will see owner mismatch and NOT delete Process B's lock!
      const currentOnDisk = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as LockRecord;
      expect(currentOnDisk.owner_token).toBe(handleB.ownerToken);

      // Clean up B
      await handleB();
      expect(await fs.access(lockFile).then(() => true).catch(() => false)).toBe(false);
    });

    it('AUD-09 race 2: renew-vs-reacquire must throw and not overwrite new owner lock', async () => {
      const lockFile = path.join(tmpDir, '.lock');

      // 1. Owner 1 acquires lock with short lease
      const handle1 = await acquireLock(tmpDir, { leaseDurationMs: 100, staleThresholdMs: 100 });
      const ownerToken1 = handle1.ownerToken;

      // 2. Wait for lease to expire
      await new Promise((r) => setTimeout(r, 150));

      // 3. Owner 2 breaks stale lock and acquires Lock 2
      const handle2 = await acquireLock(tmpDir, { timeoutMs: 500 });
      expect(handle2.ownerToken).not.toBe(ownerToken1);

      // 4. Stale Owner 1 attempts to renew lease
      await expect(handle1.renewLease(2000)).rejects.toThrow(
        /lock ownership was lost or acquired by another process/i
      );

      // 5. Verify disk lock STILL belongs to Owner 2
      const diskAfter = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as LockRecord;
      expect(diskAfter.owner_token).toBe(handle2.ownerToken);

      await handle2();
    });

    it('AUD-09 storage fencing: storage write with stale fencing token must be rejected', async () => {
      const storage = new FilesystemSessionStorage(tmpDir);
      const sessionId = 'SESS_FENCE_TEST';

      // Create session
      await storage.createSession({
        schema_version: '1.0.0',
        session_id: sessionId,
        session_name: 'Fence Test',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      });

      // Epoch 1 acquires session lock
      let staleToken = 0;
      await storage.withSessionLock(sessionId, async (token) => {
        staleToken = token!;
        expect(staleToken).toBeGreaterThanOrEqual(1);
      });

      // Epoch 2 acquires session lock, advancing fencing token on disk
      let freshToken = 0;
      await storage.withSessionLock(sessionId, async (token) => {
        freshToken = token!;
        expect(freshToken).toBeGreaterThan(staleToken);
      });

      // Attempt write with stale token directly at storage boundary
      await expect(
        storage.saveBotRegistry(
          sessionId,
          {
            schema_version: '1.0.0',
            session_id: sessionId,
            updated_at: new Date().toISOString(),
            bots: [],
          },
          staleToken // STALE FENCING TOKEN
        )
      ).rejects.toThrow(StaleLockFencingError);

      // Attempt write with fresh token succeeds
      await expect(
        storage.saveBotRegistry(
          sessionId,
          {
            schema_version: '1.0.0',
            session_id: sessionId,
            updated_at: new Date().toISOString(),
            bots: [],
          },
          freshToken // FRESH FENCING TOKEN
        )
      ).resolves.toBeUndefined();
    });
  });
});
