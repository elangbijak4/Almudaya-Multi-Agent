import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { DisplayNameConflictError } from '../../src/core/errors.js';

describe('Phase 7: End-to-End Proof of Concept (MASTER_PROMPT.md Section 10)', () => {
  let tmpWorkspace: string;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  const activeProcesses: ChildProcess[] = [];

  const cliBinPath = path.resolve('dist/cli/bin.js');

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-poc-e2e-'));
    const storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);
  });

  afterEach(async () => {
    for (const proc of activeProcesses) {
      try {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      } catch {
        // Ignore
      }
    }
    activeProcesses.length = 0;

    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should execute the complete two-terminal proof of concept scenario', async () => {
    // Step 1: Create Session S001
    const session = await sessionService.createSession({
      sessionId: 'S001',
      sessionName: 'Research Collab',
      description: 'End-to-End POC Session',
    });
    expect(session.session_id).toBe('S001');

    // Step 2: Start BOT001 in Terminal 1 process
    const term1Proc = spawn(
      process.execPath,
      [
        cliBinPath,
        'bot',
        'run',
        '--session',
        'S001',
        '--bot',
        'BOT001',
        '--name',
        'Architect',
        '--description',
        'Lead System Architect',
        '--auto-ack',
        '-w',
        tmpWorkspace,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    activeProcesses.push(term1Proc);

    // Wait for BOT001 registration
    let bot1Ready = false;
    const waitStart1 = Date.now();
    while (Date.now() - waitStart1 < 5000) {
      try {
        const b = await botService.getBot('S001', 'BOT001');
        if (b.status === 'active' && b.pid === term1Proc.pid) {
          bot1Ready = true;
          break;
        }
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(bot1Ready).toBe(true);

    // Step 3: Start BOT002 in Terminal 2 process
    const term2Proc = spawn(
      process.execPath,
      [
        cliBinPath,
        'bot',
        'run',
        '--session',
        'S001',
        '--bot',
        'BOT002',
        '--name',
        'Worker',
        '--description',
        'Feature Engineer',
        '-w',
        tmpWorkspace,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    activeProcesses.push(term2Proc);

    let bot2Ready = false;
    const waitStart2 = Date.now();
    while (Date.now() - waitStart2 < 5000) {
      try {
        const b = await botService.getBot('S001', 'BOT002');
        if (b.status === 'active' && b.pid === term2Proc.pid) {
          bot2Ready = true;
          break;
        }
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(bot2Ready).toBe(true);

    // Step 4: Confirm both are present in the same persistent Session Blackboard
    const peerList = await botService.listBots('S001');
    expect(peerList.length).toBe(2);
    expect(peerList.map((p) => p.bot_id).sort()).toEqual(['BOT001', 'BOT002']);

    // Step 5: Confirm each bot can discover the other's Bot ID, display name, and description
    const bot1Data = await botService.getBot('S001', 'BOT001');
    const bot2Data = await botService.getBot('S001', 'BOT002');

    expect(bot1Data.display_name).toBe('Architect');
    expect(bot1Data.description).toBe('Lead System Architect');

    expect(bot2Data.display_name).toBe('Worker');
    expect(bot2Data.description).toBe('Feature Engineer');

    // Step 6: Confirm BOT001 can broadcast an event and BOT002 can read it
    const broadcastEvent = await messagingService.publishBroadcast('S001', {
      senderBotId: 'BOT001',
      category: 'DECISION',
      content: 'Architecture blueprint finalized',
    });
    expect(broadcastEvent.event_id).toBeDefined();

    const bot2Observed = await messagingService.readBroadcasts('S001', {
      botId: 'BOT002',
      autoAdvanceCursor: true,
    });
    expect(bot2Observed.length).toBe(1);
    expect(bot2Observed[0]?.content).toBe('Architecture blueprint finalized');
    expect(bot2Observed[0]?.sender_bot_id).toBe('BOT001');

    // Step 7: Confirm BOT002 can send a direct message to BOT001 (using display name "Architect")
    const directMsg = await messagingService.sendDirectMessage('S001', {
      senderBotId: 'BOT002',
      recipient: 'Architect',
      content: 'Requesting code review for module A',
    });
    expect(directMsg.recipient_bot_id).toBe('BOT001');

    // Step 8: Confirm BOT001 can read and acknowledge the message
    let messageAcknowledged = false;
    const waitAck = Date.now();
    while (Date.now() - waitAck < 5000) {
      const inbox = await messagingService.readInbox('S001', 'BOT001');
      if (inbox.length > 0 && inbox[0]?.status === 'acknowledged') {
        messageAcknowledged = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(messageAcknowledged).toBe(true);

    // Step 9: Stop both processes
    term1Proc.kill('SIGTERM');
    term2Proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));

    // Step 10: Restart and verify Session, registry, broadcast, and message history persist
    const freshStorage = new FilesystemSessionStorage(tmpWorkspace);
    const freshSessionService = new SessionService(freshStorage);
    const freshBotService = new BotService(freshStorage);
    const freshMessagingService = new MessagingService(freshStorage, freshBotService);

    const reloadedSession = await freshSessionService.getSession('S001');
    expect(reloadedSession.session_name).toBe('Research Collab');

    const reloadedBots = await freshBotService.listBots('S001');
    expect(reloadedBots.length).toBe(2);

    const reloadedBroadcasts = await freshMessagingService.readBroadcasts('S001');
    expect(reloadedBroadcasts.length).toBe(1);
    expect(reloadedBroadcasts[0]?.content).toBe('Architecture blueprint finalized');

    const reloadedInbox = await freshMessagingService.readInbox('S001', 'BOT001');
    expect(reloadedInbox.length).toBe(1);
    expect(reloadedInbox[0]?.content).toBe('Requesting code review for module A');
    expect(reloadedInbox[0]?.status).toBe('acknowledged');

    // Step 11: Verify that renaming a bot changes its display name but not its stable Bot ID or historical messages
    const renamed = await freshBotService.renameBot('S001', 'BOT001', 'Principal Architect');
    expect(renamed.bot_id).toBe('BOT001');
    expect(renamed.display_name).toBe('Principal Architect');

    // Historical messages must still point to stable Bot ID BOT001
    const postRenameInbox = await freshMessagingService.readInbox('S001', 'Principal Architect');
    expect(postRenameInbox.length).toBe(1);
    expect(postRenameInbox[0]?.recipient_bot_id).toBe('BOT001');
    expect(postRenameInbox[0]?.message_id).toBe(directMsg.message_id);

    // Step 12: Verify that duplicate display names are rejected
    await expect(
      freshBotService.registerBot('S001', { displayName: 'Worker' })
    ).rejects.toThrow(DisplayNameConflictError);

    await expect(
      freshBotService.renameBot('S001', 'BOT001', 'Worker')
    ).rejects.toThrow(DisplayNameConflictError);
  }, 25000);
});
