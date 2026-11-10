import { z, type ZodError } from 'zod';
import { ValidationError } from '../../core/errors.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  type ExecutionCheckpoint,
  type HandoffContext,
  type KnowledgeObject,
  type KnowledgeProvenance,
  type KnowledgeQuery,
  type KnowledgeRelation,
  type KnowledgeTreeNode,
  type MemoryEvent,
  type MemoryIdentity,
  type MemoryLifecyclePlan,
  type MemoryLifecycleRequest,
  type MemoryPermissionContext,
  type ProjectMemoryUniverse,
  type RegisterSnapshot,
} from './types.js';

/**
 * PKU Canonical Zod Schemas & Validation Helpers (Phase 1 — PKU-001).
 * Provides strict schema validation with actionable field-path diagnostics.
 */

export const PKU_ID_REGEX = /^[a-zA-Z0-9_:-]{1,128}$/;

export const KnowledgeScopeSchema = z.enum([
  'project',
  'session',
  'agent',
  'shared',
  'cross_project',
]);

export const KnowledgeValidationStatusSchema = z.enum([
  'unverified',
  'validated',
  'rejected',
  'superseded',
]);

export const KnowledgeLifecycleStatusSchema = z.enum([
  'active',
  'dormant',
  'archived',
  'reusable',
  'deleted',
  'purged',
]);

export const ProjectUniverseStatusSchema = z.enum([
  'active',
  'dormant',
  'archived',
  'reusable',
  'deleted',
  'purged',
]);

export const RegisterKindSchema = z.enum(['global', 'individual']);

export const RegisterSyncStatusSchema = z.enum([
  'persisted',
  'pending_persistence',
  'synchronization_failed',
  'reconciliation_required',
  'reconstructed',
]);

export const KnowledgeHierarchyLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3']);

export const KnowledgeProvenanceSchema: z.ZodType<KnowledgeProvenance> = z.object({
  sourceSystem: z.string().min(1, 'sourceSystem must not be empty'),
  sourceType: z.string().min(1, 'sourceType must not be empty'),
  sourceId: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  sourceSchemaVersion: z.string().min(1).optional(),
  sourceTimestamp: z.string().datetime().optional(),
  createdBy: z.string().min(1).optional(),
  createdAt: z.string().datetime({ message: 'provenance.createdAt must be a valid ISO-8601 datetime' }),
  ingestedAt: z.string().datetime({ message: 'provenance.ingestedAt must be a valid ISO-8601 datetime' }),
  contentHash: z.string().min(8).optional(),
  migrationBatchId: z.string().min(1).optional(),
  originProjectUniverseId: z.string().regex(PKU_ID_REGEX).optional(),
});

export const KnowledgeRelationSchema: z.ZodType<KnowledgeRelation> = z.object({
  relationId: z.string().regex(PKU_ID_REGEX, 'relationId must be 1-128 alphanumeric/underscore/colon/hyphen chars'),
  projectUniverseId: z.string().regex(PKU_ID_REGEX).optional(),
  fromId: z.string().regex(PKU_ID_REGEX, 'fromId must be a valid KnowledgeId'),
  toId: z.string().regex(PKU_ID_REGEX, 'toId must be a valid KnowledgeId'),
  relationType: z.string().min(1, 'relationType must not be empty'),
  weight: z.number().min(0).max(1).optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  provenance: KnowledgeProvenanceSchema.optional(),
});

