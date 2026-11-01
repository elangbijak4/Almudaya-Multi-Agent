import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';

describe('Bot Liveness & Stale Status Detection (OI-005)', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-liveness-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);

    await sessionService.createSession({ sessionId: 'S001', sessionName: 'Liveness Lab' });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should keep active bots with live PID and fresh heartbeat as active', async () => {
    await botService.registerBot('S001', {
      botId: 'ALIVE_BOT',
      status: 'active',
      pid: process.pid,
    });

    const reconciled = await botService.reconcileBotLiveness('S001', 5000);
    const bot = reconciled.find((b) => b.bot_id === 'ALIVE_BOT');
    expect(bot?.status).toBe('active');
  });

  it('should mark bot as stale if its OS PID does not exist', async () => {
    await botService.registerBot('S001', {
      botId: 'DEAD_PID_BOT',
      status: 'active',
      pid: 9999999, // Non-existent PID
    });

    const reconciled = await botService.reconcileBotLiveness('S001', 50000);
    const bot = reconciled.find((b) => b.bot_id === 'DEAD_PID_BOT');
    expect(bot?.status).toBe('stale');
  });

  it('should mark bot as stale if heartbeat timestamp is older than threshold', async () => {
    const pastTime = new Date(Date.now() - 20000).toISOString();

    // Register bot and manually backdate last_seen_at
    const registered = await botService.registerBot('S001', {
      botId: 'TIMED_OUT_BOT',
      status: 'active',
      pid: process.pid,
    });

    const registry = await storage.getBotRegistry('S001');
    const idx = registry.bots.findIndex((b) => b.bot_id === registered.bot_id);
    registry.bots[idx]!.last_seen_at = pastTime;
    await storage.saveBotRegistry('S001', registry);

    const reconciled = await botService.reconcileBotLiveness('S001', 5000);
    const bot = reconciled.find((b) => b.bot_id === 'TIMED_OUT_BOT');
    expect(bot?.status).toBe('stale');
  });
});
