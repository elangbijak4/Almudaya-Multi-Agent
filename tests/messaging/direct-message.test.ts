import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { BotNotFoundError, MessageNotFoundError } from '../../src/core/errors.js';

describe('Direct Messaging & Acknowledgements', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-dm-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    await sessionService.createSession({ sessionId: 'S001', sessionName: 'DM Lab' });
    await botService.registerBot('S001', { botId: 'BOT001', displayName: 'Architect Bot' });
    await botService.registerBot('S001', { botId: 'BOT002', displayName: 'Worker Bot' });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should send direct message using Bot ID', async () => {
    const msg = await messagingService.sendDirectMessage('S001', {
      senderBotId: 'BOT001',
      recipient: 'BOT002',
      content: 'Please inspect the module architecture.',
    });

    expect(msg.message_id).toMatch(/^msg_\d+_[0-9a-f]+$/);
    expect(msg.sender_bot_id).toBe('BOT001');
    expect(msg.recipient_bot_id).toBe('BOT002');
    expect(msg.status).toBe('unread');

    const inbox = await messagingService.readInbox('S001', 'BOT002');
    expect(inbox.length).toBe(1);
    expect(inbox[0]?.message_id).toBe(msg.message_id);
    expect(inbox[0]?.content).toBe('Please inspect the module architecture.');
  });

  it('should resolve recipient by display name and deliver to stable Bot ID', async () => {
    const msg = await messagingService.sendDirectMessage('S001', {
      senderBotId: 'HUMAN',
      recipient: 'Worker Bot',
      content: 'Hello via display name',
    });

    expect(msg.recipient_bot_id).toBe('BOT002');

    const inbox = await messagingService.readInbox('S001', 'BOT002');
    expect(inbox.length).toBe(1);
    expect(inbox[0]?.content).toBe('Hello via display name');
  });

  it('should reject message transmission to non-existent recipient', async () => {
    await expect(
      messagingService.sendDirectMessage('S001', {
        senderBotId: 'BOT001',
        recipient: 'UNKNOWN_BOT',
        content: 'Ghost message',
      })
    ).rejects.toThrow(BotNotFoundError);
  });

  it('should mark unread messages as read when readInbox is called with markAsRead: true', async () => {
    await messagingService.sendDirectMessage('S001', {
      senderBotId: 'BOT001',
      recipient: 'BOT002',
      content: 'Message to be read',
    });

    const messages = await messagingService.readInbox('S001', 'BOT002', { markAsRead: true });
    expect(messages.length).toBe(1);
    expect(messages[0]?.status).toBe('read');
    expect(messages[0]?.read_at).toBeDefined();

    // Verify stored state in storage
    const rawInbox = await storage.getInbox('S001', 'BOT002');
    expect(rawInbox.messages[0]?.status).toBe('read');
  });

  it('should acknowledge message idempotently', async () => {
    const sent = await messagingService.sendDirectMessage('S001', {
      senderBotId: 'BOT001',
      recipient: 'BOT002',
      content: 'Message requiring ack',
    });

    const acked1 = await messagingService.acknowledgeMessage('S001', 'BOT002', sent.message_id);
    expect(acked1.status).toBe('acknowledged');
    expect(acked1.acknowledged_at).toBeDefined();

    // Second acknowledgement call should succeed idempotently
    const acked2 = await messagingService.acknowledgeMessage('S001', 'BOT002', sent.message_id);
    expect(acked2.status).toBe('acknowledged');
    expect(acked2.acknowledged_at).toBe(acked1.acknowledged_at);
  });

  it('should throw MessageNotFoundError when acknowledging unknown message ID', async () => {
    await expect(
      messagingService.acknowledgeMessage('S001', 'BOT002', 'msg_fake_123')
    ).rejects.toThrow(MessageNotFoundError);
  });

  it('should persist inbox and acknowledgements across restarts', async () => {
    const sent = await messagingService.sendDirectMessage('S001', {
      senderBotId: 'BOT001',
      recipient: 'BOT002',
      content: 'Persistent message',
    });
    await messagingService.acknowledgeMessage('S001', 'BOT002', sent.message_id);

    // Simulate restart with fresh instances
    const freshStorage = new FilesystemSessionStorage(tmpWorkspace);
    const freshMessaging = new MessagingService(freshStorage);

    const reloaded = await freshMessaging.readInbox('S001', 'BOT002');
    expect(reloaded.length).toBe(1);
    expect(reloaded[0]?.message_id).toBe(sent.message_id);
    expect(reloaded[0]?.status).toBe('acknowledged');
  });

  describe('AUD-06: readInbox limit before mutation', () => {
    it('should mark ONLY returned message as read when limit=1 is used with markAsRead: true', async () => {
      // 1. Send three unread messages
      const m1 = await messagingService.sendDirectMessage('S001', {
        senderBotId: 'BOT001',
        recipient: 'BOT002',
        content: 'Message 1',
      });
      const m2 = await messagingService.sendDirectMessage('S001', {
        senderBotId: 'BOT001',
        recipient: 'BOT002',
        content: 'Message 2',
      });
      const m3 = await messagingService.sendDirectMessage('S001', {
        senderBotId: 'BOT001',
        recipient: 'BOT002',
        content: 'Message 3',
      });

      // 2. Read with limit: 1 and markAsRead: true
      const returned = await messagingService.readInbox('S001', 'BOT002', {
        status: 'unread',
        markAsRead: true,
        limit: 1,
      });

      expect(returned).toHaveLength(1);
      expect(returned[0]?.message_id).toBe(m3.message_id);
      expect(returned[0]?.status).toBe('read');

      // 3. Verify in raw storage that M1 and M2 are STILL unread, and only M3 is read
      const rawInbox = await storage.getInbox('S001', 'BOT002');
      const rawM1 = rawInbox.messages.find((m) => m.message_id === m1.message_id);
      const rawM2 = rawInbox.messages.find((m) => m.message_id === m2.message_id);
      const rawM3 = rawInbox.messages.find((m) => m.message_id === m3.message_id);

      expect(rawM1?.status).toBe('unread');
      expect(rawM1?.read_at).toBeUndefined();
      expect(rawM2?.status).toBe('unread');
      expect(rawM2?.read_at).toBeUndefined();
      expect(rawM3?.status).toBe('read');
      expect(rawM3?.read_at).toBeDefined();

      // 4. Reading remaining unread returns M1 and M2
      const remainingUnread = await messagingService.readInbox('S001', 'BOT002', {
        status: 'unread',
      });
      expect(remainingUnread).toHaveLength(2);
      expect(remainingUnread.map((m) => m.message_id)).toEqual([m1.message_id, m2.message_id]);
    });
  });

  describe('AUD-10: Sender identity verification at service boundary', () => {
    it('should reject direct message from unregistered sender bot ID', async () => {
      await expect(
        messagingService.sendDirectMessage('S001', {
          senderBotId: 'BOT_NOT_REGISTERED',
          recipient: 'BOT002',
          content: 'Imposter message',
        })
      ).rejects.toThrow(BotNotFoundError);
    });

    it('should reject direct message from inactive/stopped sender bot', async () => {
      await botService.registerBot('S001', {
        botId: 'BOT_INACTIVE',
        displayName: 'Sleeping Bot',
        status: 'stopped',
      });

      await expect(
        messagingService.sendDirectMessage('S001', {
          senderBotId: 'BOT_INACTIVE',
          recipient: 'BOT002',
          content: 'Message from stopped bot',
        })
      ).rejects.toThrow(/not an active bot/);
    });

    it('should accept direct message from explicit typed principal HUMAN or SYSTEM', async () => {
      const humanMsg = await messagingService.sendDirectMessage('S001', {
        senderBotId: 'HUMAN',
        recipient: 'BOT002',
        content: 'Hello from human operator',
      });
      expect(humanMsg.sender_bot_id).toBe('HUMAN');

      const systemMsg = await messagingService.sendDirectMessage('S001', {
        senderBotId: 'SYSTEM',
        recipient: 'BOT002',
        content: 'System notification',
      });
      expect(systemMsg.sender_bot_id).toBe('SYSTEM');
    });
  });
});
