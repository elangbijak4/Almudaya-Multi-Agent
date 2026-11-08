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
  category_cursors: z.record(z.string(), z.string()).optional().default({}),
  acknowledged_event_ids: z.array(z.string()).optional().default([]),
});
export type BroadcastCursor = z.infer<typeof BroadcastCursorSchema>;

export const DirectMessageTypeSchema = z.enum([
  'DIRECT',
  'REQUEST',
  'RESPONSE',
  'NOTIFICATION',
]);
export type DirectMessageType = z.infer<typeof DirectMessageTypeSchema>;

export const InboxDeliveryStateSchema = z.enum([
  'RECEIVED',
  'PROCESSING',
  'COMPLETED',
  'RETRY_PENDING',
  'DEAD_LETTER',
]);
export type InboxDeliveryState = z.infer<typeof InboxDeliveryStateSchema>;

export const MessageStatusSchema = z.enum([
  'unread',
  'read',
  'acknowledged',
  'RECEIVED',
  'PROCESSING',
  'COMPLETED',
  'RETRY_PENDING',
  'DEAD_LETTER',
]);
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

  // Phase 4 Inbox Delivery State Machine (RELIA-01, ADR-004, §13.1, §5.14)
  delivery_state: InboxDeliveryStateSchema.default('RECEIVED'),
  attempt_count: z.number().int().nonnegative().default(0),
  max_attempts: z.number().int().positive().default(3),
  fence_token: z.number().int().nonnegative().default(0),
  lease_owner: z.string().nullable().optional().default(null),
  lease_expires_at: z.string().datetime().nullable().optional().default(null),
  last_attempt_at: z.string().datetime().nullable().optional().default(null),
  last_error: z.string().nullable().optional().default(null),
  idempotency_key: z.string().optional(),
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
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface ReadInboxOptions {
  markAsRead?: boolean;
  status?: MessageStatus;
  deliveryState?: InboxDeliveryState;
  limit?: number;
}

export interface MessageAckOptions {
  consumerId?: string;
  fenceToken?: number;
  adminOverride?: boolean;
  reason?: string;
}

export function generateEventId(): string {
  const rand = crypto.randomBytes(3).toString('hex');
  return `evt_${Date.now()}_${rand}`;
}

export function generateMessageId(): string {
  const rand = crypto.randomBytes(3).toString('hex');
  return `msg_${Date.now()}_${rand}`;
}
