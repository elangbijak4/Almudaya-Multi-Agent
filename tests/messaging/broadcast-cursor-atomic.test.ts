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

    // 3. Bot subsequently reads WITHOUT filter (AUD-07, REQ-05 live fix)
    // Both E1 (ACTIVITY) and E3 (ACTIVITY) must remain available; E1 was NOT skipped by reading DECISION!
    const subsequentRead = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true
    });

    expect(subsequentRead).toHaveLength(2);
    expect(subsequentRead.map((e) => e.event_id)).toEqual([e1.event_id, e3.event_id]);
    expect(subsequentRead[0]?.content).toBe('Event 1: Starting server');
    expect(subsequentRead[1]?.content).toBe('Event 3: Server compiled');

    // 4. Reading again after all events consumed returns empty
    const finalRead = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true
    });
    expect(finalRead).toHaveLength(0);
  });

  it('AUD-07 regression: pagination with limit must consume in FIFO order without skipping earlier events', async () => {
    // 1. Publish 3 events
    const e1 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'B001',
      category: 'ACTIVITY',
      content: 'Step 1'
    });
    const e2 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'B001',
      category: 'ACTIVITY',
      content: 'Step 2'
    });
    const e3 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'B001',
      category: 'ACTIVITY',
      content: 'Step 3'
    });

    // 2. Read with limit=1 and autoAdvanceCursor
    const page1 = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true,
      limit: 1
    });
    expect(page1).toHaveLength(1);
    expect(page1[0]?.event_id).toBe(e1.event_id);

    // 3. Next page with limit=1
    const page2 = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true,
      limit: 1
    });
    expect(page2).toHaveLength(1);
    expect(page2[0]?.event_id).toBe(e2.event_id);

    // 4. Next page with limit=1
    const page3 = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true,
      limit: 1
    });
    expect(page3).toHaveLength(1);
    expect(page3[0]?.event_id).toBe(e3.event_id);

    // 5. Subsequent read is empty
    const page4 = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: true,
      limit: 1
    });
    expect(page4).toHaveLength(0);
  });

  it('AUD-07 regression: broadcast redelivery on callback failure or crash', async () => {
    const e1 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'B001',
      category: 'TASK',
      content: 'Task alpha'
    });
    const e2 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'B001',
      category: 'TASK',
      content: 'Task beta'
    });

    // Worker fetches broadcasts without auto-advancing cursor
    const unread = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: false
    });
    expect(unread).toHaveLength(2);

    // Simulate consumer callback processing e1 successfully, then failing on e2
    await messagingService.advanceBroadcastCursor(sessionId, 'B001', e1);

    // On crash / restart / retry, e2 must be redelivered!
    const redelivered = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: false
    });
    expect(redelivered).toHaveLength(1);
    expect(redelivered[0]?.event_id).toBe(e2.event_id);

    // Now e2 succeeds and advances cursor
    await messagingService.advanceBroadcastCursor(sessionId, 'B001', e2);

    const empty = await messagingService.readBroadcasts(sessionId, {
      botId: 'B001',
      autoAdvanceCursor: false
    });
    expect(empty).toHaveLength(0);
  });
});
