import { Command } from 'commander';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { CapabilityService } from '../../capability/service.js';
import { CapabilityPersistence } from '../../capability/persistence.js';
import { CapabilityRegistry } from '../../capability/registry.js';
import { CapabilityPresets } from '../../capability/presets.js';
import type { ApprovalMode } from '../../capability/schema.js';
import { validateSessionId } from '../../session/schema.js';

export function registerCapabilityCommands(program: Command): void {
  const capability = program
    .command('capability')
    .description('Manage Agent Capability Governance (ACG) grants, policies, and presets');

  // capability list
  capability
    .command('list')
    .description('List registered system capabilities or active grants in a session')
    .option('-s, --session <sessionId>', 'Target session ID to list active grants')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output as JSON')
    .action(async (options: { session?: string; workspace?: string; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const service = new CapabilityService(new CapabilityPersistence({ workspaceRoot }));

        if (options.session) {
          const validatedSession = validateSessionId(options.session);
          const grants = await service.getGrants(validatedSession);
          if (options.json) {
            console.log(JSON.stringify(grants, null, 2));
            return;
          }
          if (grants.length === 0) {
            console.log(`No capability grants found in session [${options.session}]. Defaulting to RESTRICTED.`);
            return;
          }
          console.log(`Capability Grants for Session [${options.session}]:\n`);
          for (const g of grants) {
            console.log(`  [${g.status.toUpperCase()}] ${g.capability} (${g.approval_mode})`);
            console.log(`    Grant ID:   ${g.grant_id}`);
            console.log(`    Granted By: ${g.granted_by} at ${g.granted_at}`);
            console.log(`    Expires:    ${g.expires_at}`);
            if (g.bot_id) console.log(`    Bot Bound:  ${g.bot_id}`);
            if (Object.keys(g.scope).length > 0) {
              console.log(`    Scope:      ${JSON.stringify(g.scope)}`);
            }
          }
        } else {
          const caps = CapabilityRegistry.getAllCapabilities();
          if (options.json) {
            console.log(JSON.stringify(caps, null, 2));
            return;
          }
          console.log(`Registered System Capabilities (ACG):\n`);
          for (const c of caps) {
            console.log(`  * ${c.id} [Risk: ${c.risk}]`);
            console.log(`    ${c.description}`);
            console.log(`    Operations:  ${c.supportedOperations.join(', ')}`);
            console.log(`    Enforcement: ${c.enforcement}`);
          }
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  // capability inspect <id>
  capability
    .command('inspect <id>')
    .description('Inspect details of a registered capability definition or a specific grant ID')
    .option('-s, --session <sessionId>', 'Session ID (required if inspecting a grant ID)')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (id: string, options: { session?: string; workspace?: string }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const service = new CapabilityService(new CapabilityPersistence({ workspaceRoot }));

        const capDef = CapabilityRegistry.getCapability(id);
        if (capDef) {
          console.log(`Capability Definition: ${capDef.id}`);
          console.log(`  Description:     ${capDef.description}`);
          console.log(`  Risk:            ${capDef.risk}`);
          console.log(`  Operations:      ${capDef.supportedOperations.join(', ')}`);
          console.log(`  Scope Required:  ${capDef.scopeRequired}`);
          console.log(`  Enforcement:     ${capDef.enforcement}`);
          console.log(`  Platforms:       ${capDef.platformSupport.join(', ')}`);
          return;
        }

        if (options.session) {
          const validatedSession = validateSessionId(options.session);
          const grant = await service.getGrant(validatedSession, id);
          if (grant) {
            console.log(`Capability Grant: ${grant.grant_id}`);
            console.log(`  Capability:    ${grant.capability}`);
            console.log(`  Status:        ${grant.status}`);
            console.log(`  Session:       ${grant.session_id}`);
            console.log(`  Bot ID:        ${grant.bot_id ?? '(All Bots)'}`);
            console.log(`  Approval Mode: ${grant.approval_mode}`);
            console.log(`  Granted By:    ${grant.granted_by} (${grant.granted_at})`);
            console.log(`  Expires At:    ${grant.expires_at}`);
            console.log(`  Scope:         ${JSON.stringify(grant.scope, null, 2)}`);
            if (grant.reason) console.log(`  Reason:        ${grant.reason}`);
            return;
          }
        }

        console.error(`Error: No capability definition or grant found matching "${id}".`);
        process.exitCode = 1;
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  // capability grant <capability>
  capability
    .command('grant <capability>')
    .description('Grant an external capability to a session or bot')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Bind grant to specific bot ID')
    .option('--paths <paths...>', 'Allowed filesystem path scopes')
    .option('--commands <commands...>', 'Allowed executable command scopes')
    .option('--mode <approvalMode>', 'Approval mode (session, per_action, persistent)', 'session')
    .option('-d, --duration <hours>', 'Grant validity duration in hours', (v) => parseFloat(v), 24)
    .option('--granted-by <grantor>', 'Identity of the grantor', 'HUMAN')
    .option('--reason <reason>', 'Administrative reason for grant')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (capId: string, options: {
      session: string;
      bot?: string;
      paths?: string[];
      commands?: string[];
      mode: string;
      duration: number;
      grantedBy: string;
      reason?: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const service = new CapabilityService(new CapabilityPersistence({ workspaceRoot }));

        const validatedSession = validateSessionId(options.session);
        const grant = await service.grantCapability({
          sessionId: validatedSession,
          capability: capId,
          botId: options.bot,
          scope: {
            paths: options.paths,
            commands: options.commands,
          },
          approvalMode: options.mode as ApprovalMode,
          durationHours: options.duration,
          grantedBy: options.grantedBy,
          reason: options.reason,
        });

        console.log(`Capability granted successfully!`);
        console.log(`  Grant ID:   ${grant.grant_id}`);
        console.log(`  Capability: ${grant.capability}`);
        console.log(`  Session:    ${grant.session_id}`);
        console.log(`  Mode:       ${grant.approval_mode}`);
        console.log(`  Expires:    ${grant.expires_at}`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  // capability revoke <grant-id>
  capability
    .command('revoke <grantId>')
    .description('Revoke an active capability grant')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('--revoked-by <name>', 'Identity of the revoker', 'HUMAN')
    .option('--reason <reason>', 'Reason for revocation')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (grantId: string, options: {
      session: string;
      revokedBy: string;
      reason?: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const service = new CapabilityService(new CapabilityPersistence({ workspaceRoot }));

        const validatedSession = validateSessionId(options.session);
        const revoked = await service.revokeGrant(
          validatedSession,
          grantId,
          options.revokedBy,
          options.reason
        );

        console.log(`Grant ${revoked.grant_id} for "${revoked.capability}" revoked successfully.`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  // capability history
  capability
    .command('history')
    .description('View security and capability audit trail for a session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-l, --limit <n>', 'Limit output events', (v) => parseInt(v, 10), 50)
    .option('-t, --type <type>', 'Filter audit event type')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (options: {
      session: string;
      limit: number;
      type?: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const service = new CapabilityService(new CapabilityPersistence({ workspaceRoot }));

        const validatedSession = validateSessionId(options.session);
        const events = await service.getAuditHistory(validatedSession, {
          limit: options.limit,
          type: options.type,
        });

        if (events.length === 0) {
          console.log(`No security audit events recorded for session [${options.session}].`);
          return;
        }

        console.log(`Security Audit History for Session [${options.session}]:\n`);
        for (const e of events) {
          console.log(`  [${e.timestamp}] [${e.type}] ${e.capability ?? ''}`);
          console.log(`    Event ID: ${e.event_id}`);
          if (e.bot_id) console.log(`    Bot ID:   ${e.bot_id}`);
          if (Object.keys(e.details).length > 0) {
            console.log(`    Details:  ${JSON.stringify(e.details)}`);
          }
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  // capability reset
  capability
    .command('reset')
    .description('Reset all capability grants for a session (fail-closed reset)')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (options: { session: string; workspace?: string }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const service = new CapabilityService(new CapabilityPersistence({ workspaceRoot }));

        const validatedSession = validateSessionId(options.session);
        await service.resetSession(validatedSession);
        console.log(`All capability grants in session [${options.session}] have been revoked.`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  // Preset command subgroup
  const preset = capability.command('preset').description('Manage capability presets');

  preset
    .command('list')
    .description('List available ACG capability presets')
    .action(() => {
      const presets = CapabilityPresets.getAllPresets();
      console.log(`Available Capability Presets:\n`);
      for (const p of presets) {
        console.log(`  * ${p.name.toUpperCase()}`);
        console.log(`    ${p.description}`);
        if (p.warning) console.log(`    WARNING: ${p.warning}`);
      }
    });

  preset
    .command('show <preset>')
    .description('Show templates and permissions defined in a preset')
    .action((presetName: string) => {
      const p = CapabilityPresets.getPreset(presetName);
      if (!p) {
        console.error(`Error: Unknown preset "${presetName}".`);
        process.exitCode = 1;
        return;
      }
      console.log(`Preset Details: ${p.name.toUpperCase()}`);
      console.log(`  Description: ${p.description}`);
      if (p.warning) console.log(`  WARNING:     ${p.warning}`);
      console.log(`  Grants Generated: ${p.templates.length}`);
      for (const t of p.templates) {
        console.log(`    - Capability:    ${t.capability} (${t.approval_mode})`);
        console.log(`      Default Scope: ${JSON.stringify(t.scope)}`);
        console.log(`      Reason:        ${t.reason}`);
      }
    });

  preset
    .command('apply <preset>')
    .description('Apply a capability preset to a session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('--paths <paths...>', 'Custom path scopes to inject into preset templates')
    .option('-d, --duration <hours>', 'Validity duration in hours', (v) => parseFloat(v), 24)
    .option('--granted-by <grantor>', 'Grantor identity', 'HUMAN')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (presetName: string, options: {
      session: string;
      paths?: string[];
      duration: number;
      grantedBy: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const service = new CapabilityService(new CapabilityPersistence({ workspaceRoot }));

        const validatedSession = validateSessionId(options.session);
        const grants = await service.applyPreset(validatedSession, presetName, options.grantedBy, {
          paths: options.paths,
          durationHours: options.duration,
        });

        console.log(`Preset "${presetName}" applied successfully to session [${options.session}].`);
        console.log(`Generated ${grants.length} active capability grants.`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
