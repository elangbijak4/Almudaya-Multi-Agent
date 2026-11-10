# Individual Memory / ACMA Audit (`Phase 0`)

**Target:** All bot-scoped state, persistence, identity, continuity, retrieval, and handoff mechanisms across `src/` and all Git branches/tags.  
**Architectural Role in PKU:** Operational **Individual Register (ACMA)**.

---

## 1. Repository-Wide Search for Existing ACMA Implementation

Per Mandatory Instruction §1.6 and Master Prompt Constraint 5:
- All local and remote Git branches (`main`, `security/srp-1-v0.3.3`, `origin/main`, `origin/security/srp-1-v0.3.3`), tags (`v0.3.3`), stashes (none), and all 63 files in `src/` and 47 files in `tests/` were inspected.
- **Finding:** There is **no separate legacy class or module named `ACMA`** in the codebase prior to the `PKU_Memory_Modules_Scaffold_v0.1.0` scaffold.
- Instead, individual bot state, continuity, and memory are currently distributed across **five concrete mechanisms** in `src/bot/`, `src/messaging/`, and `src/shared/`.

---

## 2. Inventory of Existing Bot-Specific State & Continuity Mechanisms

### 2.1 Bot Identity, Lifecycle & Metadata (`src/bot/schema.ts`, `src/bot/service.ts`)
- **Storage:** `<sessionDir>/registry/bots.json` (`BotRegistrySchema`, `schema_version: '1.0.0'`).
- **Identity Contract (`BotRecord`, `src/bot/schema.ts#L18-L32`):**
  - `bot_id`: Stable canonical identifier (`BOT001`, `BOT002`, or custom matching `/^[a-zA-Z0-9_-]{1,64}$/`). Never changes when display name is renamed (`BotService.renameBot`, `src/bot/service.ts#L113-L151`).
  - `display_name`: Human-readable name (`<sanitized-session-name>_001` by default, unique per session).
  - `description`: Role/persona description used in system prompt construction (`src/ai/prompts.ts#L68-L71`).
  - `status`: `'starting' | 'active' | 'idle' | 'stopped' | 'failed' | 'stale'`.
  - `pid`: OS process ID of the active `BotRuntime` instance (cleared when `status` transitions to `'stopped'` or `'failed'`, `src/bot/service.ts#L188-L190`).
  - `joined_at`, `last_seen_at`: ISO-8601 timestamps updated by `BotService.touchHeartbeat()` (`#L211-L235`).
  - `metadata`: Extensible `Record<string, unknown>` dictionary on each `BotRecord` (`src/bot/schema.ts#L31`).
- **Continuity on Restart (`BotRuntime.start()`, `src/bot/runtime.ts#L78-L107`):**
  - When `BotRuntime.start()` is invoked with an existing `botId`, it looks up the existing `BotRecord` via `botService.getBot(sessionId, botId)` and re-activates it (`updateStatus(..., 'active', { pid: process.pid })`), preserving its `bot_id`, `display_name`, `joined_at`, `metadata`, inbox, and broadcast cursor across process restarts.

### 2.2 Individual Direct-Message Inbox (`src/messaging/schema.ts`, `src/messaging/delivery.ts`)
- **Storage:** `<sessionDir>/inbox/<botId>/messages.json` (`InboxStoreSchema`, `schema_version: '1.0.0'`).
- **Continuity & Recovery:**
  - Stores all `DirectMessage` records addressed to `recipient_bot_id === botId`.
  - Tracks per-message delivery state (`RECEIVED`, `PROCESSING`, `COMPLETED`, `RETRY_PENDING`, `DEAD_LETTER`), `attempt_count`, `max_attempts`, monotonic `fence_token`, `lease_owner` (`<botId>:pid-<pid>`), `lease_expires_at`, `last_attempt_at`, `last_error`, and optional `idempotency_key`.
  - If a bot process crashes while processing a message, `InboxDeliveryService.recoverExpiredLeases()` (`src/messaging/delivery.ts#L278-L310`) transitions expired `PROCESSING` leases back to `RETRY_PENDING` (or `DEAD_LETTER` if attempts exhausted) on the next poll cycle or restart.

### 2.3 Individual Broadcast Consumption Cursor (`src/messaging/schema.ts`, `src/messaging/service.ts`)
- **Storage:** `<sessionDir>/inbox/<botId>/broadcast_cursor.json` (`BroadcastCursorSchema`).
- **Fields (`src/messaging/schema.ts#L29-L35`):**
  - `last_read_event_id: string | null`
  - `last_read_timestamp: string | null`
  - `category_cursors: Record<string, string>` (per-category high-water event ID)
  - `acknowledged_event_ids: string[]` (bounded sliding window of up to 1,000 acknowledged event IDs, `src/messaging/service.ts#L171-L173, L237-L239`).
- **Continuity:** Ensures that across bot restarts, a bot resumes reading session broadcasts from its exact unacknowledged position without missing or re-processing completed events.

### 2.4 Ephemeral Working Conversation Memory (`src/bot/agent-loop.ts`)
- **Location:** `AutonomousAgentLoop.handleMessage()` (`src/bot/agent-loop.ts#L144-L403`).
- **Mechanics:**
  - For each incoming `DirectMessage` (or operator REPL instruction), `handleMessage()` constructs an in-memory `conversation: AIMessage[]` array (`role: 'user' | 'model' | 'tool'`).
  - During the bounded ReAct loop (up to `maxIterations`, default `10`), assistant thoughts, `toolCalls`, and `toolResults` are appended to `conversation`.
  - **Limitation:** Once `handleMessage()` returns `finalResponseText`, the `conversation` array is garbage-collected. It is **not** persisted across separate incoming messages or process restarts.

