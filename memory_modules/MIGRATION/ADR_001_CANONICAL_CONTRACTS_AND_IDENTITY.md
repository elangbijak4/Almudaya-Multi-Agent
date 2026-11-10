# ADR-001 — PKU Canonical Contracts, Deterministic Identity, and Ownership Boundaries

- **Status:** Approved & Implemented (Phase 1)
- **Date:** 2026-11-09
- **Spec Reference:** `PKU_Unified_Persistent_Memory_Architecture_Specification_v0.2.md` (§4–§14), `ACCEPTANCE_CRITERIA_AND_TEST_TRACEABILITY_MATRIX.md` (`PKU-001`, `PKU-002`)

---

## 1. Context

Almudaya Multi-Agent v0.3.3 operates with file-backed session state (`FilesystemSessionStorage`), per-bot inbox/cursor files (`InboxStore`, `BroadcastCursor`), shared session work-logs (`WorkLogEngine`), and capability governance (`CapabilityPersistence`). Before introducing any read-only compatibility bridge (Phase 2) or local PKU store (Phase 3), the system requires:

1. **Pure canonical contracts and runtime Zod schemas** (`PKU-001`) that validate `KnowledgeObject`, `ProjectMemoryUniverse`, `KnowledgeProvenance`, `KnowledgeRelation`, `KnowledgeTreeNode`, `MemoryIdentity`, `RegisterSnapshot`, `ExecutionCheckpoint`, `HandoffContext`, `MemoryEvent`, `MemoryPermissionContext`, `MemoryLifecycleRequest`, and `MemoryLifecyclePlan` with actionable field-path diagnostics.
2. **Deterministic identity, canonical serialization, and secret-redacting content hashes** (`PKU-002`, `PKU-008`) so importing or replaying legacy records produces identical IDs and idempotency keys without duplicating knowledge or leaking secrets.
3. **Explicit source-of-truth and persistence qualification boundaries** (`RISK-03`, `RISK-08`) so high-frequency operational ticks (such as 2-second bot heartbeats) are never persisted as knowledge churn in PKU, and PKU lifecycle operations never delete external source files or live operational registers.

---

## 2. Decisions

### 2.1 Canonical Domain Contracts & Separate Tree Membership (`src/memory_modules/contracts/types.ts`)
- All PKU domain types are defined as pure TypeScript contracts with `CURRENT_PKU_SCHEMA_VERSION = '1.0.0'`.
- **Tree vs. Graph Separation (`KnowledgeTreeNode` vs. `KnowledgeRelation`):** Hierarchical PMU tree membership (`KnowledgeTreeNode`, supporting domains `Identity`, `Requirements`, `Architecture`, `Architecture/Modules`, `Architecture/Components`, `Architecture/Interfaces`, `Development`, `Experiments`, `Decisions`, `Tests`, `Roadmap`) is modeled distinctly from semantic graph edges (`KnowledgeRelation`). This guarantees that structural pruning (`prune` / `detach`) only modifies tree membership without destroying shared `KnowledgeObject` records (`PKU-015`).
- **ACMA Continuity Contracts:** Explicit contracts for `ACMAMemoryDomain` (`working`, `semantic`, `episodic`, `procedural`, `retrieval`, `prospective`, `checkpoint`, `handoff`), `ExecutionCheckpoint`, and `HandoffContext` are defined without assuming a pre-existing ACMA runtime class.

### 2.2 Strict Zod Schema Validation & Evolution (`src/memory_modules/contracts/schemas.ts`)
- Every canonical contract is paired with a strict Zod 4 schema (`KnowledgeObjectSchema`, `ProjectMemoryUniverseSchema`, `MemoryEventSchema`, `RegisterSnapshotSchema`, `ExecutionCheckpointSchema`, `HandoffContextSchema`, `KnowledgeRelationSchema`, `KnowledgeTreeNodeSchema`, `MemoryLifecycleRequestSchema`, `MemoryLifecyclePlanSchema`).
- Cross-field invariants are enforced via `.refine(...)`:
  - `KnowledgeObject` with `scope === 'agent'` requires a non-empty `ownerId`.
  - `MemoryIdentity` with `registerKind === 'individual'` requires a non-empty `botId`.
  - `KnowledgeObject.content`, `RegisterSnapshot.state`, and `MemoryEvent.payload` cannot be `undefined`.
