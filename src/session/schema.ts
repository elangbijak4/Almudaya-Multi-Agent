import { z } from 'zod';
import { ValidationError } from '../core/errors.js';

export const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
export const CURRENT_SCHEMA_VERSION = '1.0.0';

export const SessionStatusSchema = z.enum(['active', 'archived', 'closed']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionMetadataSchema = z.object({
  schema_version: z.string().default(CURRENT_SCHEMA_VERSION),
  session_id: z.string().regex(SESSION_ID_REGEX, {
    message: 'Session ID must be 1-64 characters and contain only alphanumeric, hyphen, or underscore characters',
  }),
  session_name: z.string().min(1).max(128),
  description: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  status: SessionStatusSchema.default('active'),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export const CreateSessionInputSchema = z.object({
  sessionId: z.string().regex(SESSION_ID_REGEX).optional(),
  sessionName: z.string().min(1).max(128),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const UpdateSessionInputSchema = z.object({
  sessionName: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  status: SessionStatusSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateSessionInput = z.infer<typeof UpdateSessionInputSchema>;

/**
 * Validates a session ID against the canonical regex.
 */
export function validateSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!SESSION_ID_REGEX.test(trimmed)) {
    throw new ValidationError(
      `Invalid session ID "${sessionId}". Session ID must be 1-64 characters matching /^[a-zA-Z0-9_-]+$/`
    );
  }
  return trimmed;
}

/**
 * Normalizes a human-readable name into a default session ID candidate.
 */
export function sanitizeSessionId(name: string): string {
  const sanitized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return sanitized || 'session';
}
