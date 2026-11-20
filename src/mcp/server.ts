import process from 'node:process';
import { VERSION } from '../core/version.js';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import { BotService } from '../bot/service.js';
import { redactRecursively } from '../execution/environment.js';
import { MessagingService } from '../messaging/service.js';
import { GoalLedgerService } from '../protocol/goal-ledger.js';
import { ProtocolStore } from '../protocol/store.js';
import { SessionService } from '../session/service.js';
import { WorkLogService } from '../shared/work-log.js';
import { MCP_PROTOCOL_VERSION, type McpToolInfo } from './schema.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface AlmudayaMcpServerOptions {
  storage: IBlackboardStorage;
  defaultSessionId?: string;
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
}

const ALMUDAYA_MCP_TOOLS: McpToolInfo[] = [
  {
    name: 'almudaya_list_sessions',
    description: 'Lists all collaboration sessions in the Almudaya Blackboard workspace.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'almudaya_list_bots',
    description: 'Lists registered bots, status, role, and model references in a session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Target Almudaya session ID.' },
      },
    },
  },
  {
    name: 'almudaya_send_message',
    description: 'Sends a direct message to a registered bot inbox in an Almudaya session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        sender_bot_id: { type: 'string', description: 'Authenticated sender bot ID (default BOT000).' },
        recipient: { type: 'string', description: 'Recipient Bot ID or display name.' },
        content: { type: 'string', description: 'Message content.' },
        task_id: { type: 'string', description: 'Optional GoalLedger taskId.' },
      },
      required: ['recipient', 'content'],
    },
  },
  {
    name: 'almudaya_publish_broadcast',
    description: 'Publishes a broadcast event to the session event stream.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        bot_id: { type: 'string', description: 'Sender bot ID (default BOT000).' },
        category: {
          type: 'string',
          enum: ['ACTIVITY', 'OBSERVATION', 'DECISION', 'TASK', 'ARTIFACT', 'QUESTION', 'STATUS', 'ALERT'],
        },
        content: { type: 'string' },
      },
      required: ['content'],
    },
  },
  {
    name: 'almudaya_get_goal_ledger',
    description: 'Reads the shared GoalLedger blueprint and task statuses for a session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
      },
    },
  },
  {
    name: 'almudaya_get_work_log',
    description: 'Reads recent file/command/MCP work log entries for a session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
];

/**
 * Exposes Almudaya Multi-Agent Blackboard governance & messaging primitives as
 * a standard stdio JSON-RPC 2.0 MCP Server (`almudaya mcp serve`).
 */
export class AlmudayaMcpServer {
  private readonly storage: IBlackboardStorage;
  private readonly defaultSessionId?: string;
  private readonly inputStream: NodeJS.ReadableStream;
  private readonly outputStream: NodeJS.WritableStream;

  private readonly sessionService: SessionService;
  private readonly botService: BotService;
  private readonly messagingService: MessagingService;
  private readonly workLogService: WorkLogService;
  private readonly ledgerService: GoalLedgerService;

  private buffer = Buffer.alloc(0);
  private running = false;

  constructor(options: AlmudayaMcpServerOptions) {
    this.storage = options.storage;
    this.defaultSessionId = options.defaultSessionId;
    this.inputStream = options.inputStream ?? process.stdin;
    this.outputStream = options.outputStream ?? process.stdout;

    this.sessionService = new SessionService(this.storage);
    this.botService = new BotService(this.storage);
    this.messagingService = new MessagingService(this.storage, this.botService);
    this.workLogService = new WorkLogService(this.storage);
    this.ledgerService = new GoalLedgerService(new ProtocolStore(this.storage));
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    this.inputStream.on('data', (chunk: Buffer | string) => {
      if (!this.running) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      this.buffer = Buffer.concat([this.buffer, buf]);
      void this.drainInputBuffer();
    });

    this.inputStream.on('end', () => {
      this.stop();
    });
  }

  public stop(): void {
    this.running = false;
  }

  private resolveSessionId(args: Record<string, unknown>): string {
    const raw = args['session_id'] ? String(args['session_id']).trim() : this.defaultSessionId;
    if (!raw) {
      throw new Error('session_id is required (pass session_id argument or start server with --session).');
    }
    return raw;
  }

