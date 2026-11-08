export interface IsolationSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface IsolationSpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  isolationType: string;
}

export interface IIsolationBackend {
  readonly platform: string;
  readonly isolationType: string;
  isAvailable(): boolean;
  supportsCapability(capability: string): boolean;
  executeCommand(
    command: string,
    options: IsolationSpawnOptions
  ): Promise<IsolationSpawnResult>;
}
