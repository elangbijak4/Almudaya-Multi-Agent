import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';

describe('Bot Runtime Lifecycle & Heartbeat', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-runtime-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    await sessionService.createSession({ sessionId: 'S001', sessionName: 'Runtime Lab' });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should start runtime, record PID, and stop cleanly updating status to stopped', async () => {
    const runtime = new BotRuntime(storage, {
      sessionId: 'S001',
      botId: 'BOT001',
      displayName: 'Lifecycle Bot',
    });

    const started = await runtime.start();
    expect(started.status).toBe('active');
    expect(started.pid).toBe(process.pid);
    expect(runtime.running).toBe(true);

    // Stop runtime
    await runtime.stop();
    expect(runtime.running).toBe(false);

    const reloaded = await botService.getBot('S001', 'BOT001');
    expect(reloaded.status).toBe('stopped');
  });

  it('should automatically update heartbeat timestamp while running', async () => {
    const runtime = new BotRuntime(storage, {
      sessionId: 'S001',
      botId: 'BOT001',
      heartbeatIntervalMs: 50,
    });

    const initial = await runtime.start();
    const initialSeen = new Date(initial.last_seen_at).getTime();

    // Wait for heartbeat update with polling resilience against high-load worker starvation
    let updatedSeen = initialSeen;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const updated = await botService.getBot('S001', 'BOT001');
      updatedSeen = new Date(updated.last_seen_at).getTime();
      if (updatedSeen > initialSeen) break;
    }

    expect(updatedSeen).toBeGreaterThan(initialSeen);

    await runtime.stop();
  });

  it('should consume incoming direct messages and auto-acknowledge when enabled', async () => {
    let messageReceived = false;

    const runtime = new BotRuntime(storage, {
      sessionId: 'S001',
      botId: 'BOT001',
      pollIntervalMs: 50,
      autoAcknowledge: true,
      onMessage: async (msg) => {
        if (msg.content === 'Task payload') {
          messageReceived = true;
        }
      },
    });

    await runtime.start();

    // External sender sends a direct message to BOT001
    await messagingService.sendDirectMessage('S001', {
      senderBotId: 'BOT002',
      recipient: 'BOT001',
      content: 'Task payload',
    });

    // Wait for runtime to poll, process, and acknowledge
    let acknowledged = false;
    for (let i = 0; i < 40; i++) {
      const inbox = await messagingService.readInbox('S001', 'BOT001');
      if (inbox.length > 0 && inbox[0]?.status === 'acknowledged') {
        acknowledged = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(messageReceived).toBe(true);
    expect(acknowledged).toBe(true);

    await runtime.stop();
  });
});
