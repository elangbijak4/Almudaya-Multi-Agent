import path from 'node:path';
import { CapabilityRegistry } from './registry.js';
import type { CapabilityGrant, PolicyEvaluationResult } from './schema.js';

export interface PolicyEvaluationRequest {
  capability: string;
  sessionId: string;
  botId?: string;
  operation?: string;
  targetResource?: string;
  envVars?: string[];
  isTurbo?: boolean;
  enforcementBackendAvailable?: boolean;
}

/**
 * Hard-deny path patterns: sensitive OS locations and secrets that must NEVER be accessed
 * even if a broad external capability or grant is claimed.
 */
const HARD_DENY_RESOURCE_PATTERNS = [
  /(\/|\\)etc(\/|\\)(shadow|master\.passwd)/i,
  /System32(\/|\\)config(\/|\\)(SAM|SECURITY|SYSTEM)/i,
  /(\/|\\)\.ssh(\/|\\)(id_rsa|id_ed25519|id_ecdsa)$/i,
  /(\/|\\)\.gnupg(\/|\\)private-keys/i,
];

/**
 * Extracts the base command binary from a command string or executable path (AUD-13, REQ-09).
 * Handles leading quotes, path prefixes, arguments, and Windows extensions (.exe, .cmd, .bat).
 */
export function extractCommandBinary(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  if (!trimmed) return '';

  let executablePart = '';
  if (trimmed.startsWith('"')) {
    const nextQuote = trimmed.indexOf('"', 1);
    executablePart = nextQuote !== -1 ? trimmed.slice(1, nextQuote) : trimmed.slice(1);
  } else if (trimmed.startsWith("'")) {
    const nextQuote = trimmed.indexOf("'", 1);
    executablePart = nextQuote !== -1 ? trimmed.slice(1, nextQuote) : trimmed.slice(1);
  } else {
    executablePart = trimmed.split(/\s+/)[0] ?? '';
  }

  return path.basename(executablePart).toLowerCase();
}

/**
 * Central ACG Policy Engine (SEC-03, ADR-001).
 * Enforces strict fail-closed authorization, scope validation, and TURBO isolation.
 */
