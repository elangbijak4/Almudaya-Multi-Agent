import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { BotService } from '../../src/bot/service.js';
import { CapabilityPersistence, CapabilityService } from '../../src/capability/index.js';
import { createProgram } from '../../src/cli/index.js';
import { ExecutionController } from '../../src/execution/controller.js';
import {
  AlmudayaMcpServer,
  HttpMcpClient,
  McpClientManager,
  McpConfigStore,
  McpServerConfigSchema,
  StdioMcpClient,
  createPresetServerConfig,
} from '../../src/mcp/index.js';
import { generateMessageId } from '../../src/messaging/schema.js';
import { SessionService } from '../../src/session/service.js';
import { SharedContextService } from '../../src/shared/service.js';
import { WorkLogService } from '../../src/shared/work-log.js';

const MOCK_STDIO_MCP_SCRIPT = `
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  while (true) {
    const idx = buf.indexOf('\\n');
    if (idx === -1) break;
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const req = JSON.parse(line);
    if (req.id === undefined || req.id === null) continue;
    let result = {};
    if (req.method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'mock-stdio-mcp', version: '1.0.0' },
      };
    } else if (req.method === 'ping') {
      result = {};
    } else if (req.method === 'tools/list') {
      result = {
        tools: [
          {
            name: 'echo_upper',
            description: 'Uppercases text input',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string', description: 'Input text' } },
              required: ['text'],
            },
          },
        ],
      };
    } else if (req.method === 'tools/call') {
      const txt = String((req.params && req.params.arguments && req.params.arguments.text) || '');
      const secret = process.env.MCP_MOCK_SECRET || '';
      result = {
        content: [{ type: 'text', text: txt.toUpperCase() + (secret ? ' ' + secret : '') }],
      };
    } else if (req.method === 'resources/list') {
      result = {
        resources: [{ uri: 'mock://readme', name: 'readme.txt', mimeType: 'text/plain' }],
      };
    } else if (req.method === 'resources/read') {
      result = {
        contents: [{ uri: 'mock://readme', mimeType: 'text/plain', text: 'HELLO_RESOURCE' }],
      };
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n');
  }
});
`;

