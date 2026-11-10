/** PKU canonical contracts. These are domain contracts only; no persistence backend is selected here. */
export type KnowledgeId = string;
export type ProjectUniverseId = string;
export type SessionMemoryId = string;
export type AgentMemoryId = string;
export type MemoryEventId = string;

export type KnowledgeScope = 'project' | 'session' | 'agent' | 'shared' | 'cross_project';
export type KnowledgeValidationStatus = 'unverified' | 'validated' | 'rejected' | 'superseded';
export type KnowledgeLifecycleStatus = 'active' | 'archived' | 'deleted' | 'purged';
export type RegisterKind = 'global' | 'individual';

export interface KnowledgeProvenance {
  sourceSystem: string;
  sourceType: string;
  sourceId?: string;
  sourcePath?: string;
  sourceSchemaVersion?: string;
  sourceTimestamp?: string;
  createdBy?: string;
  createdAt: string;
  ingestedAt: string;
  contentHash?: string;
  migrationBatchId?: string;
}

export interface KnowledgeRelation {
  relationId: string;
  fromId: KnowledgeId;
  toId: KnowledgeId;
  relationType: string;
  createdAt: string;
  provenance?: KnowledgeProvenance;
}

export interface KnowledgeObject<TContent = unknown> {
  id: KnowledgeId;
  projectUniverseId: ProjectUniverseId;
  type: string;
  scope: KnowledgeScope;
  ownerId?: string;
  title?: string;
  content: TContent;
  provenance: KnowledgeProvenance;
  relationIds: string[];
  validationStatus: KnowledgeValidationStatus;
  lifecycleStatus: KnowledgeLifecycleStatus;
  schemaVersion: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemoryUniverse {
  id: ProjectUniverseId;
  projectKey: string;
  displayName: string;
  description?: string;
  rootNodeId: KnowledgeId;
  status: 'active' | 'dormant' | 'archived' | 'deleted' | 'purged';
  reusable: boolean;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeQuery {
  projectUniverseIds: ProjectUniverseId[];
  text?: string;
  types?: string[];
  scopes?: KnowledgeScope[];
  ownerId?: string;
  relationTraversalDepth?: number;
  limit?: number;
  includeArchived?: boolean;
  requiredEvidence?: boolean;
}

export interface KnowledgeQueryResult {
  items: KnowledgeObject[];
  total: number;
  nextCursor?: string;
  evidenceCoverage?: number;
}

export interface MemoryIdentity {
  projectUniverseId: ProjectUniverseId;
  sessionId?: string;
  botId?: string;
  principalId: string;
  registerKind: RegisterKind;
}

export interface RegisterSnapshot<TState = unknown> {
  id: string;
  identity: MemoryIdentity;
  state: TState;
  sourceRevision?: string;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  persistedKnowledgeIds: KnowledgeId[];
}

export interface MemoryEvent<TPayload = unknown> {
  id: MemoryEventId;
  eventType: string;
  identity: MemoryIdentity;
  payload: TPayload;
  occurredAt: string;
  recordedAt: string;
  idempotencyKey: string;
  provenance: KnowledgeProvenance;
}

export interface MemoryPermissionContext {
  principalId: string;
  projectUniverseIds: ProjectUniverseId[];
  scopes: KnowledgeScope[];
  capabilities: string[];
}

export interface MemoryWriteResult {
  knowledgeId: KnowledgeId;
  created: boolean;
  version: number;
}

export interface MemoryLifecycleRequest {
  projectUniverseId: ProjectUniverseId;
  operation: 'archive' | 'restore' | 'prune' | 'detach' | 'soft_delete' | 'purge' | 'reuse' | 'fork' | 'export';
  targetIds?: KnowledgeId[];
  requestedBy: string;
  reason: string;
  dryRun?: boolean;
  includeSharedDependencies?: boolean;
}

export interface MemoryLifecyclePlan {
  request: MemoryLifecycleRequest;
  affectedKnowledgeIds: KnowledgeId[];
  protectedKnowledgeIds: KnowledgeId[];
  externalReferences: string[];
  requiresExplicitConfirmation: boolean;
  irreversible: boolean;
}
