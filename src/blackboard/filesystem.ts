import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IBlackboardStorage } from './interface.js';
import type { SessionMetadata } from '../session/schema.js';
import { SessionMetadataSchema, validateSessionId } from '../session/schema.js';
import type { BotRecord, BotRegistry } from '../bot/schema.js';
import {
  BotRegistrySchema,
  CURRENT_BOT_REGISTRY_SCHEMA_VERSION,
  validateBotId,
} from '../bot/schema.js';
import type {
  BroadcastCursor,
  BroadcastEvent,
  DirectMessage,
  InboxStore,
} from '../messaging/schema.js';
import {
  BroadcastCursorSchema,
  BroadcastEventSchema,
  CURRENT_MESSAGING_SCHEMA_VERSION,
  DirectMessageSchema,
  InboxStoreSchema,
} from '../messaging/schema.js';
import type {
  EnvironmentMetadata,
  ProjectRootsRegistry,
  SdlcDocumentsRegistry,
} from '../shared/schema.js';
import {
  CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
  EnvironmentMetadataSchema,
  ProjectRootsRegistrySchema,
  SdlcDocumentsRegistrySchema,
} from '../shared/schema.js';
import type { WorkLogEntry } from '../shared/work-log.js';
import { WorkLogEntrySchema } from '../shared/work-log.js';
import {
  SessionAlreadyExistsError,
  SessionNotFoundError,
  BotNotFoundError,
  StaleLockFencingError,
} from '../core/errors.js';
import {
  ensureDir,
  pathExists,
  atomicWriteJson,
  readJsonValidated,
} from '../core/fs-utils.js';
import { withLock } from '../core/lock.js';
import { readJsonlFile } from '../core/jsonl.js';
import { getSessionDir, getSessionsBaseDir } from '../core/config.js';
import { redactRecursively } from '../execution/environment.js';

