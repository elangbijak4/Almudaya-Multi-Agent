import { z } from 'zod';
import { ValidationError } from '../core/errors.js';

export const BOT_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
export const DISPLAY_NAME_REGEX = /^[a-zA-Z0-9_ -]{1,64}$/;
export const CURRENT_BOT_REGISTRY_SCHEMA_VERSION = '1.0.0';

export const BotStatusSchema = z.enum([
  'starting',
  'active',
  'idle',
  'stopped',
  'failed',
  'stale',
]);
export type BotStatus = z.infer<typeof BotStatusSchema>;

export const BotRecordSchema = z.object({
  bot_id: z.string().regex(BOT_ID_REGEX, {
    message: 'Bot ID must be 1-64 characters matching /^[a-zA-Z0-9_-]+$/',
  }),
  session_id: z.string(),
  display_name: z.string().regex(DISPLAY_NAME_REGEX, {
    message: 'Display name must be 1-64 characters matching /^[a-zA-Z0-9_ -]+$/',
  }),
  description: z.string().optional(),
  status: BotStatusSchema.default('active'),
  pid: z.number().int().positive().optional(),
  joined_at: z.string().datetime(),
  last_seen_at: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type BotRecord = z.infer<typeof BotRecordSchema>;

export const BotRegistrySchema = z.object({
  schema_version: z.string().default(CURRENT_BOT_REGISTRY_SCHEMA_VERSION),
  session_id: z.string(),
  updated_at: z.string().datetime(),
  bots: z.array(BotRecordSchema).default([]),
});

export type BotRegistry = z.infer<typeof BotRegistrySchema>;

export const RegisterBotInputSchema = z.object({
  botId: z.string().regex(BOT_ID_REGEX).optional(),
  displayName: z.string().regex(DISPLAY_NAME_REGEX).optional(),
  description: z.string().optional(),
  status: BotStatusSchema.optional(),
  pid: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RegisterBotInput = z.infer<typeof RegisterBotInputSchema>;

export function validateBotId(botId: string): string {
  const trimmed = botId.trim();
  if (!BOT_ID_REGEX.test(trimmed)) {
    throw new ValidationError(
      `Invalid Bot ID "${botId}". Must be 1-64 characters matching /^[a-zA-Z0-9_-]+$/`
    );
  }
  return trimmed;
}

export function validateDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!DISPLAY_NAME_REGEX.test(trimmed)) {
    throw new ValidationError(
      `Invalid display name "${displayName}". Must be 1-64 characters matching /^[a-zA-Z0-9_ -]+$/`
    );
  }
  return trimmed;
}

/**
 * Finds the next available Bot ID in sequential order (BOT001, BOT002, etc.).
 */
export function generateNextBotId(existingBotIds: string[]): string {
  const set = new Set(existingBotIds);
  let seq = 1;
  while (true) {
    const candidate = `BOT${String(seq).padStart(3, '0')}`;
    if (!set.has(candidate)) {
      return candidate;
    }
    seq++;
  }
}

/**
 * Generates the default display name formatted as `<sanitized-session-name>_<sequence>` (e.g. `research-app_001`).
 */
export function generateNextDisplayName(
  sessionName: string,
  existingDisplayNames: string[]
): string {
  const sanitizedPrefix = sessionName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'bot';

  const set = new Set(existingDisplayNames.map((n) => n.toLowerCase()));
  let seq = 1;
  while (true) {
    const candidate = `${sanitizedPrefix}_${String(seq).padStart(3, '0')}`;
    if (!set.has(candidate.toLowerCase())) {
      return candidate;
    }
    seq++;
  }
}
