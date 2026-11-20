import type { ToolDefinition, ToolPropertySchema } from '../ai/provider.js';
import type {
  McpCallToolResult,
  McpInitializeResult,
  McpResourceInfo,
  McpToolInfo,
  McpTransport,
} from './schema.js';

export interface IMcpClient {
  readonly serverName: string;
  readonly transport: McpTransport;
  readonly isConnected: boolean;
  readonly serverInfo?: { name: string; version?: string };
  connect(): Promise<McpInitializeResult>;
  listTools(): Promise<McpToolInfo[]>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<McpCallToolResult>;
  listResources(): Promise<McpResourceInfo[]>;
  readResource(uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const VALID_PROPERTY_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array']);

function normalizeJsonSchemaType(rawType: unknown): ToolPropertySchema['type'] {
  if (typeof rawType === 'string') {
    if (rawType === 'integer') return 'number';
    if (VALID_PROPERTY_TYPES.has(rawType)) {
      return rawType as ToolPropertySchema['type'];
    }
  }
  if (Array.isArray(rawType)) {
    const nonNull = rawType.find((t) => t !== 'null');
    if (nonNull) return normalizeJsonSchemaType(nonNull);
  }
  return 'string';
}

export function sanitizeToolPropertySchema(raw: unknown): ToolPropertySchema {
  if (!raw || typeof raw !== 'object') {
    return { type: 'string' };
  }
  const obj = raw as Record<string, unknown>;
  const propType = normalizeJsonSchemaType(obj['type']);
  const out: ToolPropertySchema = { type: propType };

  if (typeof obj['description'] === 'string' && obj['description'].trim()) {
    out.description = obj['description'];
  }
  if (Array.isArray(obj['enum']) && obj['enum'].length > 0 && propType === 'string') {
    out.enum = obj['enum'].map(String);
  }
  if (propType === 'array' && obj['items']) {
    out.items = sanitizeToolPropertySchema(obj['items']);
  }
  if (propType === 'object' && obj['properties'] && typeof obj['properties'] === 'object') {
    const nested: Record<string, ToolPropertySchema> = {};
    for (const [k, v] of Object.entries(obj['properties'] as Record<string, unknown>)) {
      nested[k] = sanitizeToolPropertySchema(v);
    }
    out.properties = nested;
    if (Array.isArray(obj['required'])) {
      out.required = obj['required'].map(String);
    }
  }
  return out;
}

export function convertMcpToolToToolDefinition(
  namespacedName: string,
  serverName: string,
  mcpTool: McpToolInfo
): ToolDefinition {
  const inputSchema = (mcpTool.inputSchema ?? {}) as Record<string, unknown>;
  const rawProps =
    inputSchema['properties'] && typeof inputSchema['properties'] === 'object'
      ? (inputSchema['properties'] as Record<string, unknown>)
      : {};

  const properties: Record<string, ToolPropertySchema> = {};
  for (const [key, val] of Object.entries(rawProps)) {
    properties[key] = sanitizeToolPropertySchema(val);
  }

  const required = Array.isArray(inputSchema['required'])
    ? inputSchema['required'].map(String)
    : undefined;

  return {
    name: namespacedName,
    description: `[MCP ${serverName}] ${mcpTool.description ?? mcpTool.name}`,
    parameters: {
      type: 'object',
      properties,
      ...(required && required.length > 0 ? { required } : {}),
    },
  };
}
