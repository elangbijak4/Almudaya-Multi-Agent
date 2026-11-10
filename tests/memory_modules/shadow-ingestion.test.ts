import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { SessionService } from '../../src/session/service.js';
import { SharedContextService } from '../../src/shared/service.js';
import { WorkLogService } from '../../src/shared/work-log.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  DurableOutboxQueue,
  InMemoryPKUStore,
  LocalFilesystemPKUStore,
  ReadOnlyBlackboardCompatibilityBridge,
  ShadowIngestionService,
  ShadowReconciliationService,
  computeDirectoryManifest,
  deriveKnowledgeId,
  deriveProjectUniverseId,
} from '../../src/memory_modules/index.js';

describe('PKU Phase 3 — Local PKU Store, Shadow Ingestion, Outbox Replay & Reconciliation (PKU-002, PKU-008, PKU-018)', { timeout: 25000 }, () => {
  let tempRoot: string;
  let pkuDir: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  let sharedContextService: SharedContextService;
  let workLogService: WorkLogService;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-pku-phase3-'));
    pkuDir = path.join(tempRoot, 'pku');
    storage = new FilesystemSessionStorage(tempRoot);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage);
    sharedContextService = new SharedContextService(storage);
    workLogService = new WorkLogService(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore Windows cleanup errors
    }
  });

  async function seedLegacySession(sessionId = 'S_PHASE3_SHADOW'): Promise<void> {
    await sessionService.createSession({
      sessionId,
      sessionName: 'Phase 3 Shadow Ingestion Session',
      description: 'Verifies idempotent shadow ingestion, outbox replay, and reconciliation',
    });

    await sharedContextService.registerProjectRoot(sessionId, {
      rootId: 'almudaya-core',
      name: 'Almudaya Core',
      path: tempRoot,
      rootType: 'primary',
      description: 'Primary repository root',
    });

    await sharedContextService.registerDocument(sessionId, {
      documentId: 'doc-pku-003',
      title: 'PKU Phase 3 Storage ADR',
      documentType: 'ARCHITECTURE',
      uriOrPath: 'memory_modules/MIGRATION/ADR_003.md',
      version: '1.0.0',
      status: 'approved',
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT001',
      displayName: 'lead_bot',
      description: 'Lead Architect Bot',
      status: 'active',
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT002',
      displayName: 'worker_bot',
      description: 'Worker Implementation Bot',
      status: 'active',
    });

    await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'BOT001',
      category: 'DECISION',
      content: 'Use LocalFilesystemPKUStore for local-first shadow ingestion',
    });

    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT001',
      recipient: 'BOT002',
      messageType: 'REQUEST',
      content: 'Verify shadow reconciliation counts and hashes',
      metadata: { promoteToKnowledge: true },
    });

    await workLogService.recordWork(sessionId, {
      botId: 'BOT002',
      botName: 'worker_bot',
      actionType: 'WRITE',
      targetRootId: 'almudaya-core',
      targetRootName: 'Almudaya Core',
      targetRootPath: tempRoot,
      relativePath: 'src/memory_modules/pku/local-store.ts',
      summary: 'Implemented LocalFilesystemPKUStore and InMemoryPKUStore',
    });
  }

  it('PKU-002: idempotent shadow ingestion into LocalFilesystemPKUStore and full reconciliation parity', async () => {
    const sessionId = 'S_PHASE3_SHADOW';
    await seedLegacySession(sessionId);

    const legacySessionDir = storage.getSessionDir(sessionId);
    const legacyManifestBefore = await computeDirectoryManifest(legacySessionDir);

    const bridge = new ReadOnlyBlackboardCompatibilityBridge(storage, {
      ingestedAt: '2026-11-09T16:00:00.000Z',
      migrationBatchId: 'batch_phase3_001',
    });
    const bundle = await bridge.exportSession(sessionId);

    const pkuStore = new LocalFilesystemPKUStore(pkuDir);
    const ingestion = new ShadowIngestionService(pkuStore);

    // First shadow ingestion pass
    const firstResult = await ingestion.ingestExportBundle(bundle);
    expect(firstResult.completed).toBe(true);
    expect(firstResult.pendingOutboxCount).toBe(0);
    expect(firstResult.createdKnowledgeCount).toBe(bundle.knowledgeObjects.length);
    expect(firstResult.replayedKnowledgeCount).toBe(0);

    // Second shadow ingestion pass with a fresh outbox (re-importing the exact same bundle)
    const secondIngestion = new ShadowIngestionService(pkuStore, new DurableOutboxQueue());
    const secondResult = await secondIngestion.ingestExportBundle(bundle);
    expect(secondResult.completed).toBe(true);
    expect(secondResult.createdKnowledgeCount).toBe(0);
    expect(secondResult.replayedKnowledgeCount).toBe(bundle.knowledgeObjects.length);

    // Reconciliation check against LocalFilesystemPKUStore
    const reconciler = new ShadowReconciliationService(pkuStore);
    const report = await reconciler.reconcile(bundle);
    expect(report.reconciled).toBe(true);
    expect(report.duplicateIds).toHaveLength(0);
    expect(report.hashMismatches).toHaveLength(0);
    expect(report.orderingPreserved).toBe(true);
    expect(report.ownershipMismatches).toHaveLength(0);
    expect(report.danglingRelations).toHaveLength(0);
    expect(report.scopeMismatches).toHaveLength(0);
    expect(report.counts.actualKnowledgeObjects).toBe(bundle.knowledgeObjects.length);
    expect(report.counts.actualMemoryEvents).toBe(bundle.memoryEvents.length);

    // Verify legacy session directory was untouched during shadow ingestion (PKU-005)
    const legacyManifestAfter = await computeDirectoryManifest(legacySessionDir);
    expect(legacyManifestAfter).toEqual(legacyManifestBefore);
  });

  it('PKU-018: interrupted batch replay resumes from durable outbox without duplicating records', async () => {
    const sessionId = 'S_PHASE3_INTERRUPTED';
    await seedLegacySession(sessionId);

    const bridge = new ReadOnlyBlackboardCompatibilityBridge(storage, {
      ingestedAt: '2026-11-09T16:10:00.000Z',
      migrationBatchId: 'batch_phase3_interrupt',
    });
    const bundle = await bridge.exportSession(sessionId);

    const outboxFile = path.join(pkuDir, 'outbox', 'shadow_outbox.json');
    const pkuStore1 = new LocalFilesystemPKUStore(pkuDir);
    const outbox1 = new DurableOutboxQueue(outboxFile);
    const ingestion1 = new ShadowIngestionService(pkuStore1, outbox1);

    // Simulate interruption after 5 operations
    const partialResult = await ingestion1.ingestExportBundle(bundle, {
      stopAfterOperations: 5,
    });
    expect(partialResult.completed).toBe(false);
    expect(partialResult.operationsExecuted).toBe(5);
    expect(partialResult.pendingOutboxCount).toBeGreaterThan(0);

    // Simulate process restart: instantiate new store, reload durable outbox from disk, and replay
    const pkuStore2 = new LocalFilesystemPKUStore(pkuDir);
    const outbox2 = new DurableOutboxQueue(outboxFile);
    const ingestion2 = new ShadowIngestionService(pkuStore2, outbox2);

    const resumedResult = await ingestion2.ingestExportBundle(bundle);
    expect(resumedResult.completed).toBe(true);
    expect(resumedResult.pendingOutboxCount).toBe(0);

    // Verify reconciliation after interrupted replay: zero duplicates, 100% parity
    const reconciler = new ShadowReconciliationService(pkuStore2);
    const report = await reconciler.reconcile(bundle);
    expect(report.reconciled).toBe(true);
    expect(report.duplicateIds).toHaveLength(0);
    expect(report.counts.actualKnowledgeObjects).toBe(bundle.knowledgeObjects.length);
    expect(report.counts.actualMemoryEvents).toBe(bundle.memoryEvents.length);
  });

  it('PKU-008: LocalFilesystemPKUStore redacts raw secrets on disk across objects, events, and snapshots', async () => {
    const pmuId = deriveProjectUniverseId('secret-test-pmu');
    const store = new LocalFilesystemPKUStore(pkuDir, {
      customSecrets: ['custom-db-password-98765'],
    });

    await store.createUniverse({
      id: pmuId,
      projectKey: 'secret-test-pmu',
      displayName: 'Secret Redaction Test PMU',
      rootNodeId: 'pku_tree_root',
      status: 'active',
      reusable: false,
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      createdAt: '2026-11-09T16:20:00.000Z',
      updatedAt: '2026-11-09T16:20:00.000Z',
      metadata: {},
    });

    const koId = deriveKnowledgeId({
      sourceSystem: 'test',
      projectUniverseId: pmuId,
      sourceType: 'note',
      sourceRecordId: 'n1',
    });

    await store.putKnowledge(
      {
        id: koId,
        projectUniverseId: pmuId,
        type: 'security.test',
        scope: 'project',
        title: 'Config note',
        content: {
          geminiKey: 'AIzaSy' + 'D-1234567890abcdefghijklmnopqrstuvwx',
          githubToken: 'ghp_' + '1234567890abcdefghijklmnopqrstuvwxyzABCD',
          dbPassword: 'custom-db-password-98765',
        },
        provenance: {
          sourceSystem: 'test',
          sourceType: 'note',
          sourceId: 'n1',
          createdAt: '2026-11-09T16:20:00.000Z',
          ingestedAt: '2026-11-09T16:20:00.000Z',
        },
        relationIds: [],
        validationStatus: 'unverified',
        lifecycleStatus: 'active',
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: '2026-11-09T16:20:00.000Z',
        updatedAt: '2026-11-09T16:20:00.000Z',
      },
      'idem_sec_ko_1'
    );

    const storedFile = path.join(pkuDir, 'universes', pmuId, 'objects', `${koId}.json`);
    const rawOnDisk = await fs.readFile(storedFile, 'utf-8');
    expect(rawOnDisk).not.toContain('AIzaSy' + 'D-1234567890abcdefghijklmnopqrstuvwx');
    expect(rawOnDisk).not.toContain('ghp_' + '1234567890abcdefghijklmnopqrstuvwxyzABCD');
    expect(rawOnDisk).not.toContain('custom-db-password-98765');
    expect(rawOnDisk).toContain('[REDACTED_API_KEY]');
    expect(rawOnDisk).toContain('[REDACTED_TOKEN]');
    expect(rawOnDisk).toContain('[REDACTED_SECRET]');
  });

  it('supports version increments when content changes, tree domain filtering, and BFS graph traversal in queryKnowledge', async () => {
    const sessionId = 'S_PHASE3_QUERY';
    await seedLegacySession(sessionId);

    const bridge = new ReadOnlyBlackboardCompatibilityBridge(storage, {
      ingestedAt: '2026-11-09T16:30:00.000Z',
    });
    const bundle = await bridge.exportSession(sessionId);

    const store = new InMemoryPKUStore();
    const ingestion = new ShadowIngestionService(store);
    await ingestion.ingestExportBundle(bundle);

    const pmuId = bundle.defaultProjectUniverse.id;

    // 1. Tree domain filtering (Architecture)
    const archQuery = await store.queryKnowledge({
      projectUniverseIds: [pmuId],
      treeDomainPrefix: 'Architecture',
    });
    expect(archQuery.items).toHaveLength(1);
    expect(archQuery.items[0]?.type).toBe('sdlc.document');

    // 2. Graph traversal expansion from development.work_log (depth = 1 expands to session.metadata & agent.identity)
    const graphQuery = await store.queryKnowledge({
      projectUniverseIds: [pmuId],
      types: ['development.work_log'],
      relationTraversalDepth: 1,
    });
    expect(graphQuery.items.length).toBeGreaterThanOrEqual(3);
    expect(graphQuery.traversedRelations?.length).toBeGreaterThanOrEqual(2);
    expect(graphQuery.evidenceCoverage).toBe(1);

    // 3. Updating an existing KnowledgeObject with modified content increments version to 2
    const docKo = archQuery.items[0]!;
    const updatedRes = await store.putKnowledge(
      {
        ...docKo,
        content: { ...(docKo.content as Record<string, unknown>), version: '1.1.0' },
      },
      'idem_doc_update_v2'
    );
    expect(updatedRes.created).toBe(false);
    expect(updatedRes.idempotentReplay).toBe(false);
    expect(updatedRes.version).toBe(2);
  });
});
