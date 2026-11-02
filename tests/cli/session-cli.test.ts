import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../../src/cli/index.js';

describe('CLI Session Commands', () => {
  let tmpWorkspace: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-cli-test-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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

  it('should create a session via CLI', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'session',
      'create',
      'Test CLI Session',
      '--id',
      'S001',
      '--description',
      'Created via test',
      '--workspace',
      tmpWorkspace,
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Session created successfully!');
    expect(logs).toContain('S001');
    expect(logs).toContain('Test CLI Session');
  });

  it('should inspect an existing session via CLI with JSON output', async () => {
    const program = createProgram();
    program.exitOverride();

    // Create session first
    await program.parseAsync([
      'node',
      'almudaya',
      'session',
      'create',
      'Inspectable',
      '--id',
      'S002',
      '-w',
      tmpWorkspace,
    ]);

    logSpy.mockClear();

    // Inspect
    const inspectProgram = createProgram();
    inspectProgram.exitOverride();
    await inspectProgram.parseAsync([
      'node',
      'almudaya',
      'session',
      'inspect',
      'S002',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const parsed = JSON.parse(logs);
    expect(parsed.session_id).toBe('S002');
    expect(parsed.session_name).toBe('Inspectable');
    expect(parsed.status).toBe('active');
  });

  it('should list sessions via CLI with JSON output', async () => {
    const program = createProgram();
    program.exitOverride();

    // Create two sessions
    await program.parseAsync([
      'node',
      'almudaya',
      'session',
      'create',
      'Alpha',
      '--id',
      'S001',
      '-w',
      tmpWorkspace,
    ]);

    const program2 = createProgram();
    program2.exitOverride();
    await program2.parseAsync([
      'node',
      'almudaya',
      'session',
      'create',
      'Beta',
      '--id',
      'S002',
      '-w',
      tmpWorkspace,
    ]);

    logSpy.mockClear();

    const listProgram = createProgram();
    listProgram.exitOverride();
    await listProgram.parseAsync([
      'node',
      'almudaya',
      'session',
      'list',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const list = JSON.parse(logs);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(2);
  });

  it('should support --session flag for create and inspect', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'session',
      'create',
      'My Custom Session',
      '--session',
      'S003',
      '-w',
      tmpWorkspace,
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Session created successfully!');
    expect(logs).toContain('S003');

    logSpy.mockClear();

    const inspectProgram = createProgram();
    inspectProgram.exitOverride();
    await inspectProgram.parseAsync([
      'node',
      'almudaya',
      'session',
      'inspect',
      '--session',
      'S003',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    const inspectLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const details = JSON.parse(inspectLogs);
    expect(details.session_id).toBe('S003');
    expect(details.session_name).toBe('My Custom Session');
  });
});
