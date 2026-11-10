import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { BotService } from '../../src/bot/service.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  deriveKnowledgeId,
  deriveProjectUniverseId,
  InMemoryExternalAdapter,
  InMemoryPKUStore,
  MemoryLifecycleService,
  MemoryRuntime,
} from '../../src/memory_modules/index.js';
import { SessionService } from '../../src/session/service.js';

describe('Phase 9: Universal Memory Interface (UMI), External Adapter Gateway (PKU-020) & End-to-End Acceptance Verification (PKU-001..PKU-020)', { timeout: 25000 }, () => {
  let tmpRoot: string;
  let workspaceRoot: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya_pku_phase9_'));
    workspaceRoot = path.join(tmpRoot, 'workspace');
    await fs.mkdir(workspaceRoot, { recursive: true });
    storage = new FilesystemSessionStorage(workspaceRoot);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('PKU-020: External Memory Adapter degrades gracefully on backend disconnect or unsupported capability with zero hidden data loss, and replays buffered writes on reconnect', async () => {
    const pkuStore = new InMemoryPKUStore();
    const runtime = new MemoryRuntime(storage, pkuStore);

    const { universe } = await runtime.pmuService.createProjectUniverse({
      projectKey: 'adapter-resilience-proj',
      displayName: 'Adapter Resilience Project',
    });

    const extAdapter = new InMemoryExternalAdapter(
      {
        adapterId: 'ext_vector_graph_01',
        displayName: 'External Vector/Graph Store',
        backendType: 'external-hybrid',
        version: '1.0.0',
        capabilities: {
          read: true,
          write: true,
          search: true,
          semanticSearch: false, // Explicitly unsupported
          graphTraversal: false, // Explicitly unsupported
          export: true,
          import: true,
          incrementalSync: true,
          delete: true,
        },
      },
      { autoConnect: true }
    );

    runtime.gateway.registerAdapter(extAdapter);
    expect(runtime.gateway.listAdapters()).toHaveLength(1);
    expect(runtime.gateway.hasCapability('ext_vector_graph_01', 'write')).toBe(true);
    expect(runtime.gateway.hasCapability('ext_vector_graph_01', 'semanticSearch')).toBe(false);

    const ko1Id = deriveKnowledgeId({
      sourceSystem: 'almudaya.test',
      projectUniverseId: universe.id,
      sourceType: 'arch.spec',
      sourceRecordId: 'spec_online_1',
    });

    // 1. Write while external adapter is connected -> commits locally AND syncs to adapter
    const onlineWrite = await runtime.gateway.writeThroughAdapter('ext_vector_graph_01', {
      id: ko1Id,
      projectUniverseId: universe.id,
      type: 'arch.spec',
      scope: 'project',
      title: 'Online Synced Specification',
      content: {
        endpoint: '/v1/health',
        apiKey: 'AIzaSy' + 'D-1234567890abcdefghijklmnopqrstuvwx',
      },
      provenance: {
        sourceSystem: 'almudaya.test',
        sourceType: 'arch.spec',
        sourceId: 'spec_online_1',
        createdAt: '2026-11-10T10:00:00.000Z',
        ingestedAt: '2026-11-10T10:00:00.000Z',
        originProjectUniverseId: universe.id,
      },
      relationIds: [],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T10:00:00.000Z',
    });

    expect(onlineWrite.localCommitted).toBe(true);
    expect(onlineWrite.adapterSynced).toBe(true);
    expect(onlineWrite.degraded).toBe(false);

    const pulledOnline = await extAdapter.pullKnowledge(ko1Id);
    expect(pulledOnline?.id).toBe(ko1Id);
    expect(JSON.stringify(pulledOnline?.content)).toContain('[REDACTED_API_KEY]');

    // 2. Capability-specific graceful degradation: requesting semanticSearch falls back to local PKU store
    const semanticFallback = await runtime.gateway.queryWithFallback(
      'ext_vector_graph_01',
      {
        projectUniverseIds: [universe.id],
        text: 'Online Synced',
      },
      { requireSemanticSearch: true }
    );
    expect(semanticFallback.degraded).toBe(true);
    expect(semanticFallback.source).toBe('local_pku_fallback');
    expect(semanticFallback.unsupportedCapability).toBe('semanticSearch');
    expect(semanticFallback.result.items.map((i) => i.id)).toContain(ko1Id);

    // 3. Simulate external backend disconnect (PKU-020)
    extAdapter.simulateOutage('ECONNREFUSED: external cluster unreachable');

    const ko2Id = deriveKnowledgeId({
      sourceSystem: 'almudaya.test',
      projectUniverseId: universe.id,
      sourceType: 'arch.spec',
      sourceRecordId: 'spec_offline_2',
    });

    const degradedWrite = await runtime.gateway.writeThroughAdapter('ext_vector_graph_01', {
      id: ko2Id,
      projectUniverseId: universe.id,
      type: 'arch.spec',
      scope: 'project',
      title: 'Offline Buffered Specification',
      content: { endpoint: '/v1/metrics' },
      provenance: {
        sourceSystem: 'almudaya.test',
        sourceType: 'arch.spec',
        sourceId: 'spec_offline_2',
        createdAt: '2026-11-10T10:05:00.000Z',
        ingestedAt: '2026-11-10T10:05:00.000Z',
        originProjectUniverseId: universe.id,
      },
      relationIds: [],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: '2026-11-10T10:05:00.000Z',
      updatedAt: '2026-11-10T10:05:00.000Z',
    });

    // Zero hidden data loss: committed to local PKU and queued for retry in durable outbox
    expect(degradedWrite.localCommitted).toBe(true);
    expect(degradedWrite.adapterSynced).toBe(false);
    expect(degradedWrite.degraded).toBe(true);
    expect(degradedWrite.queuedForRetry).toBe(true);

    // Querying during outage degrades gracefully to local PKU store and returns BOTH ko1 and ko2
    const outageQuery = await runtime.gateway.queryWithFallback('ext_vector_graph_01', {
      projectUniverseIds: [universe.id],
      types: ['arch.spec'],
    });
    expect(outageQuery.degraded).toBe(true);
    expect(outageQuery.source).toBe('local_pku_fallback');
    expect(outageQuery.result.items.map((i) => i.id)).toContain(ko1Id);
    expect(outageQuery.result.items.map((i) => i.id)).toContain(ko2Id);

    // 4. External backend recovers -> replayBufferedWrites drains outbox to external adapter idempotently
    extAdapter.simulateOutage(null);
    await extAdapter.connect();

    const replayReport = await runtime.gateway.replayBufferedWrites('ext_vector_graph_01');
    expect(replayReport.attemptedCount).toBe(1);
    expect(replayReport.replayedCount).toBe(1);
    expect(replayReport.remainingPendingCount).toBe(0);

    const pulledAfterReconnect = await extAdapter.pullKnowledge(ko2Id);
    expect(pulledAfterReconnect?.id).toBe(ko2Id);
    expect(pulledAfterReconnect?.title).toBe('Offline Buffered Specification');
  });

  it('verifies UnifiedMemoryInterface (UMI) end-to-end orchestration across Blackboard, ACMA, Messaging, KOE, PMU, and Lifecycle', async () => {
    const sessionId = 'S_PHASE9_E2E';
    await sessionService.createSession({
      sessionId,
      sessionName: 'Phase 9 UMI E2E Session',
    });
    await botService.registerBot(sessionId, {
      botId: 'BOT001',
      displayName: 'Architect',
      role: 'Architect',
      status: 'active',
    });
    await botService.registerBot(sessionId, {
      botId: 'BOT002',
      displayName: 'Coder',
      role: 'Engineer',
      status: 'active',
    });

    const pkuStore = new InMemoryPKUStore();
    const runtime = new MemoryRuntime(storage, pkuStore);
    const umi = runtime.umi;
    const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);

    // 1. Initialize PMU via runtime.pmuService
    await runtime.pmuService.createProjectUniverse({
      projectKey: `session_${sessionId.toLowerCase()}`,
      displayName: 'Phase 9 Session Universe',
    });

    // 2. Write architectural knowledge via PMU service
    const archKnowledge = await runtime.pmuService.putProjectKnowledge({
      projectUniverseId: pmuId,
      localRecordId: 'ARCH-ORDER-PIPELINE',
      type: 'arch.design',
      title: 'Order Processing Pipeline Specification',
      summary: 'Orders are validated, reserved in inventory, and emitted to billing.',
      content: { stages: ['validate', 'reserve_inventory', 'emit_billing'] },
      domainPaths: ['Architecture/Modules'],
      hierarchyLevel: 'L1',
      sourcePath: 'docs/architecture/order-pipeline.md',
    });

    // 3. Send knowledge-aware direct message with handoff via UMI messagingBridge
    const { message } = await runtime.messagingBridge.sendKnowledgeAwareDirectMessage(
      sessionId,
      {
        senderBotId: 'BOT001',
        recipient: 'BOT002',
        messageType: 'REQUEST',
        content: 'Implement the reserve_inventory stage in the order pipeline.',
      },
      {
        knowledgeRefs: [archKnowledge.id],
        handoffContext: {
          handoffId: 'hoff_e2e_01',
          sessionId,
          projectUniverseId: pmuId,
          sourceBotId: 'BOT001',
          targetBotId: 'BOT002',
          sharedKnowledgeIds: [archKnowledge.id],
          instructions: 'Follow the 3-stage Order Processing Pipeline Specification.',
          createdAt: '2026-11-10T10:15:00.000Z',
        },
      },
      {
        projectUniverseId: pmuId,
        extractKnowledge: true,
      }
    );

    // 4. Recipient BOT002 resolves references and assembles KOE context via UMI
    const refs = await umi.messagingBridge.resolveKnowledgeReferences(
      message.message_id,
      'BOT002'
    );
    expect(refs.knowledgeRefs).toContain(archKnowledge.id);

    const bot2Client = runtime.createScopedClientForBot({
      sessionId,
      botId: 'BOT002',
      projectUniverseId: pmuId,
      explicitSharedKnowledgeIds: refs.knowledgeRefs,
    });

    const assembledContext = await umi.koe.assembleContext({
      identity: bot2Client.identity,
      task: 'Implement reserve_inventory stage in Order Processing Pipeline',
      tokenBudget: 512,
      permission: bot2Client.permission,
    });

    expect(assembledContext.sufficient).toBe(true);
    expect(assembledContext.knowledgeIds).toContain(archKnowledge.id);
    expect(assembledContext.text).toContain('Order Processing Pipeline Specification');

    // 5. Sync session state & reconstruct Global and Individual Registers
    await runtime.globalBridge.syncSessionToPKU(sessionId, pmuId);
    await runtime.individualBridge.syncIndividualSnapshotToPKU('BOT002', sessionId, pmuId);

    const globalRecon = await runtime.globalBridge.reconstructGlobalRegister(sessionId, pmuId);
    expect(globalRecon.bots.map((b) => b.bot_id)).toContain('BOT001');
    expect(globalRecon.bots.map((b) => b.bot_id)).toContain('BOT002');

    const bot1Recon = await runtime.individualBridge.reconstructIndividualRegister(
      'BOT001',
      sessionId,
      pmuId
    );
    expect(bot1Recon.handoffs.some((h) => h.handoffId === 'hoff_e2e_01')).toBe(true);

    // 6. Lifecycle soft_delete & restore via UMI lifecycle manager
    const softDelPlan = await umi.lifecycle.plan({
      projectUniverseId: pmuId,
      operation: 'soft_delete',
      targetIds: [archKnowledge.id],
      requestedBy: 'BOT001',
      reason: 'E2E lifecycle check',
    });
    await umi.lifecycle.execute(
      softDelPlan,
      MemoryLifecycleService.createConfirmationToken(softDelPlan)
    );
    expect((await umi.pku.getKnowledge(archKnowledge.id))?.lifecycleStatus).toBe('deleted');

    const restorePlan = await umi.lifecycle.plan({
      projectUniverseId: pmuId,
      operation: 'restore',
      targetIds: [archKnowledge.id],
      requestedBy: 'BOT001',
      reason: 'Restore after E2E lifecycle check',
    });
    await umi.lifecycle.execute(restorePlan);
    expect((await umi.pku.getKnowledge(archKnowledge.id))?.lifecycleStatus).toBe('active');
  });
});
