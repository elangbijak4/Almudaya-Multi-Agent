import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { BotConsole } from '../../src/bot/console.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { SharedContextService } from '../../src/shared/service.js';
import { WorkLogService } from '../../src/shared/work-log.js';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';

describe('Interactive Bot Console REPL (FR-301..310, FR-317, FR-318, ADR-301)', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let contextService: SharedContextService;
  let workLogService: WorkLogService;
  let runtime: BotRuntime;
  let inputStream: PassThrough;
  let outputStream: PassThrough;
  let outputBuffer: string;

  const sessionId = 'SESS_CONSOLE_01';
  const botId = 'B001';

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-console-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    contextService = new SharedContextService(storage);
    workLogService = new WorkLogService(storage);

    await sessionService.createSession({
      sessionId,
      sessionName: 'Interactive Console Lab',
    });

    // Register secondary peer bot B002
    await botService.registerBot(sessionId, {
      botId: 'B002',
      displayName: 'Coder',
      description: 'Backend Developer',
      status: 'active',
      pid: 1234,
    });

    // Register a project root
    await contextService.registerProjectRoot(sessionId, {
      rootId: 'backend',
      name: 'Backend API',
      path: path.join(tmpWorkspace, 'backend'),
      description: 'Main REST API service',
    });

    // Setup streams
    inputStream = new PassThrough();
    outputStream = new PassThrough();
    outputBuffer = '';

    outputStream.on('data', (chunk) => {
      outputBuffer += chunk.toString();
    });

    // Setup runtime for primary bot B001
    runtime = new BotRuntime(storage, {
      sessionId,
      botId,
      displayName: 'Architect',
      description: 'System Architect',
      heartbeatIntervalMs: 5000,
    });

    await runtime.start();
  });

  afterEach(async () => {
    if (runtime && runtime.running) {
      await runtime.stop();
    }
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Console Initialization & Banner (FR-301)', () => {
    it('should start console, render banner and prompt without blocking', async () => {
      const modeController = new ExecutionModeController('REQUEST_REVIEW');
      const botConsole = new BotConsole({
        runtime,
        storage,
        executionModeController: modeController,
        inputStream,
        outputStream,
      });

      await botConsole.start();

      expect(outputBuffer).toContain('Interactive Bot Console REPL');
      expect(outputBuffer).toContain('Bot: "Architect" [B001]');
      expect(outputBuffer).toContain('Mode: REQUEST_REVIEW');
      expect(botConsole.promptString).toBe('Architect> ');

      await botConsole.stop();
    });
  });

  describe('Slash Commands Dispatching (FR-302, FR-303, FR-305..309)', () => {
    let botConsole: BotConsole;
    let modeController: ExecutionModeController;

    beforeEach(async () => {
      modeController = new ExecutionModeController('REQUEST_REVIEW');
      botConsole = new BotConsole({
        runtime,
        storage,
        executionModeController: modeController,
        inputStream,
        outputStream,
      });
      await botConsole.start();
      outputBuffer = ''; // Clear banner
    });

    afterEach(async () => {
      await botConsole.stop();
    });

    it('should handle /help by listing available slash commands', async () => {
      await botConsole.handleInput('/help');
      expect(outputBuffer).toContain('/msg <targetBot> <pesan>');
      expect(outputBuffer).toContain('/broadcast <pesan>');
      expect(outputBuffer).toContain('/peers');
      expect(outputBuffer).toContain('/roots');
      expect(outputBuffer).toContain('/log [limit] [root]');
      expect(outputBuffer).toContain('/mode [review|turbo]');
      expect(outputBuffer).toContain('/status');
      expect(outputBuffer).toContain('/exit, /quit');
    });

    it('should handle /status by displaying bot status and process PID', async () => {
      await botConsole.handleInput('/status');
      expect(outputBuffer).toContain('Status Bot "Architect" [B001]:');
      expect(outputBuffer).toContain(`Session ID:     ${sessionId}`);
      expect(outputBuffer).toContain('Status:         active');
      expect(outputBuffer).toContain('Execution Mode: REQUEST_REVIEW');
      expect(outputBuffer).toContain(`Process PID:    ${process.pid}`);
    });

    it('should handle /peers by listing active peers in session', async () => {
      await botConsole.handleInput('/peers');
      expect(outputBuffer).toContain(`Rekan Bot dalam Sesi [${sessionId}]:`);
      expect(outputBuffer).toContain('[B001] "Architect" (active) (bot ini)');
      expect(outputBuffer).toContain('[B002] "Coder"');
    });

    it('should handle /roots by listing registered project roots', async () => {
      await botConsole.handleInput('/roots');
      expect(outputBuffer).toContain(`Project Roots Terdaftar [${sessionId}]:`);
      expect(outputBuffer).toContain('[backend] "Backend API" (primary)');
    });

    it('should handle /mode to inspect and dynamically toggle execution mode (FR-307)', async () => {
      // Query current mode
      await botConsole.handleInput('/mode');
      expect(outputBuffer).toContain('Mode eksekusi saat ini: REQUEST_REVIEW');

      outputBuffer = '';
      // Switch to TURBO
      await botConsole.handleInput('/mode turbo');
      expect(outputBuffer).toContain('Mode eksekusi diubah menjadi: TURBO');
      expect(modeController.getMode()).toBe('TURBO');

      outputBuffer = '';
      // Switch back to REVIEW
      await botConsole.handleInput('/mode review');
      expect(outputBuffer).toContain('Mode eksekusi diubah menjadi: REQUEST_REVIEW');
      expect(modeController.getMode()).toBe('REQUEST_REVIEW');

      outputBuffer = '';
      // Invalid mode
      await botConsole.handleInput('/mode superturbo');
      expect(outputBuffer).toContain('Mode tidak dikenal. Pilihan valid: /mode review atau /mode turbo');
    });

    it('should handle /msg to send direct messages to peers (FR-302)', async () => {
      await botConsole.handleInput('/msg B002 Halo Coder silakan buat API server');
      expect(outputBuffer).toContain('Pesan terkirim ke "B002": "Halo Coder silakan buat API server"');

      // Verify inbox of B002 has received the message
      const messagingStorage = storage;
      const inbox = await messagingStorage.getInbox(sessionId, 'B002');
      expect(inbox.messages.length).toBe(1);
      expect(inbox.messages[0]!.sender_bot_id).toBe('B001');
      expect(inbox.messages[0]!.content).toBe('Halo Coder silakan buat API server');
    });

    it('should report error when /msg has invalid syntax or recipient does not exist', async () => {
      await botConsole.handleInput('/msg');
      expect(outputBuffer).toContain('Penggunaan: /msg <targetBot> <pesan>');

      outputBuffer = '';
      await botConsole.handleInput('/msg NON_EXISTENT_BOT Halo');
      expect(outputBuffer).toContain('Gagal mengirim pesan:');
    });

    it('should handle /broadcast to publish events to session (FR-303)', async () => {
      await botConsole.handleInput('/broadcast Proyek v0.3.0 dimulai');
      expect(outputBuffer).toContain('Broadcast dipublikasikan: "Proyek v0.3.0 dimulai"');

      // Verify broadcast in blackboard
      const broadcasts = await storage.readBroadcasts(sessionId);
      expect(broadcasts.length).toBe(1);
      expect(broadcasts[0]!.sender_bot_id).toBe('B001');
      expect(broadcasts[0]!.content).toBe('Proyek v0.3.0 dimulai');
    });

    it('should handle /log to view shared session work history (FR-308)', async () => {
      // Record a work log entry
      await workLogService.recordWork(sessionId, {
        botId: 'B002',
        botName: 'Coder',
        actionType: 'WRITE',
        targetRootId: 'backend',
        targetRootName: 'Backend API',
        targetRootPath: path.join(tmpWorkspace, 'backend'),
        relativePath: 'src/main.ts',
        summary: 'Created REST entrypoint',
      });

      await botConsole.handleInput('/log');
      expect(outputBuffer).toContain('Riwayat Kerja Sesi (menampilkan 1 entri):');
      expect(outputBuffer).toContain('Coder [WRITE] root "Backend API" (src/main.ts): Created REST entrypoint');
    });

    it('should handle /clear in non-TTY and unknown commands gracefully', async () => {
      await botConsole.handleInput('/clear');
      expect(outputBuffer).toContain('--- CLEAR SCREEN ---');

      outputBuffer = '';
      await botConsole.handleInput('/foobar');
      expect(outputBuffer).toContain('Perintah "/foobar" tidak dikenal. Ketik /help');
    });

    it('should gracefully stop console and bot on /exit or /quit (FR-318)', async () => {
      const exitSpy = vi.fn();
      const exitConsole = new BotConsole({
        runtime,
        storage,
        onExit: async () => exitSpy(),
        inputStream: new PassThrough(),
        outputStream: new PassThrough(),
      });

      await exitConsole.start();
      await exitConsole.handleInput('/exit');

      expect(runtime.running).toBe(false);
      expect(exitSpy).toHaveBeenCalled();
    });
  });

  describe('Direct Natural Language Instruction (FR-304)', () => {
    it('should forward plain text instructions to AutonomousAgentLoop if AI provider is present', async () => {
      const mockProvider = new MockAIProvider('mock-flash', [
        { text: 'Instruksi operator telah selesai dieksekusi dengan sukses.' },
      ]);

      const modeController = new ExecutionModeController('TURBO');
      const agentLoop = new AutonomousAgentLoop({
        sessionId,
        botId,
        storage,
        provider: mockProvider,
        executionModeController: modeController,
      });

      const botConsole = new BotConsole({
        runtime,
        agentLoop,
        storage,
        executionModeController: modeController,
        aiProvider: mockProvider,
        inputStream,
        outputStream,
      });

      await botConsole.start();
      outputBuffer = '';

      await botConsole.handleInput('Tolong verifikasi skema database');

      expect(outputBuffer).toContain('Memproses instruksi operator: "Tolong verifikasi skema database"');
      expect(outputBuffer).toContain('Instruksi operator telah selesai dieksekusi dengan sukses.');

      await botConsole.stop();
    });

    it('should display helpful warning if operator sends plain text but AI provider is not enabled', async () => {
      const botConsole = new BotConsole({
        runtime,
        storage,
        inputStream,
        outputStream,
      });

      await botConsole.start();
      outputBuffer = '';

      await botConsole.handleInput('Buatkan file index.html');

      expect(outputBuffer).toContain('AI Provider tidak aktif untuk bot ini.');
      expect(outputBuffer).toContain('Gunakan /msg untuk mengirim pesan ke bot lain atau jalankan bot dengan opsi --provider.');

      await botConsole.stop();
    });
  });

  describe('Non-Destructive Notification Rendering (FR-310, ADR-301)', () => {
    it('should write notification with newline in standard output stream', () => {
      const botConsole = new BotConsole({
        runtime,
        storage,
        inputStream,
        outputStream,
      });

      botConsole.printNotification('Pesan masuk dari B002');
      expect(outputBuffer).toContain('Pesan masuk dari B002\n');
    });

    it('should write ANSI escape sequence in TTY mode without mangling prompt buffer', async () => {
      const ttyOutputStream = new PassThrough() as PassThrough & { isTTY: boolean };
      ttyOutputStream.isTTY = true;

      let ttyBuffer = '';
      ttyOutputStream.on('data', (c) => {
        ttyBuffer += c.toString();
      });

      const botConsole = new BotConsole({
        runtime,
        storage,
        inputStream,
        outputStream: ttyOutputStream,
      });

      await botConsole.start();
      botConsole.printNotification('Incoming Broadcast');
      expect(ttyBuffer).toContain('\r\x1b[KIncoming Broadcast\n');
      await botConsole.stop();
    });
  });

  describe('Human-in-the-Loop Review Integration (FR-317)', () => {
    it('should prompt question and resolve operator response', async () => {
      const botConsole = new BotConsole({
        runtime,
        storage,
        inputStream,
        outputStream,
      });

      await botConsole.start();

      // Simulate operator answering 'y'
      const questionPromise = botConsole.askQuestion('Setujui eksekusi? (y/n): ');
      // Feed answer through inputStream
      inputStream.write('y\n');

      const answer = await questionPromise;
      expect(answer).toBe('y');

      await botConsole.stop();
    });
  });

  describe('REPL Non-Reentrancy and FIFO Input Ordering (PERF-01, §19, BP §5.21)', () => {
    it('should process multiple consecutive input lines sequentially in FIFO order without reentrancy', async () => {
      const processed: string[] = [];
      const botConsole = new BotConsole({
        runtime,
        storage,
        inputStream,
        outputStream,
      });

      // Spy on dispatchSlashCommand to simulate async processing delay
      const originalDispatch = botConsole.dispatchSlashCommand.bind(botConsole);
      vi.spyOn(botConsole, 'dispatchSlashCommand').mockImplementation(async (line: string) => {
        processed.push(`start:${line}`);
        await new Promise((resolve) => setTimeout(resolve, 30));
        processed.push(`end:${line}`);
        return originalDispatch(line);
      });

      await botConsole.start();

      // Feed multiple lines rapidly into input stream
      inputStream.write('/mode\n/status\n/mode\n');

      // Wait for all lines to be processed
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Each command must start and end before the next command starts (strict serial execution)
      expect(processed).toEqual([
        'start:/mode',
        'end:/mode',
        'start:/status',
        'end:/status',
        'start:/mode',
        'end:/mode',
      ]);

      await botConsole.stop();
    });
  });
});
