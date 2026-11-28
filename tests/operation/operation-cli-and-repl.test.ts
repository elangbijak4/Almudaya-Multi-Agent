import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { BotConsole } from '../../src/bot/console.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { createProgram } from '../../src/cli/index.js';
import { SessionService } from '../../src/session/service.js';

describe('Operation v0.3 CLI (`almudaya operation`, `almudaya up --operation`) & Console `/operation`', () => {
  let tmpRoot: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  it('registers `operation` subcommands and `--operation` flag on `up`', () => {
    const program = createProgram();
    const opCmd = program.commands.find((c) => c.name() === 'operation');
    expect(opCmd).toBeDefined();
    const subNames = opCmd!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining([
        'list',
        'inspect',
        'validate',
        'apply',
        'status',
        'evaluate',
        'crystallize',
      ])
    );

    const upHelp = program.commands.find((c) => c.name() === 'up')!.helpInformation();
    expect(upHelp).toContain('--operation');
    expect(upHelp).toContain('--operation-params');
  });

  it('runs `almudaya up --operation #Operation-looping --non-interactive` and `operation evaluate/status --json`', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-opcli-'));
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      logs.push(String(msg ?? ''));
    });

    const program = createProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'almudaya',
      'up',
      '--session',
      'S-OP-CLI',
      '--workspace',
      tmpRoot,
      '--root',
      tmpRoot,
      '--provider',
      'mock',
      '--lazy-master',
      '--operation',
      '#Operation-looping',
      '--non-interactive',
    ]);

    logs.length = 0;
    await program.parseAsync([
      'node',
      'almudaya',
      'operation',
      'status',
      '--session',
      'S-OP-CLI',
      '--workspace',
      tmpRoot,
      '--json',
    ]);
    const statusJson = JSON.parse(logs.join('\n')) as {
      operationId: string;
      status: string;
      seededTaskIds: string[];
    };
    expect(statusJson.operationId).toBe('almudaya.operation.looping');
    expect(statusJson.status).toBe('running_l1');
    expect(statusJson.seededTaskIds).toEqual(['plan', 'implement', 'test', 'review', 'evaluate']);

    logs.length = 0;
    await program.parseAsync([
      'node',
      'almudaya',
      'operation',
      'evaluate',
      '--session',
      'S-OP-CLI',
      '--workspace',
      tmpRoot,
      '--json',
    ]);
    const evalJson = JSON.parse(logs.join('\n')) as {
      operationId: string;
      termination: { success: boolean; failure: boolean };
      loops: Array<{ id: string; continuation: boolean }>;
    };
    expect(evalJson.operationId).toBe('almudaya.operation.looping');
    expect(evalJson.termination.success).toBe(false);
    expect(evalJson.loops[0]!.continuation).toBe(true);
  });

  it('executes `/operation list`, `/operation apply`, `/operation status`, `/operation validate`, and `/operation crystallize` in BotConsole REPL', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-oprepl-'));
    const storage = new FilesystemSessionStorage(tmpRoot);
    await new SessionService(storage).createSession({
      sessionId: 'S-OP-REPL',
      sessionName: 'op-repl',
    });

    const input = new PassThrough();
    const output = new PassThrough();
    let capturedOut = '';
    output.on('data', (chunk) => {
      capturedOut += chunk.toString('utf-8');
    });

    const runtime = new BotRuntime(storage, {
      sessionId: 'S-OP-REPL',
      botId: 'BOT000',
      displayName: 'MASTER',
    });
    const consoleUi = new BotConsole({
      runtime,
      storage,
      inputStream: input,
      outputStream: output,
      isMasterConsole: true,
    });

    await consoleUi.dispatchSlashCommand('/operation list');
    expect(capturedOut).toContain('almudaya.operation.emergent-bug-hunt');

    await consoleUi.dispatchSlashCommand('/operation apply #Operation-emergentBugHunt');
    expect(capturedOut).toContain('almudaya.operation.emergent-bug-hunt@0.3.0');

    await consoleUi.dispatchSlashCommand('/operation status');
    expect(capturedOut).toContain('Status: running_l1');

    await consoleUi.dispatchSlashCommand('/operation validate');
    expect(capturedOut).toContain('VALID (0 galat)');

    await consoleUi.dispatchSlashCommand('/operation crystallize almudaya.operation.custom-bug-hunt');
    expect(capturedOut).toContain('Dikristalisasi: almudaya.operation.custom-bug-hunt@0.3.0');

    await consoleUi.stop();
  });
});
