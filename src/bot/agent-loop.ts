import type { IBlackboardStorage } from '../blackboard/interface.js';
import { BotService } from './service.js';
import { MessagingService } from '../messaging/service.js';
import { SharedContextService } from '../shared/service.js';
import type { DirectMessage } from '../messaging/schema.js';
import type {
  IAIModelProvider,
  AIMessage,
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition
} from '../ai/provider.js';
import { buildDynamicSystemPrompt } from '../ai/prompts.js';
import { FILE_TOOLS, executeFileTool } from '../tools/file-tools.js';
import { RUN_COMMAND_TOOL, executeRunCommand, type RunCommandArgs } from '../tools/command-tools.js';
import { ExecutionModeController } from './execution-mode.js';

export interface AgentStepEvent {
  iteration: number;
  thought?: string;
  toolCalls?: ToolCallRequest[];
  toolResults?: ToolCallResult[];
}

export interface AgentLoopOptions {
  sessionId: string;
  botId: string;
  storage: IBlackboardStorage;
  provider: IAIModelProvider;
  executionModeController?: ExecutionModeController;
  maxIterations?: number;
  botService?: BotService;
  messagingService?: MessagingService;
  sharedContextService?: SharedContextService;
  onStep?: (event: AgentStepEvent) => Promise<void> | void;
}

/**
 * Autonomous ReAct Agent Loop for multi-bot software engineering (ADR-204 & FR-216).
 * Routes inbox messages to AI inference, dispatches tools within sandboxed roots,
 * enforces safety modes (Request Review vs Turbo), logs Blackboard audit trail (FR-217),
 * and autonomously replies to peer bots.
 */
export class AutonomousAgentLoop {
  public readonly sessionId: string;
  public readonly botId: string;
  private readonly storage: IBlackboardStorage;
  private readonly provider: IAIModelProvider;
  private readonly executionModeController: ExecutionModeController;
  private readonly maxIterations: number;

  private readonly botService: BotService;
  private readonly messagingService: MessagingService;
  private readonly sharedContextService: SharedContextService;
  private readonly onStepCallback?: (event: AgentStepEvent) => Promise<void> | void;

  constructor(options: AgentLoopOptions) {
    this.sessionId = options.sessionId;
    this.botId = options.botId;
    this.storage = options.storage;
    this.provider = options.provider;
    this.executionModeController =
      options.executionModeController ?? new ExecutionModeController('REQUEST_REVIEW');
    this.maxIterations = options.maxIterations ?? 10;

    this.botService = options.botService ?? new BotService(this.storage);
    this.messagingService =
      options.messagingService ?? new MessagingService(this.storage, this.botService);
    this.sharedContextService =
      options.sharedContextService ?? new SharedContextService(this.storage);
    this.onStepCallback = options.onStep;
  }

