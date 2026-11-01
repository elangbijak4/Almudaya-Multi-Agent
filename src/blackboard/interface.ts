import type { SessionMetadata } from '../session/schema.js';
import type { BotRecord, BotRegistry } from '../bot/schema.js';
import type {
  BroadcastCursor,
  BroadcastEvent,
  DirectMessage,
  InboxStore,
} from '../messaging/schema.js';

/**
 * Persistence abstraction for Session storage operations.
 */
export interface ISessionStorage {
  createSession(metadata: SessionMetadata): Promise<void>;
  getSession(sessionId: string): Promise<SessionMetadata>;
  updateSession(
    sessionId: string,
    updater: (current: SessionMetadata) => SessionMetadata
  ): Promise<SessionMetadata>;
  sessionExists(sessionId: string): Promise<boolean>;
  listSessions(): Promise<SessionMetadata[]>;
  getSessionDir(sessionId: string): string;
  withSessionLock<T>(sessionId: string, action: () => Promise<T>): Promise<T>;
}

/**
 * Persistence abstraction for Bot Registry operations.
 */
export interface IBotRegistryStorage {
  getBotRegistry(sessionId: string): Promise<BotRegistry>;
  saveBotRegistry(sessionId: string, registry: BotRegistry): Promise<void>;
  getBot(sessionId: string, botIdOrDisplayName: string): Promise<BotRecord>;
  listBots(sessionId: string): Promise<BotRecord[]>;
}

/**
 * Persistence abstraction for Messaging (Broadcast log and per-bot inboxes).
 */
export interface IMessagingStorage {
  appendBroadcast(sessionId: string, event: BroadcastEvent): Promise<void>;
  readBroadcasts(sessionId: string): Promise<BroadcastEvent[]>;
  getBroadcastCursor(sessionId: string, botId: string): Promise<BroadcastCursor>;
  saveBroadcastCursor(sessionId: string, botId: string, cursor: BroadcastCursor): Promise<void>;
  getInbox(sessionId: string, botId: string): Promise<InboxStore>;
  saveInbox(sessionId: string, botId: string, store: InboxStore): Promise<void>;
  appendMessageToInbox(
    sessionId: string,
    recipientBotId: string,
    message: DirectMessage
  ): Promise<void>;
}

/**
 * Combined Blackboard Storage interface.
 */
export interface IBlackboardStorage
  extends ISessionStorage,
    IBotRegistryStorage,
    IMessagingStorage {}
