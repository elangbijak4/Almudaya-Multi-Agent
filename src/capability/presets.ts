import crypto from 'node:crypto';
import type { CapabilityGrant, CapabilityScope, ApprovalMode } from './schema.js';

export interface PresetGrantTemplate {
  capability: string;
  scope: CapabilityScope;
  approval_mode: ApprovalMode;
  reason: string;
}

export interface CapabilityPresetDefinition {
  name: string;
  description: string;
  templates: PresetGrantTemplate[];
  warning?: string;
}

export const CAPABILITY_PRESETS: Record<string, CapabilityPresetDefinition> = {
  restricted: {
    name: 'restricted',
    description: 'Default fail-closed sandbox. Zero external host capabilities. All operations confined strictly to registered workspace project roots.',
    templates: [],
  },
  controlled: {
    name: 'controlled',
    description: 'Allows reading external documentation and shared reference files. Destructive or mutating operations require per-action human approval.',
    templates: [
      {
        capability: 'filesystem.read_external',
        scope: { operations: ['read', 'list'] },
        approval_mode: 'session',
        reason: 'Preset controlled: read access to shared reference documents',
      },
      {
        capability: 'filesystem.write_external',
        scope: { operations: ['write', 'edit'] },
        approval_mode: 'per_action',
        reason: 'Preset controlled: write requires human confirmation per action',
      },
    ],
  },
  extended: {
    name: 'extended',
    description: 'Extended development preset. Grants scoped external filesystem read/write and execution of project toolchains (git, npm, tsc).',
    templates: [
      {
        capability: 'filesystem.read_external',
        scope: { operations: ['read', 'list', 'stat'] },
        approval_mode: 'session',
        reason: 'Preset extended: external workspace read access',
      },
      {
        capability: 'filesystem.write_external',
        scope: { operations: ['write', 'edit'] },
        approval_mode: 'session',
        reason: 'Preset extended: external workspace write access',
      },
      {
        capability: 'process.execute_external',
        scope: { commands: ['git', 'npm', 'tsc', 'node'] },
        approval_mode: 'session',
        reason: 'Preset extended: standard project toolchain execution',
      },
    ],
  },
  unrestricted: {
    name: 'unrestricted',
    description: 'Broad development authority. Grants arbitrary shell command and external filesystem access. Hard-deny rules still apply.',
    templates: [
      {
        capability: 'filesystem.read_external',
        scope: {},
        approval_mode: 'session',
        reason: 'Preset unrestricted: full read access',
      },
      {
        capability: 'filesystem.write_external',
        scope: {},
        approval_mode: 'session',
        reason: 'Preset unrestricted: full write access',
      },
      {
        capability: 'command.arbitrary',
        scope: {},
        approval_mode: 'session',
        reason: 'Preset unrestricted: arbitrary command execution',
      },
    ],
    warning: 'CAUTION: UNRESTRICTED authority grants broad host system execution. Use only in isolated VM, container, or disposable development machines.',
  },
};

export interface PresetOptions {
  durationHours?: number;
  botId?: string;
  paths?: string[];
}

export class CapabilityPresets {
  public static getPreset(name: string): CapabilityPresetDefinition | undefined {
    return CAPABILITY_PRESETS[name.toLowerCase()];
  }

  public static getAllPresets(): CapabilityPresetDefinition[] {
    return Object.values(CAPABILITY_PRESETS);
  }

  public static generateGrants(
    presetName: string,
    sessionId: string,
    grantedBy: string,
    options: PresetOptions = {}
  ): CapabilityGrant[] {
    const preset = this.getPreset(presetName);
    if (!preset) {
      throw new Error(`Unknown capability preset: "${presetName}". Available: restricted, controlled, extended, unrestricted.`);
    }

    const durationHours = options.durationHours ?? 24;
    const now = Date.now();
    const grantedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + durationHours * 3600 * 1000).toISOString();

    return preset.templates.map((tmpl) => {
      const scope: CapabilityScope = { ...tmpl.scope };
      if (options.paths && options.paths.length > 0) {
        scope.paths = options.paths;
      }

      return {
        grant_id: crypto.randomUUID(),
        capability: tmpl.capability,
        scope,
        granted_by: grantedBy,
        granted_at: grantedAt,
        expires_at: expiresAt,
        session_id: sessionId,
        bot_id: options.botId,
        approval_mode: tmpl.approval_mode,
        status: 'active',
        reason: tmpl.reason,
      };
    });
  }
}
