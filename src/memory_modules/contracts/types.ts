/**
 * PKU Canonical Domain Contracts (Phase 1 — Spec v0.2 §4–§14).
 * Pure domain types with zero persistence backend coupling or runtime side effects.
 */

export const CURRENT_PKU_SCHEMA_VERSION = '1.0.0';

export type KnowledgeId = string;
export type ProjectUniverseId = string;
export type SessionMemoryId = string;
export type AgentMemoryId = string;
export type MemoryEventId = string;
export type TreeNodeId = string;
export type CheckpointId = string;

export type KnowledgeScope = 'project' | 'session' | 'agent' | 'shared' | 'cross_project';
export type KnowledgeValidationStatus = 'unverified' | 'validated' | 'rejected' | 'superseded';
export type KnowledgeLifecycleStatus = 'active' | 'dormant' | 'archived' | 'reusable' | 'deleted' | 'purged';
export type ProjectUniverseStatus = 'active' | 'dormant' | 'archived' | 'reusable' | 'deleted' | 'purged';
export type RegisterKind = 'global' | 'individual';

/**
 * Synchronization states between an operational register and PKU (Spec §13).
 */
export type RegisterSyncStatus =
  | 'persisted'
  | 'pending_persistence'
  | 'synchronization_failed'
  | 'reconciliation_required'
  | 'reconstructed';

/**
 * Hierarchical retrieval levels defined for KOE (Spec §8.3).
 * L0: Project-level index
 * L1: Domain and module summaries
 * L2: Detailed specifications and contracts
 * L3: Raw evidence, source files, logs, and records
 */
export type KnowledgeHierarchyLevel = 'L0' | 'L1' | 'L2' | 'L3';

/**
 * Standard knowledge graph relation types (Spec §5.2).
 */
export type KnowledgeRelationType =
  | 'depends_on'
  | 'implements'
  | 'derived_from'
  | 'supersedes'
  | 'validates'
  | 'contradicts'
  | 'influences'
  | 'reuses'
  | 'created_by'
  | 'executed_during'
  | (string & {});

/**
 * Standard PMU hierarchical tree domains (Spec §5.2).
 */
export type KnowledgeTreeDomain =
  | 'Identity'
  | 'Requirements'
  | 'Architecture'
  | 'Architecture/Modules'
  | 'Architecture/Components'
  | 'Architecture/Interfaces'
  | 'Development'
  | 'Experiments'
  | 'Decisions'
  | 'Tests'
  | 'Roadmap'
  | (string & {});

/**
 * ACMA individual memory cognitive domains (Spec §7.1).
 */
export type ACMAMemoryDomain =
  | 'working'
  | 'semantic'
  | 'episodic'
  | 'procedural'
  | 'retrieval'
  | 'prospective'
  | 'checkpoint'
  | 'handoff';

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
  originProjectUniverseId?: ProjectUniverseId;
}

export interface KnowledgeRelation {
  relationId: string;
  projectUniverseId?: ProjectUniverseId;
  fromId: KnowledgeId;
  toId: KnowledgeId;
  relationType: KnowledgeRelationType;
  weight?: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
  provenance?: KnowledgeProvenance;
}

/**
 * Hierarchical tree node membership (Spec §5.2).
 * Managed separately from KnowledgeRelation graph edges so pruning a tree branch
 * never destroys shared KnowledgeObject nodes still referenced elsewhere (PKU-015).
 */
export interface KnowledgeTreeNode {
  nodeId: TreeNodeId;
  projectUniverseId: ProjectUniverseId;
  parentNodeId: TreeNodeId | null;
  domainPath: KnowledgeTreeDomain;
  label: string;
  knowledgeIds: KnowledgeId[];
  childNodeIds: TreeNodeId[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeObject<TContent = unknown> {
  id: KnowledgeId;
  projectUniverseId: ProjectUniverseId;
  type: string;
  scope: KnowledgeScope;
  ownerId?: string;
  title?: string;
  summary?: string;
  hierarchyLevel?: KnowledgeHierarchyLevel;
  content: TContent;
  provenance: KnowledgeProvenance;
  relationIds: string[];
  treeNodeIds?: TreeNodeId[];
  validationStatus: KnowledgeValidationStatus;
  lifecycleStatus: KnowledgeLifecycleStatus;
  reusable?: boolean;
  schemaVersion: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProjectMemoryUniverse {
  id: ProjectUniverseId;
  projectKey: string;
  displayName: string;
  description?: string;
  rootNodeId: KnowledgeId;
  status: ProjectUniverseStatus;
  reusable: boolean;
  parentUniverseId?: ProjectUniverseId;
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
  hierarchyLevels?: KnowledgeHierarchyLevel[];
  treeDomainPrefix?: string;
  relationTraversalDepth?: number;
  limit?: number;
  cursor?: string;
  includeArchived?: boolean;
  requiredEvidence?: boolean;
}

export interface KnowledgeQueryResult {
  items: KnowledgeObject[];
  total: number;
  nextCursor?: string;
  evidenceCoverage?: number;
  traversedRelations?: KnowledgeRelation[];
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
  syncStatus?: RegisterSyncStatus;
  sourceRevision?: string;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  persistedKnowledgeIds: KnowledgeId[];
}

/**
 * Execution checkpoint for bot task continuity and recovery (Spec §7.1, §7.4).
 */
export interface ExecutionCheckpoint<TContext = unknown> {
  checkpointId: CheckpointId;
  identity: MemoryIdentity;
  taskId?: string;
  sourceMessageId?: string;
  iteration: number;
  maxIterations: number;
  status: 'in_progress' | 'paused' | 'completed' | 'failed' | 'handed_off';
  summary: string;
  workingContext: TContext;
  knowledgeRefs: KnowledgeId[];
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Structured handoff descriptor between bots (Spec §7.3, §9.2).
 */
export interface HandoffContext {
  handoffId: string;
  sessionId: string;
  projectUniverseId: ProjectUniverseId;
  sourceBotId: string;
  targetBotId: string;
  checkpointId?: CheckpointId;
  sharedKnowledgeIds: KnowledgeId[];
  instructions: string;
  createdAt: string;
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
  sessionId?: string;
  botId?: string;
  projectUniverseIds: ProjectUniverseId[];
  scopes: KnowledgeScope[];
  capabilities: string[];
  explicitSharedKnowledgeIds?: KnowledgeId[];
}

export interface MemoryWriteResult {
  knowledgeId: KnowledgeId;
  created: boolean;
  version: number;
  idempotentReplay?: boolean;
}

export type MemoryLifecycleOperation =
  | 'archive'
  | 'restore'
  | 'prune'
  | 'detach'
  | 'soft_delete'
  | 'purge'
  | 'reuse'
  | 'fork'
  | 'export'
  | 'merge';

export interface MemoryLifecycleRequest {
  projectUniverseId: ProjectUniverseId;
  operation: MemoryLifecycleOperation;
  targetIds?: KnowledgeId[];
  targetTreeNodeIds?: TreeNodeId[];
  destinationUniverseId?: ProjectUniverseId;
  requestedBy: string;
  reason: string;
  dryRun?: boolean;
  includeSharedDependencies?: boolean;
}

export interface MemoryLifecyclePlan {
  request: MemoryLifecycleRequest;
  affectedKnowledgeIds: KnowledgeId[];
  affectedTreeNodeIds?: TreeNodeId[];
  protectedKnowledgeIds: KnowledgeId[];
  externalReferences: string[];
  requiresExplicitConfirmation: boolean;
  irreversible: boolean;
}
