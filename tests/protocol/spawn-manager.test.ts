import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { BotService } from '../../src/bot/service.js';
import {
  ProtocolSupervisor,
  SpawnManager,
  buildOsTerminalLaunchSpec,
} from '../../src/protocol/index.js';
import { SessionService } from '../../src/session/service.js';

describe('TC-350-13: SpawnManager OS Window Builders, --max-windows & Hot-Swap', () => {
  let tmpRoot: string;
  let storage: FilesystemSessionStorage;
  let botService: BotService;
  let supervisor: ProtocolSupervisor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-spawn-'));
    storage = new FilesystemSessionStorage(tmpRoot);
    botService = new BotService(storage);
    supervisor = new ProtocolSupervisor({ storage });
    await new SessionService(storage).createSession({
      sessionId: 'S-SPAWN-1',
      sessionName: 'Spawn Test',
    });
    await supervisor.initializeSession('S-SPAWN-1', {
      spawnMode: 'windows',
      maxWindows: 1,
      prBotLimit: 5,
      prBotGlobalMax: 5,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('builds OS-specific terminal launch commands for win32, darwin, linux, and multiplexed', () => {
    const win = buildOsTerminalLaunchSpec({
      platform: 'win32',
      spawnMode: 'windows',
      title: 'Worker1',
      cliEntrypoint: 'dist/cli/bin.js',
      cliArgs: ['bot', 'run', '--session', 'S1'],
      nodeExecutable: 'node',
    });
    expect(win.command).toBe('cmd.exe');
    expect(win.args).toContain('/k');
    expect(win.detached).toBe(true);

    const mac = buildOsTerminalLaunchSpec({
      platform: 'darwin',
      spawnMode: 'windows',
      title: 'Worker1',
      cliEntrypoint: 'dist/cli/bin.js',
      cliArgs: ['bot', 'run'],
      nodeExecutable: 'node',
    });
    expect(mac.command).toBe('osascript');

    const mux = buildOsTerminalLaunchSpec({
      platform: 'linux',
      spawnMode: 'multiplexed',
      title: 'Worker1',
      cliEntrypoint: 'dist/cli/bin.js',
      cliArgs: ['bot', 'run'],
      nodeExecutable: 'node',
    });
    expect(mux.command).toBe('node');
    expect(mux.stdio).toBe('pipe');
    expect(mux.detached).toBe(false);
  });

  it('enforces --max-windows=1 by opening window for 1st worker then downgrading 2nd worker to multiplexed', async () => {
    const launched: Array<{ command: string; args: string[]; stdio: string }> = [];
    const manager = new SpawnManager({
      botService,
      supervisor,
      platform: 'win32',
      launcher: (cmd, args, opts) => {
        launched.push({ command: cmd, args, stdio: opts.stdio });
        const mockChild = new EventEmitter() as EventEmitter & {
          pid: number;
          kill: () => boolean;
          unref: () => void;
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        mockChild.pid = 5000 + launched.length;
        mockChild.kill = () => true;
        mockChild.unref = () => undefined;
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();
        return mockChild as never;
      },
    });

    const first = await manager.spawnWorker({
      sessionId: 'S-SPAWN-1',
      displayName: 'Coder1',
      model: { provider: 'mock', model: 'm1' },
      workspaceRoots: [tmpRoot],
    });
    expect(first.action).toBe('SPAWNED');
    expect(first.spawnMode).toBe('windows');

    const second = await manager.spawnWorker({
      sessionId: 'S-SPAWN-1',
      displayName: 'Coder2',
      model: { provider: 'mock', model: 'm2' },
      workspaceRoots: [tmpRoot],
    });
    expect(second.action).toBe('SPAWNED');
    expect(second.spawnMode).toBe('multiplexed');
    expect(launched[0]?.command).toBe('cmd.exe');
    expect(launched[1]?.args).toContain('bot');
    expect(launched[1]?.args).toContain('run');
    manager.reapAll();
  });
});
