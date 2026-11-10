import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/core/errors.js';
import type { BotRecord } from '../../src/bot/schema.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  HandoffContextSchema,
  KnowledgeRelationSchema,
  KnowledgeTreeNodeSchema,
  MemoryLifecyclePlanSchema,
  MemoryLifecycleRequestSchema,
  ProjectMemoryUniverseSchema,
  SOURCE_OF_TRUTH_BOUNDARIES,
  SchemaEvolutionRegistry,
  canonicalizeJson,
  computeContentHash,
  deriveCheckpointId,
  deriveIdempotencyKey,
  deriveKnowledgeId,
  deriveMemoryEventId,
  deriveProjectUniverseId,
  deriveRelationId,
  deriveTreeNodeId,
  qualifiesBotRegistryMutation,
  qualifiesBroadcastForKnowledgePromotion,
  qualifiesDirectMessageForKnowledgeExtraction,
  validateContract,
  validateExecutionCheckpoint,
  validateKnowledgeObject,
  validateMemoryEvent,
  validateProjectMemoryUniverse,
  validateRegisterSnapshot,
} from '../../src/memory_modules/index.js';

describe('PKU Phase 1 — Canonical Contracts, Deterministic Identity & Ownership', () => {
  describe('PKU-001: Contract schema validation & actionable diagnostics', () => {
    it('validates a complete KnowledgeObject and preserves typed fields', () => {
      const content = {
        decision: 'Use append-only JSONL for event logs',
        rationale: 'Preserves full audit trail and crash recovery',
      };
      const contentHash = computeContentHash(content);
      const pmuId = deriveProjectUniverseId('almudaya-multiagent');
      const knowledgeId = deriveKnowledgeId({
        sourceSystem: 'blackboard',
        projectUniverseId: pmuId,
        sessionId: 'sess-001',
        sourceType: 'artifact',
        sourceRecordId: 'art-001',
      });

      const validKnowledge = {
        id: knowledgeId,
        projectUniverseId: pmuId,
        type: 'architecture_decision',
        scope: 'project' as const,
        title: 'ADR-001: Append-only Event Logs',
        summary: 'Use append-only JSONL for event logs across registers',
        hierarchyLevel: 'L2' as const,
        content,
        provenance: {
          sourceSystem: 'blackboard',
          sourceType: 'artifact',
          sourceId: 'art-001',
          sourcePath: 'sessions/sess-001/artifacts/adr-001.json',
          sourceSchemaVersion: '1.0.0',
          createdBy: 'bot-architect',
          createdAt: '2026-11-09T10:00:00.000Z',
          ingestedAt: '2026-11-09T10:00:00.000Z',
          contentHash,
          originProjectUniverseId: pmuId,
        },
        relationIds: [],
        validationStatus: 'validated' as const,
        lifecycleStatus: 'active' as const,
        reusable: true,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T10:00:00.000Z',
        tags: ['architecture', 'storage', 'jsonl'],
      };

      const validated = validateKnowledgeObject(validKnowledge);
      expect(validated.id).toBe(knowledgeId);
      expect(validated.type).toBe('architecture_decision');
      expect(validated.provenance.contentHash).toBe(contentHash);
    });

    it('rejects invalid KnowledgeObject payloads with ValidationError and field-level diagnostics', () => {
      const invalidPayload = {
        id: 'invalid id with spaces!',
        projectUniverseId: '',
        type: '',
        scope: 'agent',
        // ownerId missing when scope is 'agent'
        content: undefined,
        provenance: {
          sourceSystem: '',
          sourceType: 'artifact',
          createdAt: 'not-a-datetime',
          ingestedAt: '2026-11-09T10:00:00.000Z',
        },
        relationIds: [],
        validationStatus: 'validated',
        lifecycleStatus: 'active',
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 0,
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T10:00:00.000Z',
      };

      expect(() => validateKnowledgeObject(invalidPayload)).toThrow(ValidationError);
      try {
        validateKnowledgeObject(invalidPayload);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const msg = (err as ValidationError).message;
        expect(msg).toContain('Invalid KnowledgeObject schema');
        expect(msg).toContain('[id]');
        expect(msg).toContain('[provenance.createdAt]');
        expect(msg).toContain('[version]');
        expect(msg).toContain('[ownerId]');
      }
    });

    it('validates ProjectMemoryUniverse, MemoryEvent, RegisterSnapshot, and ExecutionCheckpoint schemas', () => {
      const pmuId = deriveProjectUniverseId('almudaya-multiagent');
      const rootNodeId = deriveTreeNodeId(pmuId, 'Identity');

      const universe = validateProjectMemoryUniverse({
        id: pmuId,
        projectKey: 'almudaya-multiagent',
        displayName: 'Almudaya Multi-Agent',
        description: 'Multi-Agent Coding Environment',
        rootNodeId,
        status: 'active',
        reusable: true,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T10:00:00.000Z',
        metadata: { version: '0.3.3' },
      });
      expect(universe.id).toBe(pmuId);

      const payloadHash = computeContentHash({ action: 'created' });
      const idempotencyKey = deriveIdempotencyKey({
        sourceSystem: 'blackboard',
        scopeId: 'sess-001',
        sourceType: 'event',
        sourceRecordId: 'ev-101',
        contentHash: payloadHash,
      });
      const eventId = deriveMemoryEventId({
        sourceSystem: 'blackboard',
        sessionId: 'sess-001',
        sourceType: 'event',
        sourceRecordId: 'ev-101',
      });

      const memoryEvent = validateMemoryEvent({
        id: eventId,
        eventType: 'KNOWLEDGE_CREATED',
        identity: {
          projectUniverseId: pmuId,
          sessionId: 'sess-001',
          botId: 'bot-1',
          principalId: 'bot-1',
          registerKind: 'global',
        },
        payload: { knowledgeId: 'pku_ko_123' },
        occurredAt: '2026-11-09T10:00:00.000Z',
        recordedAt: '2026-11-09T10:00:00.000Z',
        idempotencyKey,
        provenance: {
          sourceSystem: 'blackboard',
          sourceType: 'event',
          sourceId: 'ev-101',
          createdAt: '2026-11-09T10:00:00.000Z',
          ingestedAt: '2026-11-09T10:00:00.000Z',
          contentHash: payloadHash,
        },
      });
      expect(memoryEvent.id).toBe(eventId);

      const snapshot = validateRegisterSnapshot({
        id: 'snap_001',
        identity: {
          projectUniverseId: pmuId,
          sessionId: 'sess-001',
          principalId: 'system',
          registerKind: 'global',
        },
        state: { activeBots: 2, status: 'ACTIVE' },
        syncStatus: 'persisted',
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T10:00:00.000Z',
        persistedKnowledgeIds: [],
      });
      expect(snapshot.identity.registerKind).toBe('global');

      const checkpoint = validateExecutionCheckpoint({
        checkpointId: deriveCheckpointId('sess-001', 'bot-1', 'msg-09', 1),
        identity: {
          projectUniverseId: pmuId,
          sessionId: 'sess-001',
          botId: 'bot-1',
          principalId: 'bot-1',
          registerKind: 'individual',
        },
        taskId: 'task-1',
        sourceMessageId: 'msg-09',
        iteration: 1,
        maxIterations: 5,
        status: 'in_progress',
        summary: 'Completed Phase 0 system audit',
        workingContext: { step: 3, broadcastCursorSeq: 12 },
        knowledgeRefs: [],
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T10:00:00.000Z',
      });
      expect(checkpoint.iteration).toBe(1);
    });

    it('validates KnowledgeRelation, KnowledgeTreeNode, HandoffContext, and Lifecycle contracts', () => {
      const pmuId = deriveProjectUniverseId('almudaya-multiagent');
      const relId = deriveRelationId('pku_ko_a', 'depends_on', 'pku_ko_b');

      const relation = validateContract('KnowledgeRelation', KnowledgeRelationSchema, {
        relationId: relId,
        projectUniverseId: pmuId,
        fromId: 'pku_ko_a',
        toId: 'pku_ko_b',
        relationType: 'depends_on',
        weight: 0.8,
        createdAt: '2026-11-09T10:00:00.000Z',
      });
      expect(relation.relationId).toBe(relId);

      const nodeId = deriveTreeNodeId(pmuId, 'Architecture/Modules');
      const treeNode = validateContract('KnowledgeTreeNode', KnowledgeTreeNodeSchema, {
        nodeId,
        projectUniverseId: pmuId,
        parentNodeId: null,
        domainPath: 'Architecture/Modules',
        label: 'Architecture Modules',
        knowledgeIds: ['pku_ko_a'],
        childNodeIds: [],
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T10:00:00.000Z',
      });
      expect(treeNode.nodeId).toBe(nodeId);

      const handoff = validateContract('HandoffContext', HandoffContextSchema, {
        handoffId: 'ho_001',
        sessionId: 'sess-001',
        projectUniverseId: pmuId,
        sourceBotId: 'bot-a',
        targetBotId: 'bot-b',
        sharedKnowledgeIds: ['pku_ko_a'],
        instructions: 'Handing off implementation after architecture review',
        createdAt: '2026-11-09T10:00:00.000Z',
      });
      expect(handoff.sourceBotId).toBe('bot-a');

      const lifecycleReq = validateContract(
        'MemoryLifecycleRequest',
        MemoryLifecycleRequestSchema,
        {
          projectUniverseId: pmuId,
          operation: 'prune',
          targetIds: ['pku_ko_a'],
          targetTreeNodeIds: [nodeId],
          requestedBy: 'owner',
          reason: 'Detach superseded node from active tree',
          dryRun: true,
        }
      );
      expect(lifecycleReq.operation).toBe('prune');

      const lifecyclePlan = validateContract('MemoryLifecyclePlan', MemoryLifecyclePlanSchema, {
        request: lifecycleReq,
        affectedKnowledgeIds: ['pku_ko_a'],
        affectedTreeNodeIds: [nodeId],
        protectedKnowledgeIds: [],
        externalReferences: [],
        requiresExplicitConfirmation: false,
        irreversible: false,
      });
      expect(lifecyclePlan.irreversible).toBe(false);
    });
  });

  describe('PKU-002: Deterministic identity, canonical hashing, and secret redaction', () => {
    it('produces identical canonical JSON and SHA-256 content hash regardless of object key order', () => {
      const recordA = {
        z_field: 'alpha',
        a_field: 42,
        nested: {
          second: [1, 2, { b: 'two', a: 'one' }],
          first: true,
        },
      };
      const recordB = {
        a_field: 42,
        nested: {
          first: true,
          second: [1, 2, { a: 'one', b: 'two' }],
        },
        z_field: 'alpha',
      };

      expect(canonicalizeJson(recordA)).toBe(canonicalizeJson(recordB));
      expect(computeContentHash(recordA)).toBe(computeContentHash(recordB));
    });

    it('generates identical deterministic IDs and idempotency keys when importing the same legacy record twice', () => {
      const legacyEventA = {
        id: 'ev-legacy-001',
        seq: 7,
        type: 'TASK_ASSIGNED',
        actor_id: 'bot-lead',
        timestamp: '2026-11-09T09:00:00.000Z',
        payload: { task: 'audit', priority: 'high' },
      };
      const legacyEventB = {
        timestamp: '2026-11-09T09:00:00.000Z',
        actor_id: 'bot-lead',
        payload: { priority: 'high', task: 'audit' },
        type: 'TASK_ASSIGNED',
        seq: 7,
        id: 'ev-legacy-001',
      };

      const pmuId1 = deriveProjectUniverseId('Almudaya-MultiAgent');
      const pmuId2 = deriveProjectUniverseId('  almudaya-multiagent  ');
      expect(pmuId1).toBe(pmuId2);

      const hash1 = computeContentHash(legacyEventA);
      const hash2 = computeContentHash(legacyEventB);
      expect(hash1).toBe(hash2);

      const koId1 = deriveKnowledgeId({
        sourceSystem: 'Blackboard',
        projectUniverseId: pmuId1,
        sourceType: 'EVENT',
        sourceRecordId: legacyEventA.id,
      });
      const koId2 = deriveKnowledgeId({
        sourceSystem: 'blackboard',
        projectUniverseId: pmuId2,
        sourceType: 'event',
        sourceRecordId: legacyEventB.id,
      });
      expect(koId1).toBe(koId2);

      const idemKey1 = deriveIdempotencyKey({
        sourceSystem: 'blackboard',
        scopeId: pmuId1,
        sourceType: 'event',
        sourceRecordId: legacyEventA.id,
        contentHash: hash1,
      });
      const idemKey2 = deriveIdempotencyKey({
        sourceSystem: 'BLACKBOARD',
        scopeId: pmuId2,
        sourceType: 'EVENT',
        sourceRecordId: legacyEventB.id,
        contentHash: hash2,
      });
      expect(idemKey1).toBe(idemKey2);

      const memEvId1 = deriveMemoryEventId({
        sourceSystem: 'blackboard',
        sessionId: 'sess-001',
        sourceType: 'event',
        sourceRecordId: legacyEventA.id,
      });
      const memEvId2 = deriveMemoryEventId({
        sourceSystem: 'BLACKBOARD',
        sessionId: 'sess-001',
        sourceType: 'EVENT',
        sourceRecordId: legacyEventB.id,
      });
      expect(memEvId1).toBe(memEvId2);
    });

    it('redacts sensitive secrets before computing content hashes', () => {
      const payloadWithRawSecret = {
        summary: 'Configured GitHub token and custom secret',
        token: 'ghp_' + '1234567890abcdefghijklmnopqrstuvwxyzABCD',
        custom: 'my-super-secret-value-999',
      };
      const payloadAlreadyRedacted = {
        summary: 'Configured GitHub token and custom secret',
        token: '[REDACTED_TOKEN]',
        custom: '[REDACTED_SECRET]',
      };

      expect(computeContentHash(payloadWithRawSecret, ['my-super-secret-value-999'])).toBe(
        computeContentHash(payloadAlreadyRedacted)
      );
    });
  });

  describe('Ownership Boundaries & Persistence Qualification Policies (RISK-03 mitigation)', () => {
    it('defines explicit source-of-truth boundaries for all 10 operational and persistent domains', () => {
      const domains = Object.keys(SOURCE_OF_TRUTH_BOUNDARIES);
      expect(domains).toHaveLength(10);
      expect(SOURCE_OF_TRUTH_BOUNDARIES.source_code.pkuMayPhysicallyDeleteSource).toBe(false);
      expect(
        SOURCE_OF_TRUTH_BOUNDARIES.project_knowledge_representation.pkuMayPhysicallyDeleteSource
      ).toBe(true);
      expect(SOURCE_OF_TRUTH_BOUNDARIES.message_delivery_state.pkuMayPhysicallyDeleteSource).toBe(
        false
      );
    });

    it('filters out 2-second heartbeat-only mutations in qualifiesBotRegistryMutation', () => {
      const previousBot: BotRecord = {
        bot_id: 'bot-1',
        session_id: 'sess-1',
        display_name: 'Builder Bot',
        status: 'ACTIVE',
        pid: 1234,
        registered_at: '2026-11-09T10:00:00.000Z',
        last_seen_at: '2026-11-09T10:00:00.000Z',
        metadata: { role: 'coder' },
      };

      const heartbeatOnlyUpdate: BotRecord = {
        ...previousBot,
        last_seen_at: '2026-11-09T10:00:02.000Z',
      };

      expect(qualifiesBotRegistryMutation(previousBot, heartbeatOnlyUpdate)).toBe(false);

      // Initial registration qualifies
      expect(qualifiesBotRegistryMutation(undefined, previousBot)).toBe(true);

      // Status transition qualifies
      const statusChanged: BotRecord = {
        ...heartbeatOnlyUpdate,
        status: 'OFFLINE',
      };
      expect(qualifiesBotRegistryMutation(previousBot, statusChanged)).toBe(true);

      // Metadata change qualifies
      const metadataChanged: BotRecord = {
        ...heartbeatOnlyUpdate,
        metadata: { role: 'reviewer' },
      };
      expect(qualifiesBotRegistryMutation(previousBot, metadataChanged)).toBe(true);
    });

    it('qualifies broadcasts and direct messages accurately for knowledge promotion', () => {
      expect(qualifiesBroadcastForKnowledgePromotion('INFO')).toBe(false);
      expect(qualifiesBroadcastForKnowledgePromotion('DECISION')).toBe(true);
      expect(qualifiesBroadcastForKnowledgePromotion('ARTIFACT')).toBe(true);
      expect(qualifiesBroadcastForKnowledgePromotion('OBSERVATION')).toBe(true);

      expect(qualifiesDirectMessageForKnowledgeExtraction({ metadata: {} })).toBe(false);
      expect(
        qualifiesDirectMessageForKnowledgeExtraction({
          metadata: { promoteToKnowledge: true },
        })
      ).toBe(true);
      expect(
        qualifiesDirectMessageForKnowledgeExtraction({
          metadata: { knowledgeRefs: ['pku_ko_123'] },
        })
      ).toBe(true);
    });
  });

  describe('SchemaEvolutionRegistry', () => {
    it('migrates payloads across sequential schema versions and validates with target schema', () => {
      const registry = new SchemaEvolutionRegistry();
      registry.registerStep('ProjectMemoryUniverse', {
        fromVersion: '0.9.0',
        toVersion: '1.0.0',
        migrate: (raw) => ({
          ...raw,
          reusable: Boolean(raw['reusable'] ?? false),
        }),
      });

      const pmuId = deriveProjectUniverseId('almudaya-multiagent');
      const rootNodeId = deriveTreeNodeId(pmuId, 'Identity');
      const legacyUniverse = {
        id: pmuId,
        projectKey: 'almudaya-multiagent',
        displayName: 'Legacy Universe',
        rootNodeId,
        status: 'active',
        schemaVersion: '0.9.0',
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T10:00:00.000Z',
        metadata: {},
      };

      const upgraded = registry.upgradeToVersion(
        'ProjectMemoryUniverse',
        legacyUniverse,
        CURRENT_PKU_SCHEMA_VERSION
      );
      const validated = validateProjectMemoryUniverse(upgraded);
      expect(validated.schemaVersion).toBe('1.0.0');
      expect(validated.reusable).toBe(false);
    });

    it('throws ValidationError when no migration path exists', () => {
      const registry = new SchemaEvolutionRegistry();
      expect(() =>
        registry.upgradeToVersion('ProjectMemoryUniverse', { schemaVersion: '0.1.0' }, '1.0.0')
      ).toThrow(ValidationError);
    });
  });
});
