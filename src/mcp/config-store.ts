import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, ensureDir, pathExists, readJsonValidated } from '../core/fs-utils.js';
import { validateSessionId } from '../session/schema.js';
import { isPathInsideRoot, PathTraversalSecurityError } from '../tools/sandbox.js';
import {
  MCP_REGISTRY_SCHEMA_VERSION,
  McpRegistryFileSchema,
  McpServerConfigSchema,
  type McpRegistryFile,
  type McpServerConfig,
  type McpTransport,
} from './schema.js';

export interface McpConfigStoreOptions {
  workspaceRoot?: string;
}

/**
 * Atomic filesystem store for MCP server configurations at workspace level
 * (`<workspaceRoot>/mcp/servers.json`), session level
 * (`<workspaceRoot>/sessions/<sessionId>/mcp/servers.json`), or external `mcp.json`.
 */
export class McpConfigStore {
  private readonly workspaceRoot: string;

  constructor(options: McpConfigStoreOptions = {}) {
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public getRegistryFilePath(sessionId?: string): string {
    if (sessionId && sessionId.trim().length > 0) {
      const validId = validateSessionId(sessionId);
      const target = path.resolve(this.workspaceRoot, 'sessions', validId, 'mcp', 'servers.json');
      if (!isPathInsideRoot(this.workspaceRoot, target)) {
        throw new PathTraversalSecurityError(
          `Path traversal detected for MCP config path "${target}".`,
          target,
          [this.workspaceRoot]
        );
      }
      return target;
    }
    return path.resolve(this.workspaceRoot, 'mcp', 'servers.json');
  }

  public async loadRegistry(sessionId?: string): Promise<McpRegistryFile> {
    const filePath = this.getRegistryFilePath(sessionId);
    if (!(await pathExists(filePath))) {
      return {
        schema_version: MCP_REGISTRY_SCHEMA_VERSION,
        updated_at: new Date().toISOString(),
        servers: {},
      };
    }
    return await readJsonValidated(filePath, McpRegistryFileSchema);
  }

  private async saveRegistry(registry: McpRegistryFile, sessionId?: string): Promise<void> {
    const filePath = this.getRegistryFilePath(sessionId);
    await ensureDir(path.dirname(filePath));
    const validated = McpRegistryFileSchema.parse({
      ...registry,
      updated_at: new Date().toISOString(),
    });
    await atomicWriteJson(filePath, validated);
  }

  public async upsertServer(config: McpServerConfig, sessionId?: string): Promise<McpServerConfig> {
    const validated = McpServerConfigSchema.parse(config);
    const registry = await this.loadRegistry(sessionId);
    registry.servers[validated.name] = validated;
    await this.saveRegistry(registry, sessionId);
    return validated;
  }

  public async removeServer(name: string, sessionId?: string): Promise<boolean> {
    const registry = await this.loadRegistry(sessionId);
    if (!(name in registry.servers)) {
      return false;
    }
    delete registry.servers[name];
    await this.saveRegistry(registry, sessionId);
    return true;
  }

  public async getServer(name: string, sessionId?: string): Promise<McpServerConfig | undefined> {
    const servers = await this.resolveEffectiveServers({ sessionId, includeDisabled: true });
    return servers.find((s) => s.name === name);
  }

  /**
   * Parses external `mcp.json` files supporting `{ mcpServers: ... }`,
   * `{ servers: ... }`, or direct Almudaya McpRegistryFile format.
   */
  public async loadExternalConfigFile(filePath: string): Promise<McpServerConfig[]> {
    const resolved = path.resolve(filePath);
    const rawText = await fs.readFile(resolved, 'utf-8');
    const parsedJson = JSON.parse(rawText) as Record<string, unknown>;

    let serverMap: Record<string, unknown> | undefined;
    if (
      parsedJson['mcpServers'] &&
      typeof parsedJson['mcpServers'] === 'object' &&
      !Array.isArray(parsedJson['mcpServers'])
    ) {
      serverMap = parsedJson['mcpServers'] as Record<string, unknown>;
    } else if (
      parsedJson['servers'] &&
      typeof parsedJson['servers'] === 'object' &&
      !Array.isArray(parsedJson['servers'])
    ) {
      serverMap = parsedJson['servers'] as Record<string, unknown>;
    } else if (!Array.isArray(parsedJson)) {
      serverMap = parsedJson;
    }

    if (!serverMap) {
      return [];
    }

    const result: McpServerConfig[] = [];
    for (const [name, entry] of Object.entries(serverMap)) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const rawTransport = obj['transport'] ?? obj['type'];
      const inferredTransport: McpTransport =
        rawTransport === 'http' || rawTransport === 'sse' || rawTransport === 'stdio'
          ? rawTransport
          : typeof obj['url'] === 'string' && obj['url'].trim().length > 0
            ? 'http'
            : 'stdio';

      const normalized = McpServerConfigSchema.parse({
        name: typeof obj['name'] === 'string' && obj['name'].trim() ? obj['name'].trim() : name,
        transport: inferredTransport,
        command: typeof obj['command'] === 'string' ? obj['command'] : undefined,
        args: Array.isArray(obj['args']) ? obj['args'].map(String) : [],
        env:
          obj['env'] && typeof obj['env'] === 'object'
            ? (obj['env'] as Record<string, string>)
            : {},
        cwd: typeof obj['cwd'] === 'string' ? obj['cwd'] : undefined,
        url: typeof obj['url'] === 'string' ? obj['url'] : undefined,
        headers:
          obj['headers'] && typeof obj['headers'] === 'object'
            ? (obj['headers'] as Record<string, string>)
            : {},
        enabled: typeof obj['enabled'] === 'boolean' ? obj['enabled'] : true,
        timeoutMs: typeof obj['timeoutMs'] === 'number' ? obj['timeoutMs'] : 30000,
        description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
        allowedTools: Array.isArray(obj['allowedTools'])
          ? obj['allowedTools'].map(String)
          : undefined,
        deniedTools: Array.isArray(obj['deniedTools']) ? obj['deniedTools'].map(String) : undefined,
      });
      result.push(normalized);
    }

    return result;
  }

  /**
   * Resolves effective MCP servers in precedence order:
   * workspace -> session -> externalConfigPath.
   */
  public async resolveEffectiveServers(options?: {
    sessionId?: string;
    externalConfigPath?: string;
    includeDisabled?: boolean;
  }): Promise<McpServerConfig[]> {
    const merged = new Map<string, McpServerConfig>();

    const wsRegistry = await this.loadRegistry(undefined);
    for (const srv of Object.values(wsRegistry.servers)) {
      merged.set(srv.name, srv);
    }

    if (options?.sessionId) {
      const sessRegistry = await this.loadRegistry(options.sessionId);
      for (const srv of Object.values(sessRegistry.servers)) {
        merged.set(srv.name, srv);
      }
    }

    if (options?.externalConfigPath) {
      const extServers = await this.loadExternalConfigFile(options.externalConfigPath);
      for (const srv of extServers) {
        merged.set(srv.name, srv);
      }
    }

    const all = Array.from(merged.values());
    return options?.includeDisabled ? all : all.filter((s) => s.enabled !== false);
  }
}
