import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { BotService } from '../../src/bot/service.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { OperationManifoldService } from '../../src/operation/manifold-engine.js';
import { validateOperationPackage } from '../../src/operation/validator.js';
import { MasterAgentOrchestrator } from '../../src/protocol/master-agent.js';
import { ProtocolSupervisor } from '../../src/protocol/supervisor.js';
import { SessionService } from '../../src/session/service.js';
import { SkillService } from '../../src/skills/service.js';
import { executeUpdateGoalTask } from '../../src/tools/goal-tools.js';
import { executeMasterProtocolTool } from '../../src/tools/master-tools.js';

describe('Operation v0.3 Dynamic Swarm Manifold Runtime Physics', () => {
  let tmpRoot: string | undefined;

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  async function setupSession(sessionId = 'S-OP-MANIFOLD') {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-oprt-'));
    const storage = new FilesystemSessionStorage(tmpRoot);
    const sessionService = new SessionService(storage);
    await sessionService.createSession({ sessionId, sessionName: 'manifold-test' });
    const orchestrator = new MasterAgentOrchestrator({
      storage,
      sessionId,
      workspaceRoots: [tmpRoot],
      provider: new MockAIProvider('mock-master', [{ text: 'Coordinated.' }]),
      dryRunSpawn: true,
    });
    await orchestrator.initializeStartup();
    return { tmpRoot, storage, orchestrator, supervisor: orchestrator.supervisor };
  }

  it('applies #Operation-looping, configures 10 protocols, seeds GoalLedger, injects DynamicRules & prompt context', async () => {
    const { storage, supervisor, orchestrator } = await setupSession('S-OP-APPLY');
    const manifold = new OperationManifoldService({ storage, supervisor });

    const inst = await manifold.applyOperation('S-OP-APPLY', '#Operation-looping');
    expect(inst.operationId).toBe('almudaya.operation.looping');
    expect(inst.status).toBe('running_l1');
    expect(inst.seededTaskIds).toEqual(['plan', 'implement', 'test', 'review', 'evaluate']);
    expect(inst.appliedDynamicRuleIds.length).toBe(2);

    const cfg = await supervisor.store.getConfig('S-OP-APPLY');
    expect(cfg.prBotLimit).toBe(10);
    expect(cfg.tokenBudget).toBe(10000000);

    const ledger = await supervisor.ledger.getLedger('S-OP-APPLY');
    expect(ledger.tasks.length).toBe(5);
    expect(ledger.tasks[1]!.targetFiles).toEqual(['src/**']);

    const skillBindings = await new SkillService({ storage }).getSessionSkills(
      'S-OP-APPLY',
      'BOT000',
      true
    );
    expect(skillBindings.some((b) => b.skill_id === 'requirements-analysis')).toBe(true);

    // Verify prompt injection in AutonomousAgentLoop
    let capturedSystemPrompt = '';
    const spyProvider = {
      providerId: 'mock',
      modelName: 'spy-model',
      generateResponse: async (req: { systemPrompt: string }) => {
        capturedSystemPrompt = req.systemPrompt;
        return { text: 'Operation context observed.' };
      },
    };
    const loop = new AutonomousAgentLoop({
      sessionId: 'S-OP-APPLY',
      botId: 'BOT000',
      storage,
      provider: spyProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      protocolSupervisor: supervisor,
      spawnManager: orchestrator.spawnManager,
    });
    await loop.handleMessage({
      message_id: 'MSG-OP-1',
      session_id: 'S-OP-APPLY',
      sender_bot_id: 'OPERATOR',
      recipient_bot_id: 'BOT000',
      timestamp: new Date().toISOString(),
      message_type: 'DIRECT',
      content: 'Report active operation constraints.',
      status: 'read',
      delivery_state: 'PROCESSING',
      attempt_count: 1,
      max_attempts: 1,
      fence_token: 1,
      lease_owner: null,
      lease_expires_at: null,
      last_attempt_at: null,
      last_error: null,
    });
    expect(capturedSystemPrompt).toContain('almudaya.operation.looping');
    expect(capturedSystemPrompt).toContain('developer ≠ reviewer');
  });

  it('enforces SpawnManager role inheritance, cardinality.max, worker apoptosis, and strict_distinct_bot anti_affinity against idle recycling', async () => {
    const { tmpRoot: root, storage, supervisor, orchestrator } = await setupSession('S-OP-SWARM');
    const manifold = new OperationManifoldService({ storage, supervisor });
    await manifold.applyOperation('S-OP-SWARM', 'almudaya.operation.looping');

    // Set global cap = 2 (BOT000 + 1 worker slot) so PrBotGlobal attempts idle recycling on second spawn
    await supervisor.store.updateConfig('S-OP-SWARM', (c) => ({
      ...c,
      prBotGlobalMax: 2,
    }));

    // 1. Spawn developer -> inherits src/** + EXCLUSIVE_WRITE token, transitions manifold to running_swarm
    const devSpawn = await orchestrator.spawnManager.spawnWorker({
      sessionId: 'S-OP-SWARM',
      displayName: 'Dev-1',
      roleArchetype: 'developer',
      model: { provider: 'mock', model: 'mock-dev' },
      taskId: 'implement',
      workspaceRoots: [root],
      dryRun: true,
    });
    expect(devSpawn.action).toBe('SPAWNED');
    expect(devSpawn.capabilityToken?.allowedPaths).toEqual(['src/**']);
    expect(devSpawn.capabilityToken?.accessMode).toBe('EXCLUSIVE_WRITE');

    const activeStateAfterDev = await manifold.getActiveInstance('S-OP-SWARM');
    expect(activeStateAfterDev?.status).toBe('running_swarm');
    expect(activeStateAfterDev?.roleRealizationMap['developer']).toEqual([devSpawn.botId]);

    // 2. Complete task via executeUpdateGoalTask -> triggers worker apoptosis to 'idle', preserves botRoleBindings
    await executeUpdateGoalTask(supervisor, 'S-OP-SWARM', devSpawn.botId!, {
      task_id: 'implement',
      status: 'DONE',
      verification_evidence: { tested: true, notes: 'Unit tests pass' },
    });

    const devBotAfter = await orchestrator.botService.getBot('S-OP-SWARM', devSpawn.botId!);
    expect(devBotAfter.status).toBe('idle');
    const stateAfterApoptosis = await manifold.getActiveInstance('S-OP-SWARM');
    expect(stateAfterApoptosis?.status).toBe('running_l1');
    expect(stateAfterApoptosis?.roleRealizationMap['developer']).toEqual([]);
    expect(stateAfterApoptosis?.botRoleBindings[devSpawn.botId!]).toContain('developer');

    // 3. Request spawning reviewer while prBotGlobalMax=2 and BOT001 (former developer) is idle:
    // strict_distinct_bot anti_affinity MUST reject recycling BOT001 as reviewer!
    const deniedReviewer = await orchestrator.spawnManager.spawnWorker({
      sessionId: 'S-OP-SWARM',
      displayName: 'Reviewer-1',
      roleArchetype: 'reviewer',
      model: { provider: 'mock', model: 'mock-rev' },
      taskId: 'review',
      workspaceRoots: [root],
      dryRun: true,
    });
    expect(deniedReviewer.action).toBe('DENIED');
    expect(deniedReviewer.reason).toContain('strict_distinct_bot anti_affinity');

    // 4. Raise prBotGlobalMax to 4 -> reviewer spawns as a fresh distinct bot with REVIEW_ONLY token
    await supervisor.store.updateConfig('S-OP-SWARM', (c) => ({
      ...c,
      prBotGlobalMax: 4,
    }));
    const revSpawn = await orchestrator.spawnManager.spawnWorker({
      sessionId: 'S-OP-SWARM',
      displayName: 'Reviewer-1',
      roleArchetype: 'reviewer',
      model: { provider: 'mock', model: 'mock-rev' },
      taskId: 'review',
      workspaceRoots: [root],
      dryRun: true,
    });
    expect(revSpawn.action).toBe('SPAWNED');
    expect(revSpawn.botId).not.toBe(devSpawn.botId);
    expect(revSpawn.capabilityToken?.accessMode).toBe('REVIEW_ONLY');

    // 5. Attempting a second reviewer violates cardinality.max=1
    const secondReviewer = await orchestrator.spawnManager.spawnWorker({
      sessionId: 'S-OP-SWARM',
      displayName: 'Reviewer-2',
      roleArchetype: 'reviewer',
      model: { provider: 'mock', model: 'mock-rev' },
      taskId: 'review',
      workspaceRoots: [root],
      dryRun: true,
    });
    expect(secondReviewer.action).toBe('DENIED');
    expect(secondReviewer.reason).toContain('cardinality.max (1)');
  });

  it('synthesizes an ad-hoc Operation via Master tools and crystallizes it into a validated workspace package', async () => {
    const { tmpRoot: root, storage, supervisor, orchestrator } = await setupSession('S-OP-SYNTH');
    const deps = {
      supervisor,
      messagingService: orchestrator.messagingService,
      botService: new BotService(storage),
      spawnManager: orchestrator.spawnManager,
      workspaceRoots: [root],
      sessionId: 'S-OP-SYNTH',
      trustedBotId: 'BOT000',
      dryRunSpawn: true,
    };

    const synthRes = await executeMasterProtocolTool(
      'synthesize_operation',
      {
        name: 'Emergency Hotfix Swarm',
        objective: 'Investigate and patch checkout currency rounding defect',
        orchestration_regime: 'emergent',
      },
      deps
    );
    expect(synthRes['synthesized_on_the_fly']).toBe(true);
    expect(synthRes['status']).toBe('running_l1');

    const crystRes = await executeMasterProtocolTool(
      'crystallize_operation',
      {
        target_id: 'almudaya.operation.emergent.currency-hotfix',
        version: '0.1.0',
        force: true,
      },
      deps
    );
    const outDir = String(crystRes['outputDir']);
    expect(await validateOperationPackage(outDir)).toEqual([]);
  });
});
