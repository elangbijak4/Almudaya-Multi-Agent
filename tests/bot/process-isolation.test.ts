import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';

describe('Multi-Process Bot Isolation & Crash Recovery (Invariants 3, 4 & FR-023)', () => {
  let tmpWorkspace: string;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  const spawnedProcesses: ChildProcess[] = [];

  const cliBinPath = path.resolve('dist/cli/bin.js');

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-proc-isolation-'));
    const storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    await sessionService.createSession({ sessionId: 'S001', sessionName: 'Isolation Lab' });
  });

  afterEach(async () => {
    // Ensure all spawned child processes are cleanly killed
    for (const proc of spawnedProcesses) {
      try {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      } catch {
        // Ignore
      }
    }
    spawnedProcesses.length = 0;

    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should run independent bot process and continue operating when another bot process is blocked or terminated', async () => {
    // 1. Spawn Bot 1 in independent Node.js process using CLI 'bot run'
    const bot1Proc = spawn(
      process.execPath,
      [cliBinPath, 'bot', 'run', '--session', 'S001', '--bot', 'BOT001', '--auto-ack', '-w', tmpWorkspace],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    spawnedProcesses.push(bot1Proc);

    // Wait for Bot 1 to start and register in Blackboard
    let bot1Active = false;
    const startWait = Date.now();
    while (Date.now() - startWait < 5000) {
      try {
        const bot = await botService.getBot('S001', 'BOT001');
        if (bot.status === 'active' && bot.pid === bot1Proc.pid) {
          bot1Active = true;
          break;
        }
      } catch {
        // Wait and retry
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(bot1Active).toBe(true);

    // 2. Spawn Bot 2 in separate independent process
    const bot2Proc = spawn(
      process.execPath,
      [cliBinPath, 'bot', 'run', '--session', 'S001', '--bot', 'BOT002', '-w', tmpWorkspace],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    spawnedProcesses.push(bot2Proc);

    let bot2Active = false;
    const startWait2 = Date.now();
    while (Date.now() - startWait2 < 5000) {
      try {
        const bot = await botService.getBot('S001', 'BOT002');
        if (bot.status === 'active' && bot.pid === bot2Proc.pid) {
          bot2Active = true;
          break;
        }
      } catch {
        // Wait and retry
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(bot2Active).toBe(true);
    expect(bot1Proc.pid).not.toBe(bot2Proc.pid);

    // 3. Bot 2 sends message to Bot 1; Bot 1's process auto-acknowledges it
    await messagingService.sendDirectMessage('S001', {
      senderBotId: 'BOT002',
      recipient: 'BOT001',
      content: 'Independent process message',
    });

    let messageAcked = false;
    const ackWait = Date.now();
    while (Date.now() - ackWait < 5000) {
      const inbox = await messagingService.readInbox('S001', 'BOT001');
      if (inbox.length > 0 && inbox[0]?.status === 'acknowledged') {
        messageAcked = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(messageAcked).toBe(true);

    // 4. Kill Bot 1 process abruptly (simulated crash / abnormal termination)
    bot1Proc.kill('SIGKILL');

    // Bot 2 continues to broadcast without blockage
    const broadcastEvent = await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT002',
      category: 'STATUS',
      content: 'Bot 2 active while Bot 1 crashed',
    });
    expect(broadcastEvent.sender_bot_id).toBe('BOT002');

    // 5. Verify crash recovery: Reconciling liveness detects dead PID and marks Bot 1 stale
    const reconciled = await botService.reconcileBotLiveness('S001', 5000);
    const bot1Record = reconciled.find((b) => b.bot_id === 'BOT001');
    const bot2Record = reconciled.find((b) => b.bot_id === 'BOT002');

    expect(bot1Record?.status).toBe('stale');
    expect(bot2Record?.status).toBe('active');
  }, 20000);
});
