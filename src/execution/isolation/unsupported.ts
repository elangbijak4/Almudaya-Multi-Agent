import type { IIsolationBackend, IsolationSpawnOptions, IsolationSpawnResult } from './interface.js';

/**
 * Fallback Isolation Backend for unsupported or unverified platforms (Fail-Closed).
 */
export class UnsupportedIsolationBackend implements IIsolationBackend {
  public readonly platform = 'unsupported';
  public readonly isolationType = 'none';

  public isAvailable(): boolean {
    return false;
  }

  public supportsCapability(_capability: string): boolean {
    return false;
  }

  public async executeCommand(
    _command: string,
    _options: IsolationSpawnOptions
  ): Promise<IsolationSpawnResult> {
    throw new Error('OS execution isolation is not supported on this platform. Execution denied (fail-closed).');
  }
}
