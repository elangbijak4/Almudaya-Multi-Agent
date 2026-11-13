import type { ToolDefinition } from '../ai/provider.js';
import {
  deriveProjectUniverseId,
  type KnowledgeHierarchyLevel,
  type MemoryPermissionContext,
  type MemoryRuntime,
} from '../memory_modules/index.js';

export const QUERY_PKU_MEMORY_TOOL: ToolDefinition = {
  name: 'query_pku_memory',
  description:
    'Membaca pengetahuan terkompresi proyek dari PKU (Project Map L0, Module Summary L1, File & Symbol Summary L2, dan Knowledge Graph dependensi). WAJIB dipanggil lebih dulu sebelum membaca file penuh dengan read_file saat mengaudit atau mengkode.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Kata kunci atau topik yang dicari (mis. "auth", "quantum-engine", "schema").',
      },
      level: {
        type: 'string',
        enum: ['auto', 'L0', 'L1', 'L2', 'L3'],
        description:
          'Level abstraksi: "L0" (peta proyek), "L1" (ringkasan modul), "L2" (ringkasan file & simbol), "L3" (bukti mentah), atau "auto" (KOE bertingkat sesuai token budget). Default: "auto".',
      },
      root_id: {
        type: 'string',
        description: 'Filter ke ID project root tertentu (opsional).',
      },
      file_path: {
        type: 'string',
        description:
          'Path relatif atau fragmen path file untuk melihat ringkasan simbol & graf dependensi file tersebut (opsional).',
      },
      relation_depth: {
        type: 'number',
        description: 'Kedalaman penelusuran graf dependensi BFS (0..3, default: 1).',
      },
      token_budget: {
        type: 'number',
        description: 'Batas anggaran token perakitan konteks KOE (default: 3000).',
      },
    },
  },
};

export interface QueryPkuMemoryArgs {
  query?: string;
  level?: 'auto' | KnowledgeHierarchyLevel;
  root_id?: string;
  file_path?: string;
  relation_depth?: number;
  token_budget?: number;
}

export async function executeQueryPkuMemory(
  memoryRuntime: MemoryRuntime | undefined,
  sessionId: string,
  botId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!memoryRuntime || !memoryRuntime.enabled) {
    return {
      available: false,
      message: 'PKU MemoryRuntime is not active or disabled in this workspace.',
      items: [],
    };
  }

  const typedArgs: QueryPkuMemoryArgs = {
    query: typeof args['query'] === 'string' ? args['query'] : undefined,
    level:
      typeof args['level'] === 'string' &&
      ['auto', 'L0', 'L1', 'L2', 'L3'].includes(args['level'])
        ? (args['level'] as QueryPkuMemoryArgs['level'])
        : 'auto',
    root_id: typeof args['root_id'] === 'string' ? args['root_id'] : undefined,
    file_path: typeof args['file_path'] === 'string' ? args['file_path'] : undefined,
    relation_depth:
      typeof args['relation_depth'] === 'number'
        ? Math.max(0, Math.min(3, Math.floor(args['relation_depth'])))
        : 1,
    token_budget:
      typeof args['token_budget'] === 'number'
        ? Math.max(256, Math.min(16000, Math.floor(args['token_budget'])))
        : 3000,
  };

  const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);
  const permissionContext: MemoryPermissionContext = {
    principalId: botId,
    sessionId,
    botId,
    projectUniverseIds: [pmuId],
    scopes: ['project', 'session', 'agent', 'shared'],
    capabilities: ['memory:read'],
  };

  // Specific level or file_path lookup via PKU store + Knowledge Graph
  if (typedArgs.file_path || (typedArgs.level && typedArgs.level !== 'auto')) {
    const hierarchyLevels =
      typedArgs.level && typedArgs.level !== 'auto' ? [typedArgs.level] : undefined;
    const textFilter = typedArgs.file_path ?? typedArgs.query;

    const queryRes = await memoryRuntime.pkuStore.queryKnowledge({
      projectUniverseIds: [pmuId],
      text: textFilter,
      ownerId: typedArgs.root_id,
      hierarchyLevels,
      scopes: ['project', 'session', 'shared'],
      relationTraversalDepth: typedArgs.relation_depth,
      limit: 25,
    });

    const items = queryRes.items.map((item) => ({
      id: item.id,
      level: item.hierarchyLevel ?? 'L2',
      type: item.type,
      title: item.title,
      summary: item.summary,
      sourcePath: item.provenance.sourcePath,
      contentHash: item.provenance.contentHash,
      content: item.hierarchyLevel === 'L0' || item.hierarchyLevel === 'L1' || typedArgs.file_path ? item.content : undefined,
    }));

    return {
      available: true,
      mode: typedArgs.file_path ? 'file_and_graph' : `level_${typedArgs.level}`,
      total: queryRes.total,
      items,
      relations: (queryRes.traversedRelations ?? []).map((r) => ({
        type: r.relationType,
        fromId: r.fromId,
        toId: r.toId,
        metadata: r.metadata,
      })),
    };
  }

  // Default 'auto': KOE progressive context assembly within token budget
  const assembled = await memoryRuntime.koe.assembleContext({
    identity: {
      principalId: botId,
      registerKind: 'individual',
      projectUniverseId: pmuId,
      sessionId,
      botId,
    },
    task: typedArgs.query ?? 'project overview architecture codebase',
    tokenBudget: typedArgs.token_budget,
    permission: permissionContext,
  });

  // Also include L0 project maps and graph-linked knowledge if KOE didn't include them yet
  const maps = await memoryRuntime.pkuStore.queryKnowledge({
    projectUniverseIds: [pmuId],
    types: ['codebase.project_map'],
    ownerId: typedArgs.root_id,
    hierarchyLevels: ['L0'],
    limit: 5,
  });

  return {
    available: true,
    mode: 'koe_auto',
    sufficient: assembled.sufficient,
    estimatedTokens: assembled.estimatedTokens,
    tokenBudget: typedArgs.token_budget,
    assembledContext: assembled.text,
    knowledgeIds: assembled.knowledgeIds,
    evidenceRefs: assembled.evidenceRefs,
    projectMaps: maps.items.map((m) => ({
      title: m.title,
      summary: m.summary,
      content: m.content,
    })),
    diagnostics: assembled.retrievalDiagnostics,
  };
}
