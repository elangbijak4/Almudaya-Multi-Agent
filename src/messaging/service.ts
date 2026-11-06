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
import { MessageNotFoundError } from '../core/errors.js';

export class MessagingService {
  private readonly storage: IBlackboardStorage;
  private readonly botService: BotService;

  constructor(storage: IBlackboardStorage, botService?: BotService) {
    this.storage = storage;
    this.botService = botService ?? new BotService(storage);
  }

  /**
   * Publishes a broadcast event to the shared Session broadcast log.
   */
  public async publishBroadcast(
    sessionId: string,
    input: PublishBroadcastInput
  ): Promise<BroadcastEvent> {
    const event: BroadcastEvent = {
      event_id: generateEventId(),
      session_id: sessionId,
      sender_bot_id: input.senderBotId.trim(),
      timestamp: new Date().toISOString(),
      category: input.category ?? 'ACTIVITY',
      content: input.content.trim(),
      metadata: input.metadata ?? {},
    };

    await this.storage.appendBroadcast(sessionId, event);
    return event;
  }

  /**
   * Reads events from the Session broadcast log.
   * If a botId is provided with autoAdvanceCursor = true, only unread events since the
   * bot's last read cursor are returned, and its cursor is persistently updated.
   */
  public async readBroadcasts(
    sessionId: string,
    options: ReadBroadcastOptions = {}
  ): Promise<BroadcastEvent[]> {
    return await this.storage.withSessionLock(sessionId, async () => {
      const allEvents = await this.storage.readBroadcasts(sessionId);

      let filtered = allEvents;

      // Handle per-bot cursor tracking
      if (options.botId && options.autoAdvanceCursor) {
        const canonicalBotId = await this.botService.resolveBotId(sessionId, options.botId);
        const cursor = await this.storage.getBroadcastCursor(sessionId, canonicalBotId);

        if (cursor.last_read_event_id) {
          const lastIndex = allEvents.findIndex(
            (e) => e.event_id === cursor.last_read_event_id
          );
          if (lastIndex !== -1) {
            filtered = allEvents.slice(lastIndex + 1);
          }
        }

        // Apply filters before advancing cursor to prevent skipping unconsumed events (CONC-02, FR-324)
        if (options.category) {
          filtered = filtered.filter((e) => e.category === options.category);
        }

        if (options.limit && options.limit > 0) {
          filtered = filtered.slice(-options.limit);
        }

        // Advance cursor to the latest event actually consumed/delivered
        if (filtered.length > 0) {
          const latest = filtered[filtered.length - 1]!;
          await this.storage.saveBroadcastCursor(sessionId, canonicalBotId, {
            last_read_event_id: latest.event_id,
            last_read_timestamp: latest.timestamp,
          });
        }

        return filtered;
      } else {
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
      }
    });
  }

  /**
   * Sends a direct message to a recipient bot.
   * Resolves recipient display name to stable Bot ID before storage.
   */
  public async sendDirectMessage(
    sessionId: string,
    input: SendDirectMessageInput
  ): Promise<DirectMessage> {
    // Resolve recipient (display name or Bot ID) to canonical stable Bot ID
    const recipientBotId = await this.botService.resolveBotId(sessionId, input.recipient);

    const message: DirectMessage = {
      message_id: generateMessageId(),
      session_id: sessionId,
      sender_bot_id: input.senderBotId.trim(),
      recipient_bot_id: recipientBotId,
      timestamp: new Date().toISOString(),
      message_type: input.messageType ?? 'DIRECT',
      content: input.content.trim(),
      status: 'unread',
      metadata: input.metadata ?? {},
    };

    await this.storage.appendMessageToInbox(sessionId, recipientBotId, message);
    return message;
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
      if (options.status) {
        matched = matched.filter((m) => m.status === options.status);
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

      if (options.limit && options.limit > 0) {
        matched = matched.slice(-options.limit);
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
      target.acknowledged_at = now;
      if (!target.read_at) {
        target.read_at = now;
      }

      inbox.updated_at = now;
      await this.storage.saveInbox(sessionId, canonicalBotId, inbox);
      return target;
    });
  }
}
