# ADR-005: Knowledge-Aware Messaging Integration & Delivery Safety

- **Status:** Accepted
- **Phase:** Phase 5 — Knowledge-Aware Messaging Integration
- **Date:** 2026-11-09
- **Spec Reference:** PKU Unified Persistent Memory Architecture v0.2 (§7.3, §9.2, §13.1, §13.3), `ACCEPTANCE_TEST_MATRIX.md` (`PKU-006`, `PKU-007`, `PKU-008`, `PKU-009`), `OWNERSHIP_MATRIX.md`

---

## 1. Context

Almudaya v0.3.3 includes an operational messaging subsystem (`src/messaging/`) with:
- `DirectMessageSchema` and per-bot `InboxStore` (`bots/<botId>/inbox.json`)
- A 5-state inbox delivery state machine (`RECEIVED` -> `PROCESSING` -> `COMPLETED` | `RETRY_PENDING` | `DEAD_LETTER`) guarded by `lease_owner`, `lease_expires_at`, and `fence_token` (`InboxDeliveryService`)
- Session broadcast logs (`broadcast/events.jsonl`) with per-bot, per-category `BroadcastCursor` (`bots/<botId>/broadcast_cursor.json`) that advances only after consumer callbacks succeed.

Phase 5 requires integrating PKU knowledge references (`knowledgeRefs`, `executionRefs`, `checkpointRef`, `handoffContext`) into direct messages and handoffs without modifying `DirectMessageSchema` required fields or breaking inbox fencing and broadcast cursor semantics.

---

## 2. Decision

1. **Non-Intrusive Sidecar + Metadata Envelope (`KnowledgeAwareMessagingBridge`):**
   - Implement `IKnowledgeAwareMessagingBridge` in `src/memory_modules/messaging/knowledge-messaging-bridge.ts`.
   - `attachKnowledgeReferences(messageId, references, context?)` stores sanitized `MessageKnowledgeReferences` in an in-memory cache and persists a sidecar `KnowledgeObject` (`type: 'messaging.knowledge_references'`, `scope: 'session'`) in PKU.
   - `sendKnowledgeAwareDirectMessage(sessionId, input, references?, extractOptions?)` delegates message creation and delivery storage to the existing `MessagingService.sendDirectMessage`, embedding optional `pku_references` inside `DirectMessage.metadata` (which is already `z.record(z.string(), z.unknown()).optional().default({})` in `DirectMessageSchema`).

2. **Strict Separation of Operational Message Events vs. Extracted Knowledge Records:**
   - Every ingested direct message is recorded as an operational `MemoryEvent` (`eventType: 'message.direct'`, `registerKind: 'individual'`) via `IPKUStore.appendEvent`.
   - Durable `KnowledgeObject` records (`type: 'agent.message_knowledge'`) are created **only** when the message carries qualified knowledge (`extractKnowledge: true`, attached `handoffContext`, or `metadata.extract_knowledge === true`), and are linked via a deterministic `derived_from` `KnowledgeRelation` referencing the operational `MemoryEvent.id`.

3. **Principal Isolation on Message References (`PKU-009`):**
   - `resolveKnowledgeReferences(messageId, principalId)` and `resolveReferencedKnowledgeObjects(messageId, principalId)` verify that `principalId` is an authorized participant (sender, recipient, or system principal) and grant explicit shared read permission (`explicitSharedKnowledgeIds`) only for the `knowledgeRefs` and `handoffContext.sharedKnowledgeIds` attached to that message. Uninvolved bots receive `MemoryAccessDeniedError`.

4. **Preservation of Broadcast Cursor and Inbox Lease/Fencing (`PKU-006`, `PKU-007`):**
   - `consumeBroadcastSafely(sessionId, botIdentifier, event, onBroadcastCallback)` executes `onBroadcastCallback` **before** calling `MessagingService.advanceBroadcastCursor`. If the callback throws, the cursor is never advanced and the broadcast remains unread and retryable (`PKU-006`).
   - `processNextInboxMessageSafely` and `completeInboxMessageWithFencing` / `failInboxMessageWithFencing` delegate lease acquisition and acknowledgement directly to `InboxDeliveryService` using the claimed `consumerId` and `fence_token`, ensuring stale workers with expired leases or outdated fencing tokens are strictly rejected (`PKU-007`).

---

## 3. Consequences

- **Zero Legacy Breakage:** `src/messaging/schema.ts`, `src/messaging/service.ts`, and `src/messaging/delivery.ts` remain 100% untouched.
- **Full Handoff Traceability:** Inter-bot handoffs automatically record both ACMA `handoff` cognitive memory and message-linked knowledge references.
- **Outage Resilience:** If PKU is disabled or unavailable, `KnowledgeAwareMessagingBridge` falls back to its in-memory reference map and legacy `MessagingService` operations without failing message delivery.
