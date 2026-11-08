export interface ExecutionContext {
  sessionId?: string;
  botId?: string;
  botDisplayName?: string;
  isTurbo?: boolean;
  projectRoots: string[];
}

export interface CommandExecutionRequest {
  command: string;
  workingDir?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface CommandExecutionResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  isolationType?: string;
  deniedByPolicy?: boolean;
}

export interface FilesystemExecutionRequest {
  operation: 'read' | 'write' | 'delete' | 'list' | 'stat';
  targetPath: string;
  content?: string;
}
