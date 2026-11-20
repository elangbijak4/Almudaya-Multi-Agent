import { VERSION } from '../core/version.js';
import { SENSITIVE_KEY_PATTERNS, registerSecret } from '../execution/environment.js';
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

/**
 * Pure JSON-RPC 2.0 MCP client over Streamable HTTP / SSE.
 */
export class HttpMcpClient implements IMcpClient {
  public readonly serverName: string;
  public readonly transport: 'http' | 'sse';
  public serverInfo?: { name: string; version?: string };

  private readonly config: McpServerConfig;
  private readonly url: string;
  private connected = false;
  private mcpSessionId?: string;
  private nextRequestId = 1;

  constructor(config: McpServerConfig) {
    if ((config.transport !== 'http' && config.transport !== 'sse') || !config.url) {
      throw new Error(
        `HttpMcpClient requires transport="http"|"sse" and non-empty url for "${config.name}".`
      );
    }
    this.config = config;
    this.serverName = config.name;
    this.transport = config.transport;
    this.url = config.url.trim();

    for (const [k, v] of Object.entries(config.headers ?? {})) {
      if (v && (SENSITIVE_KEY_PATTERNS.some((p) => p.test(k)) || /Bearer\s+/i.test(v))) {
        registerSecret(v);
      }
    }
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public getSessionHeaderId(): string | undefined {
    return this.mcpSessionId;
  }

  public async connect(): Promise<McpInitializeResult> {
    const result = (await this.sendRpc('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'almudaya-multiagent',
        version: VERSION,
      },
    })) as McpInitializeResult;

    this.serverInfo = result?.serverInfo;
    this.connected = true;

    await this.sendNotification('notifications/initialized', {}).catch(() => {
      // Optional for stateless HTTP servers
    });

    return result;
  }

  public async listTools(): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;

    do {
      const res = (await this.sendRpc(
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
    const res = (await this.sendRpc(
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
    const res = (await this.sendRpc('resources/list', {})) as {
      resources?: McpResourceInfo[];
    };
    return Array.isArray(res?.resources) ? res.resources : [];
  }

  public async readResource(uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }> {
    const res = (await this.sendRpc('resources/read', { uri })) as {
      contents?: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
    };
    return {
      contents: Array.isArray(res?.contents) ? res.contents : [],
    };
  }

  public async ping(): Promise<boolean> {
    try {
      await this.sendRpc('ping', {}, 5000);
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    const sid = this.mcpSessionId;
    this.connected = false;
    this.mcpSessionId = undefined;
    if (sid) {
      await fetch(this.url, {
        method: 'DELETE',
        headers: {
          ...this.config.headers,
          'Mcp-Session-Id': sid,
        },
      }).catch(() => undefined);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.config.headers,
    };
    if (this.mcpSessionId) {
      headers['Mcp-Session-Id'] = this.mcpSessionId;
    }
    return headers;
  }

  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    timer.unref?.();
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          ...(params !== undefined ? { params } : {}),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendRpc(
    method: string,
    params?: Record<string, unknown>,
    overrideTimeoutMs?: number
  ): Promise<unknown> {
    const id = this.nextRequestId++;
    const timeoutMs = overrideTimeoutMs ?? this.config.timeoutMs ?? 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          ...(params !== undefined ? { params } : {}),
        }),
        signal: controller.signal,
      });

      const returnedSessionId = response.headers.get('mcp-session-id');
      if (returnedSessionId && returnedSessionId.trim()) {
        this.mcpSessionId = returnedSessionId.trim();
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(
          `MCP HTTP request "${method}" on "${this.serverName}" failed (${response.status}): ${errText.slice(0, 300)}`
        );
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      const rawText = await response.text();
      const rpc = parseHttpOrSseResponse(rawText, contentType, id);

      if (rpc.error) {
        throw new Error(
          `MCP error (${method} on ${this.serverName}, code=${rpc.error.code ?? -32000}): ${rpc.error.message ?? 'Unknown error'}`
        );
      }

      return rpc.result;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseHttpOrSseResponse(
  rawText: string,
  contentType: string,
  expectedId: number
): JsonRpcResponse {
  const trimmed = rawText.trim();
  if (!trimmed) return {};

  if (!contentType.includes('text/event-stream') && !trimmed.startsWith('event:') && !trimmed.startsWith('data:')) {
    return JSON.parse(trimmed) as JsonRpcResponse;
  }

  let lastMatching: JsonRpcResponse | undefined;
  let fallbackParsed: JsonRpcResponse | undefined;

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      fallbackParsed = parsed;
      if (parsed.id !== undefined && Number(parsed.id) === expectedId) {
        lastMatching = parsed;
      }
    } catch {
      // Skip non-JSON SSE event
    }
  }

  if (lastMatching) return lastMatching;
  if (fallbackParsed) return fallbackParsed;
  throw new SyntaxError(`Unable to parse MCP SSE/HTTP response payload: ${trimmed.slice(0, 160)}`);
}
