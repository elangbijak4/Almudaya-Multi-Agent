# ADR-002 — Read-Only Legacy Compatibility Bridge (`IBlackboardStorage` & Per-Bot Registers)

- **Status:** Approved & Implemented (Phase 2)
- **Date:** 2026-11-09
- **Spec Reference:** `PKU_Unified_Persistent_Memory_Architecture_Specification_v0.2.md` (§6, §7, §9, §13), `ACCEPTANCE_TEST_MATRIX.md` (`PKU-002`, `PKU-003`, `PKU-004`, `PKU-005`, `PKU-008`)

---

## 1. Context

In Phase 2 (Gate 2 of `PHASED_MIGRATION_PLAN.md`), PKU requires a non-invasive, read-only compatibility bridge over `IBlackboardStorage` (`FilesystemSessionStorage`) and per-bot individual state (`BotRecord`, `InboxStore`, `BroadcastCursor`, and bot-authored `WorkLogEntry` records) that:

1. Exports all 10 legacy session file types (`session.json`, `registry/project_roots.json`, `registry/bots.json`, `registry/environment.json`, `registry/documents.json`, `broadcast/events.jsonl`, `inbox/<botId>/messages.json`, `inbox/<botId>/broadcast_cursor.json`, `work_log.jsonl`, and `capabilities/grants.jsonl` + `audit.jsonl`) into canonical PKU candidates (`ProjectMemoryUniverse`, `KnowledgeObject`, `MemoryEvent`, `RegisterSnapshot`, `KnowledgeRelation`, `KnowledgeTreeNode`).
2. Preserves source IDs, timestamps, schema versions, file locators (`#L<lineNumber>` for JSONL streams), and secret-redacted SHA-256 hashes (`PKU-003`, `PKU-008`).
3. **Never mutates any file in the legacy session directory (`PKU-005`)**—specifically avoiding `FilesystemSessionStorage.readBroadcasts()` and `readWorkLogs()` side effects that either append `.corrupt.jsonl` files into the legacy session folder or throw `CorruptedDataError` (`strict: true`) when encountering a malformed JSONL line (`RISK-02`).
4. Captures malformed JSON/JSONL records into an in-memory `QuarantinedLegacyRecord[]` diagnostic list and produces a deterministic `LegacyExportParityReport` (`unexplainedMissingCount === 0`).

---

## 2. Decisions

### 2.1 `ReadOnlyBlackboardCompatibilityBridge` (`src/memory_modules/bridges/legacy-blackboard-bridge.ts`)
- Implements `IGlobalRegisterBridge` with `readonly mode = 'read_only'`.
- `exportSession(sessionId, options)` reads all 10 legacy persistence artifacts and constructs a validated `LegacySessionExportBundle` containing:
  - `defaultProjectUniverse` and `projectUniverses` (derived from `primary` project roots or fallback session identity).
  - `knowledgeObjects` (`session.metadata`, `project.root`, `agent.identity`, `session.environment`, `sdlc.document`, promoted `session.decision` / `session.artifact` / `session.observation` broadcasts, promoted `agent.message_knowledge`, and `development.work_log`).
  - `memoryEvents` (`broadcast.*`, `message.direct`, `work_log.*`, `security.capability_grant`, `security.audit_event`).
  - `globalRegisterSnapshot` (`registerKind: 'global'`) and `individualRegisterSnapshots` (`registerKind: 'individual'`).
  - `relations` (`executed_during`, `created_by`) and `treeNodes` (`Identity`, `Requirements`, `Architecture`, `Decisions`, `Tests`, `Development`).
  - `quarantinedRecords` (`QuarantinedLegacyRecord[]`) and `parityReport` (`LegacyExportParityReport`).
- **Non-Mutating Line-by-Line JSONL Reader:** Reads JSONL files line-by-line via `parseJsonl(trimmedLine, schema, relativePath, { strict: false })` without passing `quarantineFilePath`. This guarantees zero disk writes inside `sessions/<sessionId>/` (`PKU-005`) while recording exact 1-based line numbers (`#L<lineNumber>`) for both valid provenance (`PKU-003`) and quarantined diagnostics (`RISK-02`).
- **Separation of Operational Delivery State from Message Event Identity:** When exporting `DirectMessage` records, the `MemoryEvent` content hash is computed over the immutable message envelope (`message_id`, `session_id`, `sender_bot_id`, `recipient_bot_id`, `timestamp`, `message_type`, `content`, `metadata`), while mutable delivery/lease/fencing fields (`delivery_state`, `attempt_count`, `fence_token`, `lease_owner`, `lease_expires_at`, `status`, `read_at`, `acknowledged_at`) are captured in the bot's `RegisterSnapshot`.

### 2.2 `ReadOnlyIndividualRegisterBridge` (`src/memory_modules/bridges/legacy-individual-bridge.ts`)
- Implements `IIndividualRegisterBridge` over `IBlackboardStorage`.
- `discoverCapabilities()` reports only verified v0.3.3 capabilities: `['bot_identity', 'direct_inbox', 'broadcast_cursor', 'session_work_log_slice']`.
- `loadIndividualState(botId, sessionId)` and `exportIndividualSnapshot(botId, sessionId, projectUniverseId)` assemble a bot's `BotRecord`, `InboxStore.messages`, `BroadcastCursor`, and authored `WorkLogEntry[]` into a validated `RegisterSnapshot` (`registerKind: 'individual'`) with recursive secret redaction.

### 2.3 Directory Checksum Manifest Verification (`computeDirectoryManifest`)
- Provides a recursive SHA-256 directory manifest helper (`FileChecksumEntry[]`) used in automated tests to prove byte-for-byte immutability of legacy session directories before and after bridge execution (`PKU-005`).

---

## 3. Consequences

- **Positive:** Legacy sessions can now be inspected, inventoried, and dry-run exported into validated PKU candidates with 100% provenance fidelity, secret redaction, malformed-line quarantine diagnostics, and mathematically verified zero mutation of legacy files.
- **Ready for Phase 3:** The `LegacySessionExportBundle` output feeds directly into Phase 3 (`IPKUStore` shadow ingestion, idempotency replay, and reconciliation).
