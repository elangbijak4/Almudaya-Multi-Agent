import process from 'node:process';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import { BotService } from './service.js';
import { MessagingService } from '../messaging/service.js';
import type { BotRecord, RegisterBotInput } from './schema.js';
import type { BroadcastEvent, DirectMessage } from '../messaging/schema.js';

export interface BotRuntimeOptions {
  sessionId: string;
  botId?: string;
  displayName?: string;
  description?: string;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  autoAcknowledge?: boolean;
  onMessage?: (message: DirectMessage) => Promise<void>;
  onBroadcast?: (event: BroadcastEvent) => Promise<void>;
}

export class BotRuntime {
  public readonly sessionId: string;
  public botId: string;
  public displayName?: string;
  public readonly description?: string;
  private readonly heartbeatIntervalMs: number;
  private readonly pollIntervalMs: number;
  private readonly autoAcknowledge: boolean;

  private readonly botService: BotService;
  private readonly messagingService: MessagingService;

  private isRunning: boolean = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;
  private signalCleanup?: () => void;

  private readonly onMessageCallback?: (message: DirectMessage) => Promise<void>;
  private readonly onBroadcastCallback?: (event: BroadcastEvent) => Promise<void>;

  constructor(storage: IBlackboardStorage, options: BotRuntimeOptions) {
    this.sessionId = options.sessionId;
    this.botId = options.botId ?? '';
    this.displayName = options.displayName;
    this.description = options.description;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 2000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.autoAcknowledge = options.autoAcknowledge ?? false;

    this.botService = new BotService(storage);
    this.messagingService = new MessagingService(storage, this.botService);

    this.onMessageCallback = options.onMessage;
    this.onBroadcastCallback = options.onBroadcast;
  }

  public get running(): boolean {
    return this.isRunning;
  }

  /**
   * Starts the bot runtime: registers/activates the bot, starts heartbeating and message polling.
   */
  public async start(): Promise<BotRecord> {
    if (this.isRunning) {
      throw new Error(`Bot runtime is already running for bot "${this.botId}"`);
    }

    let record: BotRecord;

    // Check if bot already exists in registry
    let existing: BotRecord | null = null;
    if (this.botId) {
      try {
        existing = await this.botService.getBot(this.sessionId, this.botId);
      } catch {
        existing = null;
      }
    }

    if (existing) {
      // Re-activate bot with current process PID
      record = await this.botService.updateStatus(this.sessionId, existing.bot_id, 'active', {
        pid: process.pid,
      });
      this.botId = record.bot_id;
      this.displayName = record.display_name;
    } else {
      // Register newly
      const registerInput: RegisterBotInput = {
        botId: this.botId || undefined,
        displayName: this.displayName,
        description: this.description,
        status: 'active',
        pid: process.pid,
      };
      record = await this.botService.registerBot(this.sessionId, registerInput);
      this.botId = record.bot_id;
      this.displayName = record.display_name;
    }

    this.isRunning = true;

    // Start periodic heartbeat
    this.heartbeatTimer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.botService.touchHeartbeat(this.sessionId, this.botId);
      } catch {
        // Silently handle heartbeat error to prevent crash
      }
    }, this.heartbeatIntervalMs);

    // Start polling loop if callbacks registered or autoAcknowledge enabled
    if (this.onMessageCallback || this.onBroadcastCallback || this.autoAcknowledge) {
      this.pollTimer = setInterval(async () => {
        if (!this.isRunning) return;
        await this.pollCycle();
      }, this.pollIntervalMs);
    }

    // Attach signal handlers for graceful shutdown
    const handleSignal = async () => {
      await this.stop();
      process.exit(0);
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    this.signalCleanup = () => {
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);
    };

    return record;
  }

  /**
   * Internal poll cycle for consuming broadcasts and direct messages.
   */
  public async pollCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Read new broadcasts with cursor
      const broadcasts = await this.messagingService.readBroadcasts(this.sessionId, {
        botId: this.botId,
        autoAdvanceCursor: true,
      });

      if (this.onBroadcastCallback && broadcasts.length > 0) {
        for (const evt of broadcasts) {
          await this.onBroadcastCallback(evt);
        }
      }

      // Read unread messages in inbox without marking them as read upfront (RELIA-01, FR-321)
      const unreadMessages = await this.messagingService.readInbox(this.sessionId, this.botId, {
        status: 'unread',
        markAsRead: false,
      });

      for (const msg of unreadMessages) {
        if (this.onMessageCallback) {
          await this.onMessageCallback(msg);
        }
        // ONLY mark as read and acknowledge after processing finishes with success (At-Least-Once Delivery)
        await this.messagingService.markMessagesAsRead(this.sessionId, this.botId, [msg.message_id]);
        if (this.autoAcknowledge) {
          await this.messagingService.acknowledgeMessage(
            this.sessionId,
            this.botId,
            msg.message_id
          );
        }
      }
    } catch {
      // Polling errors are absorbed to keep runtime alive
    }
  }

  /**
   * Stops the bot runtime cleanly, updating status in the session registry to 'stopped'.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    if (this.signalCleanup) {
      this.signalCleanup();
      this.signalCleanup = undefined;
    }

    try {
      await this.botService.updateStatus(this.sessionId, this.botId, 'stopped');
    } catch {
      // Ignore if session already closed
    }
  }
}
