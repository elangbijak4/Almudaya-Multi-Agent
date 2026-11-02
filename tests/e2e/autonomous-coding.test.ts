import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { SharedContextService } from '../../src/shared/service.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { MockAIProvider } from '../../src/ai/mock-provider.js';

describe('Phase 7: End-to-End Autonomous Multi-Bot Coding Benchmark (v0.2.0)', () => {
  let tmpBlackboard: string;
  let targetProjectDir: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  let sharedContextService: SharedContextService;
  const sessionId = 'S_CODING_BENCHMARK';

  beforeEach(async () => {
    tmpBlackboard = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-e2e-blackboard-'));
    targetProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-target-repo-'));

    storage = new FilesystemSessionStorage(tmpBlackboard);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);
    sharedContextService = new SharedContextService(storage);

    // 1. Initialize Collaboration Session
    await sessionService.createSession({
      sessionId,
      sessionName: 'Autonomous Coding Lab',
      description: 'E2E Validation for v0.2.0 Autonomous Coding Engine'
    });

    // 2. Register Target Project Root (Sandboxed Workspace)
    await sharedContextService.registerProjectRoot(sessionId, {
      name: 'target_repo',
      path: targetProjectDir,
      rootType: 'primary',
      description: 'Production target codebase for bot engineering'
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpBlackboard, { recursive: true, force: true });
      await fs.rm(targetProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should execute end-to-end multi-bot collaborative coding and file verification', async () => {
    // 3. Register Architect Bot (BOT001)
    const architectRuntime = new BotRuntime(storage, {
      sessionId,
      botId: 'BOT_ARCHITECT',
      displayName: 'Architect',
      description: 'System Architect Lead'
    });
    await architectRuntime.start();

    // 4. Configure Coder Bot (BOT002) with MockAIProvider simulating complete ReAct workflow:
    // Turn 1: AI calls write_file to create "math.js"
    // Turn 2: AI calls run_command to execute automated tests against "math.js"
    // Turn 3: AI produces final report and sends back to Architect
    const coderMockAI = new MockAIProvider('coder-ai-v1', [
      {
        text: 'Menerima tugas. Saya akan membuat file math.js di project root.',
        toolCalls: [
          {
            id: 'call_write_math',
            name: 'write_file',
            arguments: {
              path: 'math.js',
              content: 'function add(a, b) { return a + b; }\nfunction multiply(a, b) { return a * b; }\nmodule.exports = { add, multiply };\n'
            }
          }
        ]
      },
      {
        text: 'File math.js berhasil dibuat. Sekarang saya akan memverifikasi menggunakan tes unit Node.js.',
        toolCalls: [
          {
            id: 'call_test_math',
            name: 'run_command',
            arguments: {
              command: 'node -e "const { add, multiply } = require(\'./math.js\'); if (add(2, 3) !== 5 || multiply(4, 5) !== 20) process.exit(1); console.log(\'ALL_TESTS_PASSED\');"'
            }
          }
        ]
      },
      {
        text: 'Seluruh pengujian unit untuk modul math.js berhasil lulus (100% PASS). File siap digunakan.'
      }
    ]);

    const coderExecutionController = new ExecutionModeController('TURBO');

    const coderAgentLoop = new AutonomousAgentLoop({
      sessionId,
      botId: 'BOT_CODER',
      storage,
      provider: coderMockAI,
      executionModeController: coderExecutionController,
      botService,
      messagingService,
      sharedContextService
    });

    const coderRuntime = new BotRuntime(storage, {
      sessionId,
      botId: 'BOT_CODER',
      displayName: 'Coder',
      description: 'Senior Software Engineer',
      autoAcknowledge: true,
      onMessage: async (msg) => {
        await coderAgentLoop.handleMessage(msg);
      }
    });
    await coderRuntime.start();

    // 5. Architect sends coding task to Coder via direct message
    const taskMessage = await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT_ARCHITECT',
      recipient: 'BOT_CODER',
      content: 'Tolong buatkan modul kalkulator math.js dengan fungsi add dan multiply, serta jalankan verifikasi tes.'
    });

    // 6. Coder polls and executes autonomous ReAct loop
    await coderRuntime.pollCycle();

    // 7. Verification: Check disk file created in target project root
    const createdFileContent = await fs.readFile(
      path.join(targetProjectDir, 'math.js'),
      'utf8'
    );
    expect(createdFileContent).toContain('function add(a, b)');
    expect(createdFileContent).toContain('module.exports = { add, multiply };');

    // 8. Verification: Check Architect's inbox received autonomous completion reply
    const architectInbox = await messagingService.readInbox(sessionId, 'BOT_ARCHITECT');
    expect(architectInbox.length).toBe(1);
    expect(architectInbox[0]!.sender_bot_id).toBe('BOT_CODER');
    expect(architectInbox[0]!.content).toContain('Seluruh pengujian unit untuk modul math.js berhasil lulus');
    expect(architectInbox[0]!.metadata?.correlationId).toBe(taskMessage.message_id);

    // 9. Verification: Check Blackboard Audit Trail
    const broadcasts = await messagingService.readBroadcasts(sessionId, {
      botId: 'AUDITOR'
    });
    const activityEvents = broadcasts.filter((b) => b.category === 'ACTIVITY');
    const decisionEvents = broadcasts.filter((b) => b.category === 'DECISION');

    expect(activityEvents.length).toBeGreaterThanOrEqual(2); // write_file + run_command
    expect(decisionEvents.length).toBeGreaterThanOrEqual(1); // completion decision

    // 10. Clean shutdown
    await architectRuntime.stop();
    await coderRuntime.stop();
  });
});
