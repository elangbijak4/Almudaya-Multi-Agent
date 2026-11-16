import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { BotConsole } from '../../src/bot/console.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { MasterAgentOrchestrator } from '../../src/protocol/index.js';
import { SessionService } from '../../src/session/service.js';

describe('Master Startup Modes (Eager vs Lazy), Dual-Seat HITL Console & Slash Commands', () => {
  let tmpRoot: string;
  let storage: FilesystemSessionStorage;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-master-'));
    storage = new FilesystemSessionStorage(tmpRoot);
    await new SessionService(storage).createSession({
      sessionId: 'S-MSTR-1',
      sessionName: 'Master Startup Test',
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('supports eager startup by default and lazy startup activating on objective', async () => {
    const eager = new MasterAgentOrchestrator({
      storage,
      sessionId: 'S-MSTR-1',
      workspaceRoots: [tmpRoot],
      provider: new MockAIProvider('master-eager', [{ text: 'ok' }]),
      lazyMaster: false,
      dryRunSpawn: true,
    });
    const eagerRes = await eager.initializeStartup();
    expect(eagerRes.masterStatus).toBe('ACTIVE_EAGER');
    expect(eager.isMasterBrainActive()).toBe(true);

    // Resuming same live session reattaches without duplicating BOT000
    const resumed = await eager.initializeStartup();
    expect(resumed.masterStatus).toBe('REATTACHED');
    const bots = await eager.botService.listBots('S-MSTR-1');
    expect(bots.filter((b) => b.bot_id === 'BOT000')).toHaveLength(1);
    eager.stop();

    await new SessionService(storage).createSession({
      sessionId: 'S-MSTR-LAZY',
      sessionName: 'Lazy Master Test',
    });
    const lazy = new MasterAgentOrchestrator({
      storage,
      sessionId: 'S-MSTR-LAZY',
      workspaceRoots: [tmpRoot],
      provider: new MockAIProvider('master-lazy', [{ text: 'ok' }]),
      lazyMaster: true,
      dryRunSpawn: true,
    });
    const lazyRes = await lazy.initializeStartup();
    expect(lazyRes.masterStatus).toBe('STANDBY_LAZY');
    expect(lazy.isMasterBrainActive()).toBe(false);

    await lazy.decomposeObjectiveToBlueprint('Build login page');
    expect(lazy.isMasterBrainActive()).toBe(true);
    lazy.stop();
  });

  it('renders HITL [MASTER]> prompt and handles /protocol, /blueprint, /rules, /bots, /moderator', async () => {
    const orch = new MasterAgentOrchestrator({
      storage,
      sessionId: 'S-MSTR-1',
      workspaceRoots: [tmpRoot],
      provider: new MockAIProvider('master-console', [{ text: 'ready' }]),
      dryRunSpawn: true,
    });
    await orch.initializeStartup();
    await orch.decomposeObjectiveToBlueprint('Build auth module', [
      { title: 'Create auth.ts', description: 'Auth logic', targetFiles: ['auth.ts'] },
    ]);

    const runtime = new BotRuntime(storage, {
      sessionId: 'S-MSTR-1',
      botId: 'BOT000',
      displayName: 'MASTER',
      autoAcknowledge: false,
    });
    await runtime.start();

    const inStream = new PassThrough();
    const outStream = new PassThrough();
    let capturedOut = '';
    outStream.on('data', (chunk: Buffer) => {
      capturedOut += chunk.toString('utf8');
    });

    const consoleRepl = new BotConsole({
      runtime,
      storage,
      protocolSupervisor: orch.supervisor,
      spawnManager: orch.spawnManager,
      isMasterConsole: true,
      inputStream: inStream,
      outputStream: outStream,
    });

    expect(consoleRepl.promptString).toBe('HITL [MASTER]> ');

    await consoleRepl.dispatchSlashCommand('/protocol');
    await consoleRepl.dispatchSlashCommand('/blueprint');
    await consoleRepl.dispatchSlashCommand('/rules add HARD_STOP No console.log in prod');
    await consoleRepl.dispatchSlashCommand('/rules');
    await consoleRepl.dispatchSlashCommand('/bots');
    await consoleRepl.dispatchSlashCommand('/moderator');

    expect(capturedOut).toContain('Unified Natural Lifecycle');
    expect(capturedOut).toContain('Create auth.ts');
    expect(capturedOut).toContain('No console.log in prod');
    expect(capturedOut).toContain('BOT000');

    await consoleRepl.stop();
    orch.stop();
  });
});
