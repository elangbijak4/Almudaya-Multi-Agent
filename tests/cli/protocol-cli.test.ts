import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildProtocolConfigFromCliOptions,
  parseModelSpecList,
} from '../../src/cli/commands/up.js';
import { createProgram } from '../../src/cli/index.js';

describe('CLI v0.3.5 `almudaya up` (`start`/`master`) & Protocol Flags', () => {
  let tmpRoot: string | undefined;

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  it('registers `up` command with `start` and `master` aliases and full protocol options', () => {
    const program = createProgram();
    const upCmd = program.commands.find((c) => c.name() === 'up');
    expect(upCmd).toBeDefined();
    expect(upCmd?.aliases()).toContain('start');
    expect(upCmd?.aliases()).toContain('master');

    const help = upCmd!.helpInformation();
    expect(help).toContain('--spawn-mode');
    expect(help).toContain('--max-windows');
    expect(help).toContain('--lazy-master');
    expect(help).toContain('--master-failover');
    expect(help).toContain('--pool');
    expect(help).toContain('--pr-bot');
    expect(help).toContain('--pr-bot-global');
    expect(help).toContain('--pr-iterasi');
    expect(help).toContain('--pr-de');
    expect(help).toContain('--token-budget');
    expect(help).toContain('--time-limit');
    expect(help).toContain('--no-pr-me-end');
    expect(help).toContain('--no-pr-gate');
    expect(help).toContain('--no-reattach');
  });

  it('parses provider:model chains including colons in Ollama tags and validates ProtocolConfig', () => {
    const specs = parseModelSpecList(
      'gemini:gemini-2.5-flash,ollama:qwen2.5-coder:7b,nvidia:deepseek-ai/deepseek-r1'
    );
    expect(specs).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'ollama', model: 'qwen2.5-coder:7b' },
      { provider: 'nvidia', model: 'deepseek-ai/deepseek-r1' },
    ]);

    const cfg = buildProtocolConfigFromCliOptions({
      provider: 'mock',
      model: 'mock-m',
      spawnMode: 'multiplexed',
      maxWindows: '2',
      prBot: '6',
      prBotGlobal: '4',
      prIterasi: '8',
      prDe: '5',
      tokenBudget: '50000',
      timeLimit: 'infinite',
      masterFailover: 'ollama:qwen2.5-coder:7b',
      pool: 'mock:m1,ollama:qwen2.5-coder:7b',
      prMeEnd: true,
      prGate: false,
      reattach: true,
    });

    expect(cfg.spawnMode).toBe('multiplexed');
    expect(cfg.maxWindows).toBe(2);
    expect(cfg.prBotLimit).toBe(6);
    expect(cfg.prBotGlobalMax).toBe(4);
    expect(cfg.prGateEnabled).toBe(false);
    expect(cfg.globalTimeoutMs).toBe('infinite');
  });

  it('executes `up --non-interactive --provider mock` cleanly end-to-end', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-upcli-'));
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'almudaya',
      'up',
      '--session',
      'S-UP-CLI',
      '--workspace',
      tmpRoot,
      '--root',
      tmpRoot,
      '--provider',
      'mock',
      '--lazy-master',
      '--non-interactive',
    ]);

    const configFile = path.join(tmpRoot, 'sessions', 'S-UP-CLI', 'protocol', 'config.json');
    const raw = await fs.readFile(configFile, 'utf-8');
    expect(JSON.parse(raw).masterModel.provider).toBe('mock');
  });
});
