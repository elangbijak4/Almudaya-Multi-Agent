import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../../src/cli/index.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';

describe('CLI Bot Commands', () => {
  let tmpWorkspace: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-cli-bot-test-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create session S001
    const storage = new FilesystemSessionStorage(tmpWorkspace);
    const sessionService = new SessionService(storage);
    await sessionService.createSession({
      sessionId: 'S001',
      sessionName: 'CLI Bot Test Session',
    });
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

  it('should join/start a bot via CLI', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'bot',
      'join',
      '--session',
      'S001',
      '--bot',
      'BOT001',
      '--name',
      'Architect Bot',
      '--description',
      'System Planner',
      '-w',
      tmpWorkspace,
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Bot joined session successfully!');
    expect(logs).toContain('BOT001');
    expect(logs).toContain('Architect Bot');
  });

  it('should list bots via CLI with JSON output', async () => {
    const program = createProgram();
    program.exitOverride();

    // Register two bots
    await program.parseAsync([
      'node',
      'almudaya',
      'bot',
      'start',
      '--session',
      'S001',
      '--bot',
      'BOT001',
      '-w',
      tmpWorkspace,
    ]);

    const program2 = createProgram();
    program2.exitOverride();
    await program2.parseAsync([
      'node',
      'almudaya',
      'bot',
      'start',
      '--session',
      'S001',
      '--bot',
      'BOT002',
      '-w',
      tmpWorkspace,
    ]);

    logSpy.mockClear();

    const listProgram = createProgram();
    listProgram.exitOverride();
    await listProgram.parseAsync([
      'node',
      'almudaya',
      'bot',
      'list',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const bots = JSON.parse(logs);
    expect(Array.isArray(bots)).toBe(true);
    expect(bots.length).toBe(2);
    expect(bots[0].bot_id).toBe('BOT001');
    expect(bots[1].bot_id).toBe('BOT002');
  });

  it('should inspect a bot via CLI with JSON output', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'bot',
      'join',
      '--session',
      'S001',
      '--bot',
      'BOT001',
      '--name',
      'Lead Bot',
      '-w',
      tmpWorkspace,
    ]);

    logSpy.mockClear();

    const inspectProgram = createProgram();
    inspectProgram.exitOverride();
    await inspectProgram.parseAsync([
      'node',
      'almudaya',
      'bot',
      'inspect',
      'Lead Bot',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const inspected = JSON.parse(logs);
    expect(inspected.bot_id).toBe('BOT001');
    expect(inspected.display_name).toBe('Lead Bot');
  });

  it('should rename a bot via CLI without altering Bot ID', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'bot',
      'join',
      '--session',
      'S001',
      '--bot',
      'BOT001',
      '--name',
      'Old Name',
      '-w',
      tmpWorkspace,
    ]);

    logSpy.mockClear();

    const renameProgram = createProgram();
    renameProgram.exitOverride();
    await renameProgram.parseAsync([
      'node',
      'almudaya',
      'bot',
      'rename',
      'BOT001',
      'New Name',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Bot renamed successfully!');
    expect(logs).toContain('BOT001');
    expect(logs).toContain('New Name');
  });

  it('should expose AI provider, model, and mode options in bot run (FR-218)', () => {
    const program = createProgram();
    const botCmd = program.commands.find((c) => c.name() === 'bot');
    const runCmd = botCmd?.commands.find((c) => c.name() === 'run');

    expect(runCmd).toBeDefined();
    const optionNames = runCmd?.options.map((o) => o.name());
    expect(optionNames).toContain('provider');
    expect(optionNames).toContain('model');
    expect(optionNames).toContain('mode');
    expect(optionNames).toContain('max-iterations');
  });
});
