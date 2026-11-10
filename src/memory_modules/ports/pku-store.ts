import type {
  KnowledgeId,
  KnowledgeObject,
  KnowledgeQuery,
  KnowledgeQueryResult,
  KnowledgeRelation,
  KnowledgeTreeNode,
  MemoryEvent,
  MemoryWriteResult,
  ProjectMemoryUniverse,
  ProjectUniverseId,
  TreeNodeId,
} from '../contracts/types.js';

/** Storage port; implementations are selected by a later technology ADR. */
export interface IPKUStore {
  createUniverse(universe: ProjectMemoryUniverse): Promise<void>;
  getUniverse(universeId: ProjectUniverseId): Promise<ProjectMemoryUniverse | null>;
  listUniverses(): Promise<ProjectMemoryUniverse[]>;
  putKnowledge<T>(object: KnowledgeObject<T>, idempotencyKey: string): Promise<MemoryWriteResult>;
  getKnowledge<T = unknown>(knowledgeId: KnowledgeId): Promise<KnowledgeObject<T> | null>;
  queryKnowledge(query: KnowledgeQuery): Promise<KnowledgeQueryResult>;
  putRelation(relation: KnowledgeRelation, idempotencyKey: string): Promise<void>;
  getRelations?(knowledgeId: KnowledgeId): Promise<KnowledgeRelation[]>;
  putTreeNode?(node: KnowledgeTreeNode, idempotencyKey: string): Promise<void>;
  getTreeNode?(nodeId: TreeNodeId): Promise<KnowledgeTreeNode | null>;
  listTreeNodes?(projectUniverseId: ProjectUniverseId): Promise<KnowledgeTreeNode[]>;
  appendEvent(event: MemoryEvent, idempotencyKey: string): Promise<void>;
  listEvents?(projectUniverseId: ProjectUniverseId, limit?: number): Promise<MemoryEvent[]>;
}
