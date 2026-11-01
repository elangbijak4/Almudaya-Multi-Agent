import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';

describe('Concurrent Messaging (Multi-Process Simulation)', () => {
  let tmpWorkspace: string;
  let sessionService: SessionService;
  let botService: BotService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-concurrent-msg-test-'));
    const storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);

    await sessionService.createSession({ sessionId: 'S001', sessionName: 'Stress Test' });
    await botService.registerBot('S001', { botId: 'BOT001', displayName: 'Writer One' });
    await botService.registerBot('S001', { botId: 'BOT002', displayName: 'Writer Two' });
    await botService.registerBot('S001', { botId: 'BOT003', displayName: 'Recipient Bot' });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should safely append broadcasts concurrently without file corruption or dropped lines', async () => {
    const EVENT_COUNT = 20;

    // Concurrently publish 20 events from multiple independent service instances
    const promises = Array.from({ length: EVENT_COUNT }, async (_, idx) => {
      const independentStorage = new FilesystemSessionStorage(tmpWorkspace);
      const independentMessaging = new MessagingService(independentStorage);

      const sender = idx % 2 === 0 ? 'BOT001' : 'BOT002';
      return await independentMessaging.publishBroadcast('S001', {
        senderBotId: sender,
        content: `Concurrent broadcast payload #${idx + 1}`,
      });
    });

    const results = await Promise.all(promises);
    expect(results.length).toBe(EVENT_COUNT);

    // Read through reader service
    const verifyMessaging = new MessagingService(new FilesystemSessionStorage(tmpWorkspace));
    const events = await verifyMessaging.readBroadcasts('S001');

    expect(events.length).toBe(EVENT_COUNT);

    // Ensure all event IDs are distinct
    const eventIds = new Set(events.map((e) => e.event_id));
    expect(eventIds.size).toBe(EVENT_COUNT);
  });

  it('should safely append direct messages to the same inbox concurrently without loss', async () => {
    const MSG_COUNT = 15;

    // Concurrently send 15 direct messages from multiple senders to BOT003
    const promises = Array.from({ length: MSG_COUNT }, async (_, idx) => {
      const independentStorage = new FilesystemSessionStorage(tmpWorkspace);
      const independentMessaging = new MessagingService(independentStorage);

      const sender = idx % 2 === 0 ? 'BOT001' : 'BOT002';
      return await independentMessaging.sendDirectMessage('S001', {
        senderBotId: sender,
        recipient: 'BOT003',
        content: `Direct message payload #${idx + 1}`,
      });
    });

    const sentMessages = await Promise.all(promises);
    expect(sentMessages.length).toBe(MSG_COUNT);

    // Read BOT003 inbox
    const verifyMessaging = new MessagingService(new FilesystemSessionStorage(tmpWorkspace));
    const inbox = await verifyMessaging.readInbox('S001', 'BOT003');

    expect(inbox.length).toBe(MSG_COUNT);
    const messageIds = new Set(inbox.map((m) => m.message_id));
    expect(messageIds.size).toBe(MSG_COUNT);
  });
});
