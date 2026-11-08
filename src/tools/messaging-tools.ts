import type { ToolDefinition } from '../ai/provider.js';
import type { MessagingService } from '../messaging/service.js';
import type { DirectMessageType } from '../messaging/schema.js';

export interface SendMessageArgs {
  recipient: string;
  content: string;
  message_type?: DirectMessageType;
  idempotency_key?: string;
}

export interface SendMessageResult {
  message_id: string;
  recipient_bot_id: string;
  sender_bot_id: string;
  timestamp: string;
  status: string;
  delivery_state: string;
}

/**
 * Tool definition for native peer messaging (NT-03, IDV-01, §13.4, §5.18).
 * Sender identity is strictly derived from trusted runtime execution context,
 * never from untrusted model arguments.
 */
export const SEND_MESSAGE_TOOL: ToolDefinition = {
  name: 'send_message',
  description:
    'Sends a direct message to a peer bot in the active session. Sender identity is verified from the trusted runtime execution context.',
  parameters: {
    type: 'object',
    properties: {
      recipient: {
        type: 'string',
        description: 'Target bot ID or display name to send the direct message to.',
      },
      content: {
        type: 'string',
        description: 'Text content of the message.',
      },
      message_type: {
        type: 'string',
        enum: ['DIRECT', 'REQUEST', 'RESPONSE', 'NOTIFICATION'],
        description: 'Semantic message type. Defaults to DIRECT.',
      },
      idempotency_key: {
        type: 'string',
        description: 'Optional unique key to ensure at-most-once delivery on retries.',
      },
    },
    required: ['recipient', 'content'],
  },
};

/**
 * Executes sending a direct message to a peer bot via internal MessagingService.
 * Enforces IDV-01: sender identity is derived solely from trusted runtime context.
 */
export async function executeSendMessage(
  messagingService: MessagingService,
  sessionId: string,
  trustedSenderBotId: string,
  rawArgs: Record<string, unknown>
): Promise<SendMessageResult> {
  const recipient = String(rawArgs['recipient'] ?? '').trim();
  const content = String(rawArgs['content'] ?? '').trim();
  const messageType = rawArgs['message_type']
    ? (String(rawArgs['message_type']) as DirectMessageType)
    : undefined;
  const idempotencyKey = rawArgs['idempotency_key']
    ? String(rawArgs['idempotency_key'])
    : undefined;

  if (!recipient) {
    throw new Error('send_message failed: "recipient" must not be empty.');
  }

  if (!content) {
    throw new Error('send_message failed: "content" must not be empty.');
  }

  if (!trustedSenderBotId) {
    throw new Error('send_message failed: trusted senderBotId missing from execution context.');
  }

  const sent = await messagingService.sendDirectMessage(sessionId, {
    senderBotId: trustedSenderBotId,
    recipient,
    content,
    messageType,
    idempotencyKey,
  });

  return {
    message_id: sent.message_id,
    recipient_bot_id: sent.recipient_bot_id,
    sender_bot_id: sent.sender_bot_id,
    timestamp: sent.timestamp,
    status: sent.status,
    delivery_state: sent.delivery_state,
  };
}
