# ADR-009: Universal Memory Interface (UMI) & External Memory Adapter Gateway

- **Status:** Accepted
- **Phase:** Phase 9 — Universal Memory Interface (UMI), External Memory Adapter Layer & Final Acceptance Verification
- **Date:** 2026-11-10
- **Spec Reference:** PKU Unified Persistent Memory Architecture v0.2 (§11, §12, §14), `ACCEPTANCE_TEST_MATRIX.md` (`PKU-001`..`PKU-020`)

---

## 1. Context

The PKU Unified Persistent Memory Architecture requires a single internal facade (`IUnifiedMemoryInterface`) connecting all memory subsystems (`IPKUStore`, `IRegisterPersistence`, `IGlobalRegisterBridge`, `IIndividualRegisterBridge`, `IKnowledgeOptimizationEngine`, `IKnowledgeAwareMessagingBridge`, `IMemoryLifecycleManager`) alongside an external adapter gateway (`IMemoryIntegrationGateway`) capable of integrating external vector, graph, or document databases without risking data loss or runtime failures when external backends disconnect or lack specific capabilities (`PKU-020`).

---

## 2. Decision

1. **Local-First Authority & Outbox-Buffered External Sync (`PKU-020`):**
   - `MemoryIntegrationGateway.writeThroughAdapter(adapterId, object, idempotencyKey?)` always commits the secret-redacted (`PKU-008`), schema-validated (`PKU-001`) `KnowledgeObject` to the authoritative local `IPKUStore` **first** (`localCommitted: true`).
   - If the external adapter is disconnected, fails `healthCheck()`, or throws during `pushKnowledge`, the write is enqueued into `DurableOutboxQueue` (`adapter_sync:<adapterId>:<idemKey>`) and an audit `MemoryEvent` (`adapter.degraded_write_buffered`) is recorded, guaranteeing **zero hidden data loss** (`PKU-020`).
   - When the adapter reconnects, `replayBufferedWrites(adapterId)` drains buffered writes idempotently.

2. **Capability-Specific Graceful Degradation (`PKU-020`):**
   - Every `IExternalMemoryAdapter` declares a `MemoryAdapterManifest` with 9 boolean flags (`read`, `write`, `search`, `semanticSearch`, `graphTraversal`, `export`, `import`, `incrementalSync`, `delete`).
   - `queryWithFallback(adapterId, query, options?)` checks adapter capability flags and health before querying; if a required capability (`semanticSearch`, `graphTraversal`, `search`) is unsupported or the adapter is unreachable, it degrades gracefully to `IPKUStore.queryKnowledge` (`source: 'local_pku_fallback'`, `degraded: true`).

3. **Unified Memory Interface (`UnifiedMemoryInterface` & `MemoryRuntime`):**
   - `MemoryRuntime` implements `IUnifiedMemoryInterface` directly and exposes `runtime.umi` and `runtime.gateway` alongside all phase services.

---

## 3. Consequences

- **Complete `PKU-001`–`PKU-020` Compliance:** All 20 acceptance criteria in `ACCEPTANCE_TEST_MATRIX.md` are implemented and verified by automated Vitest suites.
- **Zero Vendor Lock-In:** External memory backends can be attached or detached at runtime via `IMemoryIntegrationGateway` without affecting local PKU or legacy Blackboard operations.
