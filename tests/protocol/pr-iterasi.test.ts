import { describe, expect, it } from 'vitest';
import {
  PrIterasiHandoverProtocol,
  createDefaultProtocolConfig,
  selectNextDistinctModel,
} from '../../src/protocol/index.js';

describe('TC-350-04, TC-350-05 & TC-350-16: PrIterasi & 3-Tier Single-Model Fallback', () => {
  it('TC-350-04: selects distinct untried model on PrIterasi trigger', async () => {
    const protocol = new PrIterasiHandoverProtocol();
    const config = createDefaultProtocolConfig({
      prIterasiLimit: 5,
      prIterasiHandoverLimit: 3,
      modelPool: [
        { provider: 'gemini', model: 'gemini-2.5-flash' },
        { provider: 'nvidia', model: 'deepseek-ai/deepseek-r1' },
      ],
    });

    const evalRes = await protocol.evaluate({
      sessionId: 'S-IT-1',
      botId: 'BOT001',
      taskId: 'TASK-1',
      iteration: 5,
      currentModel: { provider: 'gemini', model: 'gemini-2.5-flash' },
      config,
    });

    expect(evalRes.triggered).toBe(true);
    expect(evalRes.decision.action).toBe('MASTER_TAKEOVER');
    expect(evalRes.decision.metadata?.nextModel).toEqual({
      provider: 'nvidia',
      model: 'deepseek-ai/deepseek-r1',
    });
    expect(evalRes.decision.metadata?.singleModelPoolFallback).toBe(false);
  });

  it('TC-350-16: uses 3-tier fallback when pool contains only 1 model', () => {
    const choice = selectNextDistinctModel(
      [{ provider: 'ollama', model: 'qwen2.5-coder:7b' }],
      ['ollama:qwen2.5-coder:7b'],
      { provider: 'ollama', model: 'qwen2.5-coder:7b' }
    );
    expect(choice?.singleModelPoolFallback).toBe(true);
    expect(choice?.model.model).toBe('qwen2.5-coder:7b');
  });

  it('TC-350-05: escalates to HITL when task handover count reaches prIterasiHandoverLimit', async () => {
    const protocol = new PrIterasiHandoverProtocol();
    const config = createDefaultProtocolConfig({
      prIterasiLimit: 4,
      prIterasiHandoverLimit: 2,
    });

    const res = await protocol.evaluate({
      sessionId: 'S-IT-2',
      botId: 'BOT002',
      taskId: 'TASK-9',
      iteration: 4,
      handoverCount: 2,
      quotaExhausted: true,
      config,
    });

    expect(res.triggered).toBe(true);
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.action).toBe('ESCALATE_HITL');
  });
});
