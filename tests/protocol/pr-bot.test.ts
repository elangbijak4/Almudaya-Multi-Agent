import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { PrBotSpawnQuotaProtocol, ProtocolStore } from '../../src/protocol/index.js';

describe('TC-350-02: PrBot Cumulative Spawn Quota Protocol', () => {
  let tmpRoot: string;
  let store: ProtocolStore;
  let prBot: PrBotSpawnQuotaProtocol;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-prbot-'));
    const storage = new FilesystemSessionStorage(tmpRoot);
    store = new ProtocolStore(storage);
    prBot = new PrBotSpawnQuotaProtocol(store);
    await store.saveConfig('S-PRBOT', {
      ...((await store.getConfig('S-PRBOT'))),
      prBotLimit: 2,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('allows spawns up to prBotLimit and denies cumulative spawns beyond limit', async () => {
    const e1 = await prBot.evaluate({ sessionId: 'S-PRBOT', requesterBotId: 'BOT000' });
    expect(e1.decision.allowed).toBe(true);
    await prBot.enforce(e1.decision, { sessionId: 'S-PRBOT', requesterBotId: 'BOT000' });

    const e2 = await prBot.evaluate({ sessionId: 'S-PRBOT', requesterBotId: 'BOT000' });
    expect(e2.decision.allowed).toBe(true);
    await prBot.enforce(e2.decision, { sessionId: 'S-PRBOT', requesterBotId: 'BOT000' });

    const e3 = await prBot.evaluate({ sessionId: 'S-PRBOT', requesterBotId: 'BOT001' });
    expect(e3.triggered).toBe(true);
    expect(e3.decision.allowed).toBe(false);
    expect(e3.decision.action).toBe('DENY');

    const state = await store.getRuntimeState('S-PRBOT');
    expect(state.totalSpawnedWorkers).toBe(2);
  });
});
