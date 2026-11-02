import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

export interface WorkspaceConfig {
  workspaceRoot: string;
}

export interface WorkspaceOptions {
  workspace?: string;
}

/**
 * Determines the default platform-specific application data directory for Almudaya.
 */
export function getDefaultWorkspaceRoot(): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData && localAppData.trim().length > 0) {
      return path.join(localAppData, 'almudaya');
    }
    return path.join(home, '.almudaya');
  }

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'almudaya');
  }

  // Linux and other POSIX platforms
  const xdgDataHome = process.env['XDG_DATA_HOME'];
  if (xdgDataHome && xdgDataHome.trim().length > 0) {
    return path.join(xdgDataHome, 'almudaya');
  }
  return path.join(home, '.local', 'share', 'almudaya');
}

/**
 * Resolves the workspace root path following ADR-001 precedence:
 * 1. Explicit options argument (`--workspace`)
 * 2. `ALMUDAYA_WORKSPACE` environment variable
 * 3. Platform-specific default directory
 */
export function resolveWorkspaceRoot(options?: WorkspaceOptions): string {
  if (options?.workspace && options.workspace.trim().length > 0) {
    return path.resolve(options.workspace.trim());
  }

  const envWorkspace = process.env['ALMUDAYA_WORKSPACE'] ?? process.env['ALMUDAYA_WORKSPACE_ROOT'];
  if (envWorkspace && envWorkspace.trim().length > 0) {
    return path.resolve(envWorkspace.trim());
  }

  return getDefaultWorkspaceRoot();
}

/**
 * Returns the directory path for a specific session inside the workspace.
 */
export function getSessionDir(workspaceRoot: string, sessionId: string): string {
  return path.join(workspaceRoot, 'sessions', sessionId);
}

/**
 * Returns the sessions parent directory inside the workspace.
 */
export function getSessionsBaseDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'sessions');
}
