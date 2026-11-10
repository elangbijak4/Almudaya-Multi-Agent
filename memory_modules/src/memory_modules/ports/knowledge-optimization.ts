import type { KnowledgeQuery, KnowledgeQueryResult, MemoryIdentity, MemoryPermissionContext } from '../contracts/types.js';

export interface ContextAssemblyRequest {
  identity: MemoryIdentity;
  task: string;
  tokenBudget?: number;
  permission: MemoryPermissionContext;
  legacyFallback?: string;
}

export interface AssembledKnowledgeContext {
  text: string;
  knowledgeIds: string[];
  evidenceRefs: string[];
  estimatedTokens: number;
  sufficient: boolean;
  retrievalDiagnostics: Record<string, unknown>;
}

export interface IKnowledgeOptimizationEngine {
  retrieve(query: KnowledgeQuery, permission: MemoryPermissionContext): Promise<KnowledgeQueryResult>;
  assembleContext(request: ContextAssemblyRequest): Promise<AssembledKnowledgeContext>;
}
