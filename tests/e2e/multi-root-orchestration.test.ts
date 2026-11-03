import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { SharedContextService } from '../../src/shared/service.js';
import { WorkLogService } from '../../src/shared/work-log.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { PathTraversalSecurityError, executeFileTool, executeRunCommand } from '../../src/tools/index.js';

describe('Phase 6: End-to-End Multi-Root Orchestration Benchmark (v0.3.0)', () => {
  let tmpBlackboard: string;
  let backendRoot: string;
  let frontendRoot: string;
  let unauthorizedDir: string;

  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  let sharedContextService: SharedContextService;
  let workLogService: WorkLogService;

  const sessionId = 'S_MULTI_ROOT_BENCHMARK';

  beforeEach(async () => {
    tmpBlackboard = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-e2e-bb-'));
    backendRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-e2e-backend-'));
    frontendRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-e2e-frontend-'));
    unauthorizedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-e2e-unauthorized-'));

    await fs.mkdir(path.join(backendRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(frontendRoot, 'src'), { recursive: true });

    storage = new FilesystemSessionStorage(tmpBlackboard);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);
    sharedContextService = new SharedContextService(storage);
    workLogService = new WorkLogService(storage);

    // 1. Initialize Collaboration Session
    await sessionService.createSession({
      sessionId,
      sessionName: 'Multi-Root Enterprise Architecture Lab',
      description: 'E2E Cross-Root Orchestration Verification'
    });

    // 2. Register Dual Project Roots (Backend API + Frontend Web)
    await sharedContextService.registerProjectRoot(sessionId, {
      rootId: 'backend',
      name: 'Backend API Service',
      path: backendRoot,
      rootType: 'primary',
      description: 'Node.js Express REST Backend'
    });

    await sharedContextService.registerProjectRoot(sessionId, {
      rootId: 'frontend',
      name: 'Frontend Web Client',
      path: frontendRoot,
      rootType: 'primary',
      description: 'React Client Web Application'
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpBlackboard, { recursive: true, force: true });
      await fs.rm(backendRoot, { recursive: true, force: true });
      await fs.rm(frontendRoot, { recursive: true, force: true });
      await fs.rm(unauthorizedDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should orchestrate collaborative coding across multiple project roots with persistent work memory', async () => {
    // 3. Register Architect Bot (B001)
    const architectRuntime = new BotRuntime(storage, {
      sessionId,
      botId: 'B001',
      displayName: 'Architect',
      description: 'Lead System Architect'
    });
    await architectRuntime.start();

    // 4. Configure Coder Bot (B002) dedicated to backend root
    const coderMockAI = new MockAIProvider('coder-ai', [
      {
        text: 'Menerima instruksi pembuatan REST endpoint. Saya akan menulis backend/src/api.js.',
        toolCalls: [
          {
            id: 'call_write_api',
            name: 'write_file',
            arguments: {
              path: path.join(backendRoot, 'src/api.js'),
              content: [
                'function getStatus() { return { status: "online", version: "1.0.0" }; }',
                'function calculateTotal(items) { return items.reduce((acc, i) => acc + i.price * i.qty, 0); }',
                'module.exports = { getStatus, calculateTotal };'
              ].join('\n')
            }
          }
        ]
      },
      {
        text: 'File backend/src/api.js berhasil dibuat. Sekarang memverifikasi sintaks kode dengan node --check.',
        toolCalls: [
          {
            id: 'call_check_api',
            name: 'run_command',
            arguments: {
              command: 'node --check src/api.js',
              working_dir: backendRoot
            }
          }
        ]
      },
      {
        text: 'REST API backend/src/api.js telah selesai dibuat dan lolos verifikasi sintaks.'
      }
    ]);

    const coderAgentLoop = new AutonomousAgentLoop({
      sessionId,
      botId: 'B002',
      storage,
      provider: coderMockAI,
      executionModeController: new ExecutionModeController('TURBO'),
      botService,
      messagingService,
      sharedContextService
    });

    const coderRuntime = new BotRuntime(storage, {
      sessionId,
      botId: 'B002',
      displayName: 'Coder',
      description: 'Backend Developer',
      autoAcknowledge: true,
      onMessage: async (msg) => {
        await coderAgentLoop.handleMessage(msg);
      }
    });
    await coderRuntime.start();

    // 5. Configure Tester Bot (B003) dedicated to frontend root
    const testerMockAI = new MockAIProvider('tester-ai', [
      {
        text: 'Menerima instruksi verifikasi. Saya akan memeriksa work log sesi untuk mendeteksi apa yang dibuat Coder di backend.',
        toolCalls: [
          {
            id: 'call_get_log',
            name: 'get_work_log',
            arguments: {
              root_id: 'backend',
              limit: 5
            }
          }
        ]
      },
      {
        text: 'Terdeteksi Coder telah membuat backend/src/api.js. Saya akan membuat client unit test di frontend/src/client.test.js.',
        toolCalls: [
          {
            id: 'call_write_test',
            name: 'write_file',
            arguments: {
              path: path.join(frontendRoot, 'src/client.test.js'),
              content: [
                'const assert = require("node:assert");',
                'const api = { getStatus: () => ({ status: "online", version: "1.0.0" }) };',
                'assert.strictEqual(api.getStatus().status, "online");',
                'console.log("CLIENT_TESTS_PASSED");'
              ].join('\n')
            }
          }
        ]
      },
      {
        text: 'Menjalankan client unit test menggunakan Node.js.',
        toolCalls: [
          {
            id: 'call_run_test',
            name: 'run_command',
            arguments: {
              command: 'node src/client.test.js',
              working_dir: frontendRoot
            }
          }
        ]
      },
      {
        text: 'Pengujian client di root frontend berhasil lulus 100%. Integrasi lintas-root siap.'
      }
    ]);

    const testerAgentLoop = new AutonomousAgentLoop({
      sessionId,
      botId: 'B003',
      storage,
      provider: testerMockAI,
      executionModeController: new ExecutionModeController('TURBO'),
      botService,
      messagingService,
      sharedContextService
    });

    const testerRuntime = new BotRuntime(storage, {
      sessionId,
      botId: 'B003',
      displayName: 'Tester',
      description: 'QA & Test Engineer',
      autoAcknowledge: true,
      onMessage: async (msg) => {
        await testerAgentLoop.handleMessage(msg);
      }
    });
    await testerRuntime.start();

    // =========================================================================
    // Step 1: Architect -> Coder (Backend Root Work)
    // =========================================================================
    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'B001',
      recipient: 'B002',
      content: 'Tolong buatkan endpoint REST API di backend/src/api.js dan verifikasi sintaksnya.'
    });

    await coderRuntime.pollCycle();

    // Verify Backend File on Disk
    const apiFileContent = await fs.readFile(path.join(backendRoot, 'src/api.js'), 'utf-8');
    expect(apiFileContent).toContain('function getStatus()');
    expect(apiFileContent).toContain('function calculateTotal(items)');

    // Verify Backend Work Log Recording (FR-312, FR-313)
    const backendLogs = await workLogService.readWorkLogs(sessionId, { rootId: 'backend' });
    expect(backendLogs.length).toBeGreaterThanOrEqual(2);

    const writeLog = backendLogs.find((l) => l.action_type === 'WRITE');
    expect(writeLog).toBeDefined();
    expect(writeLog!.bot_id).toBe('B002');
    expect(writeLog!.bot_name).toBe('Coder');
    expect(writeLog!.target_root_id).toBe('backend');
    expect(writeLog!.target_root_name).toBe('Backend API Service');
    expect(writeLog!.relative_path).toBe('src/api.js');

    const cmdLog = backendLogs.find((l) => l.action_type === 'COMMAND');
    expect(cmdLog).toBeDefined();
    expect(cmdLog!.bot_id).toBe('B002');
    expect(cmdLog!.target_root_id).toBe('backend');

    // =========================================================================
    // Step 2: Architect -> Tester (Cross-Root Discovery & Frontend Root Work)
    // =========================================================================
    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'B001',
      recipient: 'B003',
      content: 'Periksa riwayat kerja backend di work log, lalu buatkan client unit test di frontend.'
    });

    await testerRuntime.pollCycle();

    // Verify Frontend File on Disk
    const testFileContent = await fs.readFile(path.join(frontendRoot, 'src/client.test.js'), 'utf-8');
    expect(testFileContent).toContain('CLIENT_TESTS_PASSED');

    // Verify Frontend Work Log Recording (FR-312, FR-313)
    const frontendLogs = await workLogService.readWorkLogs(sessionId, { rootId: 'frontend' });
    expect(frontendLogs.length).toBeGreaterThanOrEqual(2);

    const frontendWriteLog = frontendLogs.find((l) => l.action_type === 'WRITE');
    expect(frontendWriteLog).toBeDefined();
    expect(frontendWriteLog!.bot_id).toBe('B003');
    expect(frontendWriteLog!.bot_name).toBe('Tester');
    expect(frontendWriteLog!.target_root_id).toBe('frontend');
    expect(frontendWriteLog!.target_root_name).toBe('Frontend Web Client');
    expect(frontendWriteLog!.relative_path).toBe('src/client.test.js');

    // =========================================================================
    // Step 3: Global Session Work Memory Verification & Situational Awareness
    // =========================================================================
    const allLogs = await workLogService.readWorkLogs(sessionId);
    expect(allLogs.length).toBeGreaterThanOrEqual(4); // 2 backend + 2 frontend

    for (const log of allLogs) {
      expect(log.entry_id).toMatch(/^work_\d+_[a-f0-9]{6}$/);
      expect(log.session_id).toBe(sessionId);
      expect(log.timestamp).toBeDefined();
      expect(['backend', 'frontend']).toContain(log.target_root_id);
      expect(log.summary).toBeDefined();
    }

    const summaryMd = await workLogService.getRecentSummaryMarkdown(sessionId, 10);
    expect(summaryMd).toContain('Coder [WRITE] root "Backend API Service" (src/api.js)');
    expect(summaryMd).toContain('Tester [WRITE] root "Frontend Web Client" (src/client.test.js)');

    // =========================================================================
    // Step 4: Strict Enforcement of Invariant 5 (Sandbox Boundary & Anti-Traversal)
    // =========================================================================
    const projectRootPaths = [backendRoot, frontendRoot];

    // Attempt 1: write_file targeting outside unauthorized path must be rejected
    const unauthorizedFilePath = path.join(unauthorizedDir, 'leak.txt');
    await expect(
      executeFileTool(projectRootPaths, 'write_file', {
        path: unauthorizedFilePath,
        content: 'Malicious payload'
      })
    ).rejects.toThrow(PathTraversalSecurityError);

    // Verify no file written to unauthorized folder
    const leakExists = await fs.access(unauthorizedFilePath).then(() => true).catch(() => false);
    expect(leakExists).toBe(false);

    // Attempt 2: run_command targeting outside unauthorized working directory must be rejected
    await expect(
      executeRunCommand(projectRootPaths, {
        command: 'echo unauthorized',
        working_dir: unauthorizedDir
      })
    ).rejects.toThrow(PathTraversalSecurityError);

    // Clean shutdown
    await architectRuntime.stop();
    await coderRuntime.stop();
    await testerRuntime.stop();
  });
});
