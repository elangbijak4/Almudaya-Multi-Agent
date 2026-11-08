import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { InboxDeliveryService } from '../../src/messaging/delivery.js';
import {
  isValidStateTransition,
  isMessageLeaseExpired,
} from '../../src/messaging/inbox-state.js';
import type { DirectMessage } from '../../src/messaging/schema.js';

describe('Inbox Delivery State Machine & Reliability (Phase 4, RELIA-01, ADR-004, §13.1, §5.14)', () => {
  let tmpDir: string;
  let storage: FilesystemSessionStorage;
  let botService: BotService;
  let messagingService: MessagingService;
  let deliveryService: InboxDeliveryService;
  const sessionId = 'S_INBOX_STATE_TEST';

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `almudaya_inbox_state_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(tmpDir, { recursive: true });

    storage = new FilesystemSessionStorage(tmpDir);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);
    deliveryService = messagingService.delivery;

    // Create test session first
    const now = new Date().toISOString();
    await storage.createSession({
      session_id: sessionId,
      session_name: 'Inbox State Test Session',
      created_at: now,
      updated_at: now,
    });

    // Register test bots
    await botService.registerBot(sessionId, {
      botId: 'B_DISPATCHER',
      displayName: 'Dispatcher',
      status: 'active',
    });
    await botService.registerBot(sessionId, {
      botId: 'B_WORKER',
      displayName: 'Worker',
      status: 'active',
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('State Transitions & Validity Matrix', () => {
    it('should validate legal transitions from RECEIVED', () => {
      expect(isValidStateTransition('RECEIVED', 'PROCESSING')).toBe(true);
      expect(isValidStateTransition('RECEIVED', 'COMPLETED')).toBe(true);
      expect(isValidStateTransition('RECEIVED', 'RETRY_PENDING')).toBe(false);
      expect(isValidStateTransition('RECEIVED', 'DEAD_LETTER')).toBe(false);
    });

    it('should validate legal transitions from PROCESSING', () => {
      expect(isValidStateTransition('PROCESSING', 'COMPLETED')).toBe(true);
      expect(isValidStateTransition('PROCESSING', 'RETRY_PENDING')).toBe(true);
      expect(isValidStateTransition('PROCESSING', 'DEAD_LETTER')).toBe(true);
    });

    it('should validate legal transitions from RETRY_PENDING', () => {
      expect(isValidStateTransition('RETRY_PENDING', 'PROCESSING')).toBe(true);
      expect(isValidStateTransition('RETRY_PENDING', 'DEAD_LETTER')).toBe(true);
      expect(isValidStateTransition('RETRY_PENDING', 'COMPLETED')).toBe(true);
    });

    it('should prevent transitions from terminal COMPLETED state', () => {
      expect(isValidStateTransition('COMPLETED', 'RECEIVED')).toBe(false);
      expect(isValidStateTransition('COMPLETED', 'PROCESSING')).toBe(false);
      expect(isValidStateTransition('COMPLETED', 'RETRY_PENDING')).toBe(false);
    });

    it('should allow DEAD_LETTER re-queueing to RETRY_PENDING', () => {
      expect(isValidStateTransition('DEAD_LETTER', 'RETRY_PENDING')).toBe(true);
      expect(isValidStateTransition('DEAD_LETTER', 'PROCESSING')).toBe(false);
    });
  });

  describe('Claiming, Leasing & Completion Workflow', () => {
    it('should claim message, transition to PROCESSING, and set lease metadata', async () => {
      const msg = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'Task payload',
      });

      expect(msg.delivery_state).toBe('RECEIVED');
      expect(msg.status).toBe('unread');
      expect(msg.attempt_count).toBe(0);

      // Claim for worker
      const claimed = await deliveryService.claimNextMessage(
        sessionId,
        'B_WORKER',
        'worker-consumer-1',
        10000
      );

      expect(claimed).not.toBeNull();
      expect(claimed?.message_id).toBe(msg.message_id);
      expect(claimed?.delivery_state).toBe('PROCESSING');
      expect(claimed?.status).toBe('read');
      expect(claimed?.attempt_count).toBe(1);
      expect(claimed?.lease_owner).toBe('worker-consumer-1');
      expect(claimed?.lease_expires_at).toBeDefined();

      // Completing the message
      const completed = await deliveryService.completeMessage(
        sessionId,
        'B_WORKER',
        msg.message_id,
        'worker-consumer-1'
      );

      expect(completed.delivery_state).toBe('COMPLETED');
      expect(completed.status).toBe('acknowledged');
      expect(completed.lease_owner).toBeNull();
      expect(completed.lease_expires_at).toBeNull();
      expect(completed.acknowledged_at).toBeDefined();
    });

    it('should prevent another consumer from claiming leased message before expiry', async () => {
      await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'Exclusive task',
      });

      // Claim by consumer 1 with 30s lease
      const claim1 = await deliveryService.claimNextMessage(
        sessionId,
        'B_WORKER',
        'consumer-1',
        30000
      );
      expect(claim1).not.toBeNull();

      // Consumer 2 attempts to claim
      const claim2 = await deliveryService.claimNextMessage(
        sessionId,
        'B_WORKER',
        'consumer-2',
        30000
      );
      expect(claim2).toBeNull(); // No available messages
    });

    it('should allow claiming after lease expiration (crash recovery)', async () => {
      await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'Task that crashes worker',
      });

      // Claim with 1ms lease
      const claim1 = await deliveryService.claimNextMessage(
        sessionId,
        'B_WORKER',
        'crashed-consumer',
        1
      );
      expect(claim1).not.toBeNull();

      // Wait 10ms for lease to expire
      await new Promise((r) => setTimeout(r, 10));

      // Reclaim by healthy consumer
      const claim2 = await deliveryService.claimNextMessage(
        sessionId,
        'B_WORKER',
        'healthy-consumer',
        10000
      );
      expect(claim2).not.toBeNull();
      expect(claim2?.message_id).toBe(claim1?.message_id);
      expect(claim2?.attempt_count).toBe(2);
      expect(claim2?.lease_owner).toBe('healthy-consumer');
    });
  });

  describe('Failure Handling, Retries & Dead Letter Queue', () => {
    it('should transition to RETRY_PENDING on failure when attempts remain', async () => {
      const msg = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'Flaky task',
        maxAttempts: 3,
      });

      await deliveryService.claimNextMessage(sessionId, 'B_WORKER', 'consumer-1');

      const failed = await deliveryService.failMessage(
        sessionId,
        'B_WORKER',
        msg.message_id,
        'Database connection dropped'
      );

      expect(failed.delivery_state).toBe('RETRY_PENDING');
      expect(failed.status).toBe('unread');
      expect(failed.attempt_count).toBe(1);
      expect(failed.last_error).toBe('Database connection dropped');
      expect(failed.lease_owner).toBeNull();
    });

    it('should transition to DEAD_LETTER when maximum attempts are exhausted', async () => {
      const msg = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'Poison pill task',
        maxAttempts: 2,
      });

      // Attempt 1: claim & fail
      await deliveryService.claimNextMessage(sessionId, 'B_WORKER', 'consumer-1');
      await deliveryService.failMessage(sessionId, 'B_WORKER', msg.message_id, 'Error 1');

      // Attempt 2: claim & fail
      await deliveryService.claimNextMessage(sessionId, 'B_WORKER', 'consumer-1');
      const failed2 = await deliveryService.failMessage(sessionId, 'B_WORKER', msg.message_id, 'Error 2');

      expect(failed2.delivery_state).toBe('DEAD_LETTER');
      expect(failed2.attempt_count).toBe(2);
      expect(failed2.last_error).toBe('Error 2');

      // Should not be claimable anymore
      const claim3 = await deliveryService.claimNextMessage(sessionId, 'B_WORKER', 'consumer-1');
      expect(claim3).toBeNull();
    });

    it('should recover expired leases via recoverExpiredLeases', async () => {
      const msg = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'Task with expired lease',
      });

      await deliveryService.claimNextMessage(sessionId, 'B_WORKER', 'crashed-worker', 1);
      await new Promise((r) => setTimeout(r, 10));

      const recoveredCount = await deliveryService.recoverExpiredLeases(sessionId, 'B_WORKER');
      expect(recoveredCount).toBe(1);

      const inbox = await messagingService.readInbox(sessionId, 'B_WORKER');
      const recovered = inbox.find((m) => m.message_id === msg.message_id);
      expect(recovered?.delivery_state).toBe('RETRY_PENDING');
      expect(recovered?.lease_owner).toBeNull();
    });

    it('should allow manual re-queueing of dead-letter messages', async () => {
      const msg = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'Dead letter task',
        maxAttempts: 1,
      });

      await deliveryService.claimNextMessage(sessionId, 'B_WORKER', 'consumer-1');
      await deliveryService.failMessage(sessionId, 'B_WORKER', msg.message_id, 'Fatal failure');

      // Re-queue dead letter
      const requeued = await deliveryService.requeueDeadLetter(sessionId, 'B_WORKER', msg.message_id);
      expect(requeued.delivery_state).toBe('RETRY_PENDING');
      expect(requeued.status).toBe('unread');
      expect(requeued.attempt_count).toBe(0);
      expect(requeued.last_error).toBeNull();

      // Now it can be claimed again
      const claimAgain = await deliveryService.claimNextMessage(sessionId, 'B_WORKER', 'consumer-1');
      expect(claimAgain?.message_id).toBe(msg.message_id);
    });
  });

  describe('Publisher Idempotency Keys (§13.3, §5.14)', () => {
    it('should return existing message without creating duplicate when same idempotencyKey is used', async () => {
      const key = 'req_idemp_key_12345';
      const msg1 = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'First send',
        idempotencyKey: key,
      });

      const msg2 = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: 'B_DISPATCHER',
        recipient: 'B_WORKER',
        content: 'Second duplicate send',
        idempotencyKey: key,
      });

      expect(msg1.message_id).toBe(msg2.message_id);

      const inbox = await messagingService.readInbox(sessionId, 'B_WORKER');
      expect(inbox.filter((m) => m.idempotency_key === key).length).toBe(1);
    });
  });
});
