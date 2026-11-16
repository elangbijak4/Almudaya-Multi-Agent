import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import {
  GoalLedgerService,
  PrMessageEndRoutingProtocol,
  ProtocolStore,
} from '../../src/protocol/index.js';

describe('TC-350-07 & TC-350-08: PrMEend 2-Layer Routing & Deadlock Migration', () => {
  let tmpRoot: string;
  let store: ProtocolStore;
  let ledger: GoalLedgerService;
  let protocol: PrMessageEndRoutingProtocol;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-prme-'));
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
    ledger = new GoalLedgerService(store);
    protocol = new PrMessageEndRoutingProtocol(store, ledger);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('Layer 1 passes normal valid loop messages with 0 escalation overhead (CC: MASTER)', async () => {
    const evalRes = await protocol.evaluate({
      sessionId: 'S-ME-1',
      senderBotId: 'BOT001',
      recipientBotId: 'BOT002',
      recipientExists: true,
      hasSentLoopMessage: true,
      messageContent: 'Silakan review modul auth.ts',
    });

    expect(evalRes.triggered).toBe(false);
    expect(evalRes.decision.allowed).toBe(true);
    expect(evalRes.decision.action).toBe('CONTINUE');
    expect(evalRes.decision.metadata?.layer).toBe(1);
    expect(evalRes.decision.metadata?.ccMaster).toBe(true);
  });

  it('TC-350-07: triggers Layer 2 MASTER_MIGRATE on UNKNOWN recipient or missing end message', async () => {
    const evalUnknown = await protocol.evaluate({
      sessionId: 'S-ME-2',
      senderBotId: 'BOT001',
      recipientBotId: 'UNKNOWN',
      recipientExists: false,
      messageContent: 'Siapa yang menangani deployment DB?',
    });
    expect(evalUnknown.triggered).toBe(true);
    expect(evalUnknown.decision.action).toBe('MASTER_MIGRATE');
    expect(evalUnknown.decision.metadata?.suggestSpawnIfNoMatch).toBe(true);

    const evalMissing = await protocol.evaluate({
      sessionId: 'S-ME-2',
      senderBotId: 'BOT002',
      hasSentLoopMessage: false,
      messageContent: 'Selesai coding tanpa target.',
    });
    expect(evalMissing.triggered).toBe(true);
    expect(evalMissing.decision.action).toBe('MASTER_MIGRATE');
    expect(evalMissing.decision.metadata?.migrationReason).toBe('MISSING_END_MESSAGE');
  });

  it('TC-350-08: blocks premature TASK_0 when GoalLedger has open tasks, allows PrGate handoff when done', async () => {
    const task = await ledger.addTask('S-ME-3', {
      title: 'Implement API endpoint',
      description: 'Create REST handler',
      status: 'IN_PROGRESS',
    });

    const premature = await protocol.evaluate({
      sessionId: 'S-ME-3',
      senderBotId: 'BOT001',
      recipientBotId: 'TASK_0',
      isTaskZero: true,
    });
    expect(premature.triggered).toBe(true);
    expect(premature.decision.allowed).toBe(false);
    expect(premature.decision.action).toBe('MASTER_MIGRATE');
    expect(premature.decision.metadata?.migrationReason).toBe('PREMATURE_TASK_0');

    await ledger.updateTaskStatus('S-ME-3', task.taskId, 'DONE');
    const cleanZero = await protocol.evaluate({
      sessionId: 'S-ME-3',
      senderBotId: 'BOT001',
      recipientBotId: 'TASK_0',
      isTaskZero: true,
    });
    expect(cleanZero.triggered).toBe(true);
    expect(cleanZero.decision.allowed).toBe(true);
    expect(cleanZero.decision.metadata?.triggerPrGate).toBe(true);
  });
});