export const KnowledgeTreeNodeSchema: z.ZodType<KnowledgeTreeNode> = z.object({
  nodeId: z.string().regex(PKU_ID_REGEX),
  projectUniverseId: z.string().regex(PKU_ID_REGEX),
  parentNodeId: z.string().regex(PKU_ID_REGEX).nullable(),
  domainPath: z.string().min(1),
  label: z.string().min(1).max(256),
  knowledgeIds: z.array(z.string().regex(PKU_ID_REGEX)).default([]),
  childNodeIds: z.array(z.string().regex(PKU_ID_REGEX)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const KnowledgeObjectSchema: z.ZodType<KnowledgeObject> = z
  .object({
    id: z.string().regex(PKU_ID_REGEX, 'id must be 1-128 valid identifier characters'),
    projectUniverseId: z.string().regex(PKU_ID_REGEX, 'projectUniverseId must be a valid identifier'),
    type: z.string().min(1, 'type must not be empty'),
    scope: KnowledgeScopeSchema,
    ownerId: z.string().min(1).optional(),
    title: z.string().min(1).max(512).optional(),
    summary: z.string().optional(),
    hierarchyLevel: KnowledgeHierarchyLevelSchema.optional(),
    content: z.unknown(),
    provenance: KnowledgeProvenanceSchema,
    relationIds: z.array(z.string().regex(PKU_ID_REGEX)).default([]),
    treeNodeIds: z.array(z.string().regex(PKU_ID_REGEX)).optional(),
    validationStatus: KnowledgeValidationStatusSchema.default('unverified'),
    lifecycleStatus: KnowledgeLifecycleStatusSchema.default('active'),
    reusable: z.boolean().optional(),
    schemaVersion: z.string().min(1).default(CURRENT_PKU_SCHEMA_VERSION),
    version: z.number().int().positive('version must be a positive integer'),
    createdAt: z.string().datetime({ message: 'createdAt must be a valid ISO-8601 datetime' }),
    updatedAt: z.string().datetime({ message: 'updatedAt must be a valid ISO-8601 datetime' }),
    tags: z.array(z.string().min(1)).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((obj) => obj.content !== undefined, {
    message: 'content is required and must not be undefined',
    path: ['content'],
  })
  .refine((obj) => (obj.scope === 'agent' ? Boolean(obj.ownerId && obj.ownerId.trim().length > 0) : true), {
    message: 'ownerId is required when scope is "agent"',
    path: ['ownerId'],
  });

export const ProjectMemoryUniverseSchema: z.ZodType<ProjectMemoryUniverse> = z.object({
  id: z.string().regex(PKU_ID_REGEX, 'id must be a valid ProjectUniverseId'),
  projectKey: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'projectKey must be 1-64 slug characters'),
  displayName: z.string().min(1).max(256),
  description: z.string().optional(),
  rootNodeId: z.string().regex(PKU_ID_REGEX),
  status: ProjectUniverseStatusSchema.default('active'),
  reusable: z.boolean().default(false),
  parentUniverseId: z.string().regex(PKU_ID_REGEX).optional(),
  schemaVersion: z.string().min(1).default(CURRENT_PKU_SCHEMA_VERSION),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const KnowledgeQuerySchema: z.ZodType<KnowledgeQuery> = z.object({
  projectUniverseIds: z.array(z.string().regex(PKU_ID_REGEX)).min(1, 'At least one projectUniverseId is required'),
  text: z.string().optional(),
  types: z.array(z.string().min(1)).optional(),
  scopes: z.array(KnowledgeScopeSchema).optional(),
  ownerId: z.string().min(1).optional(),
  hierarchyLevels: z.array(KnowledgeHierarchyLevelSchema).optional(),
  treeDomainPrefix: z.string().optional(),
  relationTraversalDepth: z.number().int().min(0).max(5).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  cursor: z.string().optional(),
  includeArchived: z.boolean().optional(),
  requiredEvidence: z.boolean().optional(),
});

export const MemoryIdentitySchema: z.ZodType<MemoryIdentity> = z
  .object({
    projectUniverseId: z.string().regex(PKU_ID_REGEX),
    sessionId: z.string().min(1).optional(),
    botId: z.string().min(1).optional(),
    principalId: z.string().min(1, 'principalId must not be empty'),
    registerKind: RegisterKindSchema,
  })
  .refine((id) => (id.registerKind === 'individual' ? Boolean(id.botId && id.botId.trim().length > 0) : true), {
    message: 'botId is required when registerKind is "individual"',
    path: ['botId'],
  });

export const RegisterSnapshotSchema: z.ZodType<RegisterSnapshot> = z.object({
  id: z.string().regex(PKU_ID_REGEX),
  identity: MemoryIdentitySchema,
  state: z.unknown().refine((val) => val !== undefined, { message: 'state must not be undefined' }),
  syncStatus: RegisterSyncStatusSchema.optional(),
  sourceRevision: z.string().optional(),
  schemaVersion: z.string().min(1).default(CURRENT_PKU_SCHEMA_VERSION),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  persistedKnowledgeIds: z.array(z.string().regex(PKU_ID_REGEX)).default([]),
});

export const ExecutionCheckpointSchema: z.ZodType<ExecutionCheckpoint> = z.object({
  checkpointId: z.string().regex(PKU_ID_REGEX),
  identity: MemoryIdentitySchema,
  taskId: z.string().min(1).optional(),
  sourceMessageId: z.string().min(1).optional(),
  iteration: z.number().int().nonnegative(),
  maxIterations: z.number().int().positive(),
  status: z.enum(['in_progress', 'paused', 'completed', 'failed', 'handed_off']),
  summary: z.string().min(1),
  workingContext: z.unknown(),
  knowledgeRefs: z.array(z.string().regex(PKU_ID_REGEX)).default([]),
  schemaVersion: z.string().min(1).default(CURRENT_PKU_SCHEMA_VERSION),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const HandoffContextSchema: z.ZodType<HandoffContext> = z.object({
  handoffId: z.string().regex(PKU_ID_REGEX),
  sessionId: z.string().min(1),
  projectUniverseId: z.string().regex(PKU_ID_REGEX),
  sourceBotId: z.string().min(1),
  targetBotId: z.string().min(1),
  checkpointId: z.string().regex(PKU_ID_REGEX).optional(),
  sharedKnowledgeIds: z.array(z.string().regex(PKU_ID_REGEX)).default([]),
  instructions: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const MemoryEventSchema: z.ZodType<MemoryEvent> = z
  .object({
    id: z.string().regex(PKU_ID_REGEX, 'id must be a valid MemoryEventId'),
    eventType: z.string().min(1, 'eventType must not be empty'),
    identity: MemoryIdentitySchema,
    payload: z.unknown(),
    occurredAt: z.string().datetime(),
    recordedAt: z.string().datetime(),
    idempotencyKey: z.string().min(1, 'idempotencyKey must not be empty'),
    provenance: KnowledgeProvenanceSchema,
  })
  .refine((evt) => evt.payload !== undefined, {
    message: 'payload is required and must not be undefined',
    path: ['payload'],
  });

export const MemoryPermissionContextSchema: z.ZodType<MemoryPermissionContext> = z.object({
  principalId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  botId: z.string().min(1).optional(),
  projectUniverseIds: z.array(z.string().regex(PKU_ID_REGEX)),
  scopes: z.array(KnowledgeScopeSchema),
  capabilities: z.array(z.string()),
  explicitSharedKnowledgeIds: z.array(z.string().regex(PKU_ID_REGEX)).optional(),
});

export const MemoryLifecycleOperationSchema = z.enum([
  'archive',
  'restore',
  'prune',
  'detach',
  'soft_delete',
  'purge',
  'reuse',
  'fork',
  'export',
  'merge',
]);

export const MemoryLifecycleRequestSchema: z.ZodType<MemoryLifecycleRequest> = z.object({
  projectUniverseId: z.string().regex(PKU_ID_REGEX),
  operation: MemoryLifecycleOperationSchema,
  targetIds: z.array(z.string().regex(PKU_ID_REGEX)).optional(),
  targetTreeNodeIds: z.array(z.string().regex(PKU_ID_REGEX)).optional(),
  destinationUniverseId: z.string().regex(PKU_ID_REGEX).optional(),
  requestedBy: z.string().min(1),
  reason: z.string().min(1),
  dryRun: z.boolean().optional(),
  includeSharedDependencies: z.boolean().optional(),
});

export const MemoryLifecyclePlanSchema: z.ZodType<MemoryLifecyclePlan> = z.object({
  request: MemoryLifecycleRequestSchema,
  affectedKnowledgeIds: z.array(z.string().regex(PKU_ID_REGEX)),
  affectedTreeNodeIds: z.array(z.string().regex(PKU_ID_REGEX)).optional(),
  protectedKnowledgeIds: z.array(z.string().regex(PKU_ID_REGEX)),
  externalReferences: z.array(z.string()),
  requiresExplicitConfirmation: z.boolean(),
  irreversible: z.boolean(),
});

/**
 * Formats Zod validation issues into an actionable diagnostic message (PKU-001).
 */
export function formatSchemaDiagnostics(entityName: string, error: ZodError): string {
  const details = error.issues
    .map((issue) => {
      const fieldPath = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `[${fieldPath}] ${issue.message}`;
    })
    .join('; ');
  return `Invalid ${entityName} schema: ${details}`;
}

/**
 * Validates any PKU contract against its Zod schema, throwing a structured ValidationError
 * with actionable field-level diagnostics on failure (PKU-001).
 */
export function validateContract<T>(
  entityName: string,
  schema: z.ZodType<T>,
  candidate: unknown
): T {
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new ValidationError(formatSchemaDiagnostics(entityName, parsed.error));
  }
  return parsed.data;
}

export function validateKnowledgeObject<T = unknown>(candidate: unknown): KnowledgeObject<T> {
  return validateContract('KnowledgeObject', KnowledgeObjectSchema, candidate) as KnowledgeObject<T>;
}

export function validateProjectMemoryUniverse(candidate: unknown): ProjectMemoryUniverse {
  return validateContract('ProjectMemoryUniverse', ProjectMemoryUniverseSchema, candidate);
}

export function validateMemoryEvent<T = unknown>(candidate: unknown): MemoryEvent<T> {
  return validateContract('MemoryEvent', MemoryEventSchema, candidate) as MemoryEvent<T>;
}

export function validateRegisterSnapshot<T = unknown>(candidate: unknown): RegisterSnapshot<T> {
  return validateContract('RegisterSnapshot', RegisterSnapshotSchema, candidate) as RegisterSnapshot<T>;
}

export function validateExecutionCheckpoint<T = unknown>(candidate: unknown): ExecutionCheckpoint<T> {
  return validateContract('ExecutionCheckpoint', ExecutionCheckpointSchema, candidate) as ExecutionCheckpoint<T>;
}

/**
 * Schema Evolution & Version Migration Registry (Phase 1).
 * Allows deterministic upcasting of older schemaVersion payloads to CURRENT_PKU_SCHEMA_VERSION.
 */
export interface SchemaMigrationStep {
  fromVersion: string;
  toVersion: string;
  migrate: (rawRecord: Record<string, unknown>) => Record<string, unknown>;
}

export class SchemaEvolutionRegistry {
  private readonly steps: Map<string, SchemaMigrationStep[]> = new Map();

  public registerStep(entityType: string, step: SchemaMigrationStep): void {
    const existing = this.steps.get(entityType) ?? [];
    existing.push(step);
    this.steps.set(entityType, existing);
  }

  public upgradeToVersion(
    entityType: string,
    rawRecord: Record<string, unknown>,
    targetVersion: string = CURRENT_PKU_SCHEMA_VERSION
  ): Record<string, unknown> {
    let current = { ...rawRecord };
    let currentVersion = String(current['schemaVersion'] ?? current['schema_version'] ?? '1.0.0');
    const entitySteps = this.steps.get(entityType) ?? [];

    let guard = 0;
    while (currentVersion !== targetVersion && guard < 20) {
      guard++;
      const step = entitySteps.find((s) => s.fromVersion === currentVersion);
      if (!step) {
        throw new ValidationError(
          `No schema migration path registered for "${entityType}" from version "${currentVersion}" to "${targetVersion}".`
        );
      }
      current = step.migrate(current);
      current['schemaVersion'] = step.toVersion;
      currentVersion = step.toVersion;
    }

    return current;
  }
}
