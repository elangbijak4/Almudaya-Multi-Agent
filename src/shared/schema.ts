import { z } from 'zod';
import { ValidationError } from '../core/errors.js';

export const CURRENT_SHARED_CONTEXT_SCHEMA_VERSION = '1.0.0';
export const SLUG_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

// --- Secret Redaction ---
const SENSITIVE_KEY_PATTERN = /token|secret|password|private|credential|api[_-]?key|bearer|auth/i;
const JWT_PATTERN = /^[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+$/;

/**
 * Redacts any keys or values containing credentials, secrets, or tokens.
 */
export function redactSecrets(variables: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, val] of Object.entries(variables)) {
    if (SENSITIVE_KEY_PATTERN.test(key) || JWT_PATTERN.test(val)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

// --- Project Roots ---
export const ProjectRootTypeSchema = z.enum(['primary', 'dependency', 'reference', 'docs']);
export type ProjectRootType = z.infer<typeof ProjectRootTypeSchema>;

export const ProjectRootRecordSchema = z.object({
  root_id: z.string().regex(SLUG_ID_REGEX, {
    message: 'Root ID must be 1-64 characters matching /^[a-zA-Z0-9_-]+$/',
  }),
  name: z.string().min(1).max(128),
  path: z.string().min(1),
  root_type: ProjectRootTypeSchema.default('primary'),
  description: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ProjectRootRecord = z.infer<typeof ProjectRootRecordSchema>;

export const ProjectRootsRegistrySchema = z.object({
  schema_version: z.string().default(CURRENT_SHARED_CONTEXT_SCHEMA_VERSION),
  session_id: z.string(),
  updated_at: z.string().datetime(),
  roots: z.array(ProjectRootRecordSchema).default([]),
});
export type ProjectRootsRegistry = z.infer<typeof ProjectRootsRegistrySchema>;

export interface RegisterProjectRootInput {
  rootId?: string;
  name: string;
  path: string;
  rootType?: ProjectRootType;
  description?: string;
}

// --- Environment Metadata ---
export const EnvironmentMetadataSchema = z.object({
  schema_version: z.string().default(CURRENT_SHARED_CONTEXT_SCHEMA_VERSION),
  session_id: z.string(),
  os: z.string(),
  arch: z.string(),
  node_version: z.string(),
  npm_version: z.string(),
  git_version: z.string().optional(),
  variables: z.record(z.string(), z.string()).default({}),
  updated_at: z.string().datetime(),
});
export type EnvironmentMetadata = z.infer<typeof EnvironmentMetadataSchema>;

export interface RegisterEnvironmentInput {
  os?: string;
  arch?: string;
  nodeVersion?: string;
  npmVersion?: string;
  gitVersion?: string;
  variables?: Record<string, string>;
}

// --- SDLC Documents ---
export const DocumentTypeSchema = z.enum([
  'SRS',
  'REQUIREMENTS',
  'ARCHITECTURE',
  'DESIGN',
  'API_SPEC',
  'TEST_PLAN',
  'USER_GUIDE',
  'OTHER',
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentStatusSchema = z.enum(['draft', 'approved', 'deprecated']);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const SdlcDocumentRecordSchema = z.object({
  document_id: z.string().regex(SLUG_ID_REGEX, {
    message: 'Document ID must be 1-64 characters matching /^[a-zA-Z0-9_-]+$/',
  }),
  title: z.string().min(1).max(256),
  document_type: DocumentTypeSchema.default('OTHER'),
  uri_or_path: z.string().min(1),
  version: z.string().optional(),
  status: DocumentStatusSchema.default('draft'),
  updated_at: z.string().datetime(),
});
export type SdlcDocumentRecord = z.infer<typeof SdlcDocumentRecordSchema>;

export const SdlcDocumentsRegistrySchema = z.object({
  schema_version: z.string().default(CURRENT_SHARED_CONTEXT_SCHEMA_VERSION),
  session_id: z.string(),
  updated_at: z.string().datetime(),
  documents: z.array(SdlcDocumentRecordSchema).default([]),
});
export type SdlcDocumentsRegistry = z.infer<typeof SdlcDocumentsRegistrySchema>;

export interface RegisterDocumentInput {
  documentId?: string;
  title: string;
  documentType?: DocumentType;
  uriOrPath: string;
  version?: string;
  status?: DocumentStatus;
}

export function validateSlugId(id: string, entityName: string = 'ID'): string {
  const trimmed = id.trim();
  if (!SLUG_ID_REGEX.test(trimmed)) {
    throw new ValidationError(
      `Invalid ${entityName} "${id}". Must be 1-64 characters matching /^[a-zA-Z0-9_-]+$/`
    );
  }
  return trimmed;
}
