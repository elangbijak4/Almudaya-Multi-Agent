import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { SharedContextService } from '../../src/shared/service.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { WorkLogService } from '../../src/shared/work-log.js';
import type { DirectMessage } from '../../src/messaging/schema.js';

describe('Autonomous Multi-Bot Agent Loop (FR-216, FR-217, ADR-204)', () => {
  let tmpDir: string;
  let targetProjectDir: string;
  let storage: FilesystemSessionStorage;
  let botService: BotService;
  let messagingService: MessagingService;
  let sharedContextService: SharedContextService;
  const sessionId = 'S_AGENT_LOOP_TEST';

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `almudaya_loop_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    targetProjectDir = path.join(tmpDir, 'target_repo');
    await fs.mkdir(targetProjectDir, { recursive: true });

    storage = new FilesystemSessionStorage(tmpDir);
    const sessionService = new SessionService(storage);
    await sessionService.createSession({
      sessionId,
      sessionName: 'Agent Loop Lab'
    });

    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);
    sharedContextService = new SharedContextService(storage);

    // Register project root in shared context
    await sharedContextService.registerProjectRoot(sessionId, {
      name: 'target_repo',
      path: targetProjectDir,
      rootType: 'primary'
    });

    // Register Architect and Coder bots
    await botService.registerBot(sessionId, {
      botId: 'BOT_ARCHITECT',
      displayName: 'System Architect',
      description: 'System Architecture Lead',
      status: 'active'
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT_CODER',
      displayName: 'Software Engineer',
      description: 'Fullstack Developer',
      status: 'active'
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should autonomously handle incoming message, execute tool in TURBO mode, and reply', async () => {
    // Mock AI that calls write_file on first turn, then completes on second turn
    const mockProvider = new MockAIProvider('mock-model', [
      {
        text: 'Saya akan membuat file komponen Button.tsx.',
        toolCalls: [
          {
            id: 'call_1',
            name: 'write_file',
            arguments: {
              path: 'src/Button.tsx',
              content: 'export const Button = () => <button>Click</button>;'
            }
          }
        ]
      },
      {
        text: 'File src/Button.tsx telah berhasil dibuat sesuai spesifikasi.'
      }
    ]);

    const executionModeController = new ExecutionModeController('TURBO');

    const agentLoop = new AutonomousAgentLoop({
      sessionId,
      botId: 'BOT_CODER',
      storage,
      provider: mockProvider,
      executionModeController,
      botService,
      messagingService,
      sharedContextService
    });

    const incomingMsg: DirectMessage = {
      message_id: 'MSG_001',
      session_id: sessionId,
      sender_bot_id: 'BOT_ARCHITECT',
      recipient_bot_id: 'BOT_CODER',
      content: 'Tolong buatkan komponen Button.tsx di folder src.',
      created_at: new Date().toISOString()
    };

    const reply = await agentLoop.handleMessage(incomingMsg);

    expect(reply).toBe(
      'File src/Button.tsx telah berhasil dibuat sesuai spesifikasi.'
    );

    // Verify file actually written to target project root (FR-207)
    const writtenFile = await fs.readFile(
      path.join(targetProjectDir, 'src/Button.tsx'),
      'utf8'
    );
    expect(writtenFile).toBe(
      'export const Button = () => <button>Click</button>;'
    );

    // Verify reply sent to Architect inbox (FR-216)
    const architectInbox = await messagingService.readInbox(
      sessionId,
      'BOT_ARCHITECT'
    );
    expect(architectInbox.length).toBe(1);
    expect(architectInbox[0]!.content).toBe(
      'File src/Button.tsx telah berhasil dibuat sesuai spesifikasi.'
    );
    expect(architectInbox[0]!.metadata?.correlationId).toBe('MSG_001');

    // Verify Blackboard audit trail (FR-217)
    const broadcasts = await messagingService.readBroadcasts(sessionId, {
      botId: 'OBSERVER'
    });
    const activityEvents = broadcasts.filter((b) => b.category === 'ACTIVITY');
    const decisionEvents = broadcasts.filter((b) => b.category === 'DECISION');

    expect(activityEvents.length).toBeGreaterThanOrEqual(1);
    expect(decisionEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('should enforce review rejection in REQUEST_REVIEW mode and not mutate disk', async () => {
    const mockProvider = new MockAIProvider('mock-model', [
      {
        text: 'Mencoba membuat file rahasia.',
        toolCalls: [
          {
            id: 'call_reject',
            name: 'write_file',
            arguments: {
              path: 'unauthorized.txt',
              content: 'malicious code'
            }
          }
        ]
      },
      {
        text: 'Aksi dibatalkan karena operator menolak.'
      }
    ]);

    // Prompt handler returns 'n' (reject)
    const promptHandler = vi.fn().mockResolvedValue('n');
    const executionModeController = new ExecutionModeController(
      'REQUEST_REVIEW',
      promptHandler
    );

    const agentLoop = new AutonomousAgentLoop({
      sessionId,
      botId: 'BOT_CODER',
      storage,
      provider: mockProvider,
      executionModeController,
      botService,
      messagingService,
      sharedContextService
    });

    const incomingMsg: DirectMessage = {
      message_id: 'MSG_002',
      session_id: sessionId,
      sender_bot_id: 'BOT_ARCHITECT',
      recipient_bot_id: 'BOT_CODER',
      content: 'Coba buat unauthorized.txt.',
      created_at: new Date().toISOString()
    };

    const reply = await agentLoop.handleMessage(incomingMsg);

    expect(promptHandler).toHaveBeenCalledTimes(1);
    expect(reply).toBe('Aksi dibatalkan karena operator menolak.');

    // Verify file was NOT created on disk (Invariant 6)
    const fileExists = await fs
      .access(path.join(targetProjectDir, 'unauthorized.txt'))
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(false);
  });

  it('should prevent infinite loops by enforcing maxIterations cap', async () => {
    // Provider continuously generates tool calls without stopping
    const infiniteCallsProvider = new MockAIProvider(
      'mock-model',
      Array.from({ length: 15 }, (_, i) => ({
        text: `Iteration ${i}`,
        toolCalls: [
          {
            id: `call_${i}`,
            name: 'list_dir',
            arguments: {}
          }
        ]
      }))
    );

    const agentLoop = new AutonomousAgentLoop({
      sessionId,
      botId: 'BOT_CODER',
      storage,
      provider: infiniteCallsProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      maxIterations: 4,
      botService,
      messagingService,
      sharedContextService
    });

    const incomingMsg: DirectMessage = {
      message_id: 'MSG_003',
      session_id: sessionId,
      sender_bot_id: 'BOT_ARCHITECT',
      recipient_bot_id: 'BOT_CODER',
      content: 'Lakukan perulangan tak berujung.',
      created_at: new Date().toISOString()
    };

    const reply = await agentLoop.handleMessage(incomingMsg);
    expect(reply).toContain('Mencapai batas maksimal 4 iterasi');
  });

  it('should automatically record work log entries when tools mutate files (FR-313, ADR-302)', async () => {
    const mockProvider = new MockAIProvider('mock-model', [
      {
        text: 'Membuat file konfigurasi server.',
        toolCalls: [
          {
            id: 'call_write_1',
            name: 'write_file',
            arguments: {
              path: 'config.json',
              content: '{"port": 8080}'
            }
          }
        ]
      },
      {
        text: 'Konfigurasi telah disimpan.'
      }
    ]);

    const agentLoop = new AutonomousAgentLoop({
      sessionId,
      botId: 'BOT_CODER',
      storage,
      provider: mockProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      botService,
      messagingService,
      sharedContextService
    });

    const msg: DirectMessage = {
      message_id: 'MSG_WORK_LOG_1',
      session_id: sessionId,
      sender_bot_id: 'BOT_ARCHITECT',
      recipient_bot_id: 'BOT_CODER',
      content: 'Buat config.json',
      created_at: new Date().toISOString()
    };

    await agentLoop.handleMessage(msg);

    // Verify automatic work log recording
    const workLogService = new WorkLogService(storage);
    const logs = await workLogService.readWorkLogs(sessionId);
    expect(logs.length).toBe(1);
    expect(logs[0]!.bot_id).toBe('BOT_CODER');
    expect(logs[0]!.action_type).toBe('WRITE');
    expect(logs[0]!.relative_path).toBe('config.json');
    expect(logs[0]!.summary).toContain('Wrote file config.json');
  });

  it('should allow AI to call get_work_log to inspect peer activities (FR-314, FR-315)', async () => {
    const workLogService = new WorkLogService(storage);
    await workLogService.recordWork(sessionId, {
      botId: 'BOT_ARCHITECT',
      botName: 'System Architect',
      actionType: 'WRITE',
      targetRootId: 'target_repo',
      targetRootName: 'target_repo',
      targetRootPath: targetProjectDir,
      relativePath: 'schema.sql',
      summary: 'Created initial SQL schema',
    });

    const mockProvider = new MockAIProvider('mock-model', [
      {
        text: 'Saya akan memeriksa apa yang sudah dibuat Architect.',
        toolCalls: [
          {
            id: 'call_get_log',
            name: 'get_work_log',
            arguments: { limit: 5 }
          }
        ]
      },
      {
        text: 'Saya melihat schema.sql telah dibuat. Sekarang saya siap melanjutkan.'
      }
    ]);

    const agentLoop = new AutonomousAgentLoop({
      sessionId,
      botId: 'BOT_CODER',
      storage,
      provider: mockProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      botService,
      messagingService,
      sharedContextService
    });

    const msg: DirectMessage = {
      message_id: 'MSG_WORK_LOG_2',
      session_id: sessionId,
      sender_bot_id: 'BOT_ARCHITECT',
      recipient_bot_id: 'BOT_CODER',
      content: 'Lanjutkan pekerjaan setelah schema dibuat.',
      created_at: new Date().toISOString()
    };

    const reply = await agentLoop.handleMessage(msg);
    expect(reply).toContain('Saya melihat schema.sql telah dibuat.');
  });
});
