import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import {
  GoalLedgerService,
  PrObjectiveGateProtocol,
  ProtocolStore,
} from '../../src/protocol/index.js';

describe('TC-350-18: PrGate Objective Completion Gate Verification', () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let store: ProtocolStore;
  let ledger: GoalLedgerService;
  let gate: PrObjectiveGateProtocol;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-prgate-'));
    workspaceDir = path.join(tmpRoot, 'proj');
    await fs.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
    ledger = new GoalLedgerService(store);
    gate = new PrObjectiveGateProtocol(store, ledger);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('rejects GOAL_ACHIEVED if tasks are incomplete or targetFiles do not exist or are empty', async () => {
    const task = await ledger.addTask('S-GATE-1', {
      title: 'Create calculator module',
      description: 'Write src/calc.ts',
      targetFiles: ['src/calc.ts'],
      status: 'DONE',
    });

    // Missing file on disk despite AI claiming DONE
    const missingEval = await gate.evaluate({
      sessionId: 'S-GATE-1',
      workspaceRoots: [workspaceDir],
    });
    expect(missingEval.decision.allowed).toBe(false);
    expect(missingEval.decision.action).toBe('GATE_FAILED');

    // Empty 0-byte file on disk
    await fs.writeFile(path.join(workspaceDir, 'src', 'calc.ts'), '', 'utf-8');
    const emptyEval = await gate.evaluate({
      sessionId: 'S-GATE-1',
      workspaceRoots: [workspaceDir],
    });
    expect(emptyEval.decision.allowed).toBe(false);

    // Valid non-empty file, plus a second incomplete task
    await fs.writeFile(
      path.join(workspaceDir, 'src', 'calc.ts'),
      'export const add = (a: number, b: number) => a + b;\n',
      'utf-8'
    );
    const task2 = await ledger.addTask('S-GATE-1', {
      title: 'Add unit tests',
      description: 'pending test',
      status: 'IN_PROGRESS',
    });
    const openEval = await gate.evaluate({
      sessionId: 'S-GATE-1',
      workspaceRoots: [workspaceDir],
    });
    expect(openEval.decision.allowed).toBe(false);
    expect(openEval.decision.metadata?.incompleteTaskIds).toContain(task2.taskId);

    // Finish task2 -> Gate passes
    await ledger.updateTaskStatus('S-GATE-1', task2.taskId, 'DONE');
    const passed = await gate.evaluate({
      sessionId: 'S-GATE-1',
      workspaceRoots: [workspaceDir],
    });
    expect(task.status).toBe('DONE');
    expect(passed.decision.allowed).toBe(true);
    expect(passed.decision.action).toBe('GOAL_ACHIEVED');
  });
});
