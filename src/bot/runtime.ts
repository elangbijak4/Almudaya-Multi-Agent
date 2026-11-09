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
  onMessage?: (message: DirectMessage, signal?: AbortSignal) => Promise<void>;
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
  private pollInFlight: boolean = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;
  private signalCleanup?: () => void;
  private abortController: AbortController = new AbortController();

  private readonly onMessageCallback?: (message: DirectMessage, signal?: AbortSignal) => Promise<void>;
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

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Starts the bot runtime: registers/activates the bot, starts heartbeating and message polling.
   */
  public async start(): Promise<BotRecord> {
    if (this.isRunning) {
      throw new Error(`Bot runtime is already running for bot "${this.botId}"`);
    }

    this.abortController = new AbortController();

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
   * Single-flight execution prevents intra-process reentrancy (PERF-01).
   * Storage-level leases prevent inter-process duplicate claims (RELIA-01, ADR-004).
   */
  public async pollCycle(): Promise<void> {
    if (!this.isRunning || this.pollInFlight || this.abortController.signal.aborted) return;
    this.pollInFlight = true;

    try {
      // 1. Read new broadcasts without premature cursor advancement (AUD-07, REQ-05)
      const broadcasts = await this.messagingService.readBroadcasts(this.sessionId, {
        botId: this.botId,
        autoAdvanceCursor: false,
      });

      if (broadcasts.length > 0) {
        if (this.onBroadcastCallback) {
          for (const evt of broadcasts) {
            if (this.abortController.signal.aborted) break;
            await this.onBroadcastCallback(evt);
            // Advance cursor only AFTER callback completes successfully (AUD-07, REQ-05)
            await this.messagingService.advanceBroadcastCursor(this.sessionId, this.botId, evt);
          }
        } else {
          for (const evt of broadcasts) {
            if (this.abortController.signal.aborted) break;
            await this.messagingService.advanceBroadcastCursor(this.sessionId, this.botId, evt);
          }
        }
      }

      if (this.abortController.signal.aborted) return;

      // 2. Recover any expired leases from crashed workers
      await this.messagingService.delivery.recoverExpiredLeases(this.sessionId, this.botId);

      // 3. Atomically claim and process messages via delivery state machine
      const consumerId = `${this.botId}:pid-${process.pid}`;
      const processedInThisCycle: string[] = [];
      let msg: DirectMessage | null = null;

      while (this.isRunning && !this.abortController.signal.aborted) {
        msg = await this.messagingService.delivery.claimNextMessage(
          this.sessionId,
          this.botId,
          consumerId,
          undefined,
          processedInThisCycle
        );
        if (!msg) break;
        processedInThisCycle.push(msg.message_id);

        try {
          if (this.onMessageCallback) {
            await this.onMessageCallback(msg, this.abortController.signal);
          }

          // Complete message only after consumer callback succeeds, with lease ownership and fencing token (AUD-08, REQ-04)
          await this.messagingService.delivery.completeMessage(
            this.sessionId,
            this.botId,
            msg.message_id,
            consumerId,
            msg.fence_token
          );
        } catch (err: unknown) {
          // Transition to RETRY_PENDING or DEAD_LETTER without dropping message, with lease ownership and fencing token (AUD-08, REQ-04)
          const errMsg = err instanceof Error ? err.message : String(err);
          await this.messagingService.delivery.failMessage(
            this.sessionId,
            this.botId,
            msg.message_id,
            errMsg,
            consumerId,
            msg.fence_token
          );
        }
      }
    } catch {
      // Polling errors are absorbed to keep runtime alive
    } finally {
      this.pollInFlight = false;
    }
  }

  /**
   * Stops the bot runtime cleanly, updating status in the session registry to 'stopped'.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.abortController.abort();

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
