import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';

describe('Atomic Broadcast Cursor & Filter Loss Prevention (CONC-02, FR-324)', () => {
  let workspaceRoot: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  const sessionId = 'SES_CURSOR_ATOMIC_01';

  beforeEach(async () => {
    workspaceRoot = path.join(
      os.tmpdir(),
      `almudaya_cursor_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    storage = new FilesystemSessionStorage(workspaceRoot);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    await sessionService.createSession({ sessionId, sessionName: 'Cursor atomic test' });
    await botService.registerBot(sessionId, {
      botId: 'B001',
      displayName: 'Architect',
      status: 'active'
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should NOT lose unconsumed broadcast events when reading with a category filter (CONC-02 live fix)', async () => {
    // 1. Publish 3 events in sequence
    const e1 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'B001',
      category: 'ACTIVITY',
      content: 'Event 1: Starting server'
    });

    const e2 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'B001',
      category: 'DECISION',
      content: 'Event 2: Spec approved'
    });

    const e3 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'B001',
      category: 'ACTIVITY',
      content: 'Event 3: Server compiled'
    });

    // 2. Bot reads with category filter 'DECISION' and autoAdvanceCursor
    const decisionRead = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true,
      category: 'DECISION'
    });

    expect(decisionRead).toHaveLength(1);
    expect(decisionRead[0]?.event_id).toBe(e2.event_id);
    expect(decisionRead[0]?.category).toBe('DECISION');

    // 3. Bot subsequently reads WITHOUT filter (or for next events)
    // E3 must NOT be lost! Cursor must be at E2, so E3 is successfully returned.
    const subsequentRead = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true
    });

    expect(subsequentRead).toHaveLength(1);
    expect(subsequentRead[0]?.event_id).toBe(e3.event_id);
    expect(subsequentRead[0]?.content).toBe('Event 3: Server compiled');

    // 4. Reading again after all events consumed returns empty
    const finalRead = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true
    });
    expect(finalRead).toHaveLength(0);
  });
});
