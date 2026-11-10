import { describe, expect, it } from 'vitest';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  deriveKnowledgeId,
  deriveProjectUniverseId,
  deriveRelationId,
  InMemoryPKUStore,
  KnowledgeOptimizationEngine,
  type KnowledgeObject,
  type MemoryIdentity,
  type MemoryPermissionContext,
} from '../../src/memory_modules/index.js';

describe('Phase 6: Knowledge Optimization Engine — KOE (PKU-012, PKU-013, PKU-008, PKU-009)', () => {
  const sessionId = 'S_PHASE6_KOE';
  const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);

  function createBotPermission(
    botId: string,
    explicitSharedKnowledgeIds: string[] = []
  ): MemoryPermissionContext {
    return {
      principalId: botId,
      sessionId,
      botId,
      projectUniverseIds: [pmuId],
      scopes: ['project', 'session', 'agent', 'shared'],
      capabilities: [],
      explicitSharedKnowledgeIds,
    };
  }

  function createBotIdentity(botId: string): MemoryIdentity {
    return {
      projectUniverseId: pmuId,
      sessionId,
      botId,
      principalId: botId,
      registerKind: 'individual',
    };
  }

  it('PKU-012: assembles evidence-grounded context within constrained token budget, compresses when needed, and reports explicit insufficient result + legacyFallback when budget is too small', async () => {
    const store = new InMemoryPKUStore();
    const koe = new KnowledgeOptimizationEngine(store);

    const l0Id = deriveKnowledgeId({
      sourceSystem: 'almudaya.koe_test',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'arch.index',
      sourceRecordId: 'idx_0',
    });
    const l2Id = deriveKnowledgeId({
      sourceSystem: 'almudaya.koe_test',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'arch.contract',
      sourceRecordId: 'contract_2',
    });

    const l0Index: KnowledgeObject = {
      id: l0Id,
      projectUniverseId: pmuId,
      type: 'arch.index',
      scope: 'project',
      hierarchyLevel: 'L0',
      title: 'Authentication Module Index',
      summary: 'JWT authentication uses RS256 signing and token rotation.',
      content: {
        overview:
          'JWT authentication module handles RS256 token verification, refresh token rotation, and session revocation across API gateway endpoints.',
        leakedCanary: 'AIzaSy' + 'D-1234567890abcdefghijklmnopqrstuvwx',
      },
      tags: ['authentication', 'jwt', 'rs256'],
      provenance: {
        sourceSystem: 'almudaya.koe_test',
        sourceType: 'arch.index',
        sourceId: 'idx_0',
        sourcePath: 'docs/auth/INDEX.md',
        createdAt: '2026-11-09T19:00:00.000Z',
        ingestedAt: '2026-11-09T19:00:00.000Z',
        originProjectUniverseId: pmuId,
      },
      relationIds: [],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: '2026-11-09T19:00:00.000Z',
      updatedAt: '2026-11-09T19:00:00.000Z',
    };

    const l2Contract: KnowledgeObject = {
      id: l2Id,
      projectUniverseId: pmuId,
      type: 'arch.contract',
      scope: 'project',
      hierarchyLevel: 'L2',
      title: 'JWT Verifier Interface Specification',
      summary: 'Defines verifyToken(jwt) and rotateRefreshToken(tokenId).',
      content: {
        interfaceSpec:
          'export interface IJwtVerifier { verifyToken(jwt: string): Promise<Claims>; rotateRefreshToken(tokenId: string): Promise<TokenPair>; revokeSession(sessionId: string): Promise<void>; }',
        notes: 'Must enforce clock skew tolerance <= 5 seconds and reject alg=none.',
      },
      tags: ['authentication', 'jwt', 'contract'],
      provenance: {
        sourceSystem: 'almudaya.koe_test',
        sourceType: 'arch.contract',
        sourceId: 'contract_2',
        sourcePath: 'src/auth/verifier.ts',
        createdAt: '2026-11-09T19:01:00.000Z',
        ingestedAt: '2026-11-09T19:01:00.000Z',
        originProjectUniverseId: pmuId,
      },
      relationIds: [],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: '2026-11-09T19:01:00.000Z',
      updatedAt: '2026-11-09T19:01:00.000Z',
    };

    await store.putKnowledge(l0Index, 'idem_koe_l0');
    await store.putKnowledge(l2Contract, 'idem_koe_l2');

    const permission = createBotPermission('BOT001');
    const identity = createBotIdentity('BOT001');

    // 1. Moderate token budget (120 tokens): fits L0 + compressed L2, sufficient=true, secrets redacted
    const assembledModerate = await koe.assembleContext({
      identity,
      task: 'Implement JWT authentication verifier and token rotation',
      tokenBudget: 120,
      permission,
    });

    expect(assembledModerate.sufficient).toBe(true);
    expect(assembledModerate.estimatedTokens).toBeLessThanOrEqual(120);
    expect(assembledModerate.knowledgeIds).toContain(l0Id);
    expect(assembledModerate.evidenceRefs.length).toBeGreaterThanOrEqual(1);
    expect(assembledModerate.text).not.toContain('AIzaSy' + 'D-1234567890abcdefghijklmnopqrstuvwx');

    // 2. Extremely constrained token budget (5 tokens): cannot fit any evidence-backed block -> sufficient=false + legacyFallback preserved
    const assembledTiny = await koe.assembleContext({
      identity,
      task: 'Implement JWT authentication verifier and token rotation',
      tokenBudget: 5,
      permission,
      legacyFallback: 'LEGACY_PROMPT_CONTEXT_FALLBACK',
    });

    expect(assembledTiny.sufficient).toBe(false);
    expect(assembledTiny.knowledgeIds).toHaveLength(0);
    expect(assembledTiny.retrievalDiagnostics['droppedForBudgetCount']).toBeGreaterThan(0);
    expect(assembledTiny.retrievalDiagnostics['insufficiencyReason']).toContain('Token budget (5)');
    expect(assembledTiny.retrievalDiagnostics['legacyFallbackUsed']).toBe(true);
    expect(assembledTiny.text).toBe('LEGACY_PROMPT_CONTEXT_FALLBACK');
  });

  it('PKU-013: detects stale compiled summary when underlying raw L3 evidence has a newer version and refreshes from raw evidence', async () => {
    const store = new InMemoryPKUStore();
    const koe = new KnowledgeOptimizationEngine(store);

    const rawEvidenceId = deriveKnowledgeId({
      sourceSystem: 'almudaya.koe_test',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'raw.config',
      sourceRecordId: 'raw_db_config',
    });

    const compiledSummaryId = deriveKnowledgeId({
      sourceSystem: 'almudaya.koe_test',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'summary.config',
      sourceRecordId: 'sum_db_config',
    });

    // Initial raw evidence (v1) then updated to v2 with new pool size (maxPoolSize = 50)
    const rawEvidenceV1: KnowledgeObject = {
      id: rawEvidenceId,
      projectUniverseId: pmuId,
      type: 'raw.config',
      scope: 'project',
      hierarchyLevel: 'L3',
      title: 'Database Connection Pool Raw Evidence',
      summary: 'Raw database pool configuration (maxPoolSize=10)',
      content: { maxPoolSize: 10, timeoutMs: 5000 },
      tags: ['database', 'pool', 'config'],
      provenance: {
        sourceSystem: 'almudaya.koe_test',
        sourceType: 'raw.config',
        sourceId: 'raw_db_config',
        sourcePath: 'config/database.json',
        createdAt: '2026-11-09T18:00:00.000Z',
        ingestedAt: '2026-11-09T18:00:00.000Z',
        originProjectUniverseId: pmuId,
      },
      relationIds: [],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: '2026-11-09T18:00:00.000Z',
      updatedAt: '2026-11-09T18:00:00.000Z',
    };

    await store.putKnowledge(rawEvidenceV1, 'idem_raw_v1');

    // Compiled L1 summary created from rawEvidence v1
    const relId = deriveRelationId(compiledSummaryId, 'derived_from', rawEvidenceId);
    const staleSummary: KnowledgeObject = {
      id: compiledSummaryId,
      projectUniverseId: pmuId,
      type: 'summary.config',
      scope: 'project',
      hierarchyLevel: 'L1',
      title: 'Database Pool Compiled Summary',
      summary: 'STALE SUMMARY: Database pool uses maxPoolSize=10.',
      content: 'STALE SUMMARY: Database pool uses maxPoolSize=10.',
      tags: ['database', 'pool', 'summary'],
      provenance: {
        sourceSystem: 'almudaya.koe_test',
        sourceType: 'summary.config',
        sourceId: 'sum_db_config',
        createdAt: '2026-11-09T18:05:00.000Z',
        ingestedAt: '2026-11-09T18:05:00.000Z',
        originProjectUniverseId: pmuId,
      },
      relationIds: [relId],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: '2026-11-09T18:05:00.000Z',
      updatedAt: '2026-11-09T18:05:00.000Z',
      metadata: {
        compiledFromSourceVersion: 1,
        sourceEvidenceIds: [rawEvidenceId],
      },
    };

    await store.putKnowledge(staleSummary, 'idem_sum_v1');
    await store.putRelation(
      {
        relationId: relId,
        projectUniverseId: pmuId,
        fromId: compiledSummaryId,
        toId: rawEvidenceId,
        relationType: 'derived_from',
        createdAt: '2026-11-09T18:05:00.000Z',
        metadata: { sourceVersion: 1 },
      },
      'idem_rel_sum_raw'
    );

    // Raw evidence is updated to v2 (maxPoolSize = 50) at 19:10:00Z!
    const rawEvidenceV2: KnowledgeObject = {
      ...rawEvidenceV1,
      summary: 'Updated raw database pool configuration (maxPoolSize=50)',
      content: { maxPoolSize: 50, timeoutMs: 10000 },
      version: 2,
      updatedAt: '2026-11-09T19:10:00.000Z',
    };
    await store.putKnowledge(rawEvidenceV2, 'idem_raw_v2');

    const permission = createBotPermission('BOT001');
    const identity = createBotIdentity('BOT001');

    const assembled = await koe.assembleContext({
      identity,
      task: 'Configure database connection pool size',
      tokenBudget: 500,
      permission,
    });

    expect(assembled.sufficient).toBe(true);
    // Stale summary MUST be excluded and replaced by rawEvidenceV2
    expect(assembled.knowledgeIds).not.toContain(compiledSummaryId);
    expect(assembled.knowledgeIds).toContain(rawEvidenceId);
    expect(assembled.text).not.toContain('STALE SUMMARY');
    expect(assembled.text).toContain('maxPoolSize":50');
    expect(assembled.retrievalDiagnostics['staleSummaryIds']).toContain(compiledSummaryId);
    expect(assembled.retrievalDiagnostics['refreshedFromRawEvidenceIds']).toContain(rawEvidenceId);
  });

  it('PKU-009 & Shadow Comparison: enforces permission isolation during KOE retrieval and supports Gate 5 shadow context comparison', async () => {
    const store = new InMemoryPKUStore();
    const koe = new KnowledgeOptimizationEngine(store);

    const bot2PrivateId = deriveKnowledgeId({
      sourceSystem: 'almudaya.koe_test',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'acma.working',
      sourceRecordId: 'bot2_priv_note',
    });

    const sharedProjectId = deriveKnowledgeId({
      sourceSystem: 'almudaya.koe_test',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'arch.decision',
      sourceRecordId: 'shared_dec_1',
    });

    await store.putKnowledge(
      {
        id: bot2PrivateId,
        projectUniverseId: pmuId,
        type: 'acma.working',
        scope: 'agent',
        ownerId: 'BOT002',
        hierarchyLevel: 'L2',
        title: 'BOT002 Private Caching Scratchpad',
        summary: 'Private working notes on Redis caching strategy',
        content: { secretPlan: 'Only BOT002 can read this' },
        tags: ['caching', 'redis'],
        provenance: {
          sourceSystem: 'almudaya.koe_test',
          sourceType: 'acma.working',
          sourceId: 'bot2_priv_note',
          createdBy: 'BOT002',
          createdAt: '2026-11-09T19:20:00.000Z',
          ingestedAt: '2026-11-09T19:20:00.000Z',
          originProjectUniverseId: pmuId,
        },
        relationIds: [],
        validationStatus: 'validated',
        lifecycleStatus: 'active',
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: '2026-11-09T19:20:00.000Z',
        updatedAt: '2026-11-09T19:20:00.000Z',
      },
      'idem_bot2_priv'
    );

    await store.putKnowledge(
      {
        id: sharedProjectId,
        projectUniverseId: pmuId,
        type: 'arch.decision',
        scope: 'project',
        hierarchyLevel: 'L1',
        title: 'Project Caching Architecture Decision',
        summary: 'Use write-through Redis cache with 60s TTL.',
        content: { strategy: 'write-through', ttlSeconds: 60 },
        tags: ['caching', 'redis'],
        provenance: {
          sourceSystem: 'almudaya.koe_test',
          sourceType: 'arch.decision',
          sourceId: 'shared_dec_1',
          createdAt: '2026-11-09T19:21:00.000Z',
          ingestedAt: '2026-11-09T19:21:00.000Z',
          originProjectUniverseId: pmuId,
        },
        relationIds: [],
        validationStatus: 'validated',
        lifecycleStatus: 'active',
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: '2026-11-09T19:21:00.000Z',
        updatedAt: '2026-11-09T19:21:00.000Z',
      },
      'idem_shared_dec'
    );

    const bot1Permission = createBotPermission('BOT001');
    const bot1Identity = createBotIdentity('BOT001');

    // BOT001 retrieves caching knowledge -> receives sharedProjectId, NEVER bot2PrivateId (PKU-009)
    const retrieveResult = await koe.retrieve(
      {
        projectUniverseIds: [pmuId],
        text: 'Redis',
      },
      bot1Permission
    );
    expect(retrieveResult.items.map((i) => i.id)).toEqual([sharedProjectId]);
    expect(retrieveResult.items.map((i) => i.id)).not.toContain(bot2PrivateId);

    // Shadow context comparison against verbose legacy prompt context
    const verboseLegacyPrompt = Array.from({ length: 20 })
      .map((_, idx) => `Legacy log line ${idx}: discussing Redis caching strategy and TTL settings in detail.`)
      .join('\n');

    const comparison = await koe.compareShadowContext(
      {
        identity: bot1Identity,
        task: 'Implement Redis caching strategy with TTL',
        tokenBudget: 256,
        permission: bot1Permission,
      },
      verboseLegacyPrompt
    );

    expect(comparison.sufficient).toBe(true);
    expect(comparison.evidenceCoverage).toBe(1);
    expect(comparison.koeEstimatedTokens).toBeLessThan(comparison.legacyEstimatedTokens);
    expect(comparison.tokenCompressionRatio).toBeLessThan(1);
    expect(comparison.koeContext.text).not.toContain('Only BOT002 can read this');
  });
});