export class PolicyEngine {
  /**
   * Evaluates an access request against active session grants and security rules.
   * Follows the normative 10-step policy evaluation order:
   * 1. Validate request
   * 2. Apply hard-deny rules
   * 3. Apply explicit deny rules
   * 4. Find active matching grants
   * 5. Validate scope (empty scope never means unrestricted)
   * 6. Validate session and bot binding
   * 7. Validate expiry and revocation
   * 8. Evaluate approval requirement
   * 9. Confirm enforcement backend support
   * 10. Return structured decision
   */
  public static evaluate(
    request: PolicyEvaluationRequest,
    activeGrants: CapabilityGrant[]
  ): PolicyEvaluationResult {
    const { capability, sessionId, botId, targetResource, operation, isTurbo } = request;
    const def = CapabilityRegistry.getCapability(capability);

    // 1. Validate request: unknown capabilities and missing sessionId default to DENY (AUD-02, REQ-02)
    if (!sessionId || !sessionId.trim()) {
      return {
        decision: 'DENY',
        capability,
        reason: 'Policy evaluation rejected: missing mandatory sessionId.',
        requires_approval: false,
        risk: def?.risk ?? 'CRITICAL',
      };
    }

    if (!def) {
      return {
        decision: 'DENY',
        capability,
        reason: `Unknown capability identifier: "${capability}". Capability must be registered in ACG registry.`,
        requires_approval: false,
        risk: 'CRITICAL',
      };
    }

    // 2. Hard-deny rules
    if (targetResource) {
      for (const pattern of HARD_DENY_RESOURCE_PATTERNS) {
        if (pattern.test(targetResource)) {
          return {
            decision: 'DENY',
            capability,
            reason: `Hard-deny security rule violated: access to sensitive OS resource "${targetResource}" is permanently forbidden.`,
            requires_approval: false,
            risk: def.risk,
          };
        }
      }
    }

    // 4. Find matching grants bound to this session
    const matchingGrants = activeGrants.filter((g) => {
      if (g.capability !== capability) return false;
      if (g.session_id !== sessionId) return false;
      if (g.status !== 'active') return false;

      // 6. Bot binding: if grant is bound to specific bot, caller must match exactly (AUD-04, REQ-02, Invariant 5)
      if (g.bot_id && (!botId || g.bot_id !== botId)) return false;

      // 7. Expiry check
      const now = Date.now();
      if (now > new Date(g.expires_at).getTime()) return false;

      return true;
    });

    if (matchingGrants.length === 0) {
      // Rule 6.6: TURBO is NOT privilege escalation! TURBO + no grant = DENY
      return {
        decision: 'DENY',
        capability,
        reason: `Access denied: no active capability grant found for "${capability}" in session "${sessionId}"${isTurbo ? ' (TURBO mode cannot grant capabilities)' : ''}.`,
        requires_approval: false,
        risk: def.risk,
      };
    }

    // 5. Scope validation across candidate grants
    let matchingGrant: CapabilityGrant | undefined;
    let scopeFailureReason = 'Target resource is outside granted scope.';

    for (const grant of matchingGrants) {
      // Empty scope rule: an empty scope NEVER means unrestricted access!
      if (def.scopeRequired) {
        const hasPaths = grant.scope.paths && grant.scope.paths.length > 0;
        const hasCommands = grant.scope.commands && grant.scope.commands.length > 0;
        const hasHosts = grant.scope.hosts && grant.scope.hosts.length > 0;
        const hasEnv = grant.scope.env_vars && grant.scope.env_vars.length > 0;

        if (!hasPaths && !hasCommands && !hasHosts && !hasEnv) {
          scopeFailureReason = 'Capability requires explicit scope; empty scope does not grant unrestricted access.';
          continue;
        }
      }

      // Check path scope
      if (targetResource && grant.scope.paths && grant.scope.paths.length > 0) {
        const normTarget = path.resolve(targetResource).toLowerCase();
        const pathMatches = grant.scope.paths.some((p) => {
          const normScope = path.resolve(p).toLowerCase();
          return normTarget === normScope || normTarget.startsWith(normScope + path.sep);
        });
        if (!pathMatches) {
          scopeFailureReason = `Path "${targetResource}" is not inside granted path scopes: [${grant.scope.paths.join(', ')}].`;
          continue;
        }
      }

      // Check command scope (AUD-13, REQ-09)
      if (targetResource && grant.scope.commands && grant.scope.commands.length > 0) {
        const baseCmd = extractCommandBinary(targetResource);
        const baseCmdWithoutExt = baseCmd.replace(/\.(exe|cmd|bat)$/i, '');
        const cmdMatches = grant.scope.commands.some((c) => {
          const lowerC = c.toLowerCase().trim();
          const lowerCWithoutExt = lowerC.replace(/\.(exe|cmd|bat)$/i, '');
          return (
            lowerC === baseCmd ||
            lowerCWithoutExt === baseCmd ||
            lowerC === baseCmdWithoutExt ||
            lowerCWithoutExt === baseCmdWithoutExt
          );
        });
        if (!cmdMatches) {
          scopeFailureReason = `Command "${baseCmd}" is not in granted command scope: [${grant.scope.commands.join(', ')}].`;
          continue;
        }
      }

      // Check operation scope
      if (operation && grant.scope.operations && grant.scope.operations.length > 0) {
        if (!grant.scope.operations.includes(operation)) {
          scopeFailureReason = `Operation "${operation}" is not permitted by grant scope: [${grant.scope.operations.join(', ')}].`;
          continue;
        }
      }

      // Passed all scope checks
      matchingGrant = grant;
      break;
    }

    if (!matchingGrant) {
      // TURBO + wrong scope = DENY
      return {
        decision: 'DENY',
        capability,
        reason: `Access denied by scope: ${scopeFailureReason}`,
        requires_approval: false,
        risk: def.risk,
      };
    }

    // 8. Evaluate approval requirements
    if (matchingGrant.approval_mode === 'per_action') {
      return {
        decision: 'REQUIRE_APPROVAL',
        capability,
        reason: `Capability granted with per_action approval mode: explicit human approval is required for this action.`,
        matching_grant_id: matchingGrant.grant_id,
        requires_approval: true,
        risk: def.risk,
      };
    }

    // 9. Confirm enforcement backend support (AUD-01, AUD-14, REQ-01)
    if (request.enforcementBackendAvailable === false) {
      return {
        decision: 'DENY',
        capability,
        reason: `Required enforcement backend (${def.enforcement}) is unavailable on this platform. Failing closed.`,
        requires_approval: false,
        risk: def.risk,
      };
    }

    // 10. Grant is active, scope is valid, and backend is supported: ALLOW
    return {
      decision: 'ALLOW',
      capability,
      reason: `Access authorized by active grant ${matchingGrant.grant_id} (${matchingGrant.approval_mode}).`,
      matching_grant_id: matchingGrant.grant_id,
      requires_approval: false,
      risk: def.risk,
    };
  }
}
