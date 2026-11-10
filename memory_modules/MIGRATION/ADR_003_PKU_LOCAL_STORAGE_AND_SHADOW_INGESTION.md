# ADR-003 — Local-First PKU Storage Engine, Durable Outbox & Shadow Ingestion

- **Status:** Approved & Implemented (Phase 3)
- **Date:** 2026-11-09
- **Spec Reference:** `PKU_Unified_Persistent_Memory_Architecture_Specification_v0.2.md` (§5, §12, §13), `TECHNOLOGY_DECISIONS_PENDING.md`, `ROLLBACK_AND_RECONCILIATION.md`, `ACCEPTANCE_TEST_MATRIX.md` (`PKU-002`, `PKU-008`, `PKU-018`)

---

## 1. Context

`TECHNOLOGY_DECISIONS_PENDING.md` requires an explicit Architecture Decision Record (ADR) before selecting a persistence backend for PKU, evaluating:
1. Windows/Linux support and Node.js 22+ compatibility.
2. Local-first offline operation and zero external server dependencies.
3. Data portability, human-inspectable backup/restore, and strict separation from `<workspaceRoot>/sessions/`.
4. Transaction, durable outbox, idempotency, and multi-process locking consistency.
5. Mandatory recursive secret redaction (`PKU-008`) before any byte reaches disk.

---

## 2. Decisions

### 2.1 Local-First Storage Implementations Behind `IPKUStore` & `IRegisterPersistence` (`src/memory_modules/pku/local-store.ts`)
We implement two interchangeable stores behind `IPKUStore` and `IRegisterPersistence`:
1. **`LocalFilesystemPKUStore`:**
   - Stores all PKU state under an isolated directory `<pkuRootDir>` (typically `<workspaceRoot>/pku/`), completely separate from `<workspaceRoot>/sessions/`:
     - `universes/<pmuId>/universe.json`
     - `universes/<pmuId>/objects/<knowledgeId>.json`
     - `universes/<pmuId>/relations/<relationId>.json`
     - `universes/<pmuId>/tree/<nodeId>.json`
     - `universes/<pmuId>/events.jsonl`
     - `snapshots/<pmuId>__<registerKind>__<sessionId>__<botId>.json`
     - `idempotency/ledger.json`
   - Uses `withLock` (`src/core/lock.js`), `atomicWriteJson` (`src/core/fs-utils.js`), and `appendJsonlRecord` (`src/core/jsonl.js`) for crash-safe multi-process writes on both Windows and Linux.
2. **`InMemoryPKUStore`:**
   - Provides an identical validation, idempotency, graph-traversal, and secret-redaction contract in memory for fast unit tests and ephemeral simulations.

### 2.2 Idempotency Ledger & Content-Hash Versioning (`PKU-002`, `PKU-018`)
- Every mutating port method accepts an `idempotencyKey`.
- `putKnowledge(object, idempotencyKey)`:
  1. Redacts secrets via `redactRecursively()` and validates via `KnowledgeObjectSchema`.
  2. Checks `idempotency/ledger.json`: if `idempotencyKey` was already recorded, returns `{ knowledgeId, created: false, version, idempotentReplay: true }` without rewriting disk.
  3. If an object with `object.id` already exists on disk, compares `computeContentHash(existing.content)` with `computeContentHash(incoming.content)`:
     - If identical, records the new `idempotencyKey` and returns `{ created: false, version: existing.version, idempotentReplay: true }`.
     - If modified, increments `version = existing.version + 1` and writes the updated object atomically.

### 2.3 Durable Outbox Queue & Shadow Ingestion (`src/memory_modules/pku/shadow-ingestion.ts`)
- **`DurableOutboxQueue`:** Persists staged write operations (`create_universe`, `put_tree_node`, `put_knowledge`, `put_relation`, `append_event`, `save_snapshot`) with status (`pending`, `completed`, `failed`), attempt counters, and error diagnostics.
- **`ShadowIngestionService`:** Stages all records from a `LegacySessionExportBundle` into `DurableOutboxQueue` using deterministic idempotency keys (`deriveIdempotencyKey`) and drains the queue into `IPKUStore & IRegisterPersistence`. If interrupted mid-batch (`PKU-018`), reloading the queue and re-running `ingestExportBundle` resumes cleanly with zero duplicate records.
- **`ShadowReconciliationService`:** Verifies all 8 invariants from `ROLLBACK_AND_RECONCILIATION.md` (`counts`, `duplicateIds`, `hashMismatches`, `orderingPreserved`, `ownershipMismatches`, `danglingRelations`, `scopeMismatches`, `quarantinedCount`).

---

## 3. Consequences

- **Positive:** Full offline local persistence works immediately across Windows and Linux with zero native binary dependencies, 100% secret redaction (`PKU-008`), replay-safe outbox recovery (`PKU-018`), and verified reconciliation parity.
- **Extensibility:** External vector/graph/Obsidian backends remain pluggable via `IExternalMemoryAdapter` and `IMemoryIntegrationGateway` without changing `IPKUStore` consumers.
