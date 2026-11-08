import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { BotRuntime } from '../../src/bot/runtime.js';

describe('Transactional Inbox Message Processing (RELIA-01, FR-321)', () => {
  let workspaceRoot: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  const sessionId = 'SES_TRANSACT_01';

  beforeEach(async () => {
    workspaceRoot = path.join(
      os.tmpdir(),
      `almudaya_transact_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    storage = new FilesystemSessionStorage(workspaceRoot);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    await sessionService.createSession({ sessionId, sessionName: 'Transactional test' });
    await botService.registerBot(sessionId, {
      botId: 'BOT_WORKER',
      displayName: 'Worker',
      status: 'active'
    });
    await botService.registerBot(sessionId, {
      botId: 'BOT_DISPATCHER',
      displayName: 'Dispatcher',
      status: 'active'
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should support reading inbox without marking as read (markAsRead: false)', async () => {
    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT_DISPATCHER',
      recipient: 'BOT_WORKER',
      content: 'Task 1'
    });

    const unread = await messagingService.readInbox(sessionId, 'BOT_WORKER', {
      status: 'unread',
      markAsRead: false
    });

    expect(unread).toHaveLength(1);
    expect(unread[0]?.status).toBe('unread');
    expect(unread[0]?.read_at).toBeUndefined();

    // Verify it is STILL unread on a second check
    const verifyUnread = await messagingService.readInbox(sessionId, 'BOT_WORKER', {
      status: 'unread',
      markAsRead: false
    });
    expect(verifyUnread).toHaveLength(1);
    expect(verifyUnread[0]?.status).toBe('unread');
  });

  it('should explicitly mark specific messages as read via markMessagesAsRead', async () => {
    const msg1 = await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT_DISPATCHER',
      recipient: 'BOT_WORKER',
      content: 'Task 1'
    });

    const msg2 = await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT_DISPATCHER',
      recipient: 'BOT_WORKER',
      content: 'Task 2'
    });

    // Mark ONLY msg1 as read
    await messagingService.markMessagesAsRead(sessionId, 'BOT_WORKER', [msg1.message_id]);

    const inbox = await messagingService.readInbox(sessionId, 'BOT_WORKER');
    const item1 = inbox.find((m) => m.message_id === msg1.message_id);
    const item2 = inbox.find((m) => m.message_id === msg2.message_id);

    expect(item1?.status).toBe('read');
    expect(item1?.read_at).toBeDefined();

    expect(item2?.status).toBe('unread');
    expect(item2?.read_at).toBeUndefined();
  });

  it('should NOT mark message as read or acknowledged if onMessage callback throws an error (crash simulation)', async () => {
    const sent = await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT_DISPATCHER',
      recipient: 'BOT_WORKER',
      content: 'Crash Task'
    });

    let failTurn = true;

    const runtime = new BotRuntime(storage, {
      sessionId,
      botId: 'BOT_WORKER',
      autoAcknowledge: true,
      pollIntervalMs: 60000,
      onMessage: async (_msg) => {
        if (failTurn) {
          throw new Error('Simulated transient worker crash or rate limit error');
        }
      }
    });

    await runtime.start();

    // 1. First poll cycle fails
    await runtime.pollCycle();

    // 2. Message MUST still be unread in the inbox (NOT lost, RELIA-01 guarantee)
    const inboxAfterFail = await messagingService.readInbox(sessionId, 'BOT_WORKER', {
      markAsRead: false
    });
    const failedMsg = inboxAfterFail.find((m) => m.message_id === sent.message_id);

    expect(failedMsg).toBeDefined();
    expect(failedMsg?.status).toBe('unread');
    expect(failedMsg?.acknowledged_at).toBeUndefined();

    // 3. Worker recovers, next poll cycle succeeds
    failTurn = false;
    await runtime.pollCycle();

    // 4. Message MUST now be acknowledged
    const inboxAfterSuccess = await messagingService.readInbox(sessionId, 'BOT_WORKER', {
      markAsRead: false
    });
    const successMsg = inboxAfterSuccess.find((m) => m.message_id === sent.message_id);

    expect(successMsg).toBeDefined();
    expect(successMsg?.status).toBe('acknowledged');
    expect(successMsg?.acknowledged_at).toBeDefined();

    await runtime.stop();
  });
});
