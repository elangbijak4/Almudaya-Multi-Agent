import type { IBlackboardStorage } from '../../blackboard/interface.js';
import { redactRecursively, redactSecrets } from '../../execution/environment.js';
import type {
  BroadcastEvent,
  DirectMessage,
  SendDirectMessageInput,
} from '../../messaging/schema.js';
import { DirectMessageSchema } from '../../messaging/schema.js';
import { MessagingService } from '../../messaging/service.js';
import {
  computeContentHash,
  deriveIdempotencyKey,
  deriveKnowledgeId,
  deriveMemoryEventId,
  deriveProjectUniverseId,
  deriveRelationId,
} from '../contracts/identity.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  type HandoffContext,
  type KnowledgeId,
  type KnowledgeObject,
  type KnowledgeRelation,
  type KnowledgeScope,
  type MemoryEvent,
  type MemoryPermissionContext,
  type ProjectUniverseId,
} from '../contracts/types.js';
import type {
  IKnowledgeAwareMessagingBridge,
  MessageKnowledgeReferences,
} from '../ports/messaging.js';
import type { IPKUStore } from '../ports/pku-store.js';
import type { IRegisterPersistence } from '../ports/registers.js';
import type { ACMAIndividualRegisterBridge } from '../registers/individual-register.js';
import {
  canReadKnowledgeObject,
  MemoryAccessDeniedError,
} from '../registers/memory-client.js';

export interface StoredMessageReferenceEnvelope {
  messageId: string;
  sessionId?: string;
  projectUniverseId: ProjectUniverseId;
  senderBotId?: string;
  recipientBotId?: string;
  allowedPrincipals: string[];
  references: MessageKnowledgeReferences;
  updatedAt: string;
}

export interface ExtractKnowledgeOptions {
  projectUniverseId?: ProjectUniverseId;
  extractKnowledge?: boolean;
  knowledgeTitle?: string;
  knowledgeScope?: KnowledgeScope;
  knowledgeTags?: string[];
  knowledgeSummary?: string;
  references?: MessageKnowledgeReferences;
}

export interface IngestedMessageResult {
  memoryEvent: MemoryEvent;
  extractedKnowledge?: KnowledgeObject;
  derivedRelation?: KnowledgeRelation;
  handoffContext?: HandoffContext;
}

export interface KnowledgeMessagingBridgeOptions {
  customSecrets?: string[];
  enabled?: boolean;
  defaultProjectUniverseId?: ProjectUniverseId;
  individualBridge?: ACMAIndividualRegisterBridge;
}

const SYSTEM_PRINCIPALS = new Set(['HUMAN', 'SYSTEM', 'OPERATOR', 'ADMIN', 'CONSOLE']);

/**
 * Knowledge-Aware Messaging Bridge (Phase 5 — PKU-006, PKU-007, PKU-009).
 *
 * Extends Almudaya's existing DirectMessage and Broadcast infrastructure with:
 * - Optional knowledge, execution, checkpoint, and handoff reference attachments
 *   that preserve 100% backward compatibility with `DirectMessageSchema`.
 * - Strict separation between operational message events (`MemoryEvent`) and
 *   extracted durable knowledge records (`KnowledgeObject`).
 * - Post-callback broadcast cursor advancement (`PKU-006`).
 * - Preserved inbox lease ownership and fencing token validation (`PKU-007`).
 */
export class KnowledgeAwareMessagingBridge implements IKnowledgeAwareMessagingBridge {
  public readonly storage: IBlackboardStorage;
  private readonly messagingService: MessagingService;
  private readonly pkuStore: IPKUStore & IRegisterPersistence;
  private readonly individualBridge?: ACMAIndividualRegisterBridge;
  private readonly customSecrets: string[];
  private readonly defaultProjectUniverseId: ProjectUniverseId;
  private isEnabled: boolean;

  private readonly messageReferenceCache = new Map<string, StoredMessageReferenceEnvelope>();

