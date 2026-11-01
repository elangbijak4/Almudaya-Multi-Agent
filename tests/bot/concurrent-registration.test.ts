import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';

describe('Concurrent Bot Registration', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-concurrent-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);

    await sessionService.createSession({
      sessionId: 'S001',
      sessionName: 'Concurrent Session',
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should safely register multiple bots concurrently without ID or name collision', async () => {
    const BOT_COUNT = 5;

    // Launch 5 concurrent registrations through independent service instances
    // to simulate separate bot processes accessing the shared workspace
    const promises = Array.from({ length: BOT_COUNT }, async (_, idx) => {
      const independentStorage = new FilesystemSessionStorage(tmpWorkspace);
      const independentBotService = new BotService(independentStorage);

      return await independentBotService.registerBot('S001', {
        description: `Simulated parallel worker #${idx + 1}`,
      });
    });

    const registeredBots = await Promise.all(promises);

    expect(registeredBots.length).toBe(BOT_COUNT);

    // Verify all Bot IDs are unique
    const botIds = registeredBots.map((b) => b.bot_id);
    const uniqueBotIds = new Set(botIds);
    expect(uniqueBotIds.size).toBe(BOT_COUNT);

    // Verify all display names are unique
    const displayNames = registeredBots.map((b) => b.display_name);
    const uniqueDisplayNames = new Set(displayNames);
    expect(uniqueDisplayNames.size).toBe(BOT_COUNT);

    // Verify registry file contains exactly all registered bots
    const verifyService = new BotService(new FilesystemSessionStorage(tmpWorkspace));
    const finalRegistry = await verifyService.listBots('S001');
    expect(finalRegistry.length).toBe(BOT_COUNT);
  });
});
