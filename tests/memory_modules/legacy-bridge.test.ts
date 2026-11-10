import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { BotService } from '../../src/bot/service.js';
import { InboxDeliveryService } from '../../src/messaging/delivery.js';
import { MessagingService } from '../../src/messaging/service.js';
import { SessionService } from '../../src/session/service.js';
import { SharedContextService } from '../../src/shared/service.js';
import { WorkLogService } from '../../src/shared/work-log.js';
import {
  ReadOnlyBlackboardCompatibilityBridge,
  ReadOnlyIndividualRegisterBridge,
  computeDirectoryManifest,
} from '../../src/memory_modules/index.js';

describe('PKU Phase 2 — Read-Only Legacy Compatibility Bridge (PKU-003, PKU-004, PKU-005)', { timeout: 25000 }, () => {
  let tempRoot: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;
  let deliveryService: InboxDeliveryService;
  let sharedContextService: SharedContextService;
  let workLogService: WorkLogService;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-pku-phase2-'));
    storage = new FilesystemSessionStorage(tempRoot);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage);
    deliveryService = new InboxDeliveryService(storage);
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

  async function seedFullLegacySession(sessionId = 'S_PHASE2_FIXTURE'): Promise<void> {
    await sessionService.createSession({
      sessionId,
      sessionName: 'Phase 2 Legacy Audit Session',
      description: 'Comprehensive session fixture for PKU read-only bridge verification',
      metadata: { owner: 'architect' },
    });

    await sharedContextService.registerProjectRoot(sessionId, {
      rootId: 'core-engine',
      name: 'Almudaya Core Engine',
      path: tempRoot,
      rootType: 'primary',
      description: 'Primary repository root',
    });

    await sharedContextService.registerProjectRoot(sessionId, {
      rootId: 'shared-docs',
      name: 'Architecture Docs',
      path: path.join(tempRoot, 'docs'),
      rootType: 'docs',
      description: 'Documentation reference root',
    });

    await sharedContextService.registerEnvironment(sessionId, {
      os: 'win32',
      arch: 'x64',
      nodeVersion: 'v24.21.0',
      npmVersion: '11.19.0',
      gitVersion: '2.47.0',
      variables: {
        NODE_ENV: 'test',
      },
    });

    await sharedContextService.registerDocument(sessionId, {
      documentId: 'doc-arch-001',
      title: 'PKU Unified Memory Spec v0.2',
      documentType: 'ARCHITECTURE',
      uriOrPath: 'memory_modules/PKU_Spec_v0.2.md',
      version: '0.2.0',
      status: 'approved',
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT001',
      displayName: 'architect_bot',
      description: 'Principal Architect Bot',
      status: 'active',
      metadata: { specialization: 'architecture' },
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT002',
      displayName: 'coder_bot',
      description: 'Implementation Bot',
      status: 'active',
      metadata: { specialization: 'implementation' },
    });

    // Publish broadcasts (ACTIVITY and DECISION)
    await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'BOT001',
      category: 'ACTIVITY',
      content: 'Started Phase 2 compatibility bridge inspection',
    });

    const decisionEvt = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'BOT001',
      category: 'DECISION',
      content: 'Use non-strict JSONL line parsing in read-only bridge to prevent legacy file mutation',
      metadata: { adr: 'ADR-002' },
    });

    // Advance BOT002 broadcast cursor
    await storage.saveBroadcastCursor(sessionId, 'BOT002', {
      last_read_event_id: decisionEvt.event_id,
      last_read_timestamp: decisionEvt.timestamp,
      category_cursors: { DECISION: decisionEvt.event_id },
      acknowledged_event_ids: [decisionEvt.event_id],
    });

    // Send direct messages (one standard, one qualified for knowledge extraction)
    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT001',
      recipient: 'BOT002',
      messageType: 'REQUEST',
      content: 'Please implement the read-only compatibility bridge tests',
      metadata: {
        promoteToKnowledge: true,
        knowledgeRefs: ['pku_ko_spec_001'],
      },
    });

    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: 'BOT002',
      recipient: 'BOT001',
      messageType: 'RESPONSE',
      content: 'Acknowledged, implementing tests now',
    });

    // Record work log entries
    await workLogService.recordWork(sessionId, {
      botId: 'BOT001',
      botName: 'architect_bot',
      actionType: 'DECISION',
      targetRootId: 'core-engine',
      targetRootName: 'Almudaya Core Engine',
      targetRootPath: tempRoot,
      relativePath: 'src/memory_modules/bridges/legacy-blackboard-bridge.ts',
      summary: 'Designed read-only compatibility bridge over IBlackboardStorage',
      details: { phase: 2 },
    });

    await workLogService.recordWork(sessionId, {
      botId: 'BOT002',
      botName: 'coder_bot',
      actionType: 'WRITE',
      targetRootId: 'core-engine',
      targetRootName: 'Almudaya Core Engine',
      targetRootPath: tempRoot,
      relativePath: 'tests/memory_modules/legacy-bridge.test.ts',
      summary: 'Added Phase 2 verification tests',
      details: { testCount: 6 },
    });

    // Seed optional capability grants & audit JSONL files
    const capDir = path.join(storage.getSessionDir(sessionId), 'capabilities');
    await fs.mkdir(capDir, { recursive: true });
    await fs.writeFile(
      path.join(capDir, 'grants.jsonl'),
      JSON.stringify({
        grant_id: '550e8400-e29b-41d4-a716-446655440000',
        capability: 'filesystem.read_external',
        scope: { paths: [tempRoot] },
        granted_by: 'operator',
        granted_at: '2026-11-09T10:00:00.000Z',
        expires_at: '2026-11-10T10:00:00.000Z',
        session_id: sessionId,
        bot_id: 'BOT001',
        approval_mode: 'session',
        status: 'active',
      }) + '\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(capDir, 'audit.jsonl'),
      JSON.stringify({
        event_id: '660e8400-e29b-41d4-a716-446655440001',
        timestamp: '2026-11-09T10:01:00.000Z',
        session_id: sessionId,
        bot_id: 'BOT001',
        type: 'POLICY_EVALUATED',
        capability: 'filesystem.read_external',
        details: { decision: 'ALLOW' },
      }) + '\n',
      'utf-8'
    );
  }

  it('PKU-003 & PKU-002: exports all legacy session artifacts with complete provenance and deterministic idempotency', async () => {
    const sessionId = 'S_PHASE2_FIXTURE';
    await seedFullLegacySession(sessionId);

    const fixedIngestedAt = '2026-11-09T15:00:00.000Z';
    const bridge = new ReadOnlyBlackboardCompatibilityBridge(storage, {
      ingestedAt: fixedIngestedAt,
      migrationBatchId: 'batch_phase2_001',
    });

    const bundle1 = await bridge.exportSession(sessionId);
    const bundle2 = await bridge.exportSession(sessionId);

    // Deterministic export parity (PKU-002)
    expect(bundle1.defaultProjectUniverse.id).toBe(bundle2.defaultProjectUniverse.id);
    expect(bundle1.knowledgeObjects.map((k) => k.id)).toEqual(
      bundle2.knowledgeObjects.map((k) => k.id)
    );
    expect(bundle1.memoryEvents.map((e) => e.id)).toEqual(bundle2.memoryEvents.map((e) => e.id));
    expect(bundle1.memoryEvents.map((e) => e.idempotencyKey)).toEqual(
      bundle2.memoryEvents.map((e) => e.idempotencyKey)
    );

    // Verify source counts & parity report
    expect(bundle1.parityReport.parityVerified).toBe(true);
    expect(bundle1.parityReport.unexplainedMissingCount).toBe(0);
    expect(bundle1.parityReport.sourceCounts).toEqual({
      sessionMetadata: 1,
      projectRoots: 2,
      bots: 2,
      environmentMetadata: 1,
      sdlcDocuments: 1,
      broadcastEvents: 2,
      directMessages: 2,
      broadcastCursors: 2,
      workLogEntries: 2,
      capabilityGrants: 1,
      securityAuditEvents: 1,
    });

    // Expected KnowledgeObjects:
    // 1 session.metadata + 2 project.root + 2 agent.identity + 1 session.environment +
    // 1 sdlc.document + 1 promoted broadcast (DECISION) + 1 promoted direct message + 2 work_log = 11
    expect(bundle1.knowledgeObjects).toHaveLength(11);

    // Expected MemoryEvents:
    // 2 broadcasts + 2 direct messages + 2 work logs + 1 capability grant + 1 security audit = 8
    expect(bundle1.memoryEvents).toHaveLength(8);

    // Provenance verification (PKU-003): source IDs, timestamps, file locators (#L<line>), and hashes
    const broadcastEvt = bundle1.memoryEvents.find((e) => e.eventType === 'broadcast.decision');
    expect(broadcastEvt).toBeDefined();
    expect(broadcastEvt?.provenance.sourceSystem).toBe('almudaya.blackboard');
    expect(broadcastEvt?.provenance.sourceType).toBe('BroadcastEvent');
    expect(broadcastEvt?.provenance.sourcePath).toBe(
      `sessions/${sessionId}/broadcast/events.jsonl#L2`
    );
    expect(broadcastEvt?.provenance.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(broadcastEvt?.provenance.migrationBatchId).toBe('batch_phase2_001');

    const workLogKo = bundle1.knowledgeObjects.find(
      (k) => k.type === 'development.work_log' && k.ownerId === 'BOT001'
    );
    expect(workLogKo).toBeDefined();
    expect(workLogKo?.provenance.sourcePath).toBe(`sessions/${sessionId}/work_log.jsonl#L1`);
    expect(workLogKo?.relationIds.length).toBeGreaterThanOrEqual(2);

    const directMsgEvt = bundle1.memoryEvents.find(
      (e) => e.eventType === 'message.direct' && e.identity.botId === 'BOT002'
    );
    expect(directMsgEvt).toBeDefined();
    expect(directMsgEvt?.provenance.sourcePath).toContain(
      `sessions/${sessionId}/inbox/BOT002/messages.json#msg_`
    );
  });

  it('PKU-005 &Quarantine Diagnostics: never mutates legacy files on disk even when malformed JSONL lines exist', async () => {
    const sessionId = 'S_PHASE2_IMMUTABLE';
    await seedFullLegacySession(sessionId);

    const sessionDir = storage.getSessionDir(sessionId);
    // Inject malformed JSONL lines into broadcast/events.jsonl and work_log.jsonl
    await fs.appendFile(
      path.join(sessionDir, 'broadcast', 'events.jsonl'),
      '{"corrupted_broadcast_json": true\n',
      'utf-8'
    );
    await fs.appendFile(
      path.join(sessionDir, 'work_log.jsonl'),
      '{"entry_id": "bad_work_log", "invalid_schema": 123}\n',
      'utf-8'
    );

    // Capture SHA-256 manifest of the entire session directory BEFORE export
    const manifestBefore = await computeDirectoryManifest(sessionDir);
    expect(manifestBefore.length).toBeGreaterThan(0);

    const bridge = new ReadOnlyBlackboardCompatibilityBridge(storage);
    const individualBridge = new ReadOnlyIndividualRegisterBridge(storage);

    const bundle = await bridge.exportSession(sessionId);
    const botSnapshot = await individualBridge.exportIndividualSnapshot('BOT002', sessionId);

    // Capture SHA-256 manifest of the entire session directory AFTER export
    const manifestAfter = await computeDirectoryManifest(sessionDir);

    // PKU-005: Zero legacy file mutation (no new .corrupt.jsonl files, no modified timestamps/hashes)
    expect(manifestAfter).toEqual(manifestBefore);

    // Quarantine verification: both corrupt JSONL lines were captured with line numbers and diagnostics
    expect(bundle.quarantinedRecords).toHaveLength(2);
    const broadcastQuarantine = bundle.quarantinedRecords.find(
      (q) => q.sourceType === 'BroadcastEvent'
    );
    expect(broadcastQuarantine).toBeDefined();
    expect(broadcastQuarantine?.lineNumber).toBe(3);
    expect(broadcastQuarantine?.sourcePath).toBe(
      `sessions/${sessionId}/broadcast/events.jsonl#L3`
    );

    const workLogQuarantine = bundle.quarantinedRecords.find(
      (q) => q.sourceType === 'WorkLogEntry'
    );
    expect(workLogQuarantine).toBeDefined();
    expect(workLogQuarantine?.lineNumber).toBe(3);
    expect(workLogQuarantine?.sourcePath).toBe(`sessions/${sessionId}/work_log.jsonl#L3`);

    // Valid records before the corrupt lines were still exported cleanly
    expect(bundle.parityReport.sourceCounts.broadcastEvents).toBe(2);
    expect(bundle.parityReport.sourceCounts.workLogEntries).toBe(2);
    expect(botSnapshot).not.toBeNull();
    expect(botSnapshot?.identity.botId).toBe('BOT002');
    expect(botSnapshot?.state.broadcastCursor.acknowledged_event_ids).toHaveLength(1);
  });

  it('PKU-004: existing Blackboard, messaging, lease fencing, and work-log operations continue unaffected when PKU bridge is disabled or unused', async () => {
    const sessionId = 'S_PHASE2_PKU_DISABLED';
    await seedFullLegacySession(sessionId);

    // Perform live inbox claim, stale worker fencing check, and completion without PKU involvement
    const claimed = await deliveryService.claimNextMessage(
      sessionId,
      'BOT002',
      'worker-bot002-primary',
      30_000
    );
    expect(claimed).not.toBeNull();
    expect(claimed?.delivery_state).toBe('PROCESSING');
    expect(claimed?.fence_token).toBe(1);

    // Stale consumer with wrong lease_owner or outdated fence_token is still rejected
    await expect(
      deliveryService.completeMessage(
        sessionId,
        'BOT002',
        claimed!.message_id,
        'stale-worker',
        0
      )
    ).rejects.toThrow();

    // Valid lease holder completes message
    const completed = await deliveryService.completeMessage(
      sessionId,
      'BOT002',
      claimed!.message_id,
      'worker-bot002-primary',
      claimed!.fence_token
    );
    expect(completed.delivery_state).toBe('COMPLETED');
    expect(completed.status).toBe('acknowledged');

    // Read-only bridge accurately reflects the updated delivery state in the individual snapshot
    const bridge = new ReadOnlyBlackboardCompatibilityBridge(storage);
    const bundle = await bridge.exportSession(sessionId);
    const bot2Snap = bundle.individualRegisterSnapshots.find((s) => s.identity.botId === 'BOT002');
    expect(bot2Snap).toBeDefined();
    const state = bot2Snap?.state as {
      inboxDeliveryState: Array<{ message_id: string; delivery_state: string; fence_token: number }>;
    };
    const msgState = state.inboxDeliveryState.find((m) => m.message_id === claimed!.message_id);
    expect(msgState?.delivery_state).toBe('COMPLETED');
    expect(msgState?.fence_token).toBe(1);
  });

  it('PKU-008: redacts raw secret tokens found in legacy files during read-only export', async () => {
    const sessionId = 'S_PHASE2_REDACTION';
    await seedFullLegacySession(sessionId);

    // Simulate a legacy file that accidentally had an unredacted token written manually
    const envFile = path.join(storage.getSessionDir(sessionId), 'registry', 'environment.json');
    const rawEnv = JSON.parse(await fs.readFile(envFile, 'utf-8')) as Record<string, unknown>;
    rawEnv['variables'] = {
      LEAKED_GITHUB_PAT: 'ghp_' + '1234567890abcdefghijklmnopqrstuvwxyzABCD',
      CUSTOM_CANARY: 'canary-secret-xyz-987654',
    };
    await fs.writeFile(envFile, JSON.stringify(rawEnv, null, 2), 'utf-8');

    const bridge = new ReadOnlyBlackboardCompatibilityBridge(storage, {
      customSecrets: ['canary-secret-xyz-987654'],
    });
    const bundle = await bridge.exportSession(sessionId);

    const serializedBundle = JSON.stringify(bundle);
    expect(serializedBundle).not.toContain('ghp_' + '1234567890abcdefghijklmnopqrstuvwxyzABCD');
    expect(serializedBundle).not.toContain('canary-secret-xyz-987654');
    expect(serializedBundle).toContain('[REDACTED_TOKEN]');
    expect(serializedBundle).toContain('[REDACTED_SECRET]');
  });

  it('ReadOnlyIndividualRegisterBridge discovers only verified capabilities and does not invent legacy ACMA stores', async () => {
    const sessionId = 'S_PHASE2_INDIVIDUAL';
    await seedFullLegacySession(sessionId);

    const indBridge = new ReadOnlyIndividualRegisterBridge(storage, {
      defaultSessionId: sessionId,
    });

    const capabilities = await indBridge.discoverCapabilities();
    expect(capabilities).toEqual([
      'bot_identity',
      'direct_inbox',
      'broadcast_cursor',
      'session_work_log_slice',
    ]);

    const bot1State = await indBridge.loadIndividualState('BOT001');
    expect(bot1State).not.toBeNull();
    expect(bot1State?.botRecord?.display_name).toBe('architect_bot');
    expect(bot1State?.inboxMessages).toHaveLength(1);
    expect(bot1State?.authoredWorkLogs).toHaveLength(1);

    const missingBotState = await indBridge.loadIndividualState('NON_EXISTENT_BOT');
    expect(missingBotState).toBeNull();
  });
});
