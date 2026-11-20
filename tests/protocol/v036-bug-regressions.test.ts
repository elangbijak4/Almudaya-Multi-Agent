import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_MODEL_CATALOG } from '../../src/ai/catalog.js';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { BotService } from '../../src/bot/service.js';
import {
  CapabilityPersistence,
  CapabilityPresets,
  CapabilityService,
  PolicyEngine,
} from '../../src/capability/index.js';
import { resolveDefaultMasterSpec } from '../../src/cli/commands/up.js';
import { ExecutionController } from '../../src/execution/controller.js';
import type { IIsolationBackend, IsolationSpawnOptions, IsolationSpawnResult } from '../../src/execution/isolation/interface.js';
import { DEFAULT_MESSAGE_LEASE_MS } from '../../src/messaging/inbox-state.js';
import { generateMessageId, type DirectMessage } from '../../src/messaging/schema.js';
import { MessagingService } from '../../src/messaging/service.js';
import {
  ProtocolConfigSchema,
  ProtocolSupervisor,
  SpawnManager,
} from '../../src/protocol/index.js';
import { SessionService } from '../../src/session/service.js';
import { SharedContextService } from '../../src/shared/service.js';
import { executeSubmitTaskHandoff } from '../../src/tools/goal-tools.js';
import {
  MASTER_PROTOCOL_TOOLS,
  executeMasterProtocolTool,
} from '../../src/tools/master-tools.js';

class MockExecBackend implements IIsolationBackend {
  public readonly platform = process.platform;
  public readonly isolationType = 'mock_isolation';
  public isAvailable(): boolean {
    return true;
  }
  public supportsCapability(cap: string): boolean {
    return cap === 'process_isolation' || cap === 'os_isolation_required';
  }
  public async executeCommand(command: string, _opts: IsolationSpawnOptions): Promise<IsolationSpawnResult> {
    return {
      command,
      exitCode: 0,
      stdout: `ok:${command}`,
      stderr: '',
      durationMs: 1,
      timedOut: false,
      isolationType: this.isolationType,
    };
  }
}

