import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import {
  generateNextBotId,
  generateNextDisplayName,
} from '../../src/bot/schema.js';
import {
  BotAlreadyRegisteredError,
  BotNotFoundError,
  DisplayNameConflictError,
  ValidationError,
} from '../../src/core/errors.js';

describe('Bot Registration, Discovery & Naming', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-bot-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);

    // Prepare session S001
    await sessionService.createSession({
      sessionId: 'S001',
      sessionName: 'Research App',
      description: 'Session for bot testing',
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Naming Helpers', () => {
    it('should generate next sequential bot ID', () => {
      expect(generateNextBotId([])).toBe('BOT001');
      expect(generateNextBotId(['BOT001'])).toBe('BOT002');
      expect(generateNextBotId(['BOT001', 'BOT002'])).toBe('BOT003');
      // Gap filling
      expect(generateNextBotId(['BOT002'])).toBe('BOT001');
    });

    it('should generate default display name formatted as <session_name>_<seq>', () => {
      expect(generateNextDisplayName('Research App', [])).toBe('research-app_001');
      expect(generateNextDisplayName('Research App', ['research-app_001'])).toBe('research-app_002');
    });
  });

  describe('Bot Lifecycle & Registry Operations', () => {
    it('should register a bot with auto-generated ID and default display name', async () => {
      const bot = await botService.registerBot('S001');

      expect(bot.bot_id).toBe('BOT001');
      expect(bot.display_name).toBe('research-app_001');
      expect(bot.session_id).toBe('S001');
      expect(bot.status).toBe('active');
      expect(bot.pid).toBe(process.pid);
    });

    it('should register a second bot with next sequential defaults', async () => {
      const bot1 = await botService.registerBot('S001');
      const bot2 = await botService.registerBot('S001');

      expect(bot1.bot_id).toBe('BOT001');
      expect(bot1.display_name).toBe('research-app_001');

      expect(bot2.bot_id).toBe('BOT002');
      expect(bot2.display_name).toBe('research-app_002');
    });

    it('should allow user-specified Bot ID and display name', async () => {
      const bot = await botService.registerBot('S001', {
        botId: 'ARCHITECT_01',
        displayName: 'Lead Architect',
        description: 'Plans system architecture',
      });

      expect(bot.bot_id).toBe('ARCHITECT_01');
      expect(bot.display_name).toBe('Lead Architect');
      expect(bot.description).toBe('Plans system architecture');
    });

    it('should reject registration if Bot ID is already registered', async () => {
      await botService.registerBot('S001', { botId: 'BOT001' });

      await expect(
        botService.registerBot('S001', { botId: 'BOT001' })
      ).rejects.toThrow(BotAlreadyRegisteredError);
    });

    it('should reject registration if display name conflicts with existing bot', async () => {
      await botService.registerBot('S001', { displayName: 'Worker Bot' });

      await expect(
        botService.registerBot('S001', { displayName: 'worker bot' })
      ).rejects.toThrow(DisplayNameConflictError);
    });

    it('should discover peers in the session', async () => {
      await botService.registerBot('S001', { botId: 'BOT001', displayName: 'Bot One' });
      await botService.registerBot('S001', { botId: 'BOT002', displayName: 'Bot Two' });

      const peers = await botService.listBots('S001');
      expect(peers.length).toBe(2);
      expect(peers.map((b) => b.bot_id)).toEqual(['BOT001', 'BOT002']);
    });

    it('should look up bot by Bot ID or display name', async () => {
      await botService.registerBot('S001', { botId: 'BOT001', displayName: 'Alpha Bot' });

      const byId = await botService.getBot('S001', 'BOT001');
      expect(byId.bot_id).toBe('BOT001');

      const byName = await botService.getBot('S001', 'alpha bot');
      expect(byName.bot_id).toBe('BOT001');

      const resolved = await botService.resolveBotId('S001', 'Alpha Bot');
      expect(resolved).toBe('BOT001');
    });

    it('should throw BotNotFoundError for unknown bot', async () => {
      await expect(botService.getBot('S001', 'UNKNOWN')).rejects.toThrow(BotNotFoundError);
    });

    it('should rename a bot without altering its stable Bot ID', async () => {
      const original = await botService.registerBot('S001', {
        botId: 'BOT001',
        displayName: 'Original Name',
      });

      const renamed = await botService.renameBot('S001', 'BOT001', 'Renamed Bot');
      expect(renamed.bot_id).toBe('BOT001');
      expect(renamed.display_name).toBe('Renamed Bot');
      expect(renamed.joined_at).toBe(original.joined_at);

      // Verify discovery with new name
      const found = await botService.getBot('S001', 'Renamed Bot');
      expect(found.bot_id).toBe('BOT001');
    });

    it('should reject rename if new display name conflicts with another bot', async () => {
      await botService.registerBot('S001', { botId: 'BOT001', displayName: 'First Bot' });
      await botService.registerBot('S001', { botId: 'BOT002', displayName: 'Second Bot' });

      await expect(
        botService.renameBot('S001', 'BOT002', 'First Bot')
      ).rejects.toThrow(DisplayNameConflictError);
    });

    it('should update bot status and last seen timestamp', async () => {
      await botService.registerBot('S001', { botId: 'BOT001' });

      const updated = await botService.updateStatus('S001', 'BOT001', 'idle');
      expect(updated.status).toBe('idle');
    });

    it('should persist bot registry across process restarts', async () => {
      await botService.registerBot('S001', {
        botId: 'BOT001',
        displayName: 'Persistent Bot',
        description: 'Survives restart',
      });

      // Simulate restart with new storage and service instances
      const freshStorage = new FilesystemSessionStorage(tmpWorkspace);
      const freshBotService = new BotService(freshStorage);

      const bots = await freshBotService.listBots('S001');
      expect(bots.length).toBe(1);
      expect(bots[0]?.bot_id).toBe('BOT001');
      expect(bots[0]?.display_name).toBe('Persistent Bot');
    });
  });
});
