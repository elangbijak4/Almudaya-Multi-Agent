import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';

describe('Broadcast Messaging & Cursor Tracking', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-broadcast-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    // Create session S001 and two bots
    await sessionService.createSession({ sessionId: 'S001', sessionName: 'Broadcast Lab' });
    await botService.registerBot('S001', { botId: 'BOT001', displayName: 'Publisher Bot' });
    await botService.registerBot('S001', { botId: 'BOT002', displayName: 'Subscriber Bot' });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should publish and read a broadcast event', async () => {
    const event = await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT001',
      category: 'OBSERVATION',
      content: 'Found relevant repository architecture',
    });

    expect(event.event_id).toMatch(/^evt_\d+_[0-9a-f]+$/);
    expect(event.session_id).toBe('S001');
    expect(event.sender_bot_id).toBe('BOT001');
    expect(event.category).toBe('OBSERVATION');
    expect(event.content).toBe('Found relevant repository architecture');

    const all = await messagingService.readBroadcasts('S001');
    expect(all.length).toBe(1);
    expect(all[0]?.event_id).toBe(event.event_id);
  });

  it('should filter broadcasts by category and limit', async () => {
    await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT001',
      category: 'ACTIVITY',
      content: 'Task 1 started',
    });
    await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT001',
      category: 'DECISION',
      content: 'Adopted TypeScript strict',
    });
    await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT002',
      category: 'ACTIVITY',
      content: 'Task 2 started',
    });

    const decisions = await messagingService.readBroadcasts('S001', { category: 'DECISION' });
    expect(decisions.length).toBe(1);
    expect(decisions[0]?.content).toBe('Adopted TypeScript strict');

    const limited = await messagingService.readBroadcasts('S001', { limit: 2 });
    expect(limited.length).toBe(2);
    expect(limited[1]?.content).toBe('Task 2 started');
  });

  it('should support per-bot cursor tracking with autoAdvanceCursor', async () => {
    // Publish 2 initial events
    await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT001',
      content: 'First announcement',
    });
    await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT001',
      content: 'Second announcement',
    });

    // BOT002 reads with cursor
    const firstRead = await messagingService.readBroadcasts('S001', {
      botId: 'BOT002',
      autoAdvanceCursor: true,
    });
    expect(firstRead.length).toBe(2);
    expect(firstRead.map((e) => e.content)).toEqual(['First announcement', 'Second announcement']);

    // Subsequent read without new events should yield empty array
    const secondRead = await messagingService.readBroadcasts('S001', {
      botId: 'BOT002',
      autoAdvanceCursor: true,
    });
    expect(secondRead.length).toBe(0);

    // Publish a third event
    await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT001',
      content: 'Third announcement',
    });

    // BOT002 should receive only the third event
    const thirdRead = await messagingService.readBroadcasts('S001', {
      botId: 'BOT002',
      autoAdvanceCursor: true,
    });
    expect(thirdRead.length).toBe(1);
    expect(thirdRead[0]?.content).toBe('Third announcement');
  });

  it('should persist broadcast log across storage restarts', async () => {
    await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT001',
      content: 'Durable event across restart',
    });

    // Simulate restart with fresh instances
    const freshStorage = new FilesystemSessionStorage(tmpWorkspace);
    const freshMessaging = new MessagingService(freshStorage);

    const events = await freshMessaging.readBroadcasts('S001');
    expect(events.length).toBe(1);
    expect(events[0]?.content).toBe('Durable event across restart');
  });
});
