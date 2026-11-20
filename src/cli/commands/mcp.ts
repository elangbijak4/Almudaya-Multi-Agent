import { Command } from 'commander';
import path from 'node:path';
import process from 'node:process';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { resolveWorkspaceRoot } from '../../core/config.js';
import {
  AlmudayaMcpServer,
  MCP_SERVER_PRESETS,
  McpClientManager,
  McpConfigStore,
  McpServerConfigSchema,
  createPresetServerConfig,
} from '../../mcp/index.js';

function parseKeyValuePairs(entries: string[] | undefined, separator: '=' | ':'): Record<string, string> {
  const result: Record<string, string> = {};
  if (!entries) return result;
  for (const raw of entries) {
    const idx =
      separator === ':'
        ? raw.includes(':')
          ? raw.indexOf(':')
          : raw.indexOf('=')
        : raw.indexOf('=');
    if (idx <= 0) {
      throw new Error(`Invalid key-value entry "${raw}". Expected KEY${separator}VALUE.`);
    }
    const key = raw.slice(0, idx).trim();
    const val = raw.slice(idx + 1).trim();
    if (!key) {
      throw new Error(`Empty key in entry "${raw}".`);
    }
    result[key] = val;
  }
  return result;
}

export function registerMcpCommands(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Manage external Model Context Protocol (MCP) servers and expose Almudaya over MCP');

  mcp
    .command('list')
    .description('List configured MCP servers for workspace and optional session')
    .option('-s, --session <sessionId>', 'Optional session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--all', 'Include disabled servers')
    .option('--json', 'Output as JSON')
    .action(async (options: { session?: string; workspace?: string; all?: boolean; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const store = new McpConfigStore({ workspaceRoot });
        const servers = await store.resolveEffectiveServers({
          sessionId: options.session,
          includeDisabled: Boolean(options.all),
        });

        if (options.json) {
          console.log(JSON.stringify(servers, null, 2));
          return;
        }

        if (servers.length === 0) {
          console.log('No MCP servers configured. Add one with `almudaya mcp preset playwright` or `almudaya mcp add <name> ...`.');
          return;
        }

        console.log(`Configured MCP Servers (${servers.length}):\n`);
        for (const srv of servers) {
          const endpoint =
            srv.transport === 'stdio'
              ? `${srv.command} ${(srv.args ?? []).join(' ')}`.trim()
              : srv.url ?? '';
          const state = srv.enabled === false ? 'DISABLED' : 'ENABLED';
          console.log(`  - [${srv.name}] (${srv.transport}, ${state}) -> ${endpoint}`);
          if (srv.description) {
            console.log(`      ${srv.description}`);
          }
        }
      } catch (err: unknown) {
        console.error(`Error listing MCP servers: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  mcp
    .command('add <name>')
    .description('Register or update an external MCP server (stdio or HTTP/SSE)')
    .option('-t, --transport <type>', 'Transport type ("stdio" | "http" | "sse")')
    .option('-c, --command <cmd>', 'Executable command for stdio transport')
    .option('--args <items...>', 'Arguments for stdio command')
    .option('--env <pairs...>', 'Environment variables (KEY=VALUE) for stdio transport')
    .option('--cwd <dir>', 'Working directory for stdio server')
    .option('-u, --url <url>', 'Endpoint URL for http/sse transport')
    .option('--header <pairs...>', 'HTTP headers ("Key: Value" or "Key=Value")')
    .option('--timeout <ms>', 'Request timeout in milliseconds (default: 30000)')
    .option('-d, --description <text>', 'Server description')
    .option('--allowed-tools <tools...>', 'Optional allowlist of tool names')
    .option('--denied-tools <tools...>', 'Optional denylist of tool names')
    .option('-s, --session <sessionId>', 'Optional session scope (defaults to workspace-wide)')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(
      async (
        name: string,
        options: {
          transport?: string;
          command?: string;
          args?: string[];
          env?: string[];
          cwd?: string;
          url?: string;
          header?: string[];
          timeout?: string;
          description?: string;
          allowedTools?: string[];
          deniedTools?: string[];
          session?: string;
          workspace?: string;
        }
      ) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const store = new McpConfigStore({ workspaceRoot });
          const inferredTransport =
            options.transport ?? (options.url && !options.command ? 'http' : 'stdio');
          const timeoutMs = options.timeout ? Number.parseInt(options.timeout, 10) : 30000;

          const config = McpServerConfigSchema.parse({
            name,
            transport: inferredTransport,
            command: options.command,
            args: options.args ?? [],
            env: parseKeyValuePairs(options.env, '='),
            cwd: options.cwd ? path.resolve(options.cwd) : undefined,
            url: options.url,
            headers: parseKeyValuePairs(options.header, ':'),
            timeoutMs,
            description: options.description,
            allowedTools: options.allowedTools,
            deniedTools: options.deniedTools,
            enabled: true,
          });

          const saved = await store.upsertServer(config, options.session);
          console.log(
            `MCP server "${saved.name}" (${saved.transport}) saved to ${store.getRegistryFilePath(options.session)}.`
          );
        } catch (err: unknown) {
          console.error(`Error adding MCP server: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  mcp
    .command('preset <presetId>')
    .description(
      `Register a curated MCP server preset (${Object.keys(MCP_SERVER_PRESETS).join(', ')})`
    )
    .option('-n, --name <name>', 'Override server name')
    .option('--root <dir>', 'Root directory for "filesystem" preset')
    .option('-s, --session <sessionId>', 'Optional session scope')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(
      async (
        presetId: string,
        options: { name?: string; root?: string; session?: string; workspace?: string }
      ) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const store = new McpConfigStore({ workspaceRoot });
          const config = createPresetServerConfig(presetId, {
            name: options.name,
            rootDir: options.root,
          });
          const saved = await store.upsertServer(config, options.session);
          console.log(
            `MCP preset "${presetId}" registered as "${saved.name}" -> ${saved.command} ${saved.args.join(' ')}`
          );
        } catch (err: unknown) {
          console.error(`Error applying MCP preset: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  mcp
    .command('remove <name>')
    .description('Remove a configured MCP server')
    .option('-s, --session <sessionId>', 'Optional session scope')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (name: string, options: { session?: string; workspace?: string }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const store = new McpConfigStore({ workspaceRoot });
        const removed = await store.removeServer(name, options.session);
        if (!removed) {
          console.error(`MCP server "${name}" not found.`);
          process.exitCode = 1;
          return;
        }
        console.log(`Removed MCP server "${name}".`);
      } catch (err: unknown) {
        console.error(`Error removing MCP server: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  mcp
    .command('test <name>')
    .description('Connect to a configured MCP server and list its advertised tools')
    .option('-s, --session <sessionId>', 'Optional session scope')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output result as JSON')
    .action(async (name: string, options: { session?: string; workspace?: string; json?: boolean }) => {
      const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
      const store = new McpConfigStore({ workspaceRoot });
      const manager = new McpClientManager({ enforceAcg: false, workspaceRoot });

      try {
        const config = await store.getServer(name, options.session);
        if (!config) {
          throw new Error(`MCP server "${name}" is not registered.`);
        }
        const status = await manager.connectServer(config);
        const tools = manager.getRegisteredTools();

        if (options.json) {
          console.log(JSON.stringify({ status, tools }, null, 2));
        } else if (!status.connected) {
          console.error(`Failed to connect to MCP server "${name}": ${status.error ?? 'Unknown error'}`);
          process.exitCode = 1;
        } else {
          console.log(
            `Connected to MCP server "${name}" (${status.transport}) — ${status.toolCount} tool(s):`
          );
          for (const t of tools) {
            console.log(`  - ${t.namespacedName} (raw: ${t.toolName})`);
          }
        }
        if (!status.connected) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        console.error(`Error testing MCP server "${name}": ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await manager.disposeAll();
      }
    });

  mcp
    .command('serve')
    .description('Expose Almudaya Multi-Agent Blackboard tools over stdio JSON-RPC 2.0 MCP Server')
    .option('-s, --session <sessionId>', 'Default Almudaya session ID')
    .option('-w, --workspace <path>', 'Blackboard workspace directory path')
    .action((options: { session?: string; workspace?: string }) => {
      const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
      const storage = new FilesystemSessionStorage(workspaceRoot);
      const server = new AlmudayaMcpServer({
        storage,
        defaultSessionId: options.session,
      });
      server.start();
    });
}
