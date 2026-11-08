import { CapabilityRegistry } from './registry.js';
import type { RiskLevel } from './schema.js';

export interface CapabilityApprovalRequest {
  sessionId: string;
  botId?: string;
  botDisplayName?: string;
  capability: string;
  operation?: string;
  targetResource?: string;
  durationMs?: number;
  reason?: string;
}

/**
 * Capability Approval Service (SEC-03, Section 6.5).
 * Formats reviewable capability prompts and validates human authorization.
 * Enforces rule: approving one action NEVER silently creates a persistent grant.
 */
export class CapabilityApprovalService {
  /**
   * Generates a clear, reviewable security approval banner.
   */
  public static formatApprovalPrompt(request: CapabilityApprovalRequest): string {
    const def = CapabilityRegistry.getCapability(request.capability);
    const risk: RiskLevel = def?.risk ?? 'HIGH';
    const botLabel = request.botDisplayName
      ? `"${request.botDisplayName}" [${request.botId ?? 'UNKNOWN'}]`
      : (request.botId ?? 'HUMAN');

    const lines: string[] = [
      `================================================================`,
      ` [CAPABILITY APPROVAL REQUIRED - RISK: ${risk}]`,
      ` Bot:             ${botLabel}`,
      ` Session:         ${request.sessionId}`,
      ` Capability:      ${request.capability}`,
      ` Description:     ${def?.description ?? 'External sensitive capability'}`,
      ` Target Resource: ${request.targetResource ?? '(unspecified)'}`,
      ` Operation:       ${request.operation ?? 'execute'}`,
    ];

    if (request.reason) {
      lines.push(` Reason:          ${request.reason}`);
    }

    lines.push(` Security Impact: Operation touches resources outside sandbox boundaries.`);
    lines.push(`================================================================`);
    lines.push(`Do you approve this action? (y/n): `);

    return lines.join('\n');
  }

  /**
   * Prompts the operator for approval using an injected IO prompt callback or standard stdin.
   */
  public static async promptUser(
    request: CapabilityApprovalRequest,
    promptFn?: (message: string) => Promise<boolean>
  ): Promise<boolean> {
    const promptText = this.formatApprovalPrompt(request);

    if (promptFn) {
      return await promptFn(promptText);
    }

    // Default: fail-closed if no interactive prompt handler is registered
    return false;
  }
}
