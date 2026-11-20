import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import { VERSION } from '../core/version.js';
import {
  ExecutionEnvironmentBuilder,
  SENSITIVE_KEY_PATTERNS,
  registerSecret,
} from '../execution/environment.js';
import type { IMcpClient } from './client-interface.js';
import {
  MCP_PROTOCOL_VERSION,
  type McpCallToolResult,
  type McpInitializeResult,
  type McpResourceInfo,
  type McpServerConfig,
  type McpToolInfo,
} from './schema.js';

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRpc {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

const WIN32_CMD_SHIMS = new Set(['npx', 'npm']);

/**
 * Pure JSON-RPC 2.0 MCP client over child-process stdin/stdout (newline-delimited & Content-Length framing).
 */
export class StdioMcpClient implements IMcpClient {
  public readonly serverName: string;
  public readonly transport = 'stdio' as const;
  public serverInfo?: { name: string; version?: string };

  private readonly config: McpServerConfig;
  private child?: ChildProcessWithoutNullStreams;
  private connected = false;
  private nextRequestId = 1;
  private buffer = Buffer.alloc(0);
  private stderrTail = '';
  private readonly pending = new Map<number, PendingRpc>();

  constructor(config: McpServerConfig) {
    if (config.transport !== 'stdio' || !config.command) {
      throw new Error(`StdioMcpClient requires transport="stdio" and command for "${config.name}".`);
    }
    this.config = config;
    this.serverName = config.name;
  }

  public get isConnected(): boolean {
    return this.connected && Boolean(this.child && this.child.exitCode === null);
  }

  private buildSafeEnv(): NodeJS.ProcessEnv {
    const env = new ExecutionEnvironmentBuilder({
      approvedVars: this.config.env,
    }).build();

    for (const [k, v] of Object.entries(this.config.env ?? {})) {
      if (v && SENSITIVE_KEY_PATTERNS.some((p) => p.test(k))) {
        registerSecret(v);
      }
    }
    return env;
  }

  public async connect(): Promise<McpInitializeResult> {
    if (this.isConnected) {
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        serverInfo: this.serverInfo,
      };
    }

    const rawCmd = this.config.command!.trim();
    const useWinCmd =
      process.platform === 'win32' && WIN32_CMD_SHIMS.has(rawCmd.toLowerCase());
    const spawnCmd = useWinCmd ? `${rawCmd}.cmd` : rawCmd;

    const child = spawn(spawnCmd, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: this.buildSafeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: useWinCmd,
    });
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.stderrTail = '';

    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainStdoutBuffer();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.stderrTail = (this.stderrTail + text).slice(-4096);
    });

    child.on('error', (err) => {
      this.connected = false;
      this.rejectAllPending(
        new Error(`MCP stdio server "${this.serverName}" process error: ${err.message}`)
      );
    });

    child.on('exit', (code, signal) => {
      this.connected = false;
      const tail = this.stderrTail.trim() ? ` | stderr: ${this.stderrTail.trim().slice(-300)}` : '';
      this.rejectAllPending(
        new Error(
          `MCP stdio server "${this.serverName}" exited (code=${code}, signal=${signal})${tail}`
        )
      );
    });

    const initResult = (await this.sendRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'almudaya-multiagent',
        version: VERSION,
      },
    })) as McpInitializeResult;

    this.serverInfo = initResult?.serverInfo;
    this.connected = true;

    this.sendNotification('notifications/initialized', {});
    return initResult;
  }

  public async listTools(): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;

    do {
      const res = (await this.sendRequest(
        'tools/list',
        cursor ? { cursor } : {}
      )) as { tools?: McpToolInfo[]; nextCursor?: string };
      if (Array.isArray(res?.tools)) {
        tools.push(...res.tools);
      }
      cursor = res?.nextCursor;
    } while (cursor);

    return tools;
  }

  public async callTool(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs?: number
  ): Promise<McpCallToolResult> {
    const res = (await this.sendRequest(
      'tools/call',
      { name, arguments: args },
      timeoutMs
    )) as Partial<McpCallToolResult> | undefined;

    return {
      content: Array.isArray(res?.content) ? res.content : [],
      isError: res?.isError,
      structuredContent: res?.structuredContent,
    };
  }

  public async listResources(): Promise<McpResourceInfo[]> {
    const res = (await this.sendRequest('resources/list', {})) as {
      resources?: McpResourceInfo[];
    };
    return Array.isArray(res?.resources) ? res.resources : [];
  }

  public async readResource(uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }> {
    const res = (await this.sendRequest('resources/read', { uri })) as {
      contents?: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
    };
    return {
      contents: Array.isArray(res?.contents) ? res.contents : [],
    };
  }

  public async ping(): Promise<boolean> {
    try {
      await this.sendRequest('ping', {}, 5000);
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    this.connected = false;
    this.rejectAllPending(new Error(`MCP client "${this.serverName}" closed.`));

    const child = this.child;
    this.child = undefined;
    if (!child) return;

    try {
      child.stdin.end();
    } catch {
      // ignore
    }

    if (child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const forceTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 600);
      forceTimer.unref?.();

      child.once('exit', () => {
        clearTimeout(forceTimer);
        resolve();
      });

      try {
        child.kill();
      } catch {
        clearTimeout(forceTimer);
        resolve();
      }
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.child || this.child.stdin.destroyed) return;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    });
    this.child.stdin.write(`${payload}\n`, 'utf8');
  }

  private sendRequest(
    method: string,
    params?: Record<string, unknown>,
    overrideTimeoutMs?: number
  ): Promise<unknown> {
    if (!this.child || this.child.exitCode !== null || this.child.stdin.destroyed) {
      return Promise.reject(
        new Error(`MCP stdio server "${this.serverName}" is not running.`)
      );
    }

    const id = this.nextRequestId++;
    const timeoutMs = overrideTimeoutMs ?? this.config.timeoutMs ?? 30000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP stdio request "${method}" on server "${this.serverName}" timed out after ${timeoutMs}ms.`
          )
        );
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, { resolve, reject, timer, method });

      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      });
      this.child!.stdin.write(`${payload}\n`, 'utf8');
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }

  private drainStdoutBuffer(): void {
    while (this.buffer.length > 0) {
      const asText = this.buffer.toString('utf8');
      if (asText.startsWith('Content-Length:')) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const headerText = this.buffer.slice(0, headerEnd).toString('utf8');
        const match = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        const length = Number.parseInt(match[1]!, 10);
        const bodyStart = headerEnd + 4;
        if (this.buffer.length < bodyStart + length) return;
        const jsonBody = this.buffer.slice(bodyStart, bodyStart + length).toString('utf8');
        this.buffer = this.buffer.slice(bodyStart + length);
        this.handleJsonRpcMessage(jsonBody);
        continue;
      }

      const newlineIdx = this.buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      const line = this.buffer.slice(0, newlineIdx).toString('utf8').trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line) {
        this.handleJsonRpcMessage(line);
      }
    }
  }

  private handleJsonRpcMessage(rawJson: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(rawJson) as JsonRpcResponse;
    } catch {
      return;
    }

    if (msg.id === undefined || msg.id === null) {
      return;
    }

    const numericId = typeof msg.id === 'number' ? msg.id : Number(msg.id);
    const pendingEntry = this.pending.get(numericId);
    if (!pendingEntry) return;

    clearTimeout(pendingEntry.timer);
    this.pending.delete(numericId);

    if (msg.error) {
      pendingEntry.reject(
        new Error(
          `MCP error (${pendingEntry.method} on ${this.serverName}, code=${msg.error.code ?? -32000}): ${msg.error.message ?? 'Unknown error'}`
        )
      );
      return;
    }

    pendingEntry.resolve(msg.result);
  }
}