- Validation failures throw `ValidationError` (from `src/core/errors.ts`) formatted via `formatSchemaDiagnostics(entityName, zodError)` with bracketed field paths (e.g., `[provenance.createdAt]`, `[ownerId]`).
- `SchemaEvolutionRegistry` provides deterministic step-by-step version migration (`registerStep`, `upgradeToVersion`) to upcast older `schemaVersion` payloads prior to schema validation.

### 2.3 Deterministic Identity, Canonical JSON & Secret-Redacted Hashing (`src/memory_modules/contracts/identity.ts`)
- `canonicalizeJson(value)` recursively sorts object keys lexicographically while preserving array element order and omitting `undefined` object keys.
- `computeContentHash(value, customSecrets)` runs `redactRecursively(value, customSecrets)` from `src/execution/environment.ts` **before** serializing with `canonicalizeJson` and computing a SHA-256 hex digest. This guarantees both key-order invariance (`PKU-002`) and secret redaction prior to hashing (`PKU-008`).
- Deterministic ID generators:
  - `deriveProjectUniverseId(projectKey)` -> `pmu_<24-hex>`
  - `deriveKnowledgeId(input)` -> `pku_ko_<32-hex>`
  - `deriveMemoryEventId(input)` -> `pku_evt_<32-hex>`
  - `deriveRelationId(fromId, relationType, toId)` -> `pku_rel_<32-hex>`
  - `deriveTreeNodeId(projectUniverseId, domainPath)` -> `pku_tree_<24-hex>`
  - `deriveCheckpointId(sessionId, botId, sourceMessageId, iteration)` -> `pku_chk_<24-hex>`
  - `deriveIdempotencyKey(input)` -> `idem_<36-hex>`

### 2.4 Source-of-Truth Boundaries & Persistence Qualification (`src/memory_modules/contracts/ownership.ts`)
- `SOURCE_OF_TRUTH_BOUNDARIES` codifies ownership across 10 domains (`source_code`, `commit_history`, `session_coordination_state`, `individual_agent_continuity`, `project_knowledge_representation`, `message_delivery_state`, `capability_governance_state`, `external_obsidian_notes`, `external_vector_index`, `external_graph_store`). Only `project_knowledge_representation` allows `pkuMayPhysicallyDeleteSource: true`.
- `qualifiesBotRegistryMutation(previous, next)` mitigates `RISK-03`: returns `false` when only `last_seen_at` or `pid` changes (ignoring 2-second heartbeat ticks from `BotRuntime`), and returns `true` only on initial registration or changes to `bot_id`, `display_name`, `status`, `description`, or `metadata`.
- `qualifiesBroadcastForKnowledgePromotion(category)` promotes `DECISION`, `ARTIFACT`, and `OBSERVATION` broadcasts while keeping `INFO`, `WARNING`, `ERROR`, and `HEARTBEAT` as operational events.
- `qualifiesDirectMessageForKnowledgeExtraction(message)` promotes direct messages only when `metadata.promoteToKnowledge === true` or non-empty `metadata.knowledgeRefs` are attached.

### 2.5 Clean Port Interfaces (`src/memory_modules/ports/`)
- Defined pure TypeScript port interfaces for `IPKUStore`, `IRegisterPersistence`, `IGlobalRegisterBridge`, `IIndividualRegisterBridge`, `IKnowledgeOptimizationEngine`, `IKnowledgeAwareMessagingBridge`, `IMemoryLifecycleManager`, `IExternalMemoryAdapter`, `IUnifiedMemoryInterface`, and `IMemoryIntegrationGateway`.
- Preserved 100% of scaffold port method signatures while adding optional tree/relation/checkpoint extensions.
- Zero runtime side effects: `src/index.ts` and `BotRuntime` are untouched in Phase 1.

---

## 3. Consequences

- **Positive:** Downstream phases (Phase 2 Read-Only Compatibility Bridge and Phase 3 Local PKU Store) can rely on deterministic IDs, replay-safe idempotency keys, secret-safe content hashes, and strict Zod validation without any ambiguity.
- **Zero Regression:** Existing 47 test suites (379 tests) continue to pass unchanged alongside the new Phase 1 contract test suite (12 tests; 391 total tests passing).
