import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../../src/cli/index.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';

describe('CLI Messaging Commands', () => {
  let tmpWorkspace: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-cli-msg-test-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Prepare session S001 and two bots
    const storage = new FilesystemSessionStorage(tmpWorkspace);
    const sessionService = new SessionService(storage);
    const botService = new BotService(storage);

    await sessionService.createSession({ sessionId: 'S001', sessionName: 'CLI Messaging Lab' });
    await botService.registerBot('S001', { botId: 'BOT001', displayName: 'Broadcaster' });
    await botService.registerBot('S001', { botId: 'BOT002', displayName: 'Receiver' });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should publish and read broadcasts via CLI', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'broadcast',
      'publish',
      'Session milestone reached',
      '--session',
      'S001',
      '--sender',
      'BOT001',
      '--category',
      'DECISION',
      '-w',
      tmpWorkspace,
    ]);

    let logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Broadcast published successfully!');
    expect(logs).toContain('DECISION');
    expect(logs).toContain('Session milestone reached');

    logSpy.mockClear();

    const readProgram = createProgram();
    readProgram.exitOverride();
    await readProgram.parseAsync([
      'node',
      'almudaya',
      'broadcast',
      'read',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const events = JSON.parse(logs);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].content).toBe('Session milestone reached');
  });

  it('should send, read, and acknowledge direct messages via CLI', async () => {
    const program = createProgram();
    program.exitOverride();

    // Send message to Receiver (by display name!)
    await program.parseAsync([
      'node',
      'almudaya',
      'message',
      'send',
      'Receiver',
      'Please start step 2',
      '--session',
      'S001',
      '--sender',
      'BOT001',
      '-w',
      tmpWorkspace,
    ]);

    let logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Message sent successfully!');
    expect(logs).toContain('BOT002'); // Resolved recipient

    logSpy.mockClear();

    // Read inbox as JSON
    const readProgram = createProgram();
    readProgram.exitOverride();
    await readProgram.parseAsync([
      'node',
      'almudaya',
      'message',
      'read',
      'BOT002',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const inbox = JSON.parse(logs);
    expect(Array.isArray(inbox)).toBe(true);
    expect(inbox.length).toBe(1);
    expect(inbox[0].content).toBe('Please start step 2');
    const msgId = inbox[0].message_id;

    logSpy.mockClear();

    // Acknowledge message
    const ackProgram = createProgram();
    ackProgram.exitOverride();
    await ackProgram.parseAsync([
      'node',
      'almudaya',
      'message',
      'ack',
      'BOT002',
      msgId,
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
    ]);

    logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Message acknowledged successfully!');
    expect(logs).toContain('acknowledged');
  });
});
