import type { IBlackboardStorage } from '../blackboard/interface.js';
import { BotService } from '../bot/service.js';
import { MessageNotFoundError } from '../core/errors.js';
import type { DirectMessage } from './schema.js';
import {
  DEFAULT_MESSAGE_LEASE_MS,
  isMessageLeaseExpired,
  isValidStateTransition,
} from './inbox-state.js';

export class InboxDeliveryService {
  private readonly storage: IBlackboardStorage;
  private readonly botService: BotService;

  constructor(storage: IBlackboardStorage, botService?: BotService) {
    this.storage = storage;
    this.botService = botService ?? new BotService(storage);
  }

  /**
   * Atomically claims the next eligible inbox message for processing under lease.
   * State transition: RECEIVED | RETRY_PENDING -> PROCESSING (or recovers expired lease).
   */
  public async claimNextMessage(
    sessionId: string,
    botIdentifier: string,
    consumerId: string,
    leaseDurationMs: number = DEFAULT_MESSAGE_LEASE_MS,
    excludeMessageIds: string[] = []
  ): Promise<DirectMessage | null> {
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);
    const excludeSet = new Set(excludeMessageIds);

    return await this.storage.withSessionLock(sessionId, async () => {
      const inbox = await this.storage.getInbox(sessionId, canonicalBotId);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const candidate = inbox.messages.find((m) => {
        if (excludeSet.has(m.message_id)) {
          return false;
        }

        if (m.delivery_state === 'COMPLETED' || m.delivery_state === 'DEAD_LETTER') {
          return false;
        }

        // Available for claim if fresh RECEIVED or RETRY_PENDING
        if (m.delivery_state === 'RECEIVED' || m.delivery_state === 'RETRY_PENDING') {
          return true;
        }

        // Available for reclaim if PROCESSING but lease expired
        if (m.delivery_state === 'PROCESSING' && isMessageLeaseExpired(m, nowMs)) {
          return true;
        }

        return false;
      });

      if (!candidate) {
        return null;
      }

      // Check max attempts before transitioning
      if (candidate.attempt_count >= candidate.max_attempts) {
        candidate.delivery_state = 'DEAD_LETTER';
        inbox.updated_at = nowIso;
        await this.storage.saveInbox(sessionId, canonicalBotId, inbox);
        return null;
      }

      candidate.delivery_state = 'PROCESSING';
      candidate.status = 'read';
      candidate.attempt_count = (candidate.attempt_count ?? 0) + 1;
      candidate.fence_token = (candidate.fence_token ?? 0) + 1;
      candidate.lease_owner = consumerId;
      candidate.lease_expires_at = new Date(nowMs + leaseDurationMs).toISOString();
      candidate.last_attempt_at = nowIso;
      if (!candidate.read_at) {
        candidate.read_at = nowIso;
      }

      inbox.updated_at = nowIso;
      await this.storage.saveInbox(sessionId, canonicalBotId, inbox);

      return JSON.parse(JSON.stringify(candidate)) as DirectMessage;
    });
  }

  /**
   * Marks a message as successfully processed.
   * State transition: PROCESSING -> COMPLETED (and acknowledged).
   * Enforces exact consumer ownership and fencing token (AUD-08, REQ-04).
   */
  public async completeMessage(
    sessionId: string,
    botIdentifier: string,
    messageId: string,
    consumerId?: string,
    fenceToken?: number,
    options?: { adminOverride?: boolean; reason?: string }
  ): Promise<DirectMessage> {
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);

    return await this.storage.withSessionLock(sessionId, async () => {
      const inbox = await this.storage.getInbox(sessionId, canonicalBotId);
      const target = inbox.messages.find((m) => m.message_id === messageId);

      if (!target) {
        throw new MessageNotFoundError(messageId, canonicalBotId);
      }

      // Idempotency: already completed
      if (target.delivery_state === 'COMPLETED') {
        return target;
      }

      if (!isValidStateTransition(target.delivery_state, 'COMPLETED')) {
        throw new Error(
          `Cannot complete message ${messageId}: invalid transition from state ${target.delivery_state}`
        );
      }

      const isAdmin = options?.adminOverride === true;

      if (!isAdmin) {
        // Enforce lease ownership and fencing token (AUD-08, REQ-04)
        if (!consumerId) {
          throw new Error(
            `Cannot complete message ${messageId}: consumerId is required for worker acknowledgement.`
          );
        }

        if (!target.lease_owner || target.lease_owner !== consumerId) {
          throw new Error(
            `Cannot complete message ${messageId}: lease held by another consumer (${target.lease_owner ?? 'none'})`
          );
        }

        if (isMessageLeaseExpired(target)) {
          throw new Error(
            `Cannot complete message ${messageId}: lease has expired and can no longer be acknowledged by stale consumer.`
          );
        }

        if (fenceToken !== undefined && target.fence_token !== fenceToken) {
          throw new Error(
            `Cannot complete message ${messageId}: stale fencing token (${fenceToken} vs current ${target.fence_token}).`
          );
        }
      }

      const nowIso = new Date().toISOString();
      target.delivery_state = 'COMPLETED';
      target.status = 'acknowledged';
      target.lease_owner = null;
      target.lease_expires_at = null;
      target.acknowledged_at = nowIso;
      if (!target.read_at) {
        target.read_at = nowIso;
      }

      inbox.updated_at = nowIso;
      await this.storage.saveInbox(sessionId, canonicalBotId, inbox);

      return target;
    });
  }

  /**
   * Records processing failure for a message.
   * State transition: PROCESSING -> RETRY_PENDING (or DEAD_LETTER if attempts exhausted).
   * Enforces exact consumer ownership and fencing token (AUD-08, REQ-04).
   */
  public async failMessage(
    sessionId: string,
    botIdentifier: string,
    messageId: string,
    error: string,
    consumerId?: string,
    fenceToken?: number,
    options?: { adminOverride?: boolean; reason?: string }
  ): Promise<DirectMessage> {
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);

    return await this.storage.withSessionLock(sessionId, async () => {
      const inbox = await this.storage.getInbox(sessionId, canonicalBotId);
      const target = inbox.messages.find((m) => m.message_id === messageId);

      if (!target) {
        throw new MessageNotFoundError(messageId, canonicalBotId);
      }

      const isAdmin = options?.adminOverride === true;

      if (!isAdmin) {
        // Enforce lease ownership and fencing token (AUD-08, REQ-04)
        if (!consumerId) {
          throw new Error(
            `Cannot fail message ${messageId}: consumerId is required for worker failure reporting.`
          );
        }

        if (!target.lease_owner || target.lease_owner !== consumerId) {
          throw new Error(
            `Cannot fail message ${messageId}: lease held by another consumer (${target.lease_owner ?? 'none'})`
          );
        }

        if (isMessageLeaseExpired(target)) {
          throw new Error(
            `Cannot fail message ${messageId}: lease has expired and can no longer be failed by stale consumer.`
          );
        }

        if (fenceToken !== undefined && target.fence_token !== fenceToken) {
          throw new Error(
            `Cannot fail message ${messageId}: stale fencing token (${fenceToken} vs current ${target.fence_token}).`
          );
        }
      }

      const nowIso = new Date().toISOString();
      target.last_error = error;
      target.lease_owner = null;
      target.lease_expires_at = null;

      if (target.attempt_count >= target.max_attempts) {
        target.delivery_state = 'DEAD_LETTER';
        target.status = 'read';
      } else {
        target.delivery_state = 'RETRY_PENDING';
        target.status = 'unread';
        target.read_at = undefined;
      }

      inbox.updated_at = nowIso;
      await this.storage.saveInbox(sessionId, canonicalBotId, inbox);

      return target;
    });
  }

  /**
   * Administrative override to force completion of a message regardless of lease ownership.
   */
  public async forceCompleteMessage(
    sessionId: string,
    botIdentifier: string,
    messageId: string,
    reason: string = 'Administrative override'
  ): Promise<DirectMessage> {
    return await this.completeMessage(sessionId, botIdentifier, messageId, undefined, undefined, {
      adminOverride: true,
      reason,
    });
  }

  /**
   * Administrative override to force failure of a message regardless of lease ownership.
   */
  public async forceFailMessage(
    sessionId: string,
    botIdentifier: string,
    messageId: string,
    reason: string = 'Administrative override'
  ): Promise<DirectMessage> {
    return await this.failMessage(sessionId, botIdentifier, messageId, reason, undefined, undefined, {
      adminOverride: true,
      reason,
    });
  }

  /**
   * Scans the inbox and recovers any expired leases from stalled consumers.
   */
  public async recoverExpiredLeases(
    sessionId: string,
    botIdentifier: string
  ): Promise<number> {
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);

    return await this.storage.withSessionLock(sessionId, async () => {
      const inbox = await this.storage.getInbox(sessionId, canonicalBotId);
      const nowMs = Date.now();
      let recoveredCount = 0;

      for (const msg of inbox.messages) {
        if (msg.delivery_state === 'PROCESSING' && isMessageLeaseExpired(msg, nowMs)) {
          msg.lease_owner = null;
          msg.lease_expires_at = null;
          if (msg.attempt_count >= msg.max_attempts) {
            msg.delivery_state = 'DEAD_LETTER';
          } else {
            msg.delivery_state = 'RETRY_PENDING';
            msg.status = 'unread';
          }
          recoveredCount++;
        }
      }

      if (recoveredCount > 0) {
        inbox.updated_at = new Date().toISOString();
        await this.storage.saveInbox(sessionId, canonicalBotId, inbox);
      }

      return recoveredCount;
    });
  }

  /**
   * Manually or administratively re-queues a message in DEAD_LETTER back to RETRY_PENDING.
   */
  public async requeueDeadLetter(
    sessionId: string,
    botIdentifier: string,
    messageId: string
  ): Promise<DirectMessage> {
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);

    return await this.storage.withSessionLock(sessionId, async () => {
      const inbox = await this.storage.getInbox(sessionId, canonicalBotId);
      const target = inbox.messages.find((m) => m.message_id === messageId);

      if (!target) {
        throw new MessageNotFoundError(messageId, canonicalBotId);
      }

      if (target.delivery_state !== 'DEAD_LETTER') {
        throw new Error(`Message ${messageId} is not in DEAD_LETTER state (current: ${target.delivery_state})`);
      }

      target.delivery_state = 'RETRY_PENDING';
      target.status = 'unread';
      target.attempt_count = 0;
      target.last_error = null;
      target.lease_owner = null;
      target.lease_expires_at = null;

      inbox.updated_at = new Date().toISOString();
      await this.storage.saveInbox(sessionId, canonicalBotId, inbox);

      return target;
    });
  }
}
