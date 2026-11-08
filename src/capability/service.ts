import crypto from 'node:crypto';
import { CapabilityPersistence } from './persistence.js';
import { PolicyEngine, type PolicyEvaluationRequest } from './policy-engine.js';
import { CapabilityRegistry } from './registry.js';
import { CapabilityPresets, type PresetOptions } from './presets.js';
import {
  type CapabilityGrant,
  type PolicyEvaluationResult,
  type SecurityAuditEvent,
  type CapabilityScope,
  type ApprovalMode,
} from './schema.js';

export interface GrantCapabilityInput {
  sessionId: string;
  capability: string;
  scope?: CapabilityScope;
  grantedBy: string;
  durationHours?: number;
  botId?: string;
  approvalMode?: ApprovalMode;
  reason?: string;
}

export class CapabilityService {
  private persistence: CapabilityPersistence;

  constructor(persistence?: CapabilityPersistence) {
    this.persistence = persistence ?? new CapabilityPersistence();
  }

  public getPersistence(): CapabilityPersistence {
    return this.persistence;
  }

  /**
   * Grants a scoped capability to a session (and optionally a specific bot).
   */
  public async grantCapability(input: GrantCapabilityInput): Promise<CapabilityGrant> {
    const { sessionId, capability, grantedBy, botId, reason } = input;

    if (!CapabilityRegistry.isKnownCapability(capability)) {
      throw new Error(`Cannot grant unknown capability: "${capability}". Must be defined in ACG registry.`);
    }

    const durationHours = input.durationHours ?? 24;
    const now = Date.now();
    const grantedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + durationHours * 3600 * 1000).toISOString();
    const grantId = crypto.randomUUID();

    const grant: CapabilityGrant = {
      grant_id: grantId,
      capability,
      scope: input.scope ?? {},
      granted_by: grantedBy,
      granted_at: grantedAt,
      expires_at: expiresAt,
      session_id: sessionId,
      bot_id: botId,
      approval_mode: input.approvalMode ?? 'session',
      status: 'active',
      reason: reason ?? 'Explicit capability grant',
    };

    await this.persistence.saveGrant(sessionId, grant);

    await this.recordAudit(sessionId, {
      type: 'CAPABILITY_GRANTED',
      capability,
      grant_id: grantId,
      bot_id: botId,
      details: {
        granted_by: grantedBy,
        scope: grant.scope,
        approval_mode: grant.approval_mode,
        expires_at: expiresAt,
        reason: grant.reason,
      },
    });

    return grant;
  }

  /**
   * Revokes an existing active capability grant.
   */
  public async revokeGrant(
    sessionId: string,
    grantId: string,
    revokedBy: string,
    reason = 'Administrative revocation'
  ): Promise<CapabilityGrant> {
    const updated = await this.persistence.updateGrantStatus(sessionId, grantId, 'revoked', {
      revoked_by: revokedBy,
      reason,
    });

    await this.recordAudit(sessionId, {
      type: 'CAPABILITY_REVOKED',
      capability: updated.capability,
      grant_id: grantId,
      details: {
        revoked_by: revokedBy,
        reason,
      },
    });

    return updated;
  }

  public async getGrants(sessionId: string): Promise<CapabilityGrant[]> {
    return await this.persistence.getGrants(sessionId);
  }

  public async getGrant(sessionId: string, grantId: string): Promise<CapabilityGrant | undefined> {
    return await this.persistence.getGrant(sessionId, grantId);
  }

  /**
   * Evaluates an access request against active session grants with full audit recording.
   */
  public async evaluate(request: PolicyEvaluationRequest): Promise<PolicyEvaluationResult> {
    const grants = await this.persistence.getGrants(request.sessionId);
    const result = PolicyEngine.evaluate(request, grants);

    // Record audit event
    await this.recordAudit(request.sessionId, {
      type: 'POLICY_EVALUATED',
      capability: request.capability,
      grant_id: result.matching_grant_id,
      bot_id: request.botId,
      details: {
        decision: result.decision,
        reason: result.reason,
        target_resource: request.targetResource,
        operation: request.operation,
        is_turbo: request.isTurbo,
      },
    });

    if (result.decision === 'DENY') {
      await this.recordAudit(request.sessionId, {
        type: 'CAPABILITY_DENIED',
        capability: request.capability,
        bot_id: request.botId,
        details: {
          reason: result.reason,
          target_resource: request.targetResource,
        },
      });
    }

    return result;
  }

  /**
   * Applies an architectural preset to the session.
   */
  public async applyPreset(
    sessionId: string,
    presetName: string,
    grantedBy: string,
    options: PresetOptions = {}
  ): Promise<CapabilityGrant[]> {
    const grants = CapabilityPresets.generateGrants(presetName, sessionId, grantedBy, options);

    for (const grant of grants) {
      await this.persistence.saveGrant(sessionId, grant);
      await this.recordAudit(sessionId, {
        type: 'CAPABILITY_GRANTED',
        capability: grant.capability,
        grant_id: grant.grant_id,
        bot_id: grant.bot_id,
        details: {
          preset: presetName,
          granted_by: grantedBy,
          scope: grant.scope,
          approval_mode: grant.approval_mode,
        },
      });
    }

    return grants;
  }

  public async getAuditHistory(
    sessionId: string,
    options: { limit?: number; type?: string } = {}
  ): Promise<SecurityAuditEvent[]> {
    return await this.persistence.getAuditEvents(sessionId, options);
  }

  public async resetSession(sessionId: string): Promise<void> {
    await this.persistence.resetCapabilities(sessionId);
    await this.recordAudit(sessionId, {
      type: 'CAPABILITY_REVOKED',
      details: { action: 'session_capabilities_reset' },
    });
  }

  private async recordAudit(
    sessionId: string,
    event: Omit<SecurityAuditEvent, 'event_id' | 'timestamp' | 'session_id'>
  ): Promise<void> {
    try {
      const fullEvent: SecurityAuditEvent = {
        event_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        type: event.type,
        capability: event.capability,
        grant_id: event.grant_id,
        bot_id: event.bot_id,
        details: event.details ?? {},
      };
      await this.persistence.recordAuditEvent(sessionId, fullEvent);
    } catch {
      // Best-effort audit logging
    }
  }
}