  public async handleJsonRpcRequest(req: JsonRpcRequest): Promise<Record<string, unknown> | null> {
    const method = req.method ?? '';
    const params = req.params ?? {};

    // Notifications (no id) require no response
    if (req.id === undefined || req.id === null) {
      return null;
    }

    try {
      let result: unknown;
      switch (method) {
        case 'initialize': {
          result = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: 'almudaya-multiagent-mcp-server',
              version: VERSION,
            },
          };
          break;
        }

        case 'ping': {
          result = {};
          break;
        }

        case 'tools/list': {
          result = { tools: ALMUDAYA_MCP_TOOLS };
          break;
        }

        case 'tools/call': {
          const toolName = String(params['name'] ?? '');
          const args =
            params['arguments'] && typeof params['arguments'] === 'object'
              ? (params['arguments'] as Record<string, unknown>)
              : {};
          const output = await this.executeToolCall(toolName, args);
          result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(redactRecursively(output), null, 2),
              },
            ],
            structuredContent: redactRecursively(output),
          };
          break;
        }

        default: {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
        }
      }

      return {
        jsonrpc: '2.0',
        id: req.id,
        result,
      };
    } catch (err: unknown) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'almudaya_list_sessions': {
        const sessions = await this.sessionService.listSessions();
        return { count: sessions.length, sessions };
      }

      case 'almudaya_list_bots': {
        const sessionId = this.resolveSessionId(args);
        const bots = await this.botService.reconcileBotLiveness(sessionId);
        return { session_id: sessionId, count: bots.length, bots };
      }

      case 'almudaya_send_message': {
        const sessionId = this.resolveSessionId(args);
        const senderBotId = args['sender_bot_id'] ? String(args['sender_bot_id']).trim() : 'BOT000';
        const recipient = String(args['recipient'] ?? '').trim();
        const content = String(args['content'] ?? '').trim();
        const taskId = args['task_id'] ? String(args['task_id']).trim() : undefined;
        const msg = await this.messagingService.sendDirectMessage(sessionId, {
          senderBotId,
          recipient,
          content,
          taskId,
        });
        return {
          message_id: msg.message_id,
          recipient_bot_id: msg.recipient_bot_id,
          timestamp: msg.timestamp,
        };
      }

      case 'almudaya_publish_broadcast': {
        const sessionId = this.resolveSessionId(args);
        const botId = args['bot_id'] ? String(args['bot_id']).trim() : 'BOT000';
        const category = (args['category'] ? String(args['category']).trim() : 'STATUS') as
          | 'ACTIVITY'
          | 'OBSERVATION'
          | 'DECISION'
          | 'TASK'
          | 'ARTIFACT'
          | 'QUESTION'
          | 'STATUS'
          | 'ALERT';
        const content = String(args['content'] ?? '').trim();
        const evt = await this.messagingService.publishBroadcast(sessionId, {
          senderBotId: botId,
          category,
          content,
        });
        return { event_id: evt.event_id, category: evt.category, timestamp: evt.timestamp };
      }

      case 'almudaya_get_goal_ledger': {
        const sessionId = this.resolveSessionId(args);
        const ledger = await this.ledgerService.getLedger(sessionId);
        return ledger as unknown as Record<string, unknown>;
      }

      case 'almudaya_get_work_log': {
        const sessionId = this.resolveSessionId(args);
        const limit = typeof args['limit'] === 'number' ? args['limit'] : 20;
        const entries = await this.workLogService.readWorkLogs(sessionId, { limit });
        return { session_id: sessionId, count: entries.length, entries };
      }

      default:
        throw new Error(`Unknown Almudaya MCP tool: ${toolName}`);
    }
  }

  private async drainInputBuffer(): Promise<void> {
    while (this.buffer.length > 0) {
      const nlIdx = this.buffer.indexOf('\n');
      if (nlIdx === -1) return;
      const line = this.buffer.slice(0, nlIdx).toString('utf8').trim();
      this.buffer = this.buffer.slice(nlIdx + 1);
      if (!line) continue;

      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line) as JsonRpcRequest;
      } catch {
        this.outputStream.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`
        );
        continue;
      }

      const response = await this.handleJsonRpcRequest(req);
      if (response) {
        this.outputStream.write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}
