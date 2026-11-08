import type { CapabilityDefinition, CapabilityId } from './schema.js';

export const CAPABILITY_REGISTRY: Record<CapabilityId, CapabilityDefinition> = {
  'filesystem.read_external': {
    id: 'filesystem.read_external',
    description: 'Read files or directories located outside registered project workspaces',
    risk: 'MEDIUM',
    supportedOperations: ['read', 'list', 'stat'],
    scopeRequired: true,
    enforcement: 'filesystem_sandbox',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
  'filesystem.write_external': {
    id: 'filesystem.write_external',
    description: 'Create or modify files or directories located outside registered project workspaces',
    risk: 'HIGH',
    supportedOperations: ['write', 'edit', 'append'],
    scopeRequired: true,
    enforcement: 'filesystem_sandbox',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
  'filesystem.delete_external': {
    id: 'filesystem.delete_external',
    description: 'Delete files or remove directories located outside registered project workspaces',
    risk: 'CRITICAL',
    supportedOperations: ['delete', 'unlink', 'rmdir'],
    scopeRequired: true,
    enforcement: 'filesystem_sandbox',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
  'system.config_access': {
    id: 'system.config_access',
    description: 'Read or write user configuration files (e.g. .gitconfig, .npmrc, .ssh)',
    risk: 'HIGH',
    supportedOperations: ['read', 'write'],
    scopeRequired: true,
    enforcement: 'path_allowlist',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
  'process.execute_external': {
    id: 'process.execute_external',
    description: 'Spawn and execute specific external binaries located outside project tools',
    risk: 'HIGH',
    supportedOperations: ['spawn', 'exec'],
    scopeRequired: true,
    enforcement: 'process_isolation',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
  'network.outbound': {
    id: 'network.outbound',
    description: 'Initiate outbound socket or HTTP network connections to external hosts',
    risk: 'MEDIUM',
    supportedOperations: ['connect', 'http', 'https'],
    scopeRequired: true,
    enforcement: 'network_namespace',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
  'command.arbitrary': {
    id: 'command.arbitrary',
    description: 'Execute arbitrary shell commands without pre-validated structured arguments',
    risk: 'CRITICAL',
    supportedOperations: ['shell', 'cmd', 'bash', 'powershell'],
    scopeRequired: false,
    enforcement: 'os_isolation_required',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
  'system.environment_access': {
    id: 'system.environment_access',
    description: 'Inspect host environment variables beyond the safe default allowlist',
    risk: 'HIGH',
    supportedOperations: ['env_read', 'env_write'],
    scopeRequired: true,
    enforcement: 'environment_filter',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
  'system.process_control': {
    id: 'system.process_control',
    description: 'Signal, suspend, or terminate host processes by PID',
    risk: 'CRITICAL',
    supportedOperations: ['kill', 'signal'],
    scopeRequired: true,
    enforcement: 'process_job_object',
    platformSupport: ['win32', 'linux', 'darwin'],
  },
};

export class CapabilityRegistry {
  public static getCapability(id: string): CapabilityDefinition | undefined {
    return CAPABILITY_REGISTRY[id as CapabilityId];
  }

  public static isKnownCapability(id: string): boolean {
    return id in CAPABILITY_REGISTRY;
  }

  public static getAllCapabilities(): CapabilityDefinition[] {
    return Object.values(CAPABILITY_REGISTRY);
  }
}