### 2.5 Episodic Action Memory in Shared Work Log & Capability Grants
- **Work Log (`src/shared/work-log.ts`, `src/bot/agent-loop.ts#L290-L342`):**
  - Whenever a bot executes `run_command`, `write_file`, or `edit_file`, `AutonomousAgentLoop.recordToolExecutionWorkLog()` appends a `WorkLogEntry` to `<sessionDir>/work_log.jsonl` tagged with `bot_id` and `bot_name`.
  - `WorkLogService.readWorkLogs(sessionId, { botId })` (`src/shared/work-log.ts#L111-L118`) supports filtering work history for a specific bot, though `AutonomousAgentLoop.handleMessage()` currently loads the session-wide last 10 entries (`getRecentSummaryMarkdown(this.sessionId, 10)`).
- **Bot-Bound Capability Grants (`src/capability/schema.ts#L55`, `src/capability/policy-engine.ts#L120`):**
  - `CapabilityGrant.bot_id` optionally binds an ACG capability grant to a specific `botId` (`AUD-04`).

---

## 3. Gap Analysis: Existing Per-Bot State vs Target ACMA Specification (§7)

| ACMA Domain (Spec §7.1) | Current Status in v0.3.3 | Existing Source / Artifact | What Must Be Built / Adapted in PKU |
|---|---|---|---|
| **Bot Identity & Liveness** | **Exists (Complete)** | `BotRecord` in `registry/bots.json` (`src/bot/schema.ts`) | Preserve `BotService`. Map `BotRecord` to `MemoryIdentity` (`registerKind: 'individual'`, `botId`, `sessionId`, `projectUniverseId`). |
| **Individual Inbox & Cursor** | **Exists (Complete)** | `inbox/<botId>/messages.json`, `broadcast_cursor.json` | Preserve as operational messaging/cursor state. Do **not** conflate delivery state with cognitive semantic memory. |
| **Working Memory** | **Partial (Ephemeral)** | In-memory `conversation: AIMessage[]` per `handleMessage()` call (`src/bot/agent-loop.ts#L144`) | Introduce persistent working-memory state in ACMA Individual Register so multi-turn task context survives across messages and restarts. |
| **Episodic Memory** | **Partial (Session-Shared)** | `WorkLogEntry` filtered by `bot_id` (`work_log.jsonl`) + `ACTIVITY`/`DECISION` broadcasts | Bridge bot-authored `WorkLogEntry` and task completion outcomes into bot-scoped episodic `KnowledgeObject` / `MemoryEvent` records in PKU. |
| **Semantic Memory** | **Missing** | None (only static role description in `BotRecord.description`) | Introduce ACMA semantic memory store backed by PKU (`scope: 'agent'` or promoted to `'project'`). |
| **Procedural Memory** | **Missing** | Hardcoded operational guidelines in `buildDynamicSystemPrompt()` (`src/ai/prompts.ts#L116-L121`) | Introduce ACMA procedural memory objects (learned workflows, tool patterns, project conventions) backed by PKU. |
| **Retrieval Memory** | **Missing** | Only `get_work_log` tool (`src/tools/work-log-tool.ts`) | Connect ACMA retrieval memory to KOE (`IKnowledgeOptimizationEngine`) with bot permission context (`MemoryPermissionContext`). |
| **Prospective Memory** | **Missing** | None (no deferred task queue beyond `RETRY_PENDING` inbox messages) | Introduce ACMA prospective memory (planned follow-ups, pending goals, triggers) persisted in PKU. |
| **Execution Checkpoints** | **Missing** | ReAct loop has `iteration` counter in memory (`src/bot/agent-loop.ts#L157`) but no disk checkpoint | Introduce `ExecutionCheckpoint` schema and persistence via `IRegisterPersistence` so interrupted ReAct tasks or bot restarts can resume cleanly. |
| **Handoff Continuity** | **Partial (Ad-hoc Text)** | Bots send text replies/requests via `send_message` with `metadata.correlationId` | Formalize structured `handoff` references (`checkpointId`, `sourceBotId`, `targetBotId`, `knowledgeRefs`) in ACMA + Messaging integration (`Spec §7.3, §9.2`). |

---

## 4. Architectural Rules for ACMA Integration

1. **No Invented Legacy API:** Because no legacy `ACMA` class exists in `src/`, `IIndividualRegisterBridge.discoverCapabilities()` (`memory_modules/src/memory_modules/ports/registers.ts#L18`) must accurately report only the capabilities actually active in the host (`['bot_identity', 'inbox_state', 'broadcast_cursor', 'work_log_episodic']` initially, expanding as ACMA stores are enabled).
2. **Initialization Order:** In `BotRuntime.start()` (`src/bot/runtime.ts#L88-L107`), canonical `this.botId` is only guaranteed after `botService.getBot()` or `botService.registerBot()` completes. Any Individual Register / ACMA initialization **must** occur after line 107.
3. **Default Isolation (`Spec §7.3`, `PKU-009`):** Knowledge objects with `scope: 'agent'` and `ownerId: botId` must be private to `botId` by default. Another bot (`botB`) may only read them if an explicit share/handoff grant or promotion to `scope: 'session' | 'project' | 'shared'` exists.