  /**
   * Processes an incoming direct message through the iterative ReAct loop.
   */
  public async handleMessage(message: DirectMessage): Promise<string> {
    // 1. Gather dynamic session context
    const currentBot = await this.botService.getBot(this.sessionId, this.botId);
    const peerBots = await this.botService.listBots(this.sessionId);
    const projectRoots = await this.sharedContextService.listProjectRoots(this.sessionId);
    const projectRootPaths = projectRoots.map((r) => r.path);

    const systemPrompt = buildDynamicSystemPrompt({
      sessionId: this.sessionId,
      botId: currentBot.bot_id,
      displayName: currentBot.display_name,
      role: currentBot.description,
      description: currentBot.description,
      peerBots,
      projectRoots,
      executionMode: this.executionModeController.getMode()
    });

    // 2. Prepare available tools (File Tools + Command Execution Tool)
    const availableTools: ToolDefinition[] = [...FILE_TOOLS, RUN_COMMAND_TOOL];

    // 3. Initialize conversation messages
    const senderName = message.sender_bot_id;
    const conversation: AIMessage[] = [
      {
        role: 'user',
        content: `[Pesan Masuk dari rekan bot "${senderName}"]: ${message.content}`
      }
    ];

    let finalResponseText = '';
    let iteration = 0;

    // 4. Bounded ReAct Iteration Loop (Max 10 steps per ADR-204)
    while (iteration < this.maxIterations) {
      iteration++;

      const aiResponse = await this.provider.generateResponse({
        systemPrompt,
        messages: conversation,
        tools: availableTools
      });

      const thought = aiResponse.text;
      const toolCalls = aiResponse.toolCalls;

      // Notify step observer
      if (this.onStepCallback) {
        await this.onStepCallback({
          iteration,
          thought,
          toolCalls
        });
      }

      // If AI decided to call tools
      if (toolCalls && toolCalls.length > 0) {
        // Record assistant turn with tool calls
        conversation.push({
          role: 'model',
          content: thought,
          toolCalls
        });

        const toolResults: ToolCallResult[] = [];

        for (const toolCall of toolCalls) {
          // Log intended tool invocation to Blackboard events as audit trail (FR-217)
          try {
            await this.messagingService.publishBroadcast(this.sessionId, {
              senderBotId: this.botId,
              category: 'ACTIVITY',
              content: `Bot "${currentBot.display_name}" memanggil perkakas: ${toolCall.name}`,
              metadata: {
                tool: toolCall.name,
                arguments: toolCall.arguments,
                iteration
              }
            });
          } catch {
            // Ignore broadcast failure during high concurrency
          }

          // Evaluate execution safety mode (Request Review vs Turbo)
          const approval = await this.executionModeController.requestApproval({
            toolName: toolCall.name,
            args: toolCall.arguments,
            botName: currentBot.display_name,
            botId: currentBot.bot_id
          });

          if (!approval.approved) {
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.name,
              error: approval.reason ?? 'Aksi dibatalkan oleh operator.'
            });
            continue;
          }

          // Execute tool in sandbox
          try {
            let result: unknown;

            if (toolCall.name === 'run_command') {
              const cmdArgs: RunCommandArgs = {
                command: String(toolCall.arguments['command'] ?? ''),
                timeout_ms:
                  typeof toolCall.arguments['timeout_ms'] === 'number'
                    ? toolCall.arguments['timeout_ms']
                    : undefined,
                working_dir:
                  typeof toolCall.arguments['working_dir'] === 'string'
                    ? toolCall.arguments['working_dir']
                    : undefined
              };
              result = await executeRunCommand(projectRootPaths, cmdArgs);
            } else {
              result = await executeFileTool(
                projectRootPaths,
                toolCall.name,
                toolCall.arguments
              );
            }

            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.name,
              result
            });

            // Log tool success to Blackboard (FR-217)
            try {
              await this.messagingService.publishBroadcast(this.sessionId, {
                senderBotId: this.botId,
                category: 'ACTIVITY',
                content: `Bot "${currentBot.display_name}" berhasil mengeksekusi: ${toolCall.name}`,
                metadata: {
                  tool: toolCall.name,
                  success: true
                }
              });
            } catch {
              // Ignore broadcast failure
            }
          } catch (err: unknown) {
            const errorMsg = (err as Error).message;
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.name,
              error: errorMsg
            });
          }
        }

        // Add tool results as tool messages
        for (const tr of toolResults) {
          conversation.push({
            role: 'tool',
            toolResult: tr
          });
        }

        if (this.onStepCallback) {
          await this.onStepCallback({
            iteration,
            toolResults
          });
        }

        // Loop continues to let AI observe results and reason further
        continue;
      }

      // If no tool calls, AI reached final conclusion
      if (thought) {
        finalResponseText = thought;
        conversation.push({
          role: 'model',
          content: thought
        });
      }
      break;
    }

    if (!finalResponseText && iteration >= this.maxIterations) {
      finalResponseText = `[Peringatan: Mencapai batas maksimal ${this.maxIterations} iterasi tool.]`;
    }

    // 5. Send automated reply back to sender bot (FR-216)
    if (message.sender_bot_id && message.sender_bot_id !== this.botId) {
      try {
        await this.messagingService.sendDirectMessage(this.sessionId, {
          senderBotId: this.botId,
          recipient: message.sender_bot_id,
          content: finalResponseText || '(Tugas telah diselesaikan.)',
          metadata: { correlationId: message.message_id }
        });

        // Log completion decision to Blackboard
        await this.messagingService.publishBroadcast(this.sessionId, {
          senderBotId: this.botId,
          category: 'DECISION',
          content: `Bot "${currentBot.display_name}" menyelesaikan tugas dari "${senderName}".`,
          metadata: {
            replyToMessageId: message.message_id,
            iterations: iteration
          }
        });
      } catch (err) {
        console.error(`Failed to send autonomous reply message: ${(err as Error).message}`);
      }
    }

    return finalResponseText;
  }
}
