import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import {
  PrModeratorArbitrationProtocol,
  ProtocolStore,
} from '../../src/protocol/index.js';

describe('TC-350-09 & TC-350-10: PrModerator Arbitration, Write Fencing & Delegation', () => {
  let tmpRoot: string;
  let store: ProtocolStore;
  let moderator: PrModeratorArbitrationProtocol;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-prmod-'));
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
    moderator = new PrModeratorArbitrationProtocol(store);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('TC-350-09: issues fenced CapabilityToken, blocks conflicting writer & stale epochs', async () => {
    const token = await moderator.issueToken('S-MOD-1', {
      taskId: 'TASK-10',
      holderBotId: 'BOT001',
      allowedPaths: ['src/api/**'],
      accessMode: 'EXCLUSIVE_WRITE',
    });

    expect(token.holderBotId).toBe('BOT001');
    expect(token.fenceEpoch).toBe(2);

    const valid = await moderator.validateWriteAccess('S-MOD-1', {
      botId: 'BOT001',
      tokenId: token.tokenId,
      fenceEpoch: token.fenceEpoch,
      targetPath: 'src/api/users.ts',
    });
    expect(valid.allowed).toBe(true);

    // Concurrent bot without token cannot mutate src/api/users.ts
    const blockedConflict = await moderator.validateWriteAccess('S-MOD-1', {
      botId: 'BOT002',
      targetPath: 'src/api/users.ts',
    });
    expect(blockedConflict.allowed).toBe(false);

    // Stale fence epoch rejected
    const staleEpoch = await moderator.validateWriteAccess('S-MOD-1', {
      botId: 'BOT001',
      tokenId: token.tokenId,
      fenceEpoch: 1,
      targetPath: 'src/api/users.ts',
    });
    expect(staleEpoch.allowed).toBe(false);

    // Revoking token immediately blocks previous holder too
    await moderator.revokeToken('S-MOD-1', token.tokenId, 'Revoked for test');
    const afterRevoke = await moderator.validateWriteAccess('S-MOD-1', {
      botId: 'BOT001',
      tokenId: token.tokenId,
      fenceEpoch: token.fenceEpoch,
      targetPath: 'src/api/users.ts',
    });
    expect(afterRevoke.allowed).toBe(false);
  });

  it('TC-350-10: allows Master to delegate and reclaim PrModerator seat while blocking unauthorized delegation', async () => {
    await expect(
      moderator.delegateModerator('S-MOD-2', 'BOT002', 'BOT001')
    ).rejects.toThrow();

    const delegated = await moderator.delegateModerator('S-MOD-2', 'BOT002', 'BOT000');
    expect(delegated.activeModeratorBotId).toBe('BOT002');

    const token = await moderator.issueToken('S-MOD-2', {
      taskId: 'TASK-22',
      holderBotId: 'BOT003',
    });
    expect(token.issuedByModeratorId).toBe('BOT002');

    const reclaimed = await moderator.reclaimModerator('S-MOD-2', 'BOT000');
    expect(reclaimed.activeModeratorBotId).toBe('BOT000');
  });
});
