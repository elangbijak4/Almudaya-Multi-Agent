import { z } from 'zod';
import path from 'node:path';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const;
export const MCP_REGISTRY_SCHEMA_VERSION = '1.0.0';

export const McpTransportSchema = z.enum(['stdio', 'http', 'sse']);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpServerConfigSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-zA-Z0-9._-]{1,64}$/, 'MCP server name must match /^[a-zA-Z0-9._-]{1,64}$/'),
    transport: McpTransportSchema.default('stdio'),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    cwd: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).default({}),
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().min(100).max(300000).default(30000),
    description: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
    deniedTools: z.array(z.string()).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.transport === 'stdio') {
      if (!val.command || !val.command.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['command'],
          message: `MCP server "${val.name}" uses transport "stdio" and requires a non-empty "command".`,
        });
      }
    } else if (!val.url || !val.url.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: `MCP server "${val.name}" uses transport "${val.transport}" and requires a non-empty "url".`,
      });
    }
  });
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpRegistryFileSchema = z.object({
  schema_version: z.string().default(MCP_REGISTRY_SCHEMA_VERSION),
  updated_at: z.string().datetime(),
  servers: z.record(z.string(), McpServerConfigSchema).default({}),
});
export type McpRegistryFile = z.infer<typeof McpRegistryFileSchema>;

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo?: {
    name: string;
    version?: string;
  };
  instructions?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResourceInfo {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  [key: string]: unknown;
}

export interface McpCallToolResult {
  content: McpContentBlock[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export type McpPresetId = 'playwright' | 'chrome-devtools' | 'filesystem' | 'fetch' | 'memory';

export interface McpPresetDefinition {
  id: McpPresetId;
  defaultName: string;
  description: string;
  buildConfig: (options?: { name?: string; rootDir?: string }) => McpServerConfig;
}

export const MCP_SERVER_PRESETS: Record<McpPresetId, McpPresetDefinition> = {
  playwright: {
    id: 'playwright',
    defaultName: 'playwright',
    description:
      'Playwright MCP server for live browser navigation, DOM/CSS inspection, click/drag interaction tests, and screenshots.',
    buildConfig: (options) =>
      McpServerConfigSchema.parse({
        name: options?.name ?? 'playwright',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest', '--headless'],
        timeoutMs: 60000,
        description: 'Playwright headless browser automation & visual inspection MCP server',
      }),
  },
  'chrome-devtools': {
    id: 'chrome-devtools',
    defaultName: 'chrome-devtools',
    description:
      'Chrome DevTools MCP server for live DOM/CSS style inspection, console errors, network tracing, and performance audits.',
    buildConfig: (options) =>
      McpServerConfigSchema.parse({
        name: options?.name ?? 'chrome-devtools',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest', '--headless'],
        timeoutMs: 60000,
        description: 'Chrome DevTools MCP browser inspection server',
      }),
  },
  filesystem: {
    id: 'filesystem',
    defaultName: 'filesystem',
    description: 'Official MCP Filesystem server scoped to the specified root directory.',
    buildConfig: (options) => {
      const targetRoot = path.resolve(options?.rootDir ?? process.cwd());
      return McpServerConfigSchema.parse({
        name: options?.name ?? 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', targetRoot],
        cwd: targetRoot,
        timeoutMs: 30000,
        description: `Scoped MCP Filesystem server (${targetRoot})`,
      });
    },
  },
  fetch: {
    id: 'fetch',
    defaultName: 'fetch',
    description: 'MCP web fetch server for retrieving documentation and HTTP endpoints.',
    buildConfig: (options) =>
      McpServerConfigSchema.parse({
        name: options?.name ?? 'fetch',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-fetch'],
        timeoutMs: 30000,
        description: 'MCP web fetch server',
      }),
  },
  memory: {
    id: 'memory',
    defaultName: 'memory',
    description: 'MCP persistent knowledge-graph memory server.',
    buildConfig: (options) =>
      McpServerConfigSchema.parse({
        name: options?.name ?? 'memory',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        timeoutMs: 30000,
        description: 'MCP knowledge-graph memory server',
      }),
  },
};

export function createPresetServerConfig(
  presetId: string,
  options?: { name?: string; rootDir?: string }
): McpServerConfig {
  const key = presetId.trim().toLowerCase() as McpPresetId;
  const preset = MCP_SERVER_PRESETS[key];
  if (!preset) {
    throw new Error(
      `Unknown MCP preset "${presetId}". Available presets: ${Object.keys(MCP_SERVER_PRESETS).join(', ')}.`
    );
  }
  return preset.buildConfig(options);
}
