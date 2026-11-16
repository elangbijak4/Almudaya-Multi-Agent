import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FailoverAIProvider,
  MasterFailoverExhaustedError,
} from '../../src/ai/failover-provider.js';
import type { IAIModelProvider } from '../../src/ai/provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import {
  PrMasterFailoverProtocol,
  ProtocolStore,
} from '../../src/protocol/index.js';

describe('TC-350-20: FailoverAIProvider & PrMasterFailover Chain', () => {
  let tmpRoot: string;
  let store: ProtocolStore;
  let protocol: PrMasterFailoverProtocol;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-failover-'));
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
    protocol = new PrMasterFailoverProtocol(store);
    await store.saveConfig('S-FAIL-1', {
      ...(await store.getConfig('S-FAIL-1')),
      masterModel: { provider: 'gemini', model: 'gemini-2.5-flash' },
      masterFailoverChain: [
        { provider: 'nvidia', model: 'deepseek-r1' },
        { provider: 'ollama', model: 'qwen2.5-coder:7b' },
      ],
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('automatically fails over across chain when primary endpoints return 402/429/503', async () => {
    const p1: IAIModelProvider = {
      providerId: 'gemini',
      modelName: 'gemini-2.5-flash',
      generateResponse: async () => {
        throw Object.assign(new Error('429 rate limit'), { status: 429 });
      },
    };
    const p2: IAIModelProvider = {
      providerId: 'nvidia',
      modelName: 'deepseek-r1',
      generateResponse: async () => {
        throw Object.assign(new Error('503 backend down'), { status: 503 });
      },
    };
    const p3: IAIModelProvider = {
      providerId: 'ollama',
      modelName: 'qwen2.5-coder:7b',
      generateResponse: async () => ({ text: 'Recovered via Ollama local master!' }),
    };

    const switched: string[] = [];
    const failover = new FailoverAIProvider({
      sessionId: 'S-FAIL-1',
      prMasterFailover: protocol,
      candidates: [
        { spec: { provider: 'gemini', model: 'gemini-2.5-flash' }, provider: p1 },
        { spec: { provider: 'nvidia', model: 'deepseek-r1' }, provider: p2 },
        { spec: { provider: 'ollama', model: 'qwen2.5-coder:7b' }, provider: p3 },
      ],
      onSwitch: (from, to) => switched.push(`${from.provider}->${to.provider}`),
    });

    const resp = await failover.generateResponse({
      messages: [{ role: 'user', content: 'Plan sprint' }],
    });

    expect(resp.text).toBe('Recovered via Ollama local master!');
    expect(switched).toEqual(['gemini->nvidia', 'nvidia->ollama']);
    expect(failover.providerId).toBe('ollama');
  });

  it('throws MasterFailoverExhaustedError and sets PAUSED_MASTER_UNAVAILABLE when all candidates fail', async () => {
    const pFail: IAIModelProvider = {
      providerId: 'gemini',
      modelName: 'gemini-2.5-flash',
      generateResponse: async () => {
        throw new Error('402 insufficient balance');
      },
    };

    const failover = new FailoverAIProvider({
      sessionId: 'S-FAIL-1',
      prMasterFailover: protocol,
      candidates: [
        { spec: { provider: 'gemini', model: 'gemini-2.5-flash' }, provider: pFail },
      ],
    });

    await expect(
      failover.generateResponse({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(MasterFailoverExhaustedError);

    const state = await store.getRuntimeState('S-FAIL-1');
    expect(state.macroLoopStatus).toBe('PAUSED_MASTER_UNAVAILABLE');
  });
});