export class FilesystemSessionStorage implements IBlackboardStorage {
  public readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  public getSessionDir(sessionId: string): string {
    const validId = validateSessionId(sessionId);
    return getSessionDir(this.workspaceRoot, validId);
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'session.json');
  }

  private getBotRegistryFilePath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'registry', 'bots.json');
  }

  private getProjectRootsFilePath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'registry', 'project_roots.json');
  }

  private getEnvironmentFilePath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'registry', 'environment.json');
  }

  private getDocumentsFilePath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'registry', 'documents.json');
  }

  private getBroadcastFilePath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'broadcast', 'events.jsonl');
  }

  private getInboxDir(sessionId: string, botId: string): string {
    const validBotId = validateBotId(botId);
    return path.join(this.getSessionDir(sessionId), 'inbox', validBotId);
  }

  private getInboxFilePath(sessionId: string, botId: string): string {
    return path.join(this.getInboxDir(sessionId, botId), 'messages.json');
  }

  private getCursorFilePath(sessionId: string, botId: string): string {
    return path.join(this.getInboxDir(sessionId, botId), 'broadcast_cursor.json');
  }

  public getWorkLogFilePath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'work_log.jsonl');
  }

  public async sessionExists(sessionId: string): Promise<boolean> {
    try {
      const sessionFile = this.getSessionFilePath(sessionId);
      return await pathExists(sessionFile);
    } catch {
      return false;
    }
  }

  public async createSession(metadata: SessionMetadata): Promise<void> {
    const validId = validateSessionId(metadata.session_id);
    const sessionDir = this.getSessionDir(validId);
    const sessionFile = this.getSessionFilePath(validId);

    if (await this.sessionExists(validId)) {
      throw new SessionAlreadyExistsError(validId);
    }

    // Prepare directory hierarchy
    await ensureDir(sessionDir);
    await ensureDir(path.join(sessionDir, 'registry'));
    await ensureDir(path.join(sessionDir, 'broadcast'));
    await ensureDir(path.join(sessionDir, 'inbox'));

    // Validate metadata schema
    const validated = SessionMetadataSchema.parse(metadata);

    // Write under lock
    await this.withSessionLock(validId, async () => {
      // Re-check existence inside lock
      if (await pathExists(sessionFile)) {
        throw new SessionAlreadyExistsError(validId);
      }
      await atomicWriteJson(sessionFile, validated);
    });
  }

  public async getSession(sessionId: string): Promise<SessionMetadata> {
    const validId = validateSessionId(sessionId);
    const sessionFile = this.getSessionFilePath(validId);

    if (!(await pathExists(sessionFile))) {
      throw new SessionNotFoundError(validId);
    }

    return await readJsonValidated(sessionFile, SessionMetadataSchema);
  }

  public async updateSession(
    sessionId: string,
    updater: (current: SessionMetadata) => SessionMetadata,
    fencingToken?: number
  ): Promise<SessionMetadata> {
    const validId = validateSessionId(sessionId);
    const sessionFile = this.getSessionFilePath(validId);

    return await this.withSessionLock(validId, async (activeToken) => {
      await this.verifyStorageFencing(validId, fencingToken ?? activeToken);
      if (!(await pathExists(sessionFile))) {
        throw new SessionNotFoundError(validId);
      }

      const current = await readJsonValidated(sessionFile, SessionMetadataSchema);
      const updatedCandidate = updater(current);

      const toSave: SessionMetadata = {
        ...updatedCandidate,
        schema_version: current.schema_version,
        session_id: current.session_id,
        created_at: current.created_at,
        updated_at: new Date().toISOString(),
      };

      const validated = SessionMetadataSchema.parse(toSave);
      await atomicWriteJson(sessionFile, validated);
      return validated;
    });
  }

  public async listSessions(): Promise<SessionMetadata[]> {
    const sessionsBase = getSessionsBaseDir(this.workspaceRoot);
    if (!(await pathExists(sessionsBase))) {
      return [];
    }

    const entries = await fs.readdir(sessionsBase, { withFileTypes: true });
    const sessions: SessionMetadata[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sessionFile = path.join(sessionsBase, entry.name, 'session.json');
        if (await pathExists(sessionFile)) {
          try {
            const meta = await readJsonValidated(sessionFile, SessionMetadataSchema);
            sessions.push(meta);
          } catch {
            // Skip corrupted or incompatible directories in listing
          }
        }
      }
    }

    // Sort by created_at descending
    sessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return sessions;
  }

  private activeFencingContext = new AsyncLocalStorage<Map<string, number>>();

  public async withSessionLock<T>(sessionId: string, action: (fencingToken?: number) => Promise<T>): Promise<T> {
    const validId = validateSessionId(sessionId);
    const sessionDir = this.getSessionDir(validId);
    await ensureDir(sessionDir);
    return await withLock(sessionDir, async (handle) => {
      const currentStore = this.activeFencingContext.getStore();
      const nextMap = new Map(currentStore);
      nextMap.set(validId, handle.fencingToken);
      return await this.activeFencingContext.run(nextMap, () => action(handle.fencingToken));
    });
  }

  /**
   * Verifies that the caller's fencing token matches the active fencing epoch on disk.
   * If a newer lease has incremented the fencing token on disk, the caller is stale and write is rejected.
   */
  public async verifyStorageFencing(sessionId: string, explicitToken?: number): Promise<void> {
    const validId = validateSessionId(sessionId);
    const token = explicitToken ?? this.activeFencingContext.getStore()?.get(validId);
    if (token === undefined) {
      return;
    }

    const sessionDir = this.getSessionDir(validId);
    const fencingFile = path.join(sessionDir, '.fencing_token');
    try {
      const raw = await fs.readFile(fencingFile, 'utf-8');
      const diskToken = parseInt(raw.trim(), 10);
      if (!isNaN(diskToken) && token < diskToken) {
        throw new StaleLockFencingError(validId, token, diskToken);
      }
    } catch (err: unknown) {
      if (err instanceof StaleLockFencingError) {
        throw err;
      }
      // If fencing file doesn't exist yet, it's not fenced
    }
  }

  // --- Bot Registry Operations ---

  public async getBotRegistry(sessionId: string): Promise<BotRegistry> {
    const validId = validateSessionId(sessionId);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const registryFile = this.getBotRegistryFilePath(validId);
    if (!(await pathExists(registryFile))) {
      return {
        schema_version: CURRENT_BOT_REGISTRY_SCHEMA_VERSION,
        session_id: validId,
        updated_at: new Date().toISOString(),
        bots: [],
      };
    }

    return await readJsonValidated(registryFile, BotRegistrySchema);
  }

  public async saveBotRegistry(sessionId: string, registry: BotRegistry, fencingToken?: number): Promise<void> {
    const validId = validateSessionId(sessionId);
    await this.verifyStorageFencing(validId, fencingToken);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const registryFile = this.getBotRegistryFilePath(validId);
    const validated = BotRegistrySchema.parse(registry);
    await atomicWriteJson(registryFile, validated);
  }

  public async getBot(sessionId: string, botIdOrDisplayName: string): Promise<BotRecord> {
    const registry = await this.getBotRegistry(sessionId);
    const normalized = botIdOrDisplayName.trim().toLowerCase();

    const found = registry.bots.find(
      (b) => b.bot_id.toLowerCase() === normalized || b.display_name.toLowerCase() === normalized
    );

    if (!found) {
      throw new BotNotFoundError(botIdOrDisplayName, sessionId);
    }

    return found;
  }

  public async listBots(sessionId: string): Promise<BotRecord[]> {
    const registry = await this.getBotRegistry(sessionId);
    return registry.bots;
  }

  // --- Messaging Operations ---

  public async appendBroadcast(
    sessionId: string,
    event: BroadcastEvent,
    fencingToken?: number
  ): Promise<void> {
    const validId = validateSessionId(sessionId);
    await this.verifyStorageFencing(validId, fencingToken);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const broadcastDir = path.join(this.getSessionDir(validId), 'broadcast');
    await ensureDir(broadcastDir);
    const broadcastFile = this.getBroadcastFilePath(validId);

    const validated = BroadcastEventSchema.parse(redactRecursively(event));
    const line = JSON.stringify(validated) + '\n';

    await this.withSessionLock(validId, async (activeToken) => {
      await this.verifyStorageFencing(validId, fencingToken ?? activeToken);
      await fs.appendFile(broadcastFile, line, 'utf-8');
    });
  }

  public async readBroadcasts(sessionId: string): Promise<BroadcastEvent[]> {
    const validId = validateSessionId(sessionId);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const broadcastFile = this.getBroadcastFilePath(validId);
    const quarantineFile = path.join(this.getSessionDir(validId), 'broadcast', 'events.corrupt.jsonl');
    const result = await readJsonlFile(broadcastFile, BroadcastEventSchema, {
      strict: false,
      quarantineFilePath: quarantineFile,
    });
    return result.records;
  }

  public async getBroadcastCursor(sessionId: string, botId: string): Promise<BroadcastCursor> {
    const cursorFile = this.getCursorFilePath(sessionId, botId);
    if (!(await pathExists(cursorFile))) {
      return {
        last_read_event_id: null,
        last_read_timestamp: null,
        category_cursors: {},
        acknowledged_event_ids: [],
      };
    }
    return await readJsonValidated(cursorFile, BroadcastCursorSchema);
  }

  public async saveBroadcastCursor(
    sessionId: string,
    botId: string,
    cursor: BroadcastCursor,
    fencingToken?: number
  ): Promise<void> {
    const validId = validateSessionId(sessionId);
    await this.verifyStorageFencing(validId, fencingToken);
    const cursorFile = this.getCursorFilePath(validId, botId);
    const validated = BroadcastCursorSchema.parse(cursor);
    await atomicWriteJson(cursorFile, validated);
  }

  public async getInbox(sessionId: string, botId: string): Promise<InboxStore> {
    const validSession = validateSessionId(sessionId);
    const validBot = validateBotId(botId);

    if (!(await this.sessionExists(validSession))) {
      throw new SessionNotFoundError(validSession);
    }

    const inboxFile = this.getInboxFilePath(validSession, validBot);
    if (!(await pathExists(inboxFile))) {
      return {
        schema_version: CURRENT_MESSAGING_SCHEMA_VERSION,
        session_id: validSession,
        bot_id: validBot,
        updated_at: new Date().toISOString(),
        messages: [],
      };
    }

    return await readJsonValidated(inboxFile, InboxStoreSchema);
  }

  public async saveInbox(
    sessionId: string,
    botId: string,
    store: InboxStore,
    fencingToken?: number
  ): Promise<void> {
    const validSession = validateSessionId(sessionId);
    const validBot = validateBotId(botId);
    await this.verifyStorageFencing(validSession, fencingToken);

    const inboxFile = this.getInboxFilePath(validSession, validBot);
    const validated = InboxStoreSchema.parse(redactRecursively(store));
    await atomicWriteJson(inboxFile, validated);
  }

  public async appendMessageToInbox(
    sessionId: string,
    recipientBotId: string,
    message: DirectMessage
  ): Promise<void> {
    const validSession = validateSessionId(sessionId);
    const validRecipient = validateBotId(recipientBotId);

    await this.withSessionLock(validSession, async () => {
      const inbox = await this.getInbox(validSession, validRecipient);
      const validatedMessage = DirectMessageSchema.parse(message);

      inbox.messages.push(validatedMessage);
      inbox.updated_at = new Date().toISOString();

      await this.saveInbox(validSession, validRecipient, inbox);
    });
  }

  // --- Shared Project Context Operations ---

  public async getProjectRootsRegistry(sessionId: string): Promise<ProjectRootsRegistry> {
    const validId = validateSessionId(sessionId);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const file = this.getProjectRootsFilePath(validId);
    if (!(await pathExists(file))) {
      return {
        schema_version: CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
        session_id: validId,
        updated_at: new Date().toISOString(),
        roots: [],
      };
    }

    return await readJsonValidated(file, ProjectRootsRegistrySchema);
  }

  public async saveProjectRootsRegistry(
    sessionId: string,
    registry: ProjectRootsRegistry,
    fencingToken?: number
  ): Promise<void> {
    const validId = validateSessionId(sessionId);
    await this.verifyStorageFencing(validId, fencingToken);
    const file = this.getProjectRootsFilePath(validId);
    const validated = ProjectRootsRegistrySchema.parse(registry);
    await atomicWriteJson(file, validated);
  }

  public async getEnvironmentMetadata(sessionId: string): Promise<EnvironmentMetadata | null> {
    const validId = validateSessionId(sessionId);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const file = this.getEnvironmentFilePath(validId);
    if (!(await pathExists(file))) {
      return null;
    }

    return await readJsonValidated(file, EnvironmentMetadataSchema);
  }

  public async saveEnvironmentMetadata(
    sessionId: string,
    metadata: EnvironmentMetadata,
    fencingToken?: number
  ): Promise<void> {
    const validId = validateSessionId(sessionId);
    await this.verifyStorageFencing(validId, fencingToken);
    const file = this.getEnvironmentFilePath(validId);
    const validated = EnvironmentMetadataSchema.parse(metadata);
    await atomicWriteJson(file, validated);
  }

  public async getDocumentsRegistry(sessionId: string): Promise<SdlcDocumentsRegistry> {
    const validId = validateSessionId(sessionId);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const file = this.getDocumentsFilePath(validId);
    if (!(await pathExists(file))) {
      return {
        schema_version: CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
        session_id: validId,
        updated_at: new Date().toISOString(),
        documents: [],
      };
    }

    return await readJsonValidated(file, SdlcDocumentsRegistrySchema);
  }

  public async saveDocumentsRegistry(
    sessionId: string,
    registry: SdlcDocumentsRegistry,
    fencingToken?: number
  ): Promise<void> {
    const validId = validateSessionId(sessionId);
    await this.verifyStorageFencing(validId, fencingToken);
    const file = this.getDocumentsFilePath(validId);
    const validated = SdlcDocumentsRegistrySchema.parse(registry);
    await atomicWriteJson(file, validated);
  }

  // --- Work Log Operations ---

  public async appendWorkLog(
    sessionId: string,
    entry: WorkLogEntry,
    fencingToken?: number
  ): Promise<void> {
    const validId = validateSessionId(sessionId);
    await this.verifyStorageFencing(validId, fencingToken);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const workLogFile = this.getWorkLogFilePath(validId);
    const validated = WorkLogEntrySchema.parse(redactRecursively(entry));
    const line = JSON.stringify(validated) + '\n';

    await this.withSessionLock(validId, async (activeToken) => {
      await this.verifyStorageFencing(validId, fencingToken ?? activeToken);
      await fs.appendFile(workLogFile, line, 'utf-8');
    });
  }

  public async readWorkLogs(sessionId: string): Promise<WorkLogEntry[]> {
    const validId = validateSessionId(sessionId);
    if (!(await this.sessionExists(validId))) {
      throw new SessionNotFoundError(validId);
    }

    const workLogFile = this.getWorkLogFilePath(validId);
    const quarantineFile = path.join(this.getSessionDir(validId), 'work_log.corrupt.jsonl');
    const result = await readJsonlFile(workLogFile, WorkLogEntrySchema, {
      strict: true,
      quarantineFilePath: quarantineFile,
    });
    return result.records;
  }
}
