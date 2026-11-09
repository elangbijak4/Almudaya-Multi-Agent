import type { IBlackboardStorage } from '../blackboard/interface.js';
import { BotService } from '../bot/service.js';
import type {
  BroadcastEvent,
  DirectMessage,
  PublishBroadcastInput,
  ReadBroadcastOptions,
  ReadInboxOptions,
  SendDirectMessageInput,
} from './schema.js';
import {
  generateEventId,
  generateMessageId,
} from './schema.js';
import { MessageNotFoundError, ValidationError } from '../core/errors.js';
import { InboxDeliveryService } from './delivery.js';
import { DEFAULT_MAX_ATTEMPTS } from './inbox-state.js';
import { redactSecrets, redactRecursively } from '../execution/environment.js';

export class MessagingService {
  private readonly storage: IBlackboardStorage;
  private readonly botService: BotService;
  public readonly delivery: InboxDeliveryService;

  constructor(storage: IBlackboardStorage, botService?: BotService) {
    this.storage = storage;
    this.botService = botService ?? new BotService(storage);
    this.delivery = new InboxDeliveryService(storage, this.botService);
  }

  /**
   * Authenticates sender identity at the messaging boundary (AUD-10, REQ-02).
   * Verifies against active bot registry or permits explicit typed human/system principals.
   */
  private async authenticateSender(sessionId: string, sender: string): Promise<string> {
    const trimmed = (sender || '').trim();
    if (!trimmed) {
      throw new ValidationError('Sender identity cannot be empty.');
    }

    const allowedTypedPrincipals = ['HUMAN', 'SYSTEM', 'OPERATOR', 'ADMIN', 'CONSOLE'];
    if (allowedTypedPrincipals.includes(trimmed.toUpperCase())) {
      return trimmed.toUpperCase();
    }

    const bot = await this.botService.getBot(sessionId, trimmed);
    if (bot.status !== 'active') {
      throw new Error(
        `Sender "${trimmed}" is not an active bot in session "${sessionId}" (status: ${bot.status}).`
      );
    }

    return bot.bot_id;
  }

  /**
   * Publishes a broadcast event to the shared Session broadcast log.
   * Sender identity is authenticated against the session bot registry (AUD-10, REQ-02).
   */
  public async publishBroadcast(
    sessionId: string,
    input: PublishBroadcastInput
  ): Promise<BroadcastEvent> {
    const senderId = await this.authenticateSender(sessionId, input.senderBotId);

    const event: BroadcastEvent = {
      event_id: generateEventId(),
      session_id: sessionId,
      sender_bot_id: senderId,
      timestamp: new Date().toISOString(),
      category: input.category ?? 'ACTIVITY',
      content: redactSecrets(input.content.trim()),
      metadata: redactRecursively(input.metadata ?? {}),
    };

    await this.storage.appendBroadcast(sessionId, event);
    return event;
  }

