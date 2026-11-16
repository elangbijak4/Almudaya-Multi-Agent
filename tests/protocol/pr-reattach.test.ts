import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import type { BotRecord } from '../../src/bot/schema.js';
import { PrSessionReattachProtocol, ProtocolStore } from '../../src/protocol/index.js';

describe('TC-350-19: PrReattach Live PID & Dead Bot Reconciliation', () => {
  let tmpRoot: string;
  let store: ProtocolStore;
  let prReattach: PrSessionReattachProtocol;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-prreattach-'));
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
    prReattach = new PrSessionReattachProtocol(store);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('classifies live processes as REATTACH, dead active bots as RESPAWN, and terminal bots as ALREADY_STOPPED', async () => {
    const now = new Date().toISOString();
    const bots: BotRecord[] = [
      {
        bot_id: 'BOT000',
        session_id: 'S-RE-1',
        display_name: 'MASTER',
        status: 'active',
        pid: 1001,
        role: 'master',
        joined_at: now,
        last_seen_at: now,
        metadata: {},
      },
      {
        bot_id: 'BOT001',
        session_id: 'S-RE-1',
        display_name: 'AliveWorker',
        status: 'active',
        pid: 2002,
        joined_at: now,
        last_seen_at: now,
        metadata: {},
      },
      {
        bot_id: 'BOT002',
        session_id: 'S-RE-1',
        display_name: 'CrashedWorker',
        status: 'active',
        pid: 99999,
        joined_at: now,
        last_seen_at: now,
        metadata: {},
      },
      {
        bot_id: 'BOT003',
        session_id: 'S-RE-1',
        display_name: 'OldWorker',
        status: 'stopped',
        joined_at: now,
        last_seen_at: now,
        metadata: {},
      },
    ];

    const res = await prReattach.evaluate({
      sessionId: 'S-RE-1',
      registeredBots: bots,
      processChecker: (pid) => pid === 1001 || pid === 2002,
    });

    const candidates = res.decision.metadata?.candidates as Array<{
      botId: string;
      disposition: string;
    }>;

    expect(candidates.find((c) => c.botId === 'BOT000')?.disposition).toBe('REATTACH');
    expect(candidates.find((c) => c.botId === 'BOT001')?.disposition).toBe('REATTACH');
    expect(candidates.find((c) => c.botId === 'BOT002')?.disposition).toBe('RESPAWN');
    expect(candidates.find((c) => c.botId === 'BOT003')?.disposition).toBe('ALREADY_STOPPED');
    expect(res.decision.metadata?.reattachCount).toBe(2);
    expect(res.decision.metadata?.respawnCount).toBe(1);
  });
});