  constructor(
    storage: IBlackboardStorage,
    pkuStore: IPKUStore & IRegisterPersistence,
    options: KnowledgeMessagingBridgeOptions = {},
    messagingService?: MessagingService
  ) {
    this.storage = storage;
    this.pkuStore = pkuStore;
    this.messagingService = messagingService ?? new MessagingService(storage);
    this.individualBridge = options.individualBridge;
    this.customSecrets = options.customSecrets ?? [];
    this.isEnabled = options.enabled ?? true;
    this.defaultProjectUniverseId =
      options.defaultProjectUniverseId ?? deriveProjectUniverseId('messaging_global');
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  public get enabled(): boolean {
    return this.isEnabled;
  }

  private sanitizeString(value: string): string {
    return redactSecrets(value, this.customSecrets);
  }

  private sanitizePayload<T>(value: T): T {
    return redactRecursively(value, this.customSecrets) as T;
  }

  private sanitizeReferences(references: MessageKnowledgeReferences): MessageKnowledgeReferences {
    const sanitized = this.sanitizePayload(references);
    return {
      ...(sanitized.knowledgeRefs ? { knowledgeRefs: [...sanitized.knowledgeRefs] } : {}),
      ...(sanitized.executionRefs ? { executionRefs: [...sanitized.executionRefs] } : {}),
      ...(sanitized.checkpointRef ? { checkpointRef: sanitized.checkpointRef } : {}),
      ...(sanitized.handoffContext ? { handoffContext: sanitized.handoffContext } : {}),
    };
  }

  /**
   * Attaches optional knowledge/execution/checkpoint/handoff references to a message ID.
   * Does not alter `DirectMessageSchema` required fields or mutate inbox delivery state.
   */
  public async attachKnowledgeReferences(
    messageId: string,
    references: MessageKnowledgeReferences,
    context?: {
      sessionId?: string;
      projectUniverseId?: ProjectUniverseId;
      senderBotId?: string;
      recipientBotId?: string;
    }
  ): Promise<void> {
    const trimmedMessageId = messageId.trim();
    if (!trimmedMessageId) {
      throw new Error('Cannot attach knowledge references: messageId must be non-empty.');
    }

    const cleanRefs = this.sanitizeReferences(references);
    const existing = this.messageReferenceCache.get(trimmedMessageId);
    const sessionId =
      context?.sessionId ??
      existing?.sessionId ??
      cleanRefs.handoffContext?.sessionId;
    const pmuId =
      context?.projectUniverseId ??
      existing?.projectUniverseId ??
      cleanRefs.handoffContext?.projectUniverseId ??
      (sessionId
        ? deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`)
        : this.defaultProjectUniverseId);

    const senderBotId =
      context?.senderBotId ??
      existing?.senderBotId ??
      cleanRefs.handoffContext?.sourceBotId;
    const recipientBotId =
      context?.recipientBotId ??
      existing?.recipientBotId ??
      cleanRefs.handoffContext?.targetBotId;

    const allowedPrincipals = Array.from(
      new Set(
        [
          ...(existing?.allowedPrincipals ?? []),
          senderBotId,
          recipientBotId,
        ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      )
    );

    const nowIso = new Date().toISOString();
    const envelope: StoredMessageReferenceEnvelope = {
      messageId: trimmedMessageId,
      ...(sessionId ? { sessionId } : {}),
      projectUniverseId: pmuId,
      ...(senderBotId ? { senderBotId } : {}),
      ...(recipientBotId ? { recipientBotId } : {}),
      allowedPrincipals,
      references: cleanRefs,
      updatedAt: nowIso,
    };

    this.messageReferenceCache.set(trimmedMessageId, envelope);

    if (!this.isEnabled) {
      return;
    }

    try {
      const contentHash = computeContentHash(envelope, this.customSecrets);
      const koId = deriveKnowledgeId({
        sourceSystem: 'almudaya.messaging',
        projectUniverseId: pmuId,
        sessionId,
        sourceType: 'messaging.knowledge_references',
        sourceRecordId: trimmedMessageId,
      });
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.messaging',
        scopeId: sessionId ?? 'global',
        sourceType: 'MessageKnowledgeReferences',
        sourceRecordId: trimmedMessageId,
        contentHash,
      });

      const refObject: KnowledgeObject = {
        id: koId,
        projectUniverseId: pmuId,
        type: 'messaging.knowledge_references',
        scope: 'session',
        ownerId: senderBotId,
        title: `Message Knowledge References ${trimmedMessageId}`,
        summary: `Knowledge reference sidecar for message ${trimmedMessageId}`,
        content: envelope as unknown as Record<string, unknown>,
        tags: [
          'messaging',
          'knowledge_references',
          `msg:${trimmedMessageId}`,
          ...(sessionId ? [`session:${sessionId}`] : []),
        ],
        provenance: {
          sourceSystem: 'almudaya.messaging',
          sourceType: 'MessageKnowledgeReferences',
          sourceId: trimmedMessageId,
          createdBy: senderBotId,
          createdAt: nowIso,
          ingestedAt: nowIso,
          contentHash,
          originProjectUniverseId: pmuId,
        },
        relationIds: [],
        validationStatus: 'validated',
        lifecycleStatus: 'active',
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        metadata: {
          ...(sessionId ? { sessionId } : {}),
          ...(senderBotId ? { senderBotId } : {}),
          ...(recipientBotId ? { recipientBotId } : {}),
          messageId: trimmedMessageId,
        },
      };

      await this.pkuStore.putKnowledge(refObject, idemKey);

      if (cleanRefs.handoffContext && this.individualBridge) {
        const handoffIdemKey = deriveIdempotencyKey({
          sourceSystem: 'almudaya.messaging',
          scopeId: cleanRefs.handoffContext.sessionId,
          sourceType: 'HandoffContext',
          sourceRecordId: cleanRefs.handoffContext.handoffId,
          contentHash: computeContentHash(cleanRefs.handoffContext, this.customSecrets),
        });
        await this.individualBridge.recordHandoff(cleanRefs.handoffContext, handoffIdemKey);
      }
    } catch {
      // Outage-safe: in-memory envelope remains available so messaging never fails
    }
  }

  /**
   * Resolves attached knowledge references for `messageId`, enforcing principal access control (`PKU-009`).
   */
  public async resolveKnowledgeReferences(
    messageId: string,
    principalId: string
  ): Promise<MessageKnowledgeReferences> {
    const trimmedMessageId = messageId.trim();
    const trimmedPrincipal = principalId.trim();
    if (!trimmedPrincipal) {
      throw new MemoryAccessDeniedError(
        `Cannot resolve knowledge references for message "${trimmedMessageId}": principalId is required.`
      );
    }

    let envelope = this.messageReferenceCache.get(trimmedMessageId);

    if (!envelope && this.isEnabled) {
      envelope = await this.loadEnvelopeFromPKU(trimmedMessageId);
      if (envelope) {
        this.messageReferenceCache.set(trimmedMessageId, envelope);
      }
    }

    if (!envelope) {
      return {};
    }

    const isSystemPrincipal = SYSTEM_PRINCIPALS.has(trimmedPrincipal.toUpperCase());
    if (
      !isSystemPrincipal &&
      envelope.allowedPrincipals.length > 0 &&
      !envelope.allowedPrincipals.includes(trimmedPrincipal)
    ) {
      throw new MemoryAccessDeniedError(
        `Principal "${trimmedPrincipal}" is not authorized to resolve knowledge references for message "${trimmedMessageId}".`
      );
    }

    return JSON.parse(JSON.stringify(envelope.references)) as MessageKnowledgeReferences;
  }

  /**
   * Resolves and returns the underlying `KnowledgeObject` records referenced by `messageId`
   * that `principalId` is permitted to read (`PKU-009`).
   */
  public async resolveReferencedKnowledgeObjects(
    messageId: string,
    principalId: string,
    permissionOverrides?: Partial<MemoryPermissionContext>
  ): Promise<KnowledgeObject[]> {
    const refs = await this.resolveKnowledgeReferences(messageId, principalId);
    const knowledgeRefs = Array.from(
      new Set([
        ...(refs.knowledgeRefs ?? []),
        ...(refs.handoffContext?.sharedKnowledgeIds ?? []),
      ])
    );
    if (knowledgeRefs.length === 0) {
      return [];
    }

    const envelope = this.messageReferenceCache.get(messageId.trim());
    const pmuId = envelope?.projectUniverseId ?? this.defaultProjectUniverseId;

    const permission: MemoryPermissionContext = {
      principalId,
      sessionId: envelope?.sessionId ?? permissionOverrides?.sessionId,
      botId: principalId,
      projectUniverseIds: permissionOverrides?.projectUniverseIds ?? [pmuId],
      scopes: permissionOverrides?.scopes ?? ['project', 'session', 'agent', 'shared'],
      capabilities: permissionOverrides?.capabilities ?? [],
      explicitSharedKnowledgeIds: Array.from(
        new Set([
          ...(permissionOverrides?.explicitSharedKnowledgeIds ?? []),
          ...(knowledgeRefs as KnowledgeId[]),
        ])
      ),
    };

    const resolved: KnowledgeObject[] = [];
    for (const rawId of knowledgeRefs) {
      const obj = await this.pkuStore.getKnowledge(rawId as KnowledgeId);
      if (!obj) {
        continue;
      }
      if (!canReadKnowledgeObject(obj, permission)) {
        throw new MemoryAccessDeniedError(
          `Principal "${principalId}" is not authorized to read referenced KnowledgeObject "${obj.id}".`
        );
      }
      resolved.push(obj);
    }

    return resolved;
  }

  private async loadEnvelopeFromPKU(
    messageId: string
  ): Promise<StoredMessageReferenceEnvelope | undefined> {
    try {
      const universes = await this.pkuStore.listUniverses();
      const candidatePmuIds = Array.from(
        new Set([
          this.defaultProjectUniverseId,
          ...universes.map((u) => u.id),
        ])
      );

      const queryRes = await this.pkuStore.queryKnowledge({
        projectUniverseIds: candidatePmuIds,
        types: ['messaging.knowledge_references'],
        text: messageId,
        limit: 10,
      });

      const match = queryRes.items.find(
        (item) =>
          item.provenance.sourceId === messageId ||
          (item.metadata && item.metadata['messageId'] === messageId)
      );
      if (match && match.content && typeof match.content === 'object') {
        return match.content as unknown as StoredMessageReferenceEnvelope;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  /**
   * Sends a direct message via `MessagingService.sendDirectMessage` while optionally
   * attaching `MessageKnowledgeReferences` and persisting the operational `MemoryEvent`
   * and any qualified extracted `KnowledgeObject` in PKU.
   *
   * 100% compatible with `DirectMessageSchema`.
   */
  public async sendKnowledgeAwareDirectMessage(
    sessionId: string,
    input: SendDirectMessageInput,
    references?: MessageKnowledgeReferences,
    extractOptions?: ExtractKnowledgeOptions
  ): Promise<{
    message: DirectMessage;
    ingested?: IngestedMessageResult;
  }> {
    const cleanRefs = references ? this.sanitizeReferences(references) : undefined;
    const enrichedMetadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      ...(cleanRefs ? { pku_references: cleanRefs } : {}),
    };

    const message = await this.messagingService.sendDirectMessage(sessionId, {
      ...input,
      metadata: enrichedMetadata,
    });

    // Validate strict conformance with DirectMessageSchema
    DirectMessageSchema.parse(message);

    if (cleanRefs) {
      await this.attachKnowledgeReferences(message.message_id, cleanRefs, {
        sessionId,
        projectUniverseId: extractOptions?.projectUniverseId,
        senderBotId: message.sender_bot_id,
        recipientBotId: message.recipient_bot_id,
      });
    }

    let ingested: IngestedMessageResult | undefined;
    if (this.isEnabled) {
      ingested = await this.ingestDirectMessageAndExtractKnowledge(sessionId, message, {
        ...extractOptions,
        references: cleanRefs ?? extractOptions?.references,
      });
    }

    return { message, ingested };
  }

  /**
   * Records a `DirectMessage` as an operational `MemoryEvent` (`eventType: 'message.direct'`)
   * and — when qualified — extracts a separate `KnowledgeObject` (`type: 'agent.message_knowledge'`)
   * linked by a `derived_from` `KnowledgeRelation` (`OWNERSHIP_MATRIX.md`).
   */
  public async ingestDirectMessageAndExtractKnowledge(
    sessionId: string,
    message: DirectMessage,
    options: ExtractKnowledgeOptions = {}
  ): Promise<IngestedMessageResult> {
    const pmuId =
      options.projectUniverseId ??
      deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);

    const sanitizedMessage = this.sanitizePayload(message);
    const nowIso = new Date().toISOString();
    const eventContentHash = computeContentHash(
      {
        message_id: sanitizedMessage.message_id,
        session_id: sanitizedMessage.session_id,
        sender_bot_id: sanitizedMessage.sender_bot_id,
        recipient_bot_id: sanitizedMessage.recipient_bot_id,
        message_type: sanitizedMessage.message_type,
        content: sanitizedMessage.content,
        metadata: sanitizedMessage.metadata,
      },
      this.customSecrets
    );

    const eventId = deriveMemoryEventId({
      sourceSystem: 'almudaya.messaging',
      sessionId,
      sourceType: 'message.direct',
      sourceRecordId: sanitizedMessage.message_id,
    });

    const eventIdemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.messaging',
      scopeId: `${sessionId}:${sanitizedMessage.recipient_bot_id}`,
      sourceType: 'DirectMessage',
      sourceRecordId: sanitizedMessage.message_id,
      contentHash: eventContentHash,
    });

    const memoryEvent: MemoryEvent = {
      id: eventId,
      eventType: 'message.direct',
      identity: {
        projectUniverseId: pmuId,
        sessionId,
        botId: sanitizedMessage.recipient_bot_id,
        principalId: sanitizedMessage.sender_bot_id,
        registerKind: 'individual',
      },
      payload: sanitizedMessage as unknown as Record<string, unknown>,
      occurredAt: sanitizedMessage.timestamp,
      recordedAt: nowIso,
      idempotencyKey: eventIdemKey,
      provenance: {
        sourceSystem: 'almudaya.messaging',
        sourceType: 'DirectMessage',
        sourceId: sanitizedMessage.message_id,
        createdBy: sanitizedMessage.sender_bot_id,
        createdAt: sanitizedMessage.timestamp,
        ingestedAt: nowIso,
        contentHash: eventContentHash,
        originProjectUniverseId: pmuId,
      },
    };

    if (this.isEnabled) {
      await this.pkuStore.appendEvent(memoryEvent, eventIdemKey);
    }

    const shouldExtractKnowledge =
      options.extractKnowledge === true ||
      Boolean(options.references?.handoffContext) ||
      Boolean(
        sanitizedMessage.metadata &&
          typeof sanitizedMessage.metadata === 'object' &&
          sanitizedMessage.metadata['extract_knowledge'] === true
      );

    let extractedKnowledge: KnowledgeObject | undefined;
    let derivedRelation: KnowledgeRelation | undefined;

    if (shouldExtractKnowledge) {
      const knowledgePayload = {
        messageId: sanitizedMessage.message_id,
        sessionId,
        senderBotId: sanitizedMessage.sender_bot_id,
        recipientBotId: sanitizedMessage.recipient_bot_id,
        messageType: sanitizedMessage.message_type,
        content: sanitizedMessage.content,
        references: options.references ?? null,
      };
      const koHash = computeContentHash(knowledgePayload, this.customSecrets);
      const koId = deriveKnowledgeId({
        sourceSystem: 'almudaya.messaging',
        projectUniverseId: pmuId,
        sessionId,
        sourceType: 'agent.message_knowledge',
        sourceRecordId: sanitizedMessage.message_id,
      });
      const koIdemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.messaging',
        scopeId: sessionId,
        sourceType: 'ExtractedMessageKnowledge',
        sourceRecordId: sanitizedMessage.message_id,
        contentHash: koHash,
      });

      const primaryRefId =
        options.references?.knowledgeRefs?.[0] ??
        options.references?.handoffContext?.sharedKnowledgeIds?.[0] ??
        koId;

      const relId = deriveRelationId(koId, 'derived_from', primaryRefId);

      const koRecord: KnowledgeObject = {
        id: koId,
        projectUniverseId: pmuId,
        type: 'agent.message_knowledge',
        scope: options.knowledgeScope ?? 'session',
        ownerId: sanitizedMessage.sender_bot_id,
        title:
          options.knowledgeTitle ??
          `Message Knowledge (${sanitizedMessage.sender_bot_id} -> ${sanitizedMessage.recipient_bot_id})`,
        summary:
          options.knowledgeSummary ??
          this.sanitizeString(sanitizedMessage.content.slice(0, 200)),
        content: knowledgePayload,
        tags: [
          'messaging',
          'extracted_knowledge',
          `msg:${sanitizedMessage.message_id}`,
          `sender:${sanitizedMessage.sender_bot_id}`,
          `recipient:${sanitizedMessage.recipient_bot_id}`,
          ...(options.knowledgeTags ?? []),
        ],
        provenance: {
          sourceSystem: 'almudaya.messaging',
          sourceType: 'DirectMessage',
          sourceId: sanitizedMessage.message_id,
          createdBy: sanitizedMessage.sender_bot_id,
          createdAt: sanitizedMessage.timestamp,
          ingestedAt: nowIso,
          contentHash: koHash,
          originProjectUniverseId: pmuId,
        },
        relationIds: [relId],
        validationStatus: 'validated',
        lifecycleStatus: 'active',
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: sanitizedMessage.timestamp,
        updatedAt: nowIso,
        metadata: {
          sessionId,
          messageId: sanitizedMessage.message_id,
          sourceEventId: memoryEvent.id,
        },
      };

      const relRecord: KnowledgeRelation = {
        relationId: relId,
        projectUniverseId: pmuId,
        fromId: koId,
        toId: primaryRefId,
        relationType: 'derived_from',
        weight: 1.0,
        createdAt: nowIso,
        metadata: {
          sourceEventId: memoryEvent.id,
          messageId: sanitizedMessage.message_id,
        },
        provenance: {
          sourceSystem: 'almudaya.messaging',
          sourceType: 'DirectMessage',
          sourceId: sanitizedMessage.message_id,
          createdBy: sanitizedMessage.sender_bot_id,
          createdAt: sanitizedMessage.timestamp,
          ingestedAt: nowIso,
          contentHash: koHash,
          originProjectUniverseId: pmuId,
        },
      };

      if (this.isEnabled) {
        await this.pkuStore.putKnowledge(koRecord, koIdemKey);
        await this.pkuStore.putRelation(relRecord, `${koIdemKey}_rel`);
      }

      extractedKnowledge = koRecord;
      derivedRelation = relRecord;
    }

    if (options.references?.handoffContext && this.individualBridge && this.isEnabled) {
      const handoff = options.references.handoffContext;
      const handoffIdemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.messaging',
        scopeId: handoff.sessionId,
        sourceType: 'HandoffContext',
        sourceRecordId: handoff.handoffId,
        contentHash: computeContentHash(handoff, this.customSecrets),
      });
      await this.individualBridge.recordHandoff(handoff, handoffIdemKey);
    }

    return {
      memoryEvent,
      ...(extractedKnowledge ? { extractedKnowledge } : {}),
      ...(derivedRelation ? { derivedRelation } : {}),
      ...(options.references?.handoffContext
        ? { handoffContext: options.references.handoffContext }
        : {}),
    };
  }

  /**
   * Consumes a broadcast event safely (`PKU-006`).
   *
   * Guarantees that the bot's `BroadcastCursor` is ONLY advanced after `onBroadcastCallback`
   * resolves without throwing. If the callback fails, the cursor is left untouched so
   * the broadcast remains unread and retryable.
   */
  public async consumeBroadcastSafely(
    sessionId: string,
    botIdentifier: string,
    event: BroadcastEvent,
    onBroadcastCallback: (event: BroadcastEvent) => Promise<void>
  ): Promise<void> {
    // 1. Run consumer callback first; if this throws, cursor MUST NOT advance (PKU-006)
    await onBroadcastCallback(event);

    // 2. Callback succeeded -> advance legacy BroadcastCursor
    await this.messagingService.advanceBroadcastCursor(sessionId, botIdentifier, event);

    // 3. Best-effort PKU event capture (never breaks broadcast consumption)
    if (this.isEnabled) {
      try {
        const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);
        const cleanEvent = this.sanitizePayload(event);
        const contentHash = computeContentHash(cleanEvent, this.customSecrets);
        const nowIso = new Date().toISOString();
        const idemKey = deriveIdempotencyKey({
          sourceSystem: 'almudaya.blackboard',
          scopeId: sessionId,
          sourceType: 'BroadcastEvent',
          sourceRecordId: event.event_id,
          contentHash,
        });
        const memEvent: MemoryEvent = {
          id: deriveMemoryEventId({
            sourceSystem: 'almudaya.blackboard',
            sessionId,
            sourceType: `broadcast.${event.category.toLowerCase()}`,
            sourceRecordId: event.event_id,
          }),
          eventType: `broadcast.${event.category.toLowerCase()}`,
          identity: {
            projectUniverseId: pmuId,
            sessionId,
            botId: event.sender_bot_id,
            principalId: event.sender_bot_id,
            registerKind: 'global',
          },
          payload: cleanEvent as unknown as Record<string, unknown>,
          occurredAt: event.timestamp,
          recordedAt: nowIso,
          idempotencyKey: idemKey,
          provenance: {
            sourceSystem: 'almudaya.blackboard',
            sourceType: 'BroadcastEvent',
            sourceId: event.event_id,
            createdBy: event.sender_bot_id,
            createdAt: event.timestamp,
            ingestedAt: nowIso,
            contentHash,
            originProjectUniverseId: pmuId,
          },
        };
        await this.pkuStore.appendEvent(memEvent, idemKey);
      } catch {
        // Outage-safe
      }
    }
  }

  /**
   * Claims and processes the next eligible inbox message while preserving
   * `lease_owner`, `lease_expires_at`, and `fence_token` validation (`PKU-006`, `PKU-007`).
   *
   * - On callback success: calls `completeMessage` with `consumerId` and `claimed.fence_token`.
   * - On callback failure: calls `failMessage` with `consumerId` and `claimed.fence_token`
   *   so the message transitions to `RETRY_PENDING` (or `DEAD_LETTER`) and remains retryable.
   */
  public async processNextInboxMessageSafely(
    sessionId: string,
    botIdentifier: string,
    consumerId: string,
    onMessageCallback: (
      message: DirectMessage,
      references: MessageKnowledgeReferences
    ) => Promise<void>,
    options?: {
      leaseDurationMs?: number;
      excludeMessageIds?: string[];
    }
  ): Promise<DirectMessage | null> {
    const claimed = await this.messagingService.delivery.claimNextMessage(
      sessionId,
      botIdentifier,
      consumerId,
      options?.leaseDurationMs,
      options?.excludeMessageIds
    );

    if (!claimed) {
      return null;
    }

    let references: MessageKnowledgeReferences = {};
    try {
      references = await this.resolveKnowledgeReferences(
        claimed.message_id,
        claimed.recipient_bot_id
      );
    } catch {
      references = {};
    }

    try {
      await onMessageCallback(claimed, references);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.messagingService.delivery.failMessage(
        sessionId,
        botIdentifier,
        claimed.message_id,
        errorMessage,
        consumerId,
        claimed.fence_token
      );
      throw err;
    }

    const completed = await this.messagingService.delivery.completeMessage(
      sessionId,
      botIdentifier,
      claimed.message_id,
      consumerId,
      claimed.fence_token
    );

    if (this.isEnabled) {
      try {
        await this.ingestDirectMessageAndExtractKnowledge(sessionId, completed, {
          references,
        });
      } catch {
        // Outage-safe
      }
    }

    return completed;
  }

  /**
   * Completes an inbox message with strict `consumerId` and `fenceToken` validation (`PKU-007`).
   * Stale workers with outdated fence tokens or mismatched lease owners are rejected.
   */
  public async completeInboxMessageWithFencing(
    sessionId: string,
    botIdentifier: string,
    messageId: string,
    consumerId: string,
    fenceToken: number
  ): Promise<DirectMessage> {
    return await this.messagingService.delivery.completeMessage(
      sessionId,
      botIdentifier,
      messageId,
      consumerId,
      fenceToken
    );
  }

  /**
   * Fails an inbox message with strict `consumerId` and `fenceToken` validation (`PKU-007`).
   */
  public async failInboxMessageWithFencing(
    sessionId: string,
    botIdentifier: string,
    messageId: string,
    error: string,
    consumerId: string,
    fenceToken: number
  ): Promise<DirectMessage> {
    return await this.messagingService.delivery.failMessage(
      sessionId,
      botIdentifier,
      messageId,
      error,
      consumerId,
      fenceToken
    );
  }
}
