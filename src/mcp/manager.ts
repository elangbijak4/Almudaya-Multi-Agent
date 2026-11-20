import crypto from 'node:crypto';
import type { ToolDefinition } from '../ai/provider.js';
import type { ExecutionContext } from '../execution/types.js';
import { ExecutionController } from '../execution/controller.js';
import { redactRecursively } from '../execution/environment.js';
import { convertMcpToolToToolDefinition, type IMcpClient } from './client-interface.js';
import { HttpMcpClient } from './http-client.js';
import type { McpServerConfig, McpToolInfo } from './schema.js';
import { StdioMcpClient } from './stdio-client.js';

export interface McpServerStatus {
  name: string;
  transport: McpServerConfig['transport'];
  connected: boolean;
  serverInfo?: { name: string; version?: string };
  toolCount: number;
  tools: string[];
  error?: string;
}

export interface RegisteredMcpToolEntry {
  namespacedName: string;
  serverName: string;
  toolName: string;
  definition: ToolDefinition;
  rawTool: McpToolInfo;
}

export interface McpClientManagerOptions {
  enforceAcg?: boolean;
  workspaceRoot?: string;
  clientFactory?: (config: McpServerConfig) => IMcpClient;
}

function sanitizeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
}

export function buildNamespacedMcpToolName(
  serverName: string,
  toolName: string,
  existingNames?: Set<string>
): string {
  const s = sanitizeSegment(serverName);
  const t = sanitizeSegment(toolName);
  let candidate = `mcp__${s}__${t}`;
  if (candidate.length > 64) {
    const hash = crypto.createHash('sha1').update(`${serverName}:${toolName}`).digest('hex').slice(0, 6);
    const budget = Math.max(8, 64 - `mcp__${s}__`.length - 7);
    candidate = `mcp__${s}__${t.slice(0, budget)}_${hash}`;
    if (candidate.length > 64) {
      candidate = `mcp__${hash}_${t.slice(0, Math.max(8, 52 - hash.length))}`;
    }
  }
  if (existingNames && existingNames.has(candidate)) {
    const suffix = crypto
      .createHash('sha1')
      .update(`${serverName}:${toolName}:${existingNames.size}`)
      .digest('hex')
      .slice(0, 5);
    candidate = `${candidate.slice(0, 58)}_${suffix}`;
  }
  return candidate;
}

function isToolPermittedByConfig(toolName: string, config: McpServerConfig): boolean {
  if (config.deniedTools && config.deniedTools.includes(toolName)) {
    return false;
  }
  if (config.allowedTools && config.allowedTools.length > 0) {
    return config.allowedTools.includes(toolName) || config.allowedTools.includes('*');
  }
  return true;
}

/**
 * Coordinates lifecycle, tool discovery, ACG governance, secret redaction,
 * and invocation across multiple configured MCP servers for a bot or CLI session.
 */
export class McpClientManager {
  private readonly enforceAcg: boolean;
  private readonly workspaceRoot?: string;
  private readonly clientFactory: (config: McpServerConfig) => IMcpClient;

  private readonly clients = new Map<string, IMcpClient>();
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly statuses = new Map<string, McpServerStatus>();
  private readonly toolRegistry = new Map<string, RegisteredMcpToolEntry>();

  constructor(options: McpClientManagerOptions = {}) {
    this.enforceAcg = options.enforceAcg !== false;
    this.workspaceRoot = options.workspaceRoot;
    this.clientFactory =
      options.clientFactory ??
      ((config) =>
        config.transport === 'stdio' ? new StdioMcpClient(config) : new HttpMcpClient(config));
  }

  public isMcpToolName(toolName: string): boolean {
    return this.toolRegistry.has(toolName);
  }

  public getStatuses(): McpServerStatus[] {
    return Array.from(this.statuses.values());
  }

  public getRegisteredTools(): RegisteredMcpToolEntry[] {
    return Array.from(this.toolRegistry.values());
  }

