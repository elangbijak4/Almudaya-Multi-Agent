import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import {
  LocalFilesystemPKUStore,
  createWorkspaceMemoryRuntime,
  deriveProjectUniverseId,
} from '../../src/memory_modules/index.js';
import { MessagingService } from '../../src/messaging/service.js';
import { SessionService } from '../../src/session/service.js';

describe('Automatic PKU Memory Sync across SessionService, BotRuntime & AutonomousAgentLoop', () => {
  let tmpDir: string;
  let storage: FilesystemSessionStorage;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-pku-autosync-'));
    storage = new FilesystemSessionStorage(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('automatically populates PKU on session creation, bot start, ReAct turn completion, and bot stop', async () => {
    const sessionService = new SessionService(storage);
    const session = await sessionService.createSession({
      sessionId: 'S_AUTOSYNC',
      sessionName: 'Auto Sync Session',
    });

    const pkuDir = path.join(tmpDir, 'pku');
    const pkuStore = new LocalFilesystemPKUStore(pkuDir);
    const pmuId = deriveProjectUniverseId(`session_${session.session_id.toLowerCase()}`);

    // 1. Session creation should have created the PMU in <workspace>/pku
    const universe = await pkuStore.getUniverse(pmuId);
    expect(universe).not.toBeNull();
    expect(universe?.id).toBe(pmuId);
    expect(universe?.projectKey).toBe('session_s_autosync');

    // 2. Starting BotRuntime should initialize ScopedMemoryClient and capture bot registration
    const memoryRuntime = createWorkspaceMemoryRuntime(storage)!;
    expect(memoryRuntime).not.toBeNull();

    const runtime = new BotRuntime(storage, {
      sessionId: session.session_id,
      botId: 'BOT001',
      displayName: 'AlphaBot',
      memoryRuntime,
    });

    await runtime.start();
    const scopedClient = runtime.getScopedMemoryClient();
    expect(scopedClient).toBeDefined();
    expect(scopedClient?.identity.botId).toBe('BOT001');

    // 3. Running AutonomousAgentLoop.handleMessage should sync session + save ExecutionCheckpoint
    const mockProvider = new MockAIProvider('mock-model-v1', [
      {
        text: 'Task analyzed and completed.',
      },
    ]);

    const agentLoop = new AutonomousAgentLoop({
      sessionId: session.session_id,
      botId: 'BOT001',
      storage,
      provider: mockProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      memoryRuntime,
    });

    const messagingService = new MessagingService(storage);
    const msg = await messagingService.sendDirectMessage(session.session_id, {
      senderBotId: 'OPERATOR',
      recipient: 'BOT001',
      content: 'Analyze project status',
    });

    const reply = await agentLoop.handleMessage(msg);
    expect(reply).toContain('Task analyzed and completed.');

    // Verify individual checkpoint was captured in PKU
    const checkpoints = await pkuStore.queryKnowledge({
      projectUniverseIds: [pmuId],
      types: ['acma.checkpoint'],
      ownerId: 'BOT001',
    });
    expect(checkpoints.items.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints.items[0].summary).toContain('Task analyzed and completed.');

    // Verify global session events were captured in PKU
    const events = await pkuStore.listEvents(pmuId);
    expect(events.length).toBeGreaterThanOrEqual(1);

    await runtime.stop();
  });

  it('fails open without breaking session or bot execution when PKU is disabled', async () => {
    const memoryRuntime = createWorkspaceMemoryRuntime(storage)!;
    memoryRuntime.disable();

    const sessionService = new SessionService(storage, { memoryRuntime });
    const session = await sessionService.createSession({
      sessionId: 'S_FAILOPEN',
      sessionName: 'Fail Open Session',
    });
    expect(session.session_id).toBe('S_FAILOPEN');

    const runtime = new BotRuntime(storage, {
      sessionId: session.session_id,
      botId: 'BOT001',
      displayName: 'FailOpenBot',
      memoryRuntime,
    });

    const record = await runtime.start();
    expect(record.bot_id).toBe('BOT001');
    await runtime.stop();
  });
});
