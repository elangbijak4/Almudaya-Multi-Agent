import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { BotService } from '../../src/bot/service.js';
import { generateMessageId, type DirectMessage } from '../../src/messaging/schema.js';
import { ProtocolSupervisor } from '../../src/protocol/index.js';
import { SessionService } from '../../src/session/service.js';

describe('TC-350-14: Dynamic Rules Lifecycle & Live Prompt Injection', () => {
  let tmpRoot: string;
  let storage: FilesystemSessionStorage;
  let supervisor: ProtocolSupervisor;
  let sessionId: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-rules-'));
    storage = new FilesystemSessionStorage(tmpRoot);
    const sessionService = new SessionService(storage);
    const botService = new BotService(storage);
    supervisor = new ProtocolSupervisor({ storage });

    const session = await sessionService.createSession({
      sessionId: 'S-RULES-1',
      sessionName: 'Dynamic Rules Test',
    });
    sessionId = session.session_id;
    await supervisor.initializeSession(sessionId);
    await botService.registerBot(sessionId, {
      botId: 'BOT001',
      displayName: 'Worker1',
      status: 'active',
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('orders rules by severity and injects active rules into AutonomousAgentLoop systemPrompt', async () => {
    await supervisor.rules.addRule(sessionId, {
      statement: 'Prefer early returns.',
      severity: 'ADVISORY',
    });
    const hardRule = await supervisor.rules.addRule(sessionId, {
      statement: 'NEVER edit package-lock.json directly.',
      severity: 'HARD_STOP',
    });

    const formatted = await supervisor.rules.formatRulesForPrompt(sessionId, 'BOT001');
    expect(formatted.indexOf('HARD_STOP')).toBeLessThan(formatted.indexOf('ADVISORY'));
    expect(formatted).toContain('NEVER edit package-lock.json');

    let capturedSystemPrompt = '';
    const spyingProvider = new MockAIProvider('mock-spy', [
      { text: 'Rule acknowledged and followed.' },
    ]);
    const origGenerate = spyingProvider.generateResponse.bind(spyingProvider);
    spyingProvider.generateResponse = async (req) => {
      capturedSystemPrompt = req.systemPrompt ?? '';
      return await origGenerate(req);
    };

    const loop = new AutonomousAgentLoop({
      sessionId,
      botId: 'BOT001',
      storage,
      provider: spyingProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      protocolSupervisor: supervisor,
      enablePkuSync: false,
    });

    const now = new Date().toISOString();
    const msg: DirectMessage = {
      message_id: generateMessageId(),
      session_id: sessionId,
      sender_bot_id: 'OPERATOR',
      recipient_bot_id: 'BOT001',
      timestamp: now,
      message_type: 'DIRECT',
      content: 'Implement utility helper',
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

    await loop.handleMessage(msg);
    expect(capturedSystemPrompt).toContain('NEVER edit package-lock.json directly.');

    // Deactivate rule -> no longer injected
    await supervisor.rules.deactivateRule(sessionId, hardRule.ruleId);
    const updatedFormat = await supervisor.rules.formatRulesForPrompt(sessionId, 'BOT001');
    expect(updatedFormat).not.toContain('package-lock.json');
  });
});
