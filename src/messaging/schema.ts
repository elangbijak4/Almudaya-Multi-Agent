import { z } from 'zod';
import crypto from 'node:crypto';

export const CURRENT_MESSAGING_SCHEMA_VERSION = '1.0.0';

export const BroadcastCategorySchema = z.enum([
  'ACTIVITY',
  'OBSERVATION',
  'DECISION',
  'TASK',
  'ARTIFACT',
  'QUESTION',
  'STATUS',
  'ALERT',
]);
export type BroadcastCategory = z.infer<typeof BroadcastCategorySchema>;

export const BroadcastEventSchema = z.object({
  event_id: z.string(),
  session_id: z.string(),
  sender_bot_id: z.string(),
  timestamp: z.string().datetime(),
  category: BroadcastCategorySchema.default('ACTIVITY'),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});
export type BroadcastEvent = z.infer<typeof BroadcastEventSchema>;

export const BroadcastCursorSchema = z.object({
  last_read_event_id: z.string().nullable().default(null),
  last_read_timestamp: z.string().nullable().default(null),
});
export type BroadcastCursor = z.infer<typeof BroadcastCursorSchema>;

export const DirectMessageTypeSchema = z.enum([
  'DIRECT',
  'REQUEST',
  'RESPONSE',
  'NOTIFICATION',
]);
export type DirectMessageType = z.infer<typeof DirectMessageTypeSchema>;

export const MessageStatusSchema = z.enum(['unread', 'read', 'acknowledged']);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const DirectMessageSchema = z.object({
  message_id: z.string(),
  session_id: z.string(),
  sender_bot_id: z.string(),
  recipient_bot_id: z.string(),
  timestamp: z.string().datetime(),
  message_type: DirectMessageTypeSchema.default('DIRECT'),
  content: z.string().min(1),
  status: MessageStatusSchema.default('unread'),
  read_at: z.string().datetime().optional(),
  acknowledged_at: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});
export type DirectMessage = z.infer<typeof DirectMessageSchema>;

export const InboxStoreSchema = z.object({
  schema_version: z.string().default(CURRENT_MESSAGING_SCHEMA_VERSION),
  session_id: z.string(),
  bot_id: z.string(),
  updated_at: z.string().datetime(),
  messages: z.array(DirectMessageSchema).default([]),
});
export type InboxStore = z.infer<typeof InboxStoreSchema>;

export interface PublishBroadcastInput {
  senderBotId: string;
  category?: BroadcastCategory;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ReadBroadcastOptions {
  botId?: string;
  autoAdvanceCursor?: boolean;
  afterEventId?: string;
  since?: string;
  category?: BroadcastCategory;
  limit?: number;
}

export interface SendDirectMessageInput {
  senderBotId: string;
  recipient: string; // Bot ID or display name (will be resolved)
  messageType?: DirectMessageType;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ReadInboxOptions {
  markAsRead?: boolean;
  status?: MessageStatus;
  limit?: number;
}

export function generateEventId(): string {
  const rand = crypto.randomBytes(3).toString('hex');
  return `evt_${Date.now()}_${rand}`;
}

export function generateMessageId(): string {
  const rand = crypto.randomBytes(3).toString('hex');
  return `msg_${Date.now()}_${rand}`;
}
