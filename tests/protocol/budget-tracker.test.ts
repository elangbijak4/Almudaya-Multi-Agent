import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import {
  BudgetTracker,
  ProtocolStore,
  calculateHardwareBotCap,
  createDefaultProtocolConfig,
  createDefaultRuntimeState,
} from '../../src/protocol/index.js';

describe('BudgetTracker & Hardware Bot Cap Calculation', () => {
  let tmpRoot: string;
  let store: ProtocolStore;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-budget-'));
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('scales hardware concurrency ceiling conservatively across low-spec laptops and workstations', () => {
    expect(
      calculateHardwareBotCap({ cpuCores: 2, freeRamMb: 700, totalRamMb: 4096 }, 256)
    ).toBe(1);

    expect(
      calculateHardwareBotCap({ cpuCores: 8, freeRamMb: 4096, totalRamMb: 16384 }, 256)
    ).toBe(7);

    expect(
      calculateHardwareBotCap({ cpuCores: 32, freeRamMb: 65536, totalRamMb: 131072 }, 256)
    ).toBe(12);
  });

  it('supports infinite globalTimeoutMs without spurious time breach and accumulates token usage', async () => {
    const tracker = new BudgetTracker(store, () => ({
      cpuCores: 8,
      freeRamMb: 4096,
      totalRamMb: 16384,
    }));

    const s1 = await tracker.recordTokenUsage('S-BUD-1', 450);
    const s2 = await tracker.recordTokenUsage('S-BUD-1', 250);
    expect(s1.totalTokensUsed).toBe(450);
    expect(s2.totalTokensUsed).toBe(700);

    const cfg = createDefaultProtocolConfig({
      tokenBudget: 1000,
      globalTimeoutMs: 'infinite',
    });
    const oldState = createDefaultRuntimeState({
      sessionStartedAt: '2020-01-01T00:00:00.000Z',
      totalTokensUsed: s2.totalTokensUsed,
    });
    const check = tracker.evaluateBudget(cfg, oldState, Date.now());
    expect(check.allowed).toBe(true);
  });
});
