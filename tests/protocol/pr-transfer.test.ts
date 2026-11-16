import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import {
  GoalLedgerService,
  PrModeratorArbitrationProtocol,
  PrTaskTokenTransferProtocol,
  ProtocolStore,
  TaskCheckpointManager,
} from '../../src/protocol/index.js';

describe('TC-350-11 & TC-350-12: PrTransfer Envelope, Epoch Bump & Checkpoint Restore', () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let store: ProtocolStore;
  let checkpoints: TaskCheckpointManager;
  let moderator: PrModeratorArbitrationProtocol;
  let ledger: GoalLedgerService;
  let prTransfer: PrTaskTokenTransferProtocol;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-prxfer-'));
    workspaceDir = path.join(tmpRoot, 'project');
    await fs.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
    store = new ProtocolStore(new FilesystemSessionStorage(tmpRoot));
    checkpoints = new TaskCheckpointManager(store);
    moderator = new PrModeratorArbitrationProtocol(store);
    ledger = new GoalLedgerService(store);
    prTransfer = new PrTaskTokenTransferProtocol(store, moderator, ledger, checkpoints);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('TC-350-11: atomically transfers CapabilityToken (epoch+1) & invalidates previous holder token', async () => {
    const task = await ledger.addTask('S-XF-1', {
      title: 'Build parser',
      description: 'Write JSON parser',
      assignedBotId: 'BOT001',
      status: 'IN_PROGRESS',
    });

    const tok1 = await moderator.issueToken('S-XF-1', {
      taskId: task.taskId,
      holderBotId: 'BOT001',
      allowedPaths: ['src/**'],
    });

    const envelope = await prTransfer.createAndCommitTransfer({
      sessionId: 'S-XF-1',
      taskId: task.taskId,
      fromBotId: 'BOT001',
      toBotId: 'BOT002',
      lastCompletedStep: 'Drafted lexer interface',
      pendingNextStep: 'Implement recursive descent parser & tests',
      touchedFiles: [{ path: 'src/lexer.ts', status: 'CLEAN' }],
      existingTokenId: tok1.tokenId,
    });

    expect(envelope.capabilityToken.holderBotId).toBe('BOT002');
    expect(envelope.capabilityToken.fenceEpoch).toBeGreaterThan(tok1.fenceEpoch);
    expect(envelope.lastWorkPositionLog.progressDeltaScore).toBeGreaterThan(0);

    // Old token invalidated immediately
    const oldCheck = await moderator.validateWriteAccess('S-XF-1', {
      botId: 'BOT001',
      tokenId: tok1.tokenId,
      targetPath: 'src/lexer.ts',
    });
    expect(oldCheck.allowed).toBe(false);

    // New holder token active
    const newCheck = await moderator.validateWriteAccess('S-XF-1', {
      botId: 'BOT002',
      tokenId: envelope.capabilityToken.tokenId,
      fenceEpoch: envelope.capabilityToken.fenceEpoch,
      targetPath: 'src/lexer.ts',
    });
    expect(newCheck.allowed).toBe(true);
  });

  it('TC-350-12: restores workspace files to clean pre-task checkpoint during PR_ITERASI_TAKEOVER', async () => {
    const targetFile = path.join(workspaceDir, 'src', 'app.ts');
    await fs.writeFile(targetFile, 'export const version = 1;\n', 'utf-8');

    await checkpoints.captureBeforeMutation(
      'S-XF-2',
      'TASK-CKPT',
      [{ root_id: 'main', path: workspaceDir }],
      'src/app.ts'
    );

    // Simulate corrupt partial edit by failing BOT001
    await fs.writeFile(targetFile, 'CORRUPTED BY LOOPING WORKER\n', 'utf-8');

    const envelope = await prTransfer.createAndCommitTransfer({
      sessionId: 'S-XF-2',
      taskId: 'TASK-CKPT',
      fromBotId: 'BOT001',
      toBotId: 'BOT002',
      transferKind: 'PR_ITERASI_TAKEOVER',
      lastCompletedStep: 'BOT001 stalled mid-refactor',
      pendingNextStep: 'Rewrite src/app.ts from restored clean baseline',
      checkpointIdToRestore: 'TASK-CKPT',
      workspaceRoots: [workspaceDir],
    });

    expect(envelope.checkpointRestored).toBe(true);
    const restoredContent = await fs.readFile(targetFile, 'utf-8');
    expect(restoredContent).toBe('export const version = 1;\n');
  });
});
