import type { ISessionStorage } from '../blackboard/interface.js';
import type {
  CreateSessionInput,
  SessionMetadata,
  UpdateSessionInput,
} from './schema.js';
import {
  CURRENT_SCHEMA_VERSION,
  sanitizeSessionId,
  validateSessionId,
} from './schema.js';
import crypto from 'node:crypto';

export class SessionService {
  private readonly storage: ISessionStorage;

  constructor(storage: ISessionStorage) {
    this.storage = storage;
  }

  /**
   * Creates a new persistent Session.
   */
  public async createSession(input: CreateSessionInput): Promise<SessionMetadata> {
    let sessionId: string;

    if (input.sessionId && input.sessionId.trim().length > 0) {
      sessionId = validateSessionId(input.sessionId);
    } else {
      // Generate default ID candidate from session name
      const baseCandidate = sanitizeSessionId(input.sessionName);
      const randomSuffix = crypto.randomBytes(3).toString('hex');
      sessionId = `${baseCandidate}-${randomSuffix}`;
    }

    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      schema_version: CURRENT_SCHEMA_VERSION,
      session_id: sessionId,
      session_name: input.sessionName.trim(),
      description: input.description?.trim(),
      created_at: now,
      updated_at: now,
      status: 'active',
      metadata: input.metadata ?? {},
    };

    await this.storage.createSession(metadata);
    return metadata;
  }

  /**
   * Retrieves an existing session by ID.
   */
  public async getSession(sessionId: string): Promise<SessionMetadata> {
    return await this.storage.getSession(sessionId);
  }

  /**
   * Updates an existing session's name, description, status, or metadata.
   */
  public async updateSession(
    sessionId: string,
    input: UpdateSessionInput
  ): Promise<SessionMetadata> {
    return await this.storage.updateSession(sessionId, (current) => {
      return {
        ...current,
        session_name: input.sessionName !== undefined ? input.sessionName.trim() : current.session_name,
        description: input.description !== undefined ? input.description.trim() : current.description,
        status: input.status !== undefined ? input.status : current.status,
        metadata: input.metadata !== undefined ? { ...current.metadata, ...input.metadata } : current.metadata,
      };
    });
  }

  /**
   * Lists all sessions stored in the workspace.
   */
  public async listSessions(): Promise<SessionMetadata[]> {
    return await this.storage.listSessions();
  }

  /**
   * Checks if a session ID exists.
   */
  public async sessionExists(sessionId: string): Promise<boolean> {
    return await this.storage.sessionExists(sessionId);
  }

  /**
   * Returns the directory path of a session.
   */
  public getSessionDir(sessionId: string): string {
    return this.storage.getSessionDir(sessionId);
  }
}