describe('MCP Client, Server, ACG Governance & CLI Suite (v0.3.6)', () => {
  let tmpRoot: string;
  let mockServerScript: string;
  let httpServers: http.Server[] = [];
  let managers: McpClientManager[] = [];

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-mcp-'));
    mockServerScript = path.join(tmpRoot, 'mock-stdio-mcp.mjs');
    await fs.writeFile(mockServerScript, MOCK_STDIO_MCP_SCRIPT, 'utf-8');
  });

  afterEach(async () => {
    for (const mgr of managers) {
      await mgr.disposeAll().catch(() => undefined);
    }
    managers = [];
    for (const srv of httpServers) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    httpServers = [];
    ExecutionController.resetInstance();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('StdioMcpClient executes full JSON-RPC handshake, listTools, callTool, listResources, readResource, ping & close', async () => {
    const client = new StdioMcpClient(
      McpServerConfigSchema.parse({
        name: 'mock_stdio',
        transport: 'stdio',
        command: process.execPath,
        args: [mockServerScript],
      })
    );

    try {
      const init = await client.connect();
      expect(init.serverInfo?.name).toBe('mock-stdio-mcp');
      expect(client.isConnected).toBe(true);
      expect(await client.ping()).toBe(true);

      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['echo_upper']);

      const callRes = await client.callTool('echo_upper', { text: 'almudaya mcp' });
      expect(callRes.content[0]?.text).toBe('ALMUDAYA MCP');

      const resources = await client.listResources();
      expect(resources[0]?.uri).toBe('mock://readme');

      const readRes = await client.readResource('mock://readme');
      expect(readRes.contents[0]?.text).toBe('HELLO_RESOURCE');
    } finally {
      await client.close();
      expect(client.isConnected).toBe(false);
    }
  });

  it('HttpMcpClient supports Streamable HTTP JSON & SSE responses with Mcp-Session-Id', async () => {
    let seenSessionHeader: string | undefined;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        if (req.method === 'DELETE') {
          res.writeHead(204);
          res.end();
          return;
        }
        const rpc = JSON.parse(body || '{}') as { id?: number; method?: string };
        seenSessionHeader = req.headers['mcp-session-id'] as string | undefined;

        if (rpc.id === undefined) {
          res.writeHead(202);
          res.end();
          return;
        }

        if (rpc.method === 'initialize') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': 'sess-http-123',
          });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                serverInfo: { name: 'mock-http-mcp', version: '1.0' },
              },
            })
          );
          return;
        }

        if (rpc.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `event: message\ndata: ${JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                tools: [{ name: 'sse_ping', description: 'Ping via SSE', inputSchema: { type: 'object', properties: {} } }],
              },
            })}\n\n`
          );
          res.end();
          return;
        }

        if (rpc.method === 'tools/call') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: { content: [{ type: 'text', text: 'HTTP_PONG' }] },
            })
          );
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });
    httpServers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new HttpMcpClient(
      McpServerConfigSchema.parse({
        name: 'mock_http',
        transport: 'http',
        url: `http://127.0.0.1:${addr.port}/mcp`,
      })
    );

    const init = await client.connect();
    expect(init.serverInfo?.name).toBe('mock-http-mcp');
    expect(client.getSessionHeaderId()).toBe('sess-http-123');

    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['sse_ping']);
    expect(seenSessionHeader).toBe('sess-http-123');

    const res = await client.callTool('sse_ping', {});
    expect(res.content[0]?.text).toBe('HTTP_PONG');
    await client.close();
  });

  it('McpClientManager enforces ACG mcp.invoke, redacts secrets, and powers live tool calling inside AutonomousAgentLoop', async () => {
    const storage = new FilesystemSessionStorage(tmpRoot);
    await new SessionService(storage).createSession({
      sessionId: 'S_MCP_LOOP',
      sessionName: 'MCP AgentLoop Test',
    });
    await new SharedContextService(storage).registerProjectRoot('S_MCP_LOOP', {
      name: 'App',
      path: tmpRoot,
      rootType: 'primary',
    });
    await new BotService(storage).registerBot('S_MCP_LOOP', {
      botId: 'BOT001',
      displayName: 'BrowserBot',
      role: 'worker',
    });

    const mgr = new McpClientManager({ enforceAcg: true, workspaceRoot: tmpRoot });
    managers.push(mgr);

    const status = await mgr.connectServer(
      McpServerConfigSchema.parse({
        name: 'mock_stdio',
        transport: 'stdio',
        command: process.execPath,
        args: [mockServerScript],
        env: { MCP_MOCK_SECRET: 'nvapi-super-secret-value-99999' },
      })
    );
    expect(status.connected).toBe(true);
    expect(mgr.getToolDefinitions().map((t) => t.name)).toContain('mcp__mock_stdio__echo_upper');

    // Without ACG grant -> DENIED fail-closed
    await expect(
      mgr.invokeTool(
        'mcp__mock_stdio__echo_upper',
        { text: 'hello' },
        { sessionId: 'S_MCP_LOOP', botId: 'BOT001', projectRoots: [tmpRoot], workspaceRoot: tmpRoot }
      )
    ).rejects.toThrow(/Access denied by ACG policy \(mcp\.invoke\)/);

    // Apply 'extended' preset which grants mcp.invoke
    const capService = new CapabilityService(new CapabilityPersistence({ workspaceRoot: tmpRoot }));
    await capService.applyPreset('S_MCP_LOOP', 'extended', 'ADMIN');

    const provider = new MockAIProvider('mcp-agent', [
      {
        toolCalls: [
          {
            id: 'call_mcp_1',
            name: 'mcp__mock_stdio__echo_upper',
            arguments: { text: 'verify ui' },
          },
        ],
      },
      { text: 'Verified via MCP tool.' },
    ]);

    const loop = new AutonomousAgentLoop({
      sessionId: 'S_MCP_LOOP',
      botId: 'BOT001',
      storage,
      provider,
      executionModeController: new ExecutionModeController('TURBO'),
      mcpManager: mgr,
      enablePkuSync: false,
    });

    const now = new Date().toISOString();
    const reply = await loop.handleMessage({
      message_id: generateMessageId(),
      session_id: 'S_MCP_LOOP',
      sender_bot_id: 'OPERATOR',
      recipient_bot_id: 'BOT001',
      timestamp: now,
      message_type: 'DIRECT',
      content: 'Run MCP verification tool',
      status: 'unread',
      metadata: {},
      delivery_state: 'PROCESSING',
      attempt_count: 1,
      max_attempts: 1,
      fence_token: 1,
      lease_owner: 'test',
      lease_expires_at: null,
      last_attempt_at: now,
      last_error: null,
    });

    expect(reply).toBe('Verified via MCP tool.');
    // Secret token echoed by mock MCP server must be redacted in agent observation
    const secondCall = provider.calls[1]!;
    const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
    const serialized = JSON.stringify(toolMsg);
    expect(serialized).toContain('VERIFY UI');
    expect(serialized).not.toContain('nvapi-super-secret-value-99999');

    const logs = await new WorkLogService(storage).readWorkLogs('S_MCP_LOOP');
    expect(logs.some((l) => l.action_type === 'MCP_TOOL_CALL')).toBe(true);
  });

  it('AlmudayaMcpServer, McpConfigStore presets & CLI `almudaya mcp` commands work end-to-end', async () => {
    const storage = new FilesystemSessionStorage(tmpRoot);
    await new SessionService(storage).createSession({
      sessionId: 'S_SRV_1',
      sessionName: 'MCP Server Session',
    });

    // External mcp.json parsing
    const externalFile = path.join(tmpRoot, 'external.mcp.json');
    await fs.writeFile(
      externalFile,
      JSON.stringify({
        mcpServers: {
          ext_stdio: { command: process.execPath, args: [mockServerScript] },
        },
      }),
      'utf-8'
    );

    const store = new McpConfigStore({ workspaceRoot: tmpRoot });
    await store.upsertServer(createPresetServerConfig('playwright'));
    const effective = await store.resolveEffectiveServers({ externalConfigPath: externalFile });
    expect(effective.map((s) => s.name).sort()).toEqual(['ext_stdio', 'playwright']);

    // CLI commands (`preset`, `remove`)
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'almudaya',
      'mcp',
      'preset',
      'chrome-devtools',
      '-w',
      tmpRoot,
    ]);
    const loaded = await store.loadRegistry();
    expect(loaded.servers['chrome-devtools']).toBeDefined();
    await program.parseAsync([
      'node',
      'almudaya',
      'mcp',
      'remove',
      'chrome-devtools',
      '-w',
      tmpRoot,
    ]);
    const afterRemove = await store.loadRegistry();
    expect(afterRemove.servers['chrome-devtools']).toBeUndefined();

    // AlmudayaMcpServer JSON-RPC methods
    const mcpServer = new AlmudayaMcpServer({ storage, defaultSessionId: 'S_SRV_1' });
    const listToolsRes = await mcpServer.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    const tools = (listToolsRes?.['result'] as { tools: Array<{ name: string }> }).tools;
    expect(tools.some((t) => t.name === 'almudaya_list_sessions')).toBe(true);

    const callSessionsRes = await mcpServer.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'almudaya_list_sessions', arguments: {} },
    });
    const structured = (callSessionsRes?.['result'] as { structuredContent: { count: number } })
      .structuredContent;
    expect(structured.count).toBe(1);
  });
});