  /**
   * Reads events from the Session broadcast log.
   * Uses per-category cursor tracking and delivery acknowledgement (AUD-07, REQ-05).
   * If autoAdvanceCursor = true, returned events advance the bot's cursor and ack set.
   */
  public async readBroadcasts(
    sessionId: string,
    options: ReadBroadcastOptions = {}
  ): Promise<BroadcastEvent[]> {
    return await this.storage.withSessionLock(sessionId, async () => {
      const allEvents = await this.storage.readBroadcasts(sessionId);

      let filtered = allEvents;

      // Handle per-bot cursor tracking
      if (options.botId) {
        let canonicalBotId: string | null = null;
        try {
          canonicalBotId = await this.botService.resolveBotId(sessionId, options.botId);
        } catch {
          canonicalBotId = null;
        }

        if (canonicalBotId) {
          const cursor = await this.storage.getBroadcastCursor(sessionId, canonicalBotId);
          const ackedSet = new Set(cursor.acknowledged_event_ids ?? []);
          const catCursors = cursor.category_cursors ?? {};

          if (options.category) {
            // 1. Filter events matching this category
            filtered = filtered.filter((e) => e.category === options.category);

            // 2. High-water mark for this category
            const catLastId = catCursors[options.category];
            if (catLastId) {
              const idx = filtered.findIndex((e) => e.event_id === catLastId);
              if (idx !== -1) {
                filtered = filtered.slice(idx + 1);
              }
            }

            // 3. Exclude acknowledged events
            filtered = filtered.filter((e) => !ackedSet.has(e.event_id));
          } else {
            // Unfiltered stream: exclude events already consumed or acknowledged
            filtered = filtered.filter((e) => {
              if (ackedSet.has(e.event_id)) {
                return false;
              }
              const catLastId = catCursors[e.category];
              if (catLastId) {
                const catEvents = allEvents.filter((ev) => ev.category === e.category);
                const catIdx = catEvents.findIndex((ev) => ev.event_id === catLastId);
                const myCatIdx = catEvents.findIndex((ev) => ev.event_id === e.event_id);
                if (catIdx !== -1 && myCatIdx !== -1 && myCatIdx <= catIdx) {
                  return false;
                }
              }
              if (cursor.last_read_event_id && !options.afterEventId && Object.keys(catCursors).length === 0) {
                const globalIdx = allEvents.findIndex((ev) => ev.event_id === cursor.last_read_event_id);
                const myIdx = allEvents.findIndex((ev) => ev.event_id === e.event_id);
                if (globalIdx !== -1 && myIdx !== -1 && myIdx <= globalIdx) {
                  return false;
                }
              }
              return true;
            });
          }

          if (options.afterEventId) {
            const idx = filtered.findIndex((e) => e.event_id === options.afterEventId);
            if (idx !== -1) {
              filtered = filtered.slice(idx + 1);
            }
          }

          if (options.since) {
            const sinceTime = new Date(options.since).getTime();
            filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= sinceTime);
          }

          // Apply pagination / limit in FIFO order for unread streams
          if (options.limit && options.limit > 0) {
            filtered = filtered.slice(0, options.limit);
          }

          // Advance cursor to the latest event actually consumed/delivered
          if (options.autoAdvanceCursor && filtered.length > 0) {
            const updatedAcked = Array.from(
              new Set([...(cursor.acknowledged_event_ids ?? []), ...filtered.map((e) => e.event_id)])
            );
            if (updatedAcked.length > 1000) {
              updatedAcked.splice(0, updatedAcked.length - 1000);
            }

            const updatedCatCursors = { ...(cursor.category_cursors ?? {}) };
            for (const ev of filtered) {
              updatedCatCursors[ev.category] = ev.event_id;
            }

            const latest = filtered[filtered.length - 1]!;
            await this.storage.saveBroadcastCursor(sessionId, canonicalBotId, {
              last_read_event_id: latest.event_id,
              last_read_timestamp: latest.timestamp,
              category_cursors: updatedCatCursors,
              acknowledged_event_ids: updatedAcked,
            });
          }

          return filtered;
        }
      }

      // Read without botId cursor tracking (stateless read)
      if (options.afterEventId) {
        const idx = filtered.findIndex((e) => e.event_id === options.afterEventId);
        if (idx !== -1) {
          filtered = filtered.slice(idx + 1);
        }
      }

      if (options.since) {
        const sinceTime = new Date(options.since).getTime();
        filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= sinceTime);
      }

      if (options.category) {
        filtered = filtered.filter((e) => e.category === options.category);
      }

      if (options.limit && options.limit > 0) {
        filtered = filtered.slice(-options.limit);
      }

      return filtered;
    });
  }

  /**
   * Advances a bot's broadcast cursor past a successfully processed event (AUD-07, REQ-05).
   * Ensures cursors are only advanced after consumer callbacks succeed.
   */
  public async advanceBroadcastCursor(
    sessionId: string,
    botIdentifier: string,
    event: BroadcastEvent
  ): Promise<void> {
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);

    await this.storage.withSessionLock(sessionId, async () => {
      const cursor = await this.storage.getBroadcastCursor(sessionId, canonicalBotId);
      const catCursors = { ...(cursor.category_cursors ?? {}) };
      catCursors[event.category] = event.event_id;

      const acked = new Set(cursor.acknowledged_event_ids ?? []);
      acked.add(event.event_id);
      const updatedAcked = Array.from(acked);
      if (updatedAcked.length > 1000) {
        updatedAcked.splice(0, updatedAcked.length - 1000);
      }

      await this.storage.saveBroadcastCursor(sessionId, canonicalBotId, {
        last_read_event_id: event.event_id,
        last_read_timestamp: event.timestamp,
        category_cursors: catCursors,
        acknowledged_event_ids: updatedAcked,
      });
    });
  }

  /**
   * Acknowledges specific broadcast events for a bot (AUD-07, REQ-05).
   */
  public async acknowledgeBroadcasts(
    sessionId: string,
    botIdentifier: string,
    eventIds: string[]
  ): Promise<void> {
    if (!eventIds || eventIds.length === 0) return;
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);

    await this.storage.withSessionLock(sessionId, async () => {
      const cursor = await this.storage.getBroadcastCursor(sessionId, canonicalBotId);
      const acked = new Set(cursor.acknowledged_event_ids ?? []);
      for (const id of eventIds) {
        acked.add(id);
      }
      const updatedAcked = Array.from(acked);
      if (updatedAcked.length > 1000) {
        updatedAcked.splice(0, updatedAcked.length - 1000);
      }

      await this.storage.saveBroadcastCursor(sessionId, canonicalBotId, {
        last_read_event_id: cursor.last_read_event_id,
        last_read_timestamp: cursor.last_read_timestamp,
        category_cursors: cursor.category_cursors,
        acknowledged_event_ids: updatedAcked,
      });
    });
  }

  /**
   * Sends a direct message to a recipient bot.
   * Resolves recipient display name to stable Bot ID before storage.
   * Supports publisher idempotency keys (§13.3, §5.14).
   */
  public async sendDirectMessage(
    sessionId: string,
    input: SendDirectMessageInput
  ): Promise<DirectMessage> {
    const senderId = await this.authenticateSender(sessionId, input.senderBotId);
    // Resolve recipient (display name or Bot ID) to canonical stable Bot ID
    const recipientBotId = await this.botService.resolveBotId(sessionId, input.recipient);

    return await this.storage.withSessionLock(sessionId, async () => {
      const inbox = await this.storage.getInbox(sessionId, recipientBotId);

      // Publisher Idempotency Check (§13.3, §5.14)
      if (input.idempotencyKey) {
        const existing = inbox.messages.find(
          (m) => m.idempotency_key === input.idempotencyKey
        );
        if (existing) {
          return existing;
        }
      }

      const message: DirectMessage = {
        message_id: generateMessageId(),
        session_id: sessionId,
        sender_bot_id: senderId,
        recipient_bot_id: recipientBotId,
        timestamp: new Date().toISOString(),
        message_type: input.messageType ?? 'DIRECT',
        content: redactSecrets(input.content.trim()),
        status: 'unread',
        metadata: redactRecursively(input.metadata ?? {}),
        delivery_state: 'RECEIVED',
        attempt_count: 0,
        max_attempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        fence_token: 0,
        lease_owner: null,
        lease_expires_at: null,
        last_attempt_at: null,
        last_error: null,
        idempotency_key: input.idempotencyKey,
      };

      inbox.messages.push(message);
      inbox.updated_at = message.timestamp;
      await this.storage.saveInbox(sessionId, recipientBotId, inbox);
      return message;
    });
  }

  /**
   * Reads messages from a bot's Individual Blackboard inbox.
   * Optionally marks unread messages as read.
   */
  public async readInbox(
    sessionId: string,
    botIdentifier: string,
    options: ReadInboxOptions = {}
  ): Promise<DirectMessage[]> {
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);

    return await this.storage.withSessionLock(sessionId, async () => {
      const inbox = await this.storage.getInbox(sessionId, canonicalBotId);

      // Determine matching messages before mutating status
      let matched = inbox.messages;
      if (options.deliveryState) {
        matched = matched.filter((m) => m.delivery_state === options.deliveryState);
      } else if (options.status) {
        if (options.status === 'unread') {
          matched = matched.filter(
            (m) =>
              m.status === 'unread' &&
              m.delivery_state !== 'COMPLETED' &&
              m.delivery_state !== 'DEAD_LETTER'
          );
        } else {
          matched = matched.filter((m) => m.status === options.status);
        }
      }

      // Apply limit BEFORE mutating status to read (AUD-06, REQ-04)
      if (options.limit && options.limit > 0) {
        matched = matched.slice(-options.limit);
      }

      if (options.markAsRead) {
        const now = new Date().toISOString();
        let needsSave = false;
        for (const msg of matched) {
          if (msg.status === 'unread') {
            msg.status = 'read';
            msg.read_at = now;
            needsSave = true;
          }
        }
        if (needsSave) {
          inbox.updated_at = now;
          await this.storage.saveInbox(sessionId, canonicalBotId, inbox);
        }
      }

      return matched;
    });
  }

  /**
   * Explicitly marks specific messages in a bot's inbox as 'read'.
   * Enforces transactional message processing (RELIA-01, FR-321).
   */
  public async markMessagesAsRead(
    sessionId: string,
    botIdentifier: string,
    messageIds: string[]
  ): Promise<void> {
    if (!messageIds || messageIds.length === 0) return;
    const canonicalBotId = await this.botService.resolveBotId(sessionId, botIdentifier);
    const idSet = new Set(messageIds);

    await this.storage.withSessionLock(sessionId, async () => {
      const inbox = await this.storage.getInbox(sessionId, canonicalBotId);
      const now = new Date().toISOString();
      let needsSave = false;

      for (const msg of inbox.messages) {
        if (idSet.has(msg.message_id) && msg.status === 'unread') {
          msg.status = 'read';
          msg.read_at = now;
          needsSave = true;
        }
      }

      if (needsSave) {
        inbox.updated_at = now;
        await this.storage.saveInbox(sessionId, canonicalBotId, inbox);
      }
    });
  }

  /**
   * Acknowledges receipt/processing of a direct message (idempotent operation).
   */
  public async acknowledgeMessage(
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

      if (target.status === 'acknowledged') {
        return target; // Idempotent return
      }

      const now = new Date().toISOString();
      target.status = 'acknowledged';
      target.delivery_state = 'COMPLETED';
      target.acknowledged_at = now;
      target.lease_owner = null;
      target.lease_expires_at = null;
      if (!target.read_at) {
        target.read_at = now;
      }

      inbox.updated_at = now;
      await this.storage.saveInbox(sessionId, canonicalBotId, inbox);
      return target;
    });
  }
}
