import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { createProgram } from '../../src/cli/index.js';

describe('CLI message read --no-mark-read Flag (NT-01, FR-325)', () => {
  let workspaceRoot: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const sessionId = 'SES_CLI_READ_01';

  beforeEach(async () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    workspaceRoot = path.join(
      os.tmpdir(),
      `almudaya_cliread_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    storage = new FilesystemSessionStorage(workspaceRoot);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    await sessionService.createSession({ sessionId, sessionName: 'CLI read flag test' });
    await botService.registerBot(sessionId, {
      botId: 'B001',
      displayName: 'Receiver',
      status: 'active'
    });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    try {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should accept --no-mark-read flag without Commander error and leave message status as unread', async () => {
    const msg = await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'OPERATOR',
      recipient: 'B001',
      content: 'Inspection only message'
    });

    const program = createProgram();
    program.exitOverride();

    // Call CLI command with --no-mark-read
    await program.parseAsync([
      'node',
      'almudaya',
      'message',
      'read',
      '--session',
      sessionId,
      '--bot',
      'B001',
      '--workspace',
      workspaceRoot,
      '--no-mark-read',
      '--json'
    ]);

    // Check inbox on disk directly: message MUST still be unread
    const inbox = await messagingService.readInbox(sessionId, 'B001', { markAsRead: false });
    const target = inbox.find((m) => m.message_id === msg.message_id);

    expect(target).toBeDefined();
    expect(target?.status).toBe('unread');
    expect(target?.read_at).toBeUndefined();
  });

  it('should mark message as read by default when --no-mark-read is omitted', async () => {
    const msg = await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'OPERATOR',
      recipient: 'B001',
      content: 'Normal read message'
    });

    const program = createProgram();
    program.exitOverride();

    // Call CLI command without --no-mark-read
    await program.parseAsync([
      'node',
      'almudaya',
      'message',
      'read',
      '--session',
      sessionId,
      '--bot',
      'B001',
      '--workspace',
      workspaceRoot,
      '--json'
    ]);

    // Check inbox on disk: message MUST now be read
    const inbox = await messagingService.readInbox(sessionId, 'B001', { markAsRead: false });
    const target = inbox.find((m) => m.message_id === msg.message_id);

    expect(target).toBeDefined();
    expect(target?.status).toBe('read');
    expect(target?.read_at).toBeDefined();
  });
});
