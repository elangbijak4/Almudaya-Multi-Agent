import { Command } from 'commander';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { MessagingService } from '../../messaging/service.js';
import type { BroadcastCategory, DirectMessageType } from '../../messaging/schema.js';

export function registerMessagingCommands(program: Command): void {
  // --- Broadcast Command Group ---
  const broadcast = program
    .command('broadcast')
    .description('Publish and read Session broadcast events');

  broadcast
    .command('publish [content]')
    .description('Publish an event to the Session broadcast log')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <senderBotId>', 'Sender Bot ID (alias for --sender)')
    .option('--sender <senderBotId>', 'Sender Bot ID (defaults to HUMAN)', 'HUMAN')
    .option('--payload <payload>', 'Event payload content')
    .option('--content <content>', 'Event content (alias for --payload)')
    .option(
      '-c, --category <category>',
      'Event category (ACTIVITY, OBSERVATION, DECISION, TASK, ARTIFACT, QUESTION, STATUS, ALERT)',
      'ACTIVITY'
    )
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (posContent: string | undefined, options: {
      session: string;
      bot?: string;
      sender: string;
      payload?: string;
      content?: string;
      category: string;
      workspace?: string;
    }) => {
      try {
        const publishContent = posContent ?? options.payload ?? options.content;
        const senderId = options.bot ?? options.sender ?? 'HUMAN';

        if (!publishContent) {
          console.error('Error: Broadcast content or payload is required (e.g. almudaya broadcast publish <content> or --payload <content>)');
          process.exitCode = 1;
          return;
        }

        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new MessagingService(storage);

        const event = await service.publishBroadcast(options.session, {
          senderBotId: senderId,
          category: options.category.toUpperCase() as BroadcastCategory,
          content: publishContent,
        });

        console.log(`Broadcast published successfully!`);
        console.log(`  Event ID:   ${event.event_id}`);
        console.log(`  Session ID: ${event.session_id}`);
        console.log(`  Sender:     ${event.sender_bot_id}`);
        console.log(`  Category:   ${event.category}`);
        console.log(`  Timestamp:  ${event.timestamp}`);
        console.log(`  Content:    ${event.content}`);
      } catch (error: unknown) {
        console.error(`Error publishing broadcast: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  broadcast
    .command('read')
    .description('Read broadcast events from the Session broadcast log')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Bot ID for cursor-tracked unread reading')
    .option('-c, --category <category>', 'Filter by category')
    .option('-l, --limit <count>', 'Limit the number of events returned', (val) => parseInt(val, 10))
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output events as JSON')
    .action(async (options: {
      session: string;
      bot?: string;
      category?: string;
      limit?: number;
      workspace?: string;
      json?: boolean;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new MessagingService(storage);

        const events = await service.readBroadcasts(options.session, {
          botId: options.bot,
          autoAdvanceCursor: !!options.bot,
          category: options.category?.toUpperCase() as BroadcastCategory | undefined,
          limit: options.limit,
        });

        if (options.json) {
          console.log(JSON.stringify(events, null, 2));
          return;
        }

        if (events.length === 0) {
          console.log(`No broadcast events found for session: ${options.session}`);
          return;
        }

        console.log(`Broadcast events in Session [${options.session}]:\n`);
        for (const e of events) {
          console.log(`  [${e.timestamp}] (${e.category}) ${e.sender_bot_id}: ${e.content}`);
          console.log(`    Event ID: ${e.event_id}`);
        }
      } catch (error: unknown) {
        console.error(`Error reading broadcasts: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  // --- Direct Message Command Group ---
  const message = program
    .command('message')
    .description('Send, read, and acknowledge bot-to-bot direct messages');

  message
    .command('send [recipient] [content]')
    .description('Send a direct message to a recipient bot (by Bot ID or display name)')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-r, --recipient <recipient>', 'Recipient bot ID or display name')
    .option('--body <content>', 'Message body content')
    .option('--content <content>', 'Message body content (alias for --body)')
    .option('-b, --bot <senderBotId>', 'Sender Bot ID (alias for --sender)')
    .option('--sender <senderBotId>', 'Sender Bot ID (defaults to HUMAN)', 'HUMAN')
    .option(
      '-t, --type <messageType>',
      'Message type (DIRECT, REQUEST, RESPONSE, NOTIFICATION)',
      'DIRECT'
    )
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (posRecipient: string | undefined, posContent: string | undefined, options: {
      session: string;
      recipient?: string;
      body?: string;
      content?: string;
      bot?: string;
      sender: string;
      type: string;
      workspace?: string;
    }) => {
      try {
        const targetRecipient = posRecipient ?? options.recipient;
        const targetContent = posContent ?? options.body ?? options.content;
        const senderId = options.bot ?? options.sender ?? 'HUMAN';

        if (!targetRecipient || !targetContent) {
          console.error('Error: Both recipient and body/content are required (e.g. almudaya message send <recipient> <content> or --recipient <id> --body <text>)');
          process.exitCode = 1;
          return;
        }

        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new MessagingService(storage);

        const msg = await service.sendDirectMessage(options.session, {
          recipient: targetRecipient,
          senderBotId: senderId,
          messageType: options.type.toUpperCase() as DirectMessageType,
          content: targetContent,
        });

        console.log(`Message sent successfully!`);
        console.log(`  Message ID: ${msg.message_id}`);
        console.log(`  Session ID: ${msg.session_id}`);
        console.log(`  Sender:     ${msg.sender_bot_id}`);
        console.log(`  Recipient:  ${msg.recipient_bot_id}`);
        console.log(`  Type:       ${msg.message_type}`);
        console.log(`  Timestamp:  ${msg.timestamp}`);
        console.log(`  Content:    ${msg.content}`);
      } catch (error: unknown) {
        console.error(`Error sending message: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  message
    .command('read [botId]')
    .description("Read messages in a bot's Individual Blackboard inbox")
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Bot ID whose inbox to read')
    .option('--mark-read', 'Mark unread messages as read', true)
    .option('--no-mark-read', 'Do not mark unread messages as read')
    .option('-l, --limit <count>', 'Limit the number of messages returned', (val) => parseInt(val, 10))
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output messages as JSON')
    .action(async (posBotId: string | undefined, options: {
      session: string;
      bot?: string;
      markRead?: boolean;
      limit?: number;
      workspace?: string;
      json?: boolean;
    }) => {
      try {
        const targetBot = posBotId ?? options.bot;
        if (!targetBot) {
          console.error('Error: Bot ID is required (e.g. almudaya message read <botId> or --bot <botId>)');
          process.exitCode = 1;
          return;
        }

        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new MessagingService(storage);

        const messages = await service.readInbox(options.session, targetBot, {
          markAsRead: options.markRead,
          limit: options.limit,
        });

        if (options.json) {
          console.log(JSON.stringify(messages, null, 2));
          return;
        }

        if (messages.length === 0) {
          console.log(`No messages in inbox for bot [${targetBot}] in session: ${options.session}`);
          return;
        }

        console.log(`Inbox messages for [${targetBot}] in Session [${options.session}]:\n`);
        for (const m of messages) {
          console.log(`  [${m.timestamp}] [${m.status.toUpperCase()}] From: ${m.sender_bot_id} (${m.message_type})`);
          console.log(`    Message ID: ${m.message_id}`);
          console.log(`    Content:    ${m.content}`);
          if (m.acknowledged_at) {
            console.log(`    Acked:      ${m.acknowledged_at}`);
          }
        }
      } catch (error: unknown) {
        console.error(`Error reading inbox: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  message
    .command('ack [botId] [messageId]')
    .description('Acknowledge a received message in a inbox')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Bot ID')
    .option('-m, --message-id <messageId>', 'Message ID to acknowledge')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (posBotId: string | undefined, posMessageId: string | undefined, options: {
      session: string;
      bot?: string;
      messageId?: string;
      workspace?: string;
    }) => {
      try {
        const targetBot = posBotId ?? options.bot;
        const targetMsgId = posMessageId ?? options.messageId;

        if (!targetBot || !targetMsgId) {
          console.error('Error: Both Bot ID and Message ID are required (e.g. almudaya message ack <botId> <messageId> or --bot <id> --message-id <id>)');
          process.exitCode = 1;
          return;
        }

        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new MessagingService(storage);

        const acked = await service.acknowledgeMessage(options.session, targetBot, targetMsgId);

        console.log(`Message acknowledged successfully!`);
        console.log(`  Message ID: ${acked.message_id}`);
        console.log(`  Bot ID:     ${acked.recipient_bot_id}`);
        console.log(`  Status:     ${acked.status}`);
        console.log(`  Acked At:   ${acked.acknowledged_at}`);
      } catch (error: unknown) {
        console.error(`Error acknowledging message: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });
}
