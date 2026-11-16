import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import {
  PrDeadEndMediationProtocol,
  ProtocolStore,
  createDefaultProtocolConfig,
  createDefaultRuntimeState,
} from '../../src/protocol/index.js';

describe('TC-350-06 & TC-350-17: PrDE Ping-Pong & Circular Zero-Progress Relay', () => {
  let tmpRoot: string;
  let store: ProtocolStore;
  let protocol: PrDeadEndMediationProtocol;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-prde-'));
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
    protocol = new PrDeadEndMediationProtocol(store);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('TC-350-06: triggers MASTER_MEDIATION at prDeLimit and escalates to HITL at prDeEscalationLimit', async () => {
    const config = createDefaultProtocolConfig({
      prDeLimit: 4,
      prDeEscalationLimit: 2,
    });

    const first = await protocol.evaluate({
      sessionId: 'S-DE-1',
      threadId: 'TH-1',
      senderBotId: 'BOT001',
      recipientBotId: 'BOT002',
      exchangeCount: 4,
      config,
      state: createDefaultRuntimeState({ totalPrDeTriggers: 0 }),
    });
    expect(first.triggered).toBe(true);
    expect(first.decision.action).toBe('MASTER_MEDIATION');
    await protocol.enforce(first.decision, {
      sessionId: 'S-DE-1',
      threadId: 'TH-1',
      senderBotId: 'BOT001',
      recipientBotId: 'BOT002',
      exchangeCount: 4,
    });

    const stateAfter = await store.getRuntimeState('S-DE-1');
    expect(stateAfter.threads['TH-1']?.status).toBe('MEDIATING');

    const second = await protocol.evaluate({
      sessionId: 'S-DE-1',
      threadId: 'TH-2',
      exchangeCount: 4,
      config,
      state: createDefaultRuntimeState({ totalPrDeTriggers: 1 }),
    });
    expect(second.decision.action).toBe('ESCALATE_HITL');
  });

  it('TC-350-17: detects circular zero-progress relay when progressDeltaScore stays 0', async () => {
    const config = createDefaultProtocolConfig({
      prDeLimit: 20,
      prNoProgressLimit: 3,
    });
    const state = createDefaultRuntimeState({ noProgressHandoffCount: 2 });

    const res = await protocol.evaluate({
      sessionId: 'S-DE-2',
      threadId: 'TH-CIRCULAR',
      senderBotId: 'BOT003',
      recipientBotId: 'BOT001',
      exchangeCount: 2,
      progressDeltaScore: 0,
      config,
      state,
    });

    expect(res.triggered).toBe(true);
    expect(res.decision.action).toBe('MASTER_MEDIATION');
    expect(res.decision.metadata?.reasonTag).toBe('CIRCULAR_ZERO_PROGRESS');
  });
});
