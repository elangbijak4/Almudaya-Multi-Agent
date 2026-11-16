import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import {
  MasterInterventionQueue,
  PROTOCOL_PRIORITY_ORDER,
  ProtocolSupervisor,
} from '../../src/protocol/index.js';

describe('TC-350-01: ProtocolRegistry & MasterInterventionQueue', () => {
  let tmpRoot: string;
  let supervisor: ProtocolSupervisor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-reg-'));
    const storage = new FilesystemSessionStorage(tmpRoot);
    supervisor = new ProtocolSupervisor({ storage });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('registers all 10 atomic IProtocol instances and configures them uniformly', async () => {
    const expectedIds = [
      'PrBot',
      'PrBotGlobal',
      'PrIterasi',
      'PrDE',
      'PrMEend',
      'PrModerator',
      'PrTransfer',
      'PrMasterFailover',
      'PrGate',
      'PrReattach',
    ] as const;

    const registered = supervisor.registry.listProtocols().map((p) => p.protocolId);
    expect(registered).toHaveLength(10);
    for (const id of expectedIds) {
      expect(supervisor.registry.get(id)).toBeDefined();
    }

    await supervisor.initializeSession('S-REG-1', {
      prBotLimit: 7,
      prIterasiLimit: 12,
      prDeLimit: 8,
    });

    const snapshots = supervisor.registry.getAllSnapshots();
    expect(snapshots['PrBot']?.['prBotLimit']).toBe(7);
    expect(snapshots['PrIterasi']?.['prIterasiLimit']).toBe(12);
    expect(snapshots['PrDE']?.['prDeLimit']).toBe(8);
    expect(snapshots['PrBotGlobal']?.['priority']).toBe(PROTOCOL_PRIORITY_ORDER.PrBotGlobal);
  });

  it('orders MasterInterventionQueue items strictly by priority P0..P5 then FIFO', () => {
    const queue = new MasterInterventionQueue();
    queue.enqueue({
      protocolId: 'PrBot',
      sessionId: 'S1',
      action: 'DENY',
      summary: 'P5 low priority',
    });
    queue.enqueue({
      protocolId: 'PrDE',
      sessionId: 'S1',
      action: 'MASTER_MEDIATION',
      summary: 'P2 dead-end',
    });
    queue.enqueue({
      protocolId: 'PrBotGlobal',
      sessionId: 'S1',
      action: 'ESCALATE_HITL',
      summary: 'P0 critical first',
    });
    queue.enqueue({
      protocolId: 'PrMasterFailover',
      sessionId: 'S1',
      action: 'FAILOVER_SWITCH',
      summary: 'P0 critical second',
    });
    queue.enqueue({
      protocolId: 'PrIterasi',
      sessionId: 'S1',
      action: 'MASTER_TAKEOVER',
      summary: 'P1 iteration takeover',
    });

    expect(queue.dequeue()?.summary).toBe('P0 critical first');
    expect(queue.dequeue()?.summary).toBe('P0 critical second');
    expect(queue.dequeue()?.summary).toBe('P1 iteration takeover');
    expect(queue.dequeue()?.summary).toBe('P2 dead-end');
    expect(queue.dequeue()?.summary).toBe('P5 low priority');
    expect(queue.dequeue()).toBeUndefined();
  });
});
