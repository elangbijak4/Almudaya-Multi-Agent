import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import {
  SEND_MESSAGE_TOOL,
  executeSendMessage,
} from '../../src/tools/messaging-tools.js';

describe('Native send_message Tool (Phase 4, NT-03, IDV-01, §13.4, §5.18)', () => {
  let tmpDir: string;
  let storage: FilesystemSessionStorage;
  let botService: BotService;
  let messagingService: MessagingService;
  const sessionId = 'S_MESSAGING_TOOL_TEST';

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `almudaya_msg_tool_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(tmpDir, { recursive: true });

    storage = new FilesystemSessionStorage(tmpDir);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    const now = new Date().toISOString();
    await storage.createSession({
      session_id: sessionId,
      session_name: 'Messaging Tool Test Session',
      created_at: now,
      updated_at: now,
    });

    await botService.registerBot(sessionId, {
      botId: 'B_ALICE',
      displayName: 'Alice',
      status: 'active',
    });
    await botService.registerBot(sessionId, {
      botId: 'B_BOB',
      displayName: 'Bob',
      status: 'active',
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should export standard tool definition conforming to ToolDefinition schema', () => {
    expect(SEND_MESSAGE_TOOL.name).toBe('send_message');
    expect(SEND_MESSAGE_TOOL.description).toContain('direct message');
    expect(SEND_MESSAGE_TOOL.parameters.type).toBe('object');
    expect(SEND_MESSAGE_TOOL.parameters.properties).toHaveProperty('recipient');
    expect(SEND_MESSAGE_TOOL.parameters.properties).toHaveProperty('content');
    expect(SEND_MESSAGE_TOOL.parameters.properties).toHaveProperty('message_type');
    expect(SEND_MESSAGE_TOOL.parameters.required).toContain('recipient');
    expect(SEND_MESSAGE_TOOL.parameters.required).toContain('content');
  });

  it('should execute send_message tool with trusted sender identity from context', async () => {
    const res = await executeSendMessage(
      messagingService,
      sessionId,
      'B_ALICE', // Trusted context sender
      {
        recipient: 'Bob', // By display name
        content: 'Hello Bob from Alice via tool',
        message_type: 'REQUEST',
      }
    );

    expect(res.message_id).toBeDefined();
    expect(res.sender_bot_id).toBe('B_ALICE');
    expect(res.recipient_bot_id).toBe('B_BOB');
    expect(res.status).toBe('unread');
    expect(res.delivery_state).toBe('RECEIVED');

    // Verify recipient inbox
    const bobInbox = await messagingService.readInbox(sessionId, 'B_BOB');
    expect(bobInbox.length).toBe(1);
    expect(bobInbox[0]?.content).toBe('Hello Bob from Alice via tool');
    expect(bobInbox[0]?.sender_bot_id).toBe('B_ALICE');
    expect(bobInbox[0]?.message_type).toBe('REQUEST');
  });

  it('should reject execution when recipient or content is missing', async () => {
    await expect(
      executeSendMessage(messagingService, sessionId, 'B_ALICE', {
        recipient: '',
        content: 'Some message',
      })
    ).rejects.toThrow(/recipient/);

    await expect(
      executeSendMessage(messagingService, sessionId, 'B_ALICE', {
        recipient: 'Bob',
        content: '   ',
      })
    ).rejects.toThrow(/content/);
  });

  it('should reject execution when trusted sender identity is missing (IDV-01)', async () => {
    await expect(
      executeSendMessage(messagingService, sessionId, '', {
        recipient: 'Bob',
        content: 'Attacker spoofing sender',
      })
    ).rejects.toThrow(/trusted senderBotId missing/);
  });
});
