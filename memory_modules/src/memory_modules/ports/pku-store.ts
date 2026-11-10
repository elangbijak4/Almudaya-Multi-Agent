import type {
  KnowledgeObject,
  KnowledgeQuery,
  KnowledgeQueryResult,
  KnowledgeRelation,
  MemoryEvent,
  MemoryWriteResult,
  ProjectMemoryUniverse,
} from '../contracts/types.js';

/** Storage port; implementations are selected by a later technology ADR. */
export interface IPKUStore {
  createUniverse(universe: ProjectMemoryUniverse): Promise<void>;
  getUniverse(universeId: string): Promise<ProjectMemoryUniverse | null>;
  listUniverses(): Promise<ProjectMemoryUniverse[]>;
  putKnowledge<T>(object: KnowledgeObject<T>, idempotencyKey: string): Promise<MemoryWriteResult>;
  getKnowledge<T = unknown>(knowledgeId: string): Promise<KnowledgeObject<T> | null>;
  queryKnowledge(query: KnowledgeQuery): Promise<KnowledgeQueryResult>;
  putRelation(relation: KnowledgeRelation, idempotencyKey: string): Promise<void>;
  appendEvent(event: MemoryEvent, idempotencyKey: string): Promise<void>;
}
