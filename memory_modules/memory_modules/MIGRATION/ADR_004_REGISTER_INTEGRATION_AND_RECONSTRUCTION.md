# ADR-004 — Register Integration, Scoped Memory Client Isolation, and Register Reconstruction

- **Status:** Approved & Implemented (Phase 4)
- **Date:** 2026-11-09
- **Spec Reference:** `PKU_Unified_Persistent_Memory_Architecture_Specification_v0.2.md` (§6, §7, §11, §13), `INTEGRATION_MAP.md`, `ACCEPTANCE_TEST_MATRIX.md` (`PKU-004`, `PKU-009`, `PKU-010`, `PKU-011`, `PKU-019`)

---

## 1. Context

Phase 4 (Gate 4 & Gate 6 reconstruction) integrates PKU with the operational Global Register (Blackboard) and Individual Register (ACMA) while upholding the following constraints:
1. **Legacy Authority & Outage Resilience (`PKU-004`, `PKU-019`):** `IBlackboardStorage` (`FilesystemSessionStorage`) remains authoritative for live session coordination. Any PKU outage or manual `disable()` rollback must never break live session, bot, messaging, cursor, or work-log operations.
2. **Bot Identity Prerequisite & Private Isolation (`PKU-009`):** A bot's `ScopedMemoryClient` and Individual Register can only be created after canonical `botId` is initialized. Private agent-scoped memories (`scope === 'agent'`) and Individual Registers must be isolated per bot and session unless explicit shared grants (`explicitSharedKnowledgeIds`) or admin capabilities exist.
3. **Honest ACMA Integration:** Because v0.3.3 has per-bot inbox/cursor/registry state but no legacy ACMA cognitive store class, `ACMAIndividualRegisterBridge` wraps existing per-bot operational state via `ReadOnlyIndividualRegisterBridge` and implements the new ACMA cognitive memory domains (`working`, `semantic`, `episodic`, `procedural`, `retrieval`, `prospective`, `checkpoint`, `handoff`) backed by `IPKUStore & IRegisterPersistence`.
4. **Register Reconstruction (`PKU-010`, `PKU-011`):** Both the Global Register and each bot's Individual Register must be reconstructible from PKU snapshots, `KnowledgeObject` records, and `MemoryEvent` streams with deterministic ordering and zero cross-bot leakage.

---

## 2. Decisions

### 2.1 `ScopedMemoryClient` (`src/memory_modules/registers/memory-client.ts`)
- Enforces `canReadKnowledgeObject` and `canWriteKnowledgeObject` on every `getKnowledge`, `queryKnowledge`, and `putKnowledge` call.
- Rejects cross-bot access to `scope === 'agent'` objects and `registerKind === 'individual'` snapshots with `MemoryAccessDeniedError` (`PKU-009`) unless `explicitSharedKnowledgeIds` includes the target `KnowledgeId` or `memory.admin.read_all` is granted.
- Rejects cross-project queries unless `projectUniverseIds` is authorized or `cross_project` scope + `reusable === true` is satisfied (`PKU-014`).

### 2.2 `BlackboardGlobalRegisterBridge` (`src/memory_modules/registers/global-register.ts`)
- Implements `IGlobalRegisterBridge` supporting `read_only`, `capture`, and `read_through` modes.
- Fails open on PKU store errors (`outageCount++`, `syncStatus = 'synchronization_failed'`, queues failed event into `DurableOutboxQueue`) so legacy Blackboard coordination is never interrupted (`PKU-004`).
- `reconstructGlobalRegister(sessionId, projectUniverseId)` (`PKU-010`) reconstructs `session`, `projectRoots`, `bots`, `environmentMetadata`, `sdlcDocuments`, `broadcastEvents`, and `workLogEntries` with deterministic sorting and source order preservation.

### 2.3 `ACMAIndividualRegisterBridge` (`src/memory_modules/registers/individual-register.ts`)
- Implements `IIndividualRegisterBridge` and provides `recordCognitiveMemory`, `saveCheckpoint`, `recordHandoff`, `syncIndividualSnapshotToPKU`, and `reconstructIndividualRegister` (`PKU-011`).
- `reconstructIndividualRegister` enforces caller authorization (`PKU-009`) and filters out any object whose `ownerId !== botId` or `sessionId !== targetSessionId`, preventing cross-bot and cross-session leakage (`PKU-011`).

### 2.4 `MemoryRuntime` Composition Root (`src/memory_modules/registers/memory-runtime.ts`)
- Assembles `pkuStore`, `globalBridge`, `individualBridge`, and `outbox`.
- `disable()` and `enable()` implement instant non-destructive rollback (`PKU-019`).
- `observeBotRegistryMutation(sessionId, previous, next)` filters out 2-second heartbeat ticks via `qualifiesBotRegistryMutation` (`RISK-03`).

---

## 3. Consequences

- **Positive:** Operational registers (Global Blackboard and Individual ACMA) are now bridged to PKU with strict permission enforcement, full state reconstruction, heartbeat churn protection, and zero-downtime resilience on PKU outages.
