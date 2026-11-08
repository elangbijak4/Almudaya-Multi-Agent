import path from 'node:path';
import fs from 'node:fs/promises';
import {
  CapabilityGrantSchema,
  SecurityAuditEventSchema,
  type CapabilityGrant,
  type SecurityAuditEvent,
  type GrantStatus,
} from './schema.js';
import { readJsonlFile, appendJsonlRecord } from '../core/jsonl.js';
import { ensureDir, pathExists } from '../core/fs-utils.js';
import { withLock } from '../core/lock.js';
import { redactSecrets } from '../execution/environment.js';
import { validateSessionId } from '../session/schema.js';
import { isPathInsideRoot, PathTraversalSecurityError } from '../tools/sandbox.js';

export interface CapabilityStorageOptions {
  workspaceRoot?: string;
}

export class CapabilityPersistence {
  private workspaceRoot: string;

  constructor(options: CapabilityStorageOptions = {}) {
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  }

  public getCapabilitiesDir(sessionId: string): string {
    const validId = validateSessionId(sessionId);
    const targetDir = path.resolve(this.workspaceRoot, 'sessions', validId, 'capabilities');
    if (!isPathInsideRoot(this.workspaceRoot, targetDir)) {
      throw new PathTraversalSecurityError(
        `Path traversal detected: target capabilities directory "${targetDir}" is outside workspace root "${this.workspaceRoot}".`,
        targetDir,
        [this.workspaceRoot]
      );
    }
    return targetDir;
  }

  public getGrantsFilePath(sessionId: string): string {
    return path.join(this.getCapabilitiesDir(sessionId), 'grants.jsonl');
  }

  public getAuditFilePath(sessionId: string): string {
    return path.join(this.getCapabilitiesDir(sessionId), 'audit.jsonl');
  }

  private async withSessionLock<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const validId = validateSessionId(sessionId);
    const sessionDir = path.resolve(this.workspaceRoot, 'sessions', validId);
    if (!isPathInsideRoot(this.workspaceRoot, sessionDir)) {
      throw new PathTraversalSecurityError(
        `Path traversal detected: session directory "${sessionDir}" is outside workspace root "${this.workspaceRoot}".`,
        sessionDir,
        [this.workspaceRoot]
      );
    }
    await ensureDir(sessionDir);
    return await withLock(sessionDir, action);
  }

  public async saveGrant(sessionId: string, grant: CapabilityGrant): Promise<void> {
    const validated = CapabilityGrantSchema.parse(grant);
    const dir = this.getCapabilitiesDir(sessionId);
    await ensureDir(dir);
    const grantsFile = this.getGrantsFilePath(sessionId);

    await this.withSessionLock(sessionId, async () => {
      const existing = await this.getGrantsRaw(sessionId);
      const index = existing.findIndex((g) => g.grant_id === validated.grant_id);
      if (index >= 0) {
        existing[index] = validated;
      } else {
        existing.push(validated);
      }

      // Rewrite file cleanly
      const lines = existing.map((g) => JSON.stringify(g)).join('\n');
      await fs.writeFile(grantsFile, lines ? lines + '\n' : '', 'utf-8');
    });
  }

  private async getGrantsRaw(sessionId: string): Promise<CapabilityGrant[]> {
    const grantsFile = this.getGrantsFilePath(sessionId);
    if (!(await pathExists(grantsFile))) {
      return [];
    }
    const result = await readJsonlFile(grantsFile, CapabilityGrantSchema, {
      strict: false,
      quarantineFilePath: path.join(this.getCapabilitiesDir(sessionId), 'grants.corrupt.jsonl'),
    });
    return result.records;
  }

  public async getGrants(sessionId: string): Promise<CapabilityGrant[]> {
    const raw = await this.getGrantsRaw(sessionId);
    const now = Date.now();

    // Map and mark expired grants if expired_at has passed and still marked active
    return raw.map((grant) => {
      if (grant.status === 'active' && now > new Date(grant.expires_at).getTime()) {
        return { ...grant, status: 'expired' as const };
      }
      return grant;
    });
  }

  public async getGrant(sessionId: string, grantId: string): Promise<CapabilityGrant | undefined> {
    const grants = await this.getGrants(sessionId);
    return grants.find((g) => g.grant_id === grantId);
  }

  public async updateGrantStatus(
    sessionId: string,
    grantId: string,
    status: GrantStatus,
    meta: { revoked_by?: string; reason?: string } = {}
  ): Promise<CapabilityGrant> {
    return await this.withSessionLock(sessionId, async () => {
      const grants = await this.getGrants(sessionId);
      const grant = grants.find((g) => g.grant_id === grantId);
      if (!grant) {
        throw new Error(`Capability grant not found: ${grantId} in session ${sessionId}`);
      }

      grant.status = status;
      if (status === 'revoked') {
        grant.revoked_at = new Date().toISOString();
        if (meta.revoked_by) grant.revoked_by = meta.revoked_by;
        if (meta.reason) grant.revocation_reason = meta.reason;
      }

      const grantsFile = this.getGrantsFilePath(sessionId);
      const lines = grants.map((g) => JSON.stringify(g)).join('\n');
      await fs.writeFile(grantsFile, lines ? lines + '\n' : '', 'utf-8');

      return grant;
    });
  }

  public async recordAuditEvent(sessionId: string, event: SecurityAuditEvent): Promise<void> {
    const validated = SecurityAuditEventSchema.parse(event);
    const dir = this.getCapabilitiesDir(sessionId);
    await ensureDir(dir);
    const auditFile = this.getAuditFilePath(sessionId);

    // Redact all sensitive fields in details
    const sanitizedDetails: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(validated.details)) {
      if (typeof value === 'string') {
        sanitizedDetails[key] = redactSecrets(value);
      } else {
        sanitizedDetails[key] = value;
      }
    }

    const cleanEvent: SecurityAuditEvent = {
      ...validated,
      details: sanitizedDetails,
    };

    await appendJsonlRecord(auditFile, cleanEvent, SecurityAuditEventSchema);
  }

  public async getAuditEvents(
    sessionId: string,
    options: { limit?: number; type?: string } = {}
  ): Promise<SecurityAuditEvent[]> {
    const auditFile = this.getAuditFilePath(sessionId);
    if (!(await pathExists(auditFile))) {
      return [];
    }
    const result = await readJsonlFile(auditFile, SecurityAuditEventSchema, {
      strict: false,
    });
    let events = result.records;
    if (options.type) {
      events = events.filter((e) => e.type === options.type);
    }
    if (options.limit && options.limit > 0) {
      events = events.slice(-options.limit);
    }
    return events;
  }

  public async resetCapabilities(sessionId: string): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
      const grants = await this.getGrants(sessionId);
      const now = new Date().toISOString();
      const updated = grants.map((g) => {
        if (g.status === 'active') {
          return {
            ...g,
            status: 'revoked' as const,
            revoked_at: now,
            revoked_by: 'system_reset',
            revocation_reason: 'Capability reset requested for session',
          };
        }
        return g;
      });
      const grantsFile = this.getGrantsFilePath(sessionId);
      await fs.mkdir(path.dirname(grantsFile), { recursive: true });
      const lines = updated.map((g) => JSON.stringify(g)).join('\n');
      await fs.writeFile(grantsFile, lines ? lines + '\n' : '', 'utf-8');
    });
  }
}
