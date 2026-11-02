import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../../src/cli/index.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';

describe('CLI Shared Context Commands', () => {
  let tmpWorkspace: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-cli-context-test-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create session S001
    const storage = new FilesystemSessionStorage(tmpWorkspace);
    const sessionService = new SessionService(storage);
    await sessionService.createSession({ sessionId: 'S001', sessionName: 'CLI Context Lab' });
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

  it('should add and list project roots via CLI', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'context',
      'root',
      'add',
      'Web App',
      './frontend',
      '--id',
      'web',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
    ]);

    let logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Project root registered successfully!');
    expect(logs).toContain('web');

    logSpy.mockClear();

    const listProgram = createProgram();
    listProgram.exitOverride();
    await listProgram.parseAsync([
      'node',
      'almudaya',
      'context',
      'root',
      'list',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const roots = JSON.parse(logs);
    expect(Array.isArray(roots)).toBe(true);
    expect(roots.length).toBe(1);
    expect(roots[0].root_id).toBe('web');

    logSpy.mockClear();

    // Test flags --name and --path format
    const flagProgram = createProgram();
    flagProgram.exitOverride();
    await flagProgram.parseAsync([
      'node',
      'almudaya',
      'context',
      'root',
      'add',
      '--session',
      'S001',
      '--name',
      'testing',
      '--path',
      'D:\\testingbot',
      '-w',
      tmpWorkspace,
    ]);

    logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('Project root registered successfully!');
    expect(logs).toContain('testing');
  });

  it('should set and show environment metadata via CLI with secret redaction', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'context',
      'env',
      'set',
      '--session',
      'S001',
      '--var',
      'APP_STAGE=staging',
      '--var',
      'API_TOKEN=super_secret_token',
      '-w',
      tmpWorkspace,
    ]);

    logSpy.mockClear();

    const showProgram = createProgram();
    showProgram.exitOverride();
    await showProgram.parseAsync([
      'node',
      'almudaya',
      'context',
      'env',
      'show',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const envMeta = JSON.parse(logs);
    expect(envMeta.variables['APP_STAGE']).toBe('staging');
    expect(envMeta.variables['API_TOKEN']).toBe('[REDACTED]');
  });

  it('should add and list SDLC documents via CLI', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'context',
      'doc',
      'add',
      'System Architecture',
      'docs/architecture.md',
      '--id',
      'arch-doc',
      '--type',
      'ARCHITECTURE',
      '--doc-version',
      '1.0.0',
      '--status',
      'approved',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
    ]);

    let logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('SDLC document reference registered successfully!');
    expect(logs).toContain('arch-doc');

    logSpy.mockClear();

    const listProgram = createProgram();
    listProgram.exitOverride();
    await listProgram.parseAsync([
      'node',
      'almudaya',
      'context',
      'doc',
      'list',
      '--session',
      'S001',
      '-w',
      tmpWorkspace,
      '--json',
    ]);

    logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const docs = JSON.parse(logs);
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBe(1);
    expect(docs[0].document_id).toBe('arch-doc');
    expect(docs[0].document_type).toBe('ARCHITECTURE');
  });
});
