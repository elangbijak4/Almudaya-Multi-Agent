import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import type { BotRecord } from '../../src/bot/schema.js';
import {
  BudgetTracker,
  PrBotGlobalCeilingProtocol,
  ProtocolStore,
  createDefaultProtocolConfig,
  createDefaultRuntimeState,
} from '../../src/protocol/index.js';

describe('TC-350-03 & TC-350-15: PrBotGlobal Ceiling, Budget & Bot Recycling', () => {
  let tmpRoot: string;
  let store: ProtocolStore;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-prglobal-'));
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('escalates to HITL when hardware concurrency ceiling is reached without idle workers', async () => {
    const tracker = new BudgetTracker(store, () => ({
      cpuCores: 4,
      freeRamMb: 4096,
      totalRamMb: 8192,
    }));
    const protocol = new PrBotGlobalCeilingProtocol(store, tracker);
    const config = createDefaultProtocolConfig({ prBotGlobalMax: 2 });
    const state = createDefaultRuntimeState({ activeGlobalBotCount: 2 });

    const res = await protocol.evaluate({
      sessionId: 'S-PG-1',
      config,
      state,
      activeBotCount: 2,
    });

    expect(res.triggered).toBe(true);
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.action).toBe('ESCALATE_HITL');
  });

  it('TC-350-15: recycles an idle worker instead of hitting HITL when within budget', async () => {
    const tracker = new BudgetTracker(store, () => ({
      cpuCores: 8,
      freeRamMb: 8192,
      totalRamMb: 16384,
    }));
    const protocol = new PrBotGlobalCeilingProtocol(store, tracker);
    const config = createDefaultProtocolConfig({ prBotGlobalMax: 2 });
    const state = createDefaultRuntimeState({ activeGlobalBotCount: 2 });

    const now = new Date().toISOString();
    const bots: BotRecord[] = [
      {
        bot_id: 'BOT000',
        session_id: 'S-PG-2',
        display_name: 'MASTER',
        status: 'active',
        role: 'master',
        joined_at: now,
        last_seen_at: now,
        metadata: {},
      },
      {
        bot_id: 'BOT001',
        session_id: 'S-PG-2',
        display_name: 'Worker1',
        status: 'idle',
        role: 'worker',
        joined_at: now,
        last_seen_at: now,
        metadata: {},
      },
    ];

    const res = await protocol.evaluate({
      sessionId: 'S-PG-2',
      config,
      state,
      activeBotCount: 2,
      registeredBots: bots,
    });

    expect(res.decision.allowed).toBe(true);
    expect(res.decision.metadata?.recycleCandidateBotId).toBe('BOT001');
  });

  it('escalates to HITL when tokenBudget, free RAM floor, or finite globalTimeoutMs is breached', async () => {
    const lowMemTracker = new BudgetTracker(store, () => ({
      cpuCores: 4,
      freeRamMb: 128,
      totalRamMb: 4096,
    }));
    const protocol = new PrBotGlobalCeilingProtocol(store, lowMemTracker);
    const config = createDefaultProtocolConfig({
      tokenBudget: 1000,
      minFreeMemoryMb: 256,
      globalTimeoutMs: 5000,
    });

    const lowRamEval = await protocol.evaluate({
      sessionId: 'S-PG-3',
      config,
      state: createDefaultRuntimeState({ totalTokensUsed: 100 }),
    });
    expect(lowRamEval.decision.allowed).toBe(false);
    expect(lowRamEval.decision.metadata?.limitType).toBe('HARDWARE_MEMORY');

    const okMemTracker = new BudgetTracker(store, () => ({
      cpuCores: 4,
      freeRamMb: 2048,
      totalRamMb: 8192,
    }));
    const proto2 = new PrBotGlobalCeilingProtocol(store, okMemTracker);

    const tokenBreach = await proto2.evaluate({
      sessionId: 'S-PG-3',
      config,
      state: createDefaultRuntimeState({ totalTokensUsed: 1200 }),
    });
    expect(tokenBreach.decision.allowed).toBe(false);
    expect(tokenBreach.decision.metadata?.limitType).toBe('TOKEN_BUDGET');

    const startedAgo = new Date(Date.now() - 10_000).toISOString();
    const timeBreach = await proto2.evaluate({
      sessionId: 'S-PG-3',
      config,
      state: createDefaultRuntimeState({
        sessionStartedAt: startedAgo,
        totalTokensUsed: 10,
      }),
    });
    expect(timeBreach.decision.allowed).toBe(false);
    expect(timeBreach.decision.metadata?.limitType).toBe('TIME_BUDGET');
  });
});
