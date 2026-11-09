import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { WorkLogService } from '../../src/shared/work-log.js';
import { MessagingService } from '../../src/messaging/service.js';
import { BotService } from '../../src/bot/service.js';
import { CapabilityService } from '../../src/capability/service.js';
import { CapabilityPersistence } from '../../src/capability/persistence.js';
import {
  registerSecret,
  unregisterSecret,
  redactSecrets,
  redactRecursively,
} from '../../src/execution/environment.js';
import { GeminiProvider } from '../../src/ai/gemini.js';
import { createProgram } from '../../src/cli/index.js';

describe('AUD-11 (REQ-07) Secret Lifecycle and Redaction Canary Suite', () => {
  let tmpDir: string;
  let storage: FilesystemSessionStorage;
  const sessionId = 'S_CANARY_TEST_SESSION';
  const botId = 'B_CANARY_BOT';

  const CANARY_GEMINI = 'AIzaSyCanaryGeminiKey9876543210ABCDEF';
  const CANARY_OPENAI = 'sk-canarySecretOpenAIToken1234567890abcdef';
  const CANARY_ANTHROPIC = 'sk-ant-canarySecretAnthropicToken12345';
  const CANARY_GITHUB = 'ghp_canarySecretGitHubPat1234567890abcdef';
  const CANARY_CUSTOM = 'CUSTOM_SECRET_CANARY_TOKEN_9999999999';

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `almudaya_canary_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(tmpDir, { recursive: true });
    storage = new FilesystemSessionStorage(tmpDir);
    const sessionService = new SessionService(storage);
    await sessionService.createSession({ sessionId, sessionName: 'Canary Test Session' });

    const botService = new BotService(storage);
    await botService.registerBot(sessionId, { botId, displayName: 'Canary Bot', status: 'active' });
    await botService.registerBot(sessionId, { botId: 'B_RECIPIENT', displayName: 'Recipient Bot', status: 'active' });

    registerSecret(CANARY_CUSTOM);
  });

  afterEach(async () => {
    unregisterSecret(CANARY_CUSTOM);
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const CANARIES = [
    CANARY_GEMINI,
    CANARY_OPENAI,
    CANARY_ANTHROPIC,
    CANARY_GITHUB,
    CANARY_CUSTOM,
  ];

  function assertNoCanariesInText(content: string, sinkName: string): void {
    for (const canary of CANARIES) {
      expect(content, `Raw canary "${canary}" leaked into ${sinkName}!`).not.toContain(canary);
    }
  }

  it('AUD-11 Canary Sink 1: Work Log persistence must not contain raw secrets on disk', async () => {
    const workLogService = new WorkLogService(storage);

    await workLogService.recordWork(sessionId, {
      botId,
      botName: 'Canary Bot',
      actionType: 'COMMAND',
      targetRootId: 'R1',
      targetRootName: 'project',
      targetRootPath: tmpDir,
      summary: `Running task with ${CANARY_GEMINI} and ${CANARY_CUSTOM}`,
      details: {
        nested: {
          openai: CANARY_OPENAI,
          anthropic: CANARY_ANTHROPIC,
          github: CANARY_GITHUB,
        },
        list: [`auth: ${CANARY_CUSTOM}`, CANARY_GEMINI],
      },
    });

    const workLogFile = path.join(storage.getSessionDir(sessionId), 'work_log.jsonl');
    const diskContent = await fs.readFile(workLogFile, 'utf-8');

    assertNoCanariesInText(diskContent, 'work_log.jsonl');
    expect(diskContent).toContain('[REDACTED');
  });

  it('AUD-11 Canary Sink 2: Broadcast events must not contain raw secrets on disk', async () => {
    const botService = new BotService(storage);
    const messagingService = new MessagingService(storage, botService);

    await messagingService.publishBroadcast(sessionId, {
      senderBotId: botId,
      category: 'ACTIVITY',
      content: `Broadcast containing ${CANARY_OPENAI} and ${CANARY_CUSTOM}`,
      metadata: {
        keys: {
          gemini: CANARY_GEMINI,
          anthropic: CANARY_ANTHROPIC,
          github: CANARY_GITHUB,
        },
      },
    });

    const broadcastFile = path.join(storage.getSessionDir(sessionId), 'broadcast', 'events.jsonl');
    const diskContent = await fs.readFile(broadcastFile, 'utf-8');

    assertNoCanariesInText(diskContent, 'events.jsonl');
    expect(diskContent).toContain('[REDACTED');
  });

  it('AUD-11 Canary Sink 3: Direct Message inboxes must not contain raw secrets on disk', async () => {
    const botService = new BotService(storage);
    const messagingService = new MessagingService(storage, botService);

    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: botId,
      recipient: 'B_RECIPIENT',
      content: `Direct message payload with ${CANARY_ANTHROPIC} and ${CANARY_GITHUB}`,
      metadata: {
        deep: {
          secret: CANARY_CUSTOM,
          gemini: CANARY_GEMINI,
        },
      },
    });

    const inboxFile = path.join(storage.getSessionDir(sessionId), 'inbox', 'B_RECIPIENT', 'messages.json');
    const diskContent = await fs.readFile(inboxFile, 'utf-8');

    assertNoCanariesInText(diskContent, 'messages.json');
    expect(diskContent).toContain('[REDACTED');
  });

  it('AUD-11 Canary Sink 4: Security Audit persistence must not contain raw secrets on disk', async () => {
    const persistence = new CapabilityPersistence({ workspaceRoot: tmpDir });
    const capabilityService = new CapabilityService(persistence);

    // Evaluate policy on a target resource with embedded canaries
    await capabilityService.evaluate({
      capability: 'filesystem.read_external',
      sessionId,
      botId,
      targetResource: `C:\\external\\config_${CANARY_GEMINI}_${CANARY_CUSTOM}.json`,
    });

    const auditFile = persistence.getAuditFilePath(sessionId);
    const diskContent = await fs.readFile(auditFile, 'utf-8');

    assertNoCanariesInText(diskContent, 'audit.jsonl');
    expect(diskContent).toContain('[REDACTED');
  });

  it('AUD-11 Provider Secret Lifecycle: registers key on init and unregisters on dispose', () => {
    const ephemeralKey = 'custom-ephemeral-test-secret-value-99999';
    expect(redactSecrets(`Key is: ${ephemeralKey}`)).toContain(ephemeralKey);

    const provider = new GeminiProvider({ apiKey: ephemeralKey });
    // After initialization, key is registered
    expect(redactSecrets(`Key is: ${ephemeralKey}`)).not.toContain(ephemeralKey);
    expect(redactSecrets(`Key is: ${ephemeralKey}`)).toContain('[REDACTED_SECRET]');

    // After dispose, key is unregistered
    provider.dispose();
    expect(redactSecrets(`Key is: ${ephemeralKey}`)).toContain(ephemeralKey);
  });

  it('AUD-11 CLI Security: --api-key is marked as deprecated and insecure in CLI help', () => {
    const program = createProgram();
    const botCmd = program.commands.find((c) => c.name() === 'bot');
    expect(botCmd).toBeDefined();

    const runCmd = botCmd?.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();

    const apiKeyOption = runCmd?.options.find((o) => o.flags.includes('--api-key'));
    expect(apiKeyOption).toBeDefined();
    expect(apiKeyOption?.description).toContain('DEPRECATED');
    expect(apiKeyOption?.description).toContain('INSECURE');
    expect(apiKeyOption?.description).toContain('GEMINI_API_KEY');
  });

  it('AUD-11 Recursive Redactor: handles deeply nested objects, arrays, and primitives safely', () => {
    const data = {
      level1: {
        stringWithToken: `Bearer ${CANARY_GITHUB}`,
        level2: [
          { token: CANARY_ANTHROPIC },
          { token: CANARY_OPENAI },
          CANARY_GEMINI,
          12345,
          true,
          null,
        ],
      },
    };

    const cleaned = redactRecursively(data);
    const cleanedJson = JSON.stringify(cleaned);

    assertNoCanariesInText(cleanedJson, 'redactRecursively output');
    expect(cleaned.level1.level2[3]).toBe(12345);
    expect(cleaned.level1.level2[4]).toBe(true);
    expect(cleaned.level1.level2[5]).toBe(null);
  });
});