  public getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.toolRegistry.values()).map((entry) => entry.definition);
  }

  public async connectServer(config: McpServerConfig): Promise<McpServerStatus> {
    if (this.clients.has(config.name)) {
      await this.disconnectServer(config.name);
    }

    this.configs.set(config.name, config);
    const client = this.clientFactory(config);

    try {
      const initRes = await client.connect();
      const rawTools = await client.listTools();
      const filteredTools = rawTools.filter((t) => isToolPermittedByConfig(t.name, config));

      this.clients.set(config.name, client);
      const existingNames = new Set(this.toolRegistry.keys());
      const registeredNames: string[] = [];

      for (const tool of filteredTools) {
        const namespacedName = buildNamespacedMcpToolName(config.name, tool.name, existingNames);
        existingNames.add(namespacedName);
        const definition = convertMcpToolToToolDefinition(namespacedName, config.name, tool);
        this.toolRegistry.set(namespacedName, {
          namespacedName,
          serverName: config.name,
          toolName: tool.name,
          definition,
          rawTool: tool,
        });
        registeredNames.push(namespacedName);
      }

      const status: McpServerStatus = {
        name: config.name,
        transport: config.transport,
        connected: true,
        serverInfo: initRes.serverInfo,
        toolCount: registeredNames.length,
        tools: registeredNames,
      };
      this.statuses.set(config.name, status);
      return status;
    } catch (err: unknown) {
      await client.close().catch(() => undefined);
      const status: McpServerStatus = {
        name: config.name,
        transport: config.transport,
        connected: false,
        toolCount: 0,
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      };
      this.statuses.set(config.name, status);
      return status;
    }
  }

  public async connectAll(configs: McpServerConfig[]): Promise<McpServerStatus[]> {
    const results: McpServerStatus[] = [];
    for (const cfg of configs) {
      if (cfg.enabled === false) continue;
      results.push(await this.connectServer(cfg));
    }
    return results;
  }

  public async disconnectServer(serverName: string): Promise<boolean> {
    for (const [k, entry] of this.toolRegistry.entries()) {
      if (entry.serverName === serverName) {
        this.toolRegistry.delete(k);
      }
    }

    const client = this.clients.get(serverName);
    this.clients.delete(serverName);
    if (!client) {
      const existing = this.statuses.get(serverName);
      if (existing) {
        this.statuses.set(serverName, { ...existing, connected: false, toolCount: 0, tools: [] });
      }
      return false;
    }

    await client.close().catch(() => undefined);
    const existing = this.statuses.get(serverName);
    if (existing) {
      this.statuses.set(serverName, { ...existing, connected: false, toolCount: 0, tools: [] });
    }
    return true;
  }

  public async disposeAll(): Promise<void> {
    const names = Array.from(this.clients.keys());
    for (const name of names) {
      await this.disconnectServer(name);
    }
  }

  public async invokeTool(
    namespacedName: string,
    args: Record<string, unknown> = {},
    context?: Partial<ExecutionContext>
  ): Promise<Record<string, unknown>> {
    const entry = this.toolRegistry.get(namespacedName);
    if (!entry) {
      throw new Error(`Unknown MCP tool "${namespacedName}".`);
    }

    const client = this.clients.get(entry.serverName);
    if (!client || !client.isConnected) {
      throw new Error(`MCP server "${entry.serverName}" is not connected.`);
    }

    if (this.enforceAcg) {
      const controller = ExecutionController.getInstance();
      await controller.authorizeMcpInvocation(
        {
          sessionId: context?.sessionId,
          botId: context?.botId,
          botDisplayName: context?.botDisplayName,
          isTurbo: context?.isTurbo,
          projectRoots: context?.projectRoots ?? [],
          workspaceRoot: context?.workspaceRoot ?? this.workspaceRoot,
        },
        {
          serverName: entry.serverName,
          toolName: entry.toolName,
          operation: 'call_tool',
        }
      );
    }

    const rawResult = await client.callTool(entry.toolName, args);
    const redactedContent = redactRecursively(rawResult.content ?? []);
    const redactedStructured = rawResult.structuredContent
      ? redactRecursively(rawResult.structuredContent)
      : undefined;

    if (rawResult.isError) {
      const textMsg = redactedContent
        .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
        .join('\n');
      throw new Error(
        `MCP tool "${entry.serverName}:${entry.toolName}" returned error: ${textMsg || 'Unknown MCP error'}`
      );
    }

    return {
      server: entry.serverName,
      tool: entry.toolName,
      isError: false,
      content: redactedContent,
      ...(redactedStructured ? { structuredContent: redactedStructured } : {}),
    };
  }

  public getPromptSummaryMarkdown(): string {
    const connectedStatuses = Array.from(this.statuses.values()).filter((s) => s.connected);
    if (connectedStatuses.length === 0) {
      return '';
    }

    const lines: string[] = [];
    for (const srv of connectedStatuses) {
      const info = srv.serverInfo?.name ? ` (${srv.serverInfo.name})` : '';
      const toolList =
        srv.tools.length > 0 ? srv.tools.join(', ') : '(belum ada tool ditemukan)';
      lines.push(`- **${srv.name}** [${srv.transport}${info}]: ${toolList}`);
    }
    return lines.join('\n');
  }
}
