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
  InMemoryPKUStore,
  LocalFilesystemPKUStore,
  MemoryAccessDeniedError,
  MemoryRuntime,
  deriveCheckpointId,
  deriveProjectUniverseId,
} from '../../src/memory_modules/index.js';

describe('PKU Phase 4 — Register Integration, ScopedMemoryClient, Reconstruction & Outage Safety (PKU-004, PKU-009, PKU-010, PKU-011, PKU-019)', { timeout: 25000 }, () => {
  let tempRoot: string;
  let pkuDir: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  let sharedContextService: SharedContextService;
  let workLogService: WorkLogService;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-pku-phase4-'));
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
      // Ignore cleanup errors on Windows
    }
  });

  async function seedActiveSession(sessionId = 'S_PHASE4_REG'): Promise<void> {
    await sessionService.createSession({
      sessionId,
      sessionName: 'Phase 4 Register Integration Session',
      description: 'Verifies Global & Individual Register integration and reconstruction',
    });

    await sharedContextService.registerProjectRoot(sessionId, {
      rootId: 'almudaya-main',
      name: 'Almudaya Main Root',
      path: tempRoot,
      rootType: 'primary',
      description: 'Primary repository root',
    });

    await sharedContextService.registerEnvironment(sessionId, {
      os: 'win32',
      arch: 'x64',
      nodeVersion: 'v24.21.0',
      npmVersion: '11.19.0',
      variables: { MODE: 'register_test' },
    });

    await sharedContextService.registerDocument(sessionId, {
      documentId: 'doc-reg-001',
      title: 'Register Reconstruction Spec',
      documentType: 'DESIGN',
      uriOrPath: 'docs/register-spec.md',
      version: '1.0.0',
      status: 'approved',
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT001',
      displayName: 'alpha_bot',
      description: 'Alpha Architect Bot',
      status: 'active',
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT002',
      displayName: 'beta_bot',
      description: 'Beta Engineer Bot',
      status: 'active',
    });

    await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'BOT001',
      category: 'ACTIVITY',
      content: 'Broadcast 1: Initialized register test',
    });

    const b2 = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'BOT002',
      category: 'DECISION',
      content: 'Broadcast 2: Confirmed register reconstruction schema',
    });

    await storage.saveBroadcastCursor(sessionId, 'BOT001', {
      last_read_event_id: b2.event_id,
      last_read_timestamp: b2.timestamp,
      category_cursors: { DECISION: b2.event_id },
      acknowledged_event_ids: [b2.event_id],
    });

    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT002',
      recipient: 'BOT001',
      messageType: 'REQUEST',
      content: 'Please review individual register isolation',
    });

    await workLogService.recordWork(sessionId, {
      botId: 'BOT001',
      botName: 'alpha_bot',
      actionType: 'DECISION',
      targetRootId: 'almudaya-main',
      targetRootName: 'Almudaya Main Root',
      targetRootPath: tempRoot,
      summary: 'Approved Phase 4 register integration design',
    });

    await workLogService.recordWork(sessionId, {
      botId: 'BOT002',
      botName: 'beta_bot',
      actionType: 'WRITE',
      targetRootId: 'almudaya-main',
      targetRootName: 'Almudaya Main Root',
      targetRootPath: tempRoot,
      relativePath: 'src/memory_modules/registers/memory-runtime.ts',
      summary: 'Implemented MemoryRuntime and ScopedMemoryClient',
    });
  }

  it('PKU-009: enforces strict Bot-to-Bot private memory isolation and explicit shared grants in ScopedMemoryClient', async () => {
    const sessionId = 'S_PHASE4_ISOLATION';
    await seedActiveSession(sessionId);

    const pkuStore = new InMemoryPKUStore();
    const runtime = new MemoryRuntime(storage, pkuStore);
    const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);

    // Reject creating a ScopedMemoryClient before canonical botId is known
    expect(() =>
      runtime.createScopedClientForBot({
        sessionId,
        botId: '   ',
      })
    ).toThrow(MemoryAccessDeniedError);

    // Record private ACMA working memory for BOT001
    const bot1PrivateKo = await runtime.individualBridge.recordCognitiveMemory({
      sessionId,
      botId: 'BOT001',
      projectUniverseId: pmuId,
      domain: 'working',
      recordKey: 'scratchpad-01',
      title: 'BOT001 Private Hypothesis',
      content: { secretPlan: 'Refactor parser module' },
    });
    expect(bot1PrivateKo).not.toBeNull();

    const bot1Client = runtime.createScopedClientForBot({
      sessionId,
      botId: 'BOT001',
      projectUniverseId: pmuId,
    });
    const bot2Client = runtime.createScopedClientForBot({
      sessionId,
      botId: 'BOT002',
      projectUniverseId: pmuId,
    });

    // BOT001 can read its own private memory
    const selfRead = await bot1Client.getKnowledge(bot1PrivateKo!.id);
    expect(selfRead?.id).toBe(bot1PrivateKo!.id);

    // BOT002 is strictly denied direct getKnowledge access to BOT001's private memory (PKU-009)
    await expect(bot2Client.getKnowledge(bot1PrivateKo!.id)).rejects.toThrow(
      MemoryAccessDeniedError
    );

    // BOT002 is strictly denied querying BOT001's private agent scope
    await expect(
      bot2Client.queryKnowledge({
        projectUniverseIds: [pmuId],
        scopes: ['agent'],
        ownerId: 'BOT001',
      })
    ).rejects.toThrow(MemoryAccessDeniedError);

    // Broad query by BOT002 automatically filters out BOT001's private objects
    const bot2BroadQuery = await bot2Client.queryKnowledge({
      projectUniverseIds: [pmuId],
    });
    expect(bot2BroadQuery.items.some((i) => i.id === bot1PrivateKo!.id)).toBe(false);

    // BOT002 is denied reconstructing BOT001's Individual Register
    await expect(
      runtime.individualBridge.reconstructIndividualRegister(
        'BOT001',
        sessionId,
        pmuId,
        bot2Client
      )
    ).rejects.toThrow(MemoryAccessDeniedError);

    // When BOT001 explicitly grants shared access to bot1PrivateKo.id (e.g., via HandoffContext), BOT002 can read it
    const bot2ClientWithGrant = runtime.createScopedClientForBot({
      sessionId,
      botId: 'BOT002',
      projectUniverseId: pmuId,
      explicitSharedKnowledgeIds: [bot1PrivateKo!.id],
    });
    const sharedRead = await bot2ClientWithGrant.getKnowledge(bot1PrivateKo!.id);
    expect(sharedRead?.id).toBe(bot1PrivateKo!.id);
  });

  it('PKU-010: reconstructs Global Register from PKU snapshot and objects with equivalent state and ordering', async () => {
    const sessionId = 'S_PHASE4_GLOBAL_RECON';
    await seedActiveSession(sessionId);

    const pkuStore = new LocalFilesystemPKUStore(pkuDir);
    const runtime = new MemoryRuntime(storage, pkuStore);

    const syncResult = await runtime.globalBridge.syncSessionToPKU(sessionId);
    expect(syncResult?.completed).toBe(true);

    const reconstructed = await runtime.globalBridge.reconstructGlobalRegister(sessionId);

    expect(reconstructed.syncStatus).toBe('reconstructed');
    expect(reconstructed.session?.session_id).toBe(sessionId);
    expect(reconstructed.session?.session_name).toBe('Phase 4 Register Integration Session');
    expect(reconstructed.projectRoots).toHaveLength(1);
    expect(reconstructed.projectRoots[0]?.root_id).toBe('almudaya-main');
    expect(reconstructed.bots.map((b) => b.bot_id)).toEqual(['BOT001', 'BOT002']);
    expect(reconstructed.environmentMetadata?.os).toBe('win32');
    expect(reconstructed.sdlcDocuments).toHaveLength(1);
    expect(reconstructed.sdlcDocuments[0]?.document_id).toBe('doc-reg-001');

    // Verify deterministic ordering of broadcastEvents and workLogEntries
    expect(reconstructed.broadcastEvents).toHaveLength(2);
    expect(reconstructed.broadcastEvents[0]?.content).toContain('Broadcast 1');
    expect(reconstructed.broadcastEvents[1]?.content).toContain('Broadcast 2');

    expect(reconstructed.workLogEntries).toHaveLength(2);
    expect(reconstructed.workLogEntries[0]?.bot_id).toBe('BOT001');
    expect(reconstructed.workLogEntries[1]?.bot_id).toBe('BOT002');
  });

  it('PKU-011: reconstructs Individual Register with cognitive domains, checkpoints, handoffs, and zero cross-bot leakage', async () => {
    const sessionId = 'S_PHASE4_IND_RECON';
    await seedActiveSession(sessionId);

    const pkuStore = new LocalFilesystemPKUStore(pkuDir);
    const runtime = new MemoryRuntime(storage, pkuStore);
    const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);

    // Sync operational session and individual snapshots
    await runtime.globalBridge.syncSessionToPKU(sessionId);
    await runtime.individualBridge.syncIndividualSnapshotToPKU('BOT001', sessionId, pmuId);
    await runtime.individualBridge.syncIndividualSnapshotToPKU('BOT002', sessionId, pmuId);

    // Record ACMA memories, checkpoint, and handoff for BOT001
    const semMem = await runtime.individualBridge.recordCognitiveMemory({
      sessionId,
      botId: 'BOT001',
      projectUniverseId: pmuId,
      domain: 'semantic',
      recordKey: 'domain-rule-1',
      title: 'Fencing Token Rule',
      content: { rule: 'Always verify fence_token before completing message' },
    });

    await runtime.individualBridge.recordCognitiveMemory({
      sessionId,
      botId: 'BOT002',
      projectUniverseId: pmuId,
      domain: 'working',
      recordKey: 'bot2-only-note',
      title: 'BOT002 Private Note',
      content: { note: 'Must not leak into BOT001 reconstruction' },
    });

    const bot1Client = runtime.createScopedClientForBot({
      sessionId,
      botId: 'BOT001',
      projectUniverseId: pmuId,
    });

    const checkpoint = bot1Client.createCheckpointDescriptor({
      checkpointId: deriveCheckpointId(sessionId, 'BOT001', 'msg-01', 2),
      taskId: 'task-phase4',
      sourceMessageId: 'msg-01',
      iteration: 2,
      maxIterations: 5,
      status: 'in_progress',
      summary: 'Halfway through register reconstruction verification',
      workingContext: { step: 'verify_isolation' },
      knowledgeRefs: [semMem!.id],
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
    });
    await runtime.individualBridge.saveCheckpoint(checkpoint, 'idem_chk_bot1_1');

    const handoff = bot1Client.createHandoffDescriptor({
      handoffId: 'ho_bot1_to_bot2',
      targetBotId: 'BOT002',
      checkpointId: checkpoint.checkpointId,
      sharedKnowledgeIds: [semMem!.id],
      instructions: 'Continue implementing Phase 5 messaging references',
    });
    await runtime.individualBridge.recordHandoff(handoff, 'idem_ho_bot1_1');

    // Reconstruct BOT001 Individual Register
    const reconBot1 = await runtime.individualBridge.reconstructIndividualRegister(
      'BOT001',
      sessionId,
      pmuId,
      bot1Client
    );

    expect(reconBot1.botId).toBe('BOT001');
    expect(reconBot1.sessionId).toBe(sessionId);
    expect(reconBot1.botRecord?.display_name).toBe('alpha_bot');
    expect(reconBot1.broadcastCursor.acknowledged_event_ids).toHaveLength(1);
    expect(reconBot1.inboxDeliveryState).toHaveLength(1);
    expect(reconBot1.cognitiveMemory.semantic).toHaveLength(1);
    expect(reconBot1.cognitiveMemory.working).toHaveLength(0); // Zero leakage from BOT002!
    expect(reconBot1.checkpoints).toHaveLength(1);
    expect(reconBot1.checkpoints[0]?.checkpointId).toBe(checkpoint.checkpointId);
    expect(reconBot1.handoffs).toHaveLength(1);
    expect(reconBot1.handoffs[0]?.targetBotId).toBe('BOT002');
  });

  it('PKU-004, PKU-019 & RISK-03: survives PKU store outages gracefully, supports non-destructive rollback, and filters heartbeat churn', async () => {
    const sessionId = 'S_PHASE4_OUTAGE';
    await seedActiveSession(sessionId);

    const baseStore = new InMemoryPKUStore();
    const runtime = new MemoryRuntime(storage, baseStore);

    // 1. Verify heartbeat churn filtering (RISK-03)
    const botBefore = await botService.getBot(sessionId, 'BOT001');
    await botService.touchHeartbeat(sessionId, 'BOT001');
    const botAfterHeartbeat = await botService.getBot(sessionId, 'BOT001');

    const heartbeatCaptured = await runtime.observeBotRegistryMutation(
      sessionId,
      botBefore,
      botAfterHeartbeat
    );
    expect(heartbeatCaptured).toBe(false);
    expect(runtime.globalBridge.getDiagnostics().capturedEventCount).toBe(0);

    // Status change DOES qualify
    const botStopped = await botService.updateStatus(sessionId, 'BOT001', 'idle');
    const statusCaptured = await runtime.observeBotRegistryMutation(
      sessionId,
      botAfterHeartbeat,
      botStopped
    );
    expect(statusCaptured).toBe(true);
    expect(runtime.globalBridge.getDiagnostics().capturedEventCount).toBe(1);

    // 2. Simulate PKU store outage (PKU-004)
    const failingStore = new Proxy(baseStore, {
      get(target, prop, receiver) {
        if (prop === 'appendEvent') {
          return async () => {
            throw new Error('Simulated PKU Disk I/O Outage');
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const outageRuntime = new MemoryRuntime(storage, failingStore);
    // Must not throw even when PKU store fails!
    await expect(
      outageRuntime.globalBridge.captureEvent(
        sessionId,
        'broadcast.activity',
        { note: 'live coordination during outage' },
        'idem_outage_evt_1'
      )
    ).resolves.toBeUndefined();

    const diag = outageRuntime.globalBridge.getDiagnostics();
    expect(diag.outageCount).toBe(1);
    expect(diag.syncStatus).toBe('synchronization_failed');
    expect(diag.lastError).toContain('Simulated PKU Disk I/O Outage');
    // Failed event was queued into durable outbox for later replay
    expect(outageRuntime.outbox.getPendingAndFailed()).toHaveLength(1);

    // 3. Non-destructive rollback via runtime.disable() (PKU-019)
    runtime.disable();
    expect(runtime.enabled).toBe(false);
    const syncWhileDisabled = await runtime.globalBridge.syncSessionToPKU(sessionId);
    expect(syncWhileDisabled).toBeNull();

    // Legacy operations continue working seamlessly while PKU is disabled
    const msg = await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT002',
      recipient: 'BOT001',
      content: 'Legacy message while PKU disabled',
    });
    expect(msg.message_id).toBeDefined();
  });
});