describe('v0.3.6 Bug Regressions (APP-BUG-10 .. APP-BUG-23 & C3 Registry Sync)', () => {
  let tmpRoot: string;
  let blackboardDir: string;
  let projectDir: string;
  let storage: FilesystemSessionStorage;
  let botService: BotService;
  let messagingService: MessagingService;
  let sharedContext: SharedContextService;
  let supervisor: ProtocolSupervisor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-v036-'));
    blackboardDir = path.join(tmpRoot, 'blackboard');
    projectDir = path.join(tmpRoot, 'project');
    await fs.mkdir(blackboardDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });

    storage = new FilesystemSessionStorage(blackboardDir);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);
    sharedContext = new SharedContextService(storage);
    supervisor = new ProtocolSupervisor({ storage });

    await new SessionService(storage).createSession({
      sessionId: 'S_V036',
      sessionName: 'v0.3.6 Regression Suite',
    });
    await sharedContext.registerProjectRoot('S_V036', {
      name: 'TargetProject',
      path: projectDir,
      rootType: 'primary',
    });
  });

  afterEach(async () => {
    ExecutionController.resetInstance();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('APP-BUG-10: SpawnManager passes --workspace <blackboardRoot> & forwards --failover', async () => {
    await supervisor.initializeSession('S_V036', {
      spawnMode: 'multiplexed',
      modelPool: [
        { provider: 'nvidia', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b' },
        { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3-0324:free' },
      ],
    });
    await supervisor.ledger.initializeBlueprint('S_V036', 'Build engine', [
      {
        taskId: 'T-SPAWN',
        title: 'Engine task',
        description: 'Write src/engine.js',
        targetFiles: ['src/engine.js'],
      },
    ]);

    const launched: Array<{ args: string[]; cwd?: string }> = [];
    const manager = new SpawnManager({
      botService,
      supervisor,
      blackboardRoot: blackboardDir,
      platform: 'linux',
      launcher: (_cmd, args, opts) => {
        launched.push({ args, cwd: opts.cwd });
        const child = new EventEmitter() as EventEmitter & {
          pid: number;
          kill: () => boolean;
          unref: () => void;
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        child.pid = 7777;
        child.kill = () => true;
        child.unref = () => undefined;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        return child as never;
      },
    });

    const outcome = await manager.spawnWorker({
      sessionId: 'S_V036',
      displayName: 'Worker1',
      model: { provider: 'nvidia', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b' },
      taskId: 'T-SPAWN',
      workspaceRoots: [projectDir],
      dryRun: false,
    });

    expect(outcome.action).toBe('SPAWNED');
    expect(outcome.capabilityToken?.allowedPaths).toEqual(['src/engine.js']);
    const args = launched[0]!.args;
    const wsIdx = args.indexOf('--workspace');
    expect(wsIdx).toBeGreaterThan(-1);
    expect(args[wsIdx + 1]).toBe(blackboardDir);
    expect(launched[0]!.cwd).toBe(projectDir);

    const failoverIdx = args.indexOf('--failover');
    expect(failoverIdx).toBeGreaterThan(-1);
    expect(args[failoverIdx + 1]).toContain('openrouter:deepseek/deepseek-chat-v3-0324:free');
    manager.reapAll();
  });

  it('APP-BUG-11: exposes create_goal_blueprint in MASTER_PROTOCOL_TOOLS and initializes GoalLedger', async () => {
    expect(MASTER_PROTOCOL_TOOLS.some((t) => t.name === 'create_goal_blueprint')).toBe(true);
    await supervisor.initializeSession('S_V036', {});
    await botService.registerBot('S_V036', { botId: 'BOT000', displayName: 'MASTER', role: 'master' });
    const res = await executeMasterProtocolTool(
      'create_goal_blueprint',
      {
        summary: 'Deliver Quantum Portal',
        tasks: [
          {
            task_id: 'T1',
            title: 'Quantum Engine',
            description: 'Build quantum math module',
            target_files: ['src/quantum.js'],
          },
        ],
      },
      {
        supervisor,
        messagingService,
        botService,
        workspaceRoots: [projectDir],
        sessionId: 'S_V036',
        trustedBotId: 'BOT000',
      }
    );

    expect(res['action']).toBe('blueprint_created');
    expect(res['task_count']).toBe(1);
    const task = await supervisor.ledger.getTask('S_V036', 'T1');
    expect(task?.targetFiles).toEqual(['src/quantum.js']);
  });

  it('APP-BUG-12, APP-BUG-20 & APP-BUG-22: enforces unclaimed path denial, Master conflict checks, and masterStrictOrchestrator', async () => {
    await supervisor.initializeSession('S_V036', {});
    await botService.registerBot('S_V036', { botId: 'BOT000', displayName: 'MASTER', role: 'master' });
    await botService.registerBot('S_V036', { botId: 'BOT001', displayName: 'Engineer', role: 'worker' });
    await botService.registerBot('S_V036', { botId: 'BOT002', displayName: 'QA', role: 'worker' });

    await supervisor.issueTaskToken('S_V036', {
      taskId: 'T-ENG',
      holderBotId: 'BOT001',
      allowedPaths: ['src/quantum.js'],
      accessMode: 'EXCLUSIVE_WRITE',
    });

    // CLI worker BOT001 without explicit tokenId auto-binds its owned token for allowed path
    const ownAllowed = await supervisor.checkWriteAccess('S_V036', {
      botId: 'BOT001',
      targetPath: 'src/quantum.js',
    });
    expect(ownAllowed.allowed).toBe(true);

    // APP-BUG-12 (S2b): BOT002 cannot write unclaimed path while write-fencing is active
    const unclaimedDenied = await supervisor.checkWriteAccess('S_V036', {
      botId: 'BOT002',
      targetPath: 'unclaimed_probe.tmp',
    });
    expect(unclaimedDenied.allowed).toBe(false);
    expect(unclaimedDenied.action).toBe('DENY');

    // APP-BUG-20: BOT000 cannot overwrite BOT001 locked path without revoking/transferring first
    const masterConflictDenied = await supervisor.checkWriteAccess('S_V036', {
      botId: 'BOT000',
      targetPath: 'src/quantum.js',
    });
    expect(masterConflictDenied.allowed).toBe(false);

    // APP-BUG-22: BOT000 cannot issue EXCLUSIVE_WRITE token to itself
    await expect(
      executeMasterProtocolTool(
        'issue_capability_token',
        {
          action: 'issue',
          task_id: 'T-MASTER',
          holder_bot_id: 'BOT000',
          allowed_paths: ['src/quantum.js'],
          access_mode: 'EXCLUSIVE_WRITE',
        },
        {
          supervisor,
          messagingService,
          botService,
          workspaceRoots: [projectDir],
          sessionId: 'S_V036',
          trustedBotId: 'BOT000',
        }
      )
    ).rejects.toThrow(/masterStrictOrchestrator|Cannot issue EXCLUSIVE_WRITE/);

    // APP-BUG-22: Master AutonomousAgentLoop removes write_file/edit_file when workers exist
    const inspectProvider = new MockAIProvider('master-inspect', [{ text: 'Delegated to BOT001.' }]);
    const masterLoop = new AutonomousAgentLoop({
      sessionId: 'S_V036',
      botId: 'BOT000',
      storage,
      provider: inspectProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      protocolSupervisor: supervisor,
      enablePkuSync: false,
    });
    const now = new Date().toISOString();
    await masterLoop.handleMessage({
      message_id: generateMessageId(),
      session_id: 'S_V036',
      sender_bot_id: 'OPERATOR',
      recipient_bot_id: 'BOT000',
      timestamp: now,
      message_type: 'DIRECT',
      content: 'Coordinate task',
      status: 'unread',
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
    const toolNames = inspectProvider.calls[0]!.tools?.map((t) => t.name) ?? [];
    expect(toolNames).not.toContain('write_file');
    expect(toolNames).not.toContain('edit_file');
    expect(toolNames).toContain('create_goal_blueprint');
  });

  it('APP-BUG-13 & APP-BUG-18: ExecutionController resolves ACG grants from -w workspaceRoot & extended --paths does not break node/git commands', async () => {
    const persistence = new CapabilityPersistence({ workspaceRoot: blackboardDir });
    const acg = new CapabilityService(persistence);
    await acg.applyPreset('S_V036', 'extended', 'ADMIN', {
      paths: [tmpRoot],
    });

    const otherCwdService = new CapabilityService(new CapabilityPersistence({ workspaceRoot: projectDir }));
    const controller = new ExecutionController(otherCwdService, new MockExecBackend());

    const res = await controller.executeCommand(
      {
        sessionId: 'S_V036',
        botId: 'BOT001',
        projectRoots: [projectDir],
        workspaceRoot: blackboardDir,
        isTurbo: true,
      },
      { command: 'node --version' }
    );
    expect(res.exitCode).toBe(0);
    expect(res.deniedByPolicy).toBeFalsy();

    // Verify PolicyEngine directly does not test process.execute_external against scope.paths
    const grants = await persistence.getGrants('S_V036');
    const execGrant = grants.find((g) => g.capability === 'process.execute_external');
    expect(execGrant?.scope.paths).toBeUndefined();
    const policyRes = PolicyEngine.evaluate(
      {
        capability: 'process.execute_external',
        sessionId: 'S_V036',
        targetResource: 'git status',
      },
      grants
    );
    expect(policyRes.decision).toBe('ALLOW');
  });

  it('APP-BUG-14: updates default NVIDIA model from retired nemotron-3 to nemotron-3.5-super-vl-120b-a12b', () => {
    const spec = resolveDefaultMasterSpec({ provider: 'nvidia' });
    expect(spec.model).toBe('nvidia/nemotron-3.5-super-vl-120b-a12b');
    expect(
      BUILTIN_MODEL_CATALOG.some((m) => m.id === 'nvidia/nemotron-3.5-super-vl-120b-a12b')
    ).toBe(true);
    expect(
      BUILTIN_MODEL_CATALOG.some((m) => m.id === 'nvidia/nemotron-3-super-120b-a12b')
    ).toBe(false);
  });

  it('APP-BUG-15: defaults tokenBudget to 10M, prIterasiLimit to 25, and suppresses peer ping-pong on budget exhaustion', async () => {
    const defaultCfg = ProtocolConfigSchema.parse({});
    expect(defaultCfg.tokenBudget).toBe(10000000);
    expect(defaultCfg.prIterasiLimit).toBe(25);

    await supervisor.initializeSession('S_V036', { tokenBudget: 100 });
    await botService.registerBot('S_V036', { botId: 'BOT000', displayName: 'MASTER', role: 'master' });
    await botService.registerBot('S_V036', { botId: 'BOT001', displayName: 'W1', role: 'worker' });
    await botService.registerBot('S_V036', { botId: 'BOT002', displayName: 'W2', role: 'worker' });

    const overBudgetProvider: MockAIProvider = new MockAIProvider('over', []);
    overBudgetProvider.generateResponse = async () => ({
      text: 'This reply exceeded token budget.',
      usage: { totalTokens: 500 },
    });

    const loop = new AutonomousAgentLoop({
      sessionId: 'S_V036',
      botId: 'BOT001',
      storage,
      provider: overBudgetProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      protocolSupervisor: supervisor,
      enablePkuSync: false,
    });

    const now = new Date().toISOString();
    const out = await loop.handleMessage({
      message_id: generateMessageId(),
      session_id: 'S_V036',
      sender_bot_id: 'BOT002',
      recipient_bot_id: 'BOT001',
      timestamp: now,
      message_type: 'DIRECT',
      content: 'Start work',
      status: 'unread',
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

    expect(out).toContain('[PrBotGlobal Escalation:');
    const w2Inbox = await storage.getInbox('S_V036', 'BOT002');
    expect(w2Inbox.messages).toHaveLength(0);
  });

  it('APP-BUG-16, APP-BUG-21 & APP-BUG-23: PrTransfer inherits targetFiles, forbids implicit **/*, avoids Master write lock on TASK_0, and records handoverHistory atomically', async () => {
    await supervisor.initializeSession('S_V036', {});
    await botService.registerBot('S_V036', { botId: 'BOT000', displayName: 'MASTER', role: 'master' });
    await botService.registerBot('S_V036', { botId: 'BOT001', displayName: 'W1', role: 'worker' });
    await botService.registerBot('S_V036', { botId: 'BOT002', displayName: 'W2', role: 'worker' });
    await botService.registerBot('S_V036', { botId: 'BOT003', displayName: 'W3', role: 'worker' });

    // Implicit wildcard rejected by PrModerator
    await expect(
      supervisor.prModerator.issueToken('S_V036', {
        taskId: 'T-BAD',
        holderBotId: 'BOT001',
        allowedPaths: ['**/*'],
        accessMode: 'EXCLUSIVE_WRITE',
      })
    ).rejects.toThrow(/non-wildcard allowedPaths/);

    await supervisor.ledger.addTask('S_V036', {
      taskId: 'T-XFER',
      title: 'Scoped task',
      description: 'Scoped implementation',
      assignedBotId: 'BOT001',
      targetFiles: ['src/scoped.ts'],
    });
    await supervisor.ledger.addTask('S_V036', {
      taskId: 'T-OTHER',
      title: 'Sibling task',
      description: 'Sibling work',
      assignedBotId: 'BOT003',
      targetFiles: ['src/sibling.ts'],
    });
    await supervisor.issueTaskToken('S_V036', {
      taskId: 'T-OTHER',
      holderBotId: 'BOT003',
      allowedPaths: ['src/sibling.ts'],
      accessMode: 'EXCLUSIVE_WRITE',
    });

    // Handoff BOT001 -> BOT002 inherits task.targetFiles and increments handoverCount
    const handoffRes = await executeSubmitTaskHandoff(
      supervisor,
      messagingService,
      'S_V036',
      'BOT001',
      {
        task_id: 'T-XFER',
        recipient: 'BOT002',
        last_completed_step: 'Initial draft ready',
        pending_next_step: 'Finish and verify tests',
        summary: 'Handing over to BOT002',
      }
    );

    const modState = await supervisor.prModerator.getModeratorState('S_V036');
    const tokW2 = modState.tokens[String(handoffRes['capability_token_id'])]!;
    expect(tokW2.allowedPaths).toEqual(['src/scoped.ts']);
    expect(tokW2.allowedPaths).not.toContain('**/*');
    expect(tokW2.accessMode).toBe('EXCLUSIVE_WRITE');

    const taskAfterHandoff = await supervisor.ledger.getTask('S_V036', 'T-XFER');
    expect(taskAfterHandoff?.handoverCount).toBe(1);
    expect(taskAfterHandoff?.handoverHistory).toHaveLength(1);
    expect(taskAfterHandoff?.handoverHistory[0]?.fromBotId).toBe('BOT001');
    expect(taskAfterHandoff?.handoverHistory[0]?.toBotId).toBe('BOT002');

    // BOT003 working on sibling.ts must NOT be blocked when BOT002 signals TASK_0!
    await supervisor.ledger.updateTaskStatus('S_V036', 'T-XFER', 'DONE');
    const task0Res = await executeSubmitTaskHandoff(
      supervisor,
      messagingService,
      'S_V036',
      'BOT002',
      {
        task_id: 'T-XFER',
        recipient: 'TASK_0',
        last_completed_step: 'Completed src/scoped.ts',
        pending_next_step: 'PrGate close',
        summary: 'Task T-XFER ready (TASK_0)',
      }
    );
    const modAfterTask0 = await supervisor.prModerator.getModeratorState('S_V036');
    const tokMaster = modAfterTask0.tokens[String(task0Res['capability_token_id'])]!;
    expect(tokMaster.holderBotId).toBe('BOT000');
    expect(tokMaster.accessMode).toBe('REVIEW_ONLY');

    const siblingCheck = await supervisor.checkWriteAccess('S_V036', {
      botId: 'BOT003',
      targetPath: 'src/sibling.ts',
    });
    expect(siblingCheck.allowed).toBe(true);
  });

  it('APP-BUG-19 & C3: supports lease renewal for long turns, raises default lease to 180s, and syncs model_ref across restarts', async () => {
    expect(DEFAULT_MESSAGE_LEASE_MS).toBe(180000);

    let sawRenewedExpiry = false;
    const rt = new BotRuntime(storage, {
      sessionId: 'S_V036',
      botId: 'BOT009',
      displayName: 'SlowWorker',
      description: 'FirstRole',
      modelRef: 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b',
      leaseDurationMs: 2500,
      pollIntervalMs: 60000,
      onMessage: async (msg) => {
        const inboxBefore = await storage.getInbox('S_V036', 'BOT009');
        const expBefore = Date.parse(inboxBefore.messages[0]!.lease_expires_at!);
        await new Promise((r) => setTimeout(r, 1200));
        const inboxAfter = await storage.getInbox('S_V036', 'BOT009');
        const expAfter = Date.parse(inboxAfter.messages[0]!.lease_expires_at!);
        if (expAfter > expBefore) {
          sawRenewedExpiry = true;
        }
        expect(msg.message_id).toBeDefined();
      },
    });
    const rec1 = await rt.start();
    expect(rec1.model_ref).toBe('nvidia:nvidia/nemotron-3.5-lightning-30b-a3b');

    await messagingService.sendDirectMessage('S_V036', {
      senderBotId: 'SYSTEM',
      recipient: 'BOT009',
      content: 'Long LLM task',
    });
    await rt.pollCycle();
    expect(sawRenewedExpiry).toBe(true);
    await rt.stop();

    // C3: Restart with swapped model updates model_ref & description in bots.json
    const rt2 = new BotRuntime(storage, {
      sessionId: 'S_V036',
      botId: 'BOT009',
      displayName: 'SlowWorker',
      description: 'SwappedRole',
      modelRef: 'nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b',
    });
    const rec2 = await rt2.start();
    expect(rec2.model_ref).toBe('nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b');
    expect(rec2.description).toBe('SwappedRole');
    await rt2.stop();
  });
});
