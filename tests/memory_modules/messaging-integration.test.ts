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
  InMemoryPKUStore,
  MemoryAccessDeniedError,
  MemoryRuntime,
} from '../../src/memory_modules/index.js';
import { DirectMessageSchema } from '../../src/messaging/schema.js';
import { MessagingService } from '../../src/messaging/service.js';
import { SessionService } from '../../src/session/service.js';

describe('Phase 5: Knowledge-Aware Messaging Integration (PKU-006, PKU-007, PKU-009)', () => {
  let tmpRoot: string;
  let workspaceRoot: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;
  let messagingService: MessagingService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya_pku_phase5_'));
    workspaceRoot = path.join(tmpRoot, 'workspace');
    await fs.mkdir(workspaceRoot, { recursive: true });
    storage = new FilesystemSessionStorage(workspaceRoot);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
    messagingService = new MessagingService(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function seedSessionWithBots(sessionId: string): Promise<void> {
    await sessionService.createSession({
      sessionId,
      sessionName: 'Phase 5 Messaging Session',
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT001',
      displayName: 'Architect',
      role: 'System Architect',
      status: 'active',
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT002',
      displayName: 'Coder',
      role: 'Backend Engineer',
      status: 'active',
    });

    await botService.registerBot(sessionId, {
      botId: 'BOT003',
      displayName: 'Reviewer',
      role: 'Security Reviewer',
      status: 'active',
    });
  }

  it('attaches and resolves knowledge references, handoff context, and enforces principal isolation (PKU-009) while preserving DirectMessageSchema', async () => {
    const sessionId = 'S_PHASE5_REFS';
    await seedSessionWithBots(sessionId);

    const pkuStore = new InMemoryPKUStore();
    const runtime = new MemoryRuntime(storage, pkuStore);
    const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);

    const bot1Client = runtime.createScopedClientForBot({
      sessionId,
      botId: 'BOT001',
      projectUniverseId: pmuId,
    });

    const archDocId = deriveKnowledgeId({
      sourceSystem: 'test',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'acma.semantic',
      sourceRecordId: 'arch_spec_1',
    });

    await bot1Client.putKnowledge(
      {
        id: archDocId,
        projectUniverseId: pmuId,
        type: 'acma.semantic',
        scope: 'agent',
        ownerId: 'BOT001',
        title: 'API Gateway Auth Design',
        content: {
          jwtIssuer: 'almudaya.internal',
          secretNote: 'AIzaSy' + 'D-1234567890abcdefghijklmnopqrstuvwx',
        },
        provenance: {
          sourceSystem: 'test',
          sourceType: 'spec',
          sourceId: 'arch_spec_1',
          createdBy: 'BOT001',
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
        metadata: {
          sessionId,
          botId: 'BOT001',
        },
      },
      'idem_p5_arch_spec_1'
    );

    const handoffContext = {
      handoffId: 'hoff_p5_001',
      sessionId,
      projectUniverseId: pmuId,
      sourceBotId: 'BOT001',
      targetBotId: 'BOT002',
      checkpointId: 'ckpt_bot1_01',
      sharedKnowledgeIds: [archDocId],
      instructions: 'Implement JWT middleware based on attached architecture knowledge',
      createdAt: '2026-11-09T18:01:00.000Z',
    };

    const { message, ingested } = await runtime.messagingBridge.sendKnowledgeAwareDirectMessage(
      sessionId,
      {
        senderBotId: 'BOT001',
        recipient: 'Coder',
        messageType: 'REQUEST',
        content: 'Please implement the JWT middleware using the attached spec.',
      },
      {
        knowledgeRefs: [archDocId],
        executionRefs: ['exec_run_001'],
        checkpointRef: 'ckpt_bot1_01',
        handoffContext,
      },
      {
        projectUniverseId: pmuId,
        extractKnowledge: true,
        knowledgeTitle: 'Handoff: JWT Middleware Implementation',
      }
    );

    // 1. DirectMessageSchema compatibility verified
    expect(() => DirectMessageSchema.parse(message)).not.toThrow();
    expect(message.delivery_state).toBe('RECEIVED');
    expect(message.recipient_bot_id).toBe('BOT002');

    // 2. Operational MemoryEvent and extracted KnowledgeObject are stored as DISTINCT PKU records
    expect(ingested).toBeDefined();
    expect(ingested?.memoryEvent.eventType).toBe('message.direct');
    expect(ingested?.memoryEvent.provenance.sourceId).toBe(message.message_id);
    expect(ingested?.extractedKnowledge).toBeDefined();
    expect(ingested?.extractedKnowledge?.type).toBe('agent.message_knowledge');
    expect(ingested?.extractedKnowledge?.id).not.toBe(ingested?.memoryEvent.id);
    expect(ingested?.derivedRelation?.relationType).toBe('derived_from');
    expect(ingested?.derivedRelation?.metadata?.['sourceEventId']).toBe(ingested?.memoryEvent.id);

    // 3. Recipient BOT002 and Sender BOT001 can resolve references and read the explicitly shared agent-scoped KnowledgeObject
    const resolvedByRecipient = await runtime.messagingBridge.resolveKnowledgeReferences(
      message.message_id,
      'BOT002'
    );
    expect(resolvedByRecipient.knowledgeRefs).toEqual([archDocId]);
    expect(resolvedByRecipient.checkpointRef).toBe('ckpt_bot1_01');
    expect(resolvedByRecipient.handoffContext?.handoffId).toBe('hoff_p5_001');

    const resolvedObjectsForBot2 = await runtime.messagingBridge.resolveReferencedKnowledgeObjects(
      message.message_id,
      'BOT002'
    );
    expect(resolvedObjectsForBot2).toHaveLength(1);
    expect(resolvedObjectsForBot2[0]?.id).toBe(archDocId);
    expect(JSON.stringify(resolvedObjectsForBot2[0]?.content)).toContain('[REDACTED_API_KEY]');

    // 4. Uninvolved BOT003 is denied access to message references (PKU-009)
    await expect(
      runtime.messagingBridge.resolveKnowledgeReferences(message.message_id, 'BOT003')
    ).rejects.toThrow(MemoryAccessDeniedError);

    // 5. Handoff context was also recorded into Individual Register continuity in PKU
    const bot1Reconstructed = await runtime.individualBridge.reconstructIndividualRegister(
      'BOT001',
      sessionId,
      pmuId
    );
    expect(bot1Reconstructed.handoffs.some((h) => h.handoffId === 'hoff_p5_001')).toBe(true);
  });

  it('PKU-006: BroadcastCursor does NOT advance when consumer callback fails, and advances only after callback succeeds', async () => {
    const sessionId = 'S_PHASE5_PKU006_BROADCAST';
    await seedSessionWithBots(sessionId);

    const pkuStore = new InMemoryPKUStore();
    const runtime = new MemoryRuntime(storage, pkuStore);

    const event = await messagingService.publishBroadcast(sessionId, {
      senderBotId: 'BOT001',
      category: 'DECISION',
      content: 'Adopt strict schema validation on all endpoints.',
    });

    // 1. Consumer callback throws -> cursor MUST NOT advance
    await expect(
      runtime.messagingBridge.consumeBroadcastSafely(
        sessionId,
        'BOT002',
        event,
        async () => {
          throw new Error('Simulated downstream callback failure');
        }
      )
    ).rejects.toThrow(/Simulated downstream callback failure/);

    const cursorAfterFailure = await storage.getBroadcastCursor(sessionId, 'BOT002');
    expect(cursorAfterFailure.last_read_event_id).toBeNull();
    expect(cursorAfterFailure.acknowledged_event_ids ?? []).not.toContain(event.event_id);

    // Broadcast remains unread for BOT002
    const unreadEvents = await messagingService.readBroadcasts(sessionId, {
      botId: 'BOT002',
      autoAdvanceCursor: false,
    });
    expect(unreadEvents.map((e) => e.event_id)).toContain(event.event_id);

    // 2. Retry succeeds -> cursor advances and PKU records broadcast MemoryEvent
    let processedContent = '';
    await runtime.messagingBridge.consumeBroadcastSafely(
      sessionId,
      'BOT002',
      event,
      async (ev) => {
        processedContent = ev.content;
      }
    );

    expect(processedContent).toBe('Adopt strict schema validation on all endpoints.');
    const cursorAfterSuccess = await storage.getBroadcastCursor(sessionId, 'BOT002');
    expect(cursorAfterSuccess.last_read_event_id).toBe(event.event_id);
    expect(cursorAfterSuccess.acknowledged_event_ids).toContain(event.event_id);
  });

  it('PKU-006 & PKU-007: Inbox message callback failure transitions message to RETRY_PENDING, and stale worker ACK with outdated fence_token is rejected', async () => {
    const sessionId = 'S_PHASE5_PKU007_FENCING';
    await seedSessionWithBots(sessionId);

    const pkuStore = new InMemoryPKUStore();
    const runtime = new MemoryRuntime(storage, pkuStore);

    const { message } = await runtime.messagingBridge.sendKnowledgeAwareDirectMessage(
      sessionId,
      {
        senderBotId: 'BOT001',
        recipient: 'BOT002',
        messageType: 'REQUEST',
        content: 'Run database migration step 1',
        maxAttempts: 3,
      },
      {
        executionRefs: ['mig_step_1'],
      }
    );

    // 1. First worker claims and fails inside callback -> transitions to RETRY_PENDING (PKU-006)
    await expect(
      runtime.messagingBridge.processNextInboxMessageSafely(
        sessionId,
        'BOT002',
        'worker_1',
        async () => {
          throw new Error('Temporary lock contention');
        }
      )
    ).rejects.toThrow(/Temporary lock contention/);

    const inboxAfterFail = await storage.getInbox(sessionId, 'BOT002');
    const failedMsg = inboxAfterFail.messages.find((m) => m.message_id === message.message_id);
    expect(failedMsg?.delivery_state).toBe('RETRY_PENDING');
    expect(failedMsg?.attempt_count).toBe(1);
    expect(failedMsg?.fence_token).toBe(1);
    expect(failedMsg?.lease_owner).toBeNull();

    // 2. Worker 1 claims again with short lease (10ms), then stalls while Worker 2 reclaims after expiry (PKU-007)
    const claimedByWorker1 = await messagingService.delivery.claimNextMessage(
      sessionId,
      'BOT002',
      'worker_1_stalled',
      10
    );
    expect(claimedByWorker1).not.toBeNull();
    expect(claimedByWorker1?.fence_token).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 35));

    const claimedByWorker2 = await messagingService.delivery.claimNextMessage(
      sessionId,
      'BOT002',
      'worker_2_active',
      30000
    );
    expect(claimedByWorker2).not.toBeNull();
    expect(claimedByWorker2?.fence_token).toBe(3);
    expect(claimedByWorker2?.lease_owner).toBe('worker_2_active');

    // Stale worker 1 tries to ACK using fence_token=2 or wrong lease_owner -> MUST be rejected (PKU-007)
    await expect(
      runtime.messagingBridge.completeInboxMessageWithFencing(
        sessionId,
        'BOT002',
        message.message_id,
        'worker_1_stalled',
        claimedByWorker1!.fence_token
      )
    ).rejects.toThrow(/lease held by another consumer/);

    // Even if worker_2_active supplies stale fence_token=2 -> MUST be rejected (PKU-007)
    await expect(
      runtime.messagingBridge.completeInboxMessageWithFencing(
        sessionId,
        'BOT002',
        message.message_id,
        'worker_2_active',
        claimedByWorker1!.fence_token
      )
    ).rejects.toThrow(/stale fencing token/);

    // Active worker 2 completes with valid fence_token=3 -> succeeds
    const completedMsg = await runtime.messagingBridge.completeInboxMessageWithFencing(
      sessionId,
      'BOT002',
      message.message_id,
      'worker_2_active',
      claimedByWorker2!.fence_token
    );
    expect(completedMsg.delivery_state).toBe('COMPLETED');
    expect(completedMsg.status).toBe('acknowledged');
  });
});
