import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { generateMessageId, type DirectMessage } from '../../src/messaging/schema.js';
import { MasterAgentOrchestrator } from '../../src/protocol/index.js';
import { SessionService } from '../../src/session/service.js';

describe('E2E Unified Natural Lifecycle (Single-Cycle L=1 vs Multi-Cycle Macro-Loop L>1)', () => {
  let tmpRoot: string;
  let projectDir: string;
  let storage: FilesystemSessionStorage;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-e2e-macro-'));
    projectDir = path.join(tmpRoot, 'app');
    await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
    storage = new FilesystemSessionStorage(tmpRoot);
    await new SessionService(storage).createSession({
      sessionId: 'S-E2E-LIFE',
      sessionName: 'Unified Natural Lifecycle E2E',
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('Case A (Natural L=1): completes clean single-turn objective & passes PrGate without macro-loop churn', async () => {
    const orch = new MasterAgentOrchestrator({
      storage,
      sessionId: 'S-E2E-LIFE',
      workspaceRoots: [projectDir],
      provider: new MockAIProvider('master', [{ text: 'Objective verified.' }]),
      dryRunSpawn: true,
    });
    await orch.initializeStartup();
    await orch.sharedContextService.registerProjectRoot('S-E2E-LIFE', {
      name: 'App',
      path: projectDir,
      rootType: 'primary',
    });

    const ledger = await orch.decomposeObjectiveToBlueprint('Create hello.ts utility', [
      {
        taskId: 'TASK-HELLO',
        title: 'Create hello helper',
        description: 'Write src/hello.ts',
        targetFiles: ['src/hello.ts'],
      },
    ]);
    const taskId = ledger.tasks[0]!.taskId;

    const spawnRes = await orch.dispatchTaskToNewWorker({
      taskId,
      displayName: 'SoloWorker',
      model: { provider: 'mock', model: 'mock-solo' },
      allowedPaths: ['src/**'],
    });
    expect(spawnRes.botId).toBeDefined();

    const workerProvider = new MockAIProvider('mock-solo', [
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'write_file',
            arguments: {
              path: 'src/hello.ts',
              content: 'export const greet = (name: string) => `Hello ${name}`;\n',
            },
          },
          {
            id: 'tc2',
            name: 'update_goal_task',
            arguments: {
              task_id: taskId,
              status: 'DONE',
              last_completed_step: 'Wrote src/hello.ts',
              pending_next_step: 'Send TASK_0 verification signal',
            },
          },
          {
            id: 'tc3',
            name: 'submit_task_handoff',
            arguments: {
              task_id: taskId,
              recipient: 'TASK_0',
              last_completed_step: 'Wrote src/hello.ts & marked DONE',
              pending_next_step: 'Run PrGate verification',
              summary: 'Work complete, requesting closure (TASK_0).',
            },
          },
        ],
      },
      { text: 'Single-turn implementation finished cleanly (L=1).' },
    ]);

    const workerLoop = new AutonomousAgentLoop({
      sessionId: 'S-E2E-LIFE',
      botId: spawnRes.botId!,
      storage,
      provider: workerProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      protocolSupervisor: orch.supervisor,
      activeTaskId: taskId,
      activeTokenId: spawnRes.capabilityToken?.tokenId,
      enablePkuSync: false,
    });

    const now = new Date().toISOString();
    const incoming: DirectMessage = {
      message_id: generateMessageId(),
      session_id: 'S-E2E-LIFE',
      sender_bot_id: 'BOT000',
      recipient_bot_id: spawnRes.botId!,
      timestamp: now,
      message_type: 'REQUEST',
      task_id: taskId,
      transfer_envelope: spawnRes.capabilityToken
        ? {
            transferId: 'XFER-INIT',
            fromBotId: 'BOT000',
            toBotId: spawnRes.botId!,
            transferKind: 'NORMAL_HANDOFF',
            capabilityToken: spawnRes.capabilityToken,
            lastWorkPositionLog: {
              taskId,
              lastCompletedStep: 'Task assigned by Master',
              pendingNextStep: 'Write src/hello.ts',
              touchedFiles: [],
              progressDeltaScore: 1,
              recordedAt: now,
            },
            checkpointRestored: false,
          }
        : undefined,
      content: 'Implement src/hello.ts',
      status: 'read',
      metadata: {},
      delivery_state: 'PROCESSING',
      attempt_count: 1,
      max_attempts: 1,
      fence_token: 1,
      lease_owner: 'test',
      lease_expires_at: null,
      last_attempt_at: now,
      last_error: null,
    };

    const reply = await workerLoop.handleMessage(incoming);
    expect(reply).toContain('L=1');

    const gateEval = await orch.evaluateObjectiveCompletion();
    expect(gateEval.decision.allowed).toBe(true);
    expect(gateEval.decision.action).toBe('GOAL_ACHIEVED');

    const state = await orch.supervisor.store.getRuntimeState('S-E2E-LIFE');
    expect(state.macroLoopStatus).toBe('GOAL_ACHIEVED');
    orch.stop();
  });

  it('Case B (Macro-Loop L>1): handles PrIterasi takeover, checkpoint restore, write fencing & final PrGate pass', async () => {
    await new SessionService(storage).createSession({
      sessionId: 'S-E2E-LOOP',
      sessionName: 'Macro-Loop Recovery E2E',
    });

    const targetFile = path.join(projectDir, 'src', 'engine.ts');
    await fs.writeFile(targetFile, 'export const status = "clean";\n', 'utf-8');

    const orch = new MasterAgentOrchestrator({
      storage,
      sessionId: 'S-E2E-LOOP',
      workspaceRoots: [projectDir],
      provider: new MockAIProvider('master', [{ text: 'Coordinating.' }]),
      configOverrides: {
        prIterasiLimit: 2,
        prIterasiHandoverLimit: 3,
        modelPool: [
          { provider: 'mock', model: 'weak-model' },
          { provider: 'mock', model: 'strong-model' },
        ],
      },
      dryRunSpawn: true,
    });
    await orch.initializeStartup();
    await orch.sharedContextService.registerProjectRoot('S-E2E-LOOP', {
      name: 'App',
      path: projectDir,
      rootType: 'primary',
    });

    const ledger = await orch.decomposeObjectiveToBlueprint('Upgrade engine.ts safely', [
      {
        taskId: 'TASK-ENG',
        title: 'Upgrade engine',
        description: 'Modify src/engine.ts',
        targetFiles: ['src/engine.ts'],
      },
    ]);
    const taskId = ledger.tasks[0]!.taskId;

    const worker1 = await orch.dispatchTaskToNewWorker({
      taskId,
      displayName: 'StallingWorker',
      model: { provider: 'mock', model: 'weak-model' },
      allowedPaths: ['src/**'],
    });

    // Worker 1 loops twice hitting PrIterasi after mutating engine.ts into broken state
    const stallingProvider = new MockAIProvider('weak-model', [
      {
        toolCalls: [
          {
            id: 's1',
            name: 'write_file',
            arguments: { path: 'src/engine.ts', content: 'BROKEN WIP' },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 's2',
            name: 'list_dir',
            arguments: { path: 'src' },
          },
        ],
      },
    ]);

    const loop1 = new AutonomousAgentLoop({
      sessionId: 'S-E2E-LOOP',
      botId: worker1.botId!,
      storage,
      provider: stallingProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      protocolSupervisor: orch.supervisor,
      activeTaskId: taskId,
      activeTokenId: worker1.capabilityToken?.tokenId,
      maxIterations: 2,
      enablePkuSync: false,
    });

    const now = new Date().toISOString();
    const res1 = await loop1.handleMessage({
      message_id: generateMessageId(),
      session_id: 'S-E2E-LOOP',
      sender_bot_id: 'BOT000',
      recipient_bot_id: worker1.botId!,
      timestamp: now,
      message_type: 'REQUEST',
      task_id: taskId,
      content: 'Upgrade engine',
      status: 'read',
      metadata: {},
      delivery_state: 'PROCESSING',
      attempt_count: 1,
      max_attempts: 1,
      fence_token: 1,
      lease_owner: 'test',
      lease_expires_at: null,
      last_attempt_at: now,
      last_error: null,
    });
    expect(res1).toContain('Mencapai batas maksimal 2 iterasi');
    expect(orch.supervisor.queue.hasPending()).toBe(true);

    // Master handles P1 intervention -> restores checkpoint & swaps to strong-model worker
    const handled = await orch.processNextIntervention();
    expect(handled?.protocolId).toBe('PrIterasi');
    expect(await fs.readFile(targetFile, 'utf-8')).toBe('export const status = "clean";\n');

    // Old worker's stale write is now blocked by PrModerator write fencing
    const staleWriteCheck = await orch.supervisor.checkWriteAccess('S-E2E-LOOP', {
      botId: worker1.botId!,
      tokenId: worker1.capabilityToken?.tokenId,
      fenceEpoch: worker1.capabilityToken?.fenceEpoch,
      targetPath: 'src/engine.ts',
    });
    expect(staleWriteCheck.allowed).toBe(false);

    // Newly assigned worker writes final file and marks DONE -> PrGate passes
    const updatedTask = await orch.supervisor.ledger.getTask('S-E2E-LOOP', taskId);
    expect(updatedTask?.assignedBotId).toBeDefined();
    expect(updatedTask?.assignedBotId).not.toBe(worker1.botId);

    await fs.writeFile(targetFile, 'export const status = "upgraded-verified";\n', 'utf-8');
    await orch.supervisor.ledger.updateTaskStatus('S-E2E-LOOP', taskId, 'DONE');

    const finalGate = await orch.evaluateObjectiveCompletion();
    expect(finalGate.decision.allowed).toBe(true);
    expect(finalGate.decision.action).toBe('GOAL_ACHIEVED');
    orch.stop();
  });
});
