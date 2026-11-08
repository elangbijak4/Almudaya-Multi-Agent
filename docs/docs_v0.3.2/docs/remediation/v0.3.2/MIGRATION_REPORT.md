# Migration & Compatibility Report — v0.3.2

- **From Version:** `0.3.1` (and `0.3.0`)
- **To Version:** `0.3.2` — Security & Concurrency Hardening
- **Date:** 2026-11-08

---

## 1. Compatibility Overview

Almudaya Multi-Agent v0.3.2 is **100% backward compatible** with data structures, sessions, and bots created under v0.3.0 and v0.3.1. Upgrading requires zero destructive migrations, database table re-creation, or manual file conversions.

```
sessions/
  <session_id>/
    bots.json               <-- Fully compatible (preserves schema v1.0.0)
    events.jsonl            <-- Fully compatible (JSONL line-by-line format)
    work_log.jsonl          <-- Fully compatible (location-aware coordinates)
    context.json            <-- Fully compatible (project roots & SDLC docs)
    inbox/<bot_id>.jsonl    <-- Upward-compatible (delivery metadata auto-defaulted)
    capabilities/           <-- Newly initialized on-demand:
      grants.jsonl          <-- Capability grants
      audit.jsonl           <-- Security audit events
```

---

## 2. In-Depth Subsystem Compatibility Analysis

### 2.1 Individual Inbox Data (`inbox/<bot_id>.jsonl`)
- **Legacy Format (v0.3.1):** Contained `message_id`, `session_id`, `sender_bot_id`, `recipient_bot_id`, `timestamp`, `message_type`, `content`, `status` (`'unread'` | `'read'`), and `metadata`.
- **v0.3.2 State Machine Extension:** Adds `delivery_state`, `attempt_count`, `max_attempts`, `lease_owner`, `lease_expires_at`, `last_attempt_at`, `last_error`, and `idempotency_key`.
- **Migration Strategy:** The `DirectMessageSchema` parser and `InboxDeliveryService` automatically populate default values for legacy records:
  - If `status === 'unread'` and `delivery_state` is missing, it is dynamically treated as `delivery_state: 'RECEIVED'`, `attempt_count: 0`.
  - If `status === 'read'`, it is treated as completed.
  - No legacy messages are dropped, dead-lettered, or corrupted upon upgrade.

### 2.2 Capability Storage (`capabilities/grants.jsonl` & `audit.jsonl`)
- **Behavior for Existing Sessions:** Existing sessions will not have a `capabilities/` subdirectory initially.
- **On-Demand Auto-Creation:** When an existing session is accessed in v0.3.2, `CapabilityPersistence` creates the `capabilities/` directory automatically upon first grant or audit event issuance.
- **Default-Deny Policy:** In existing sessions without grants, operations within registered project roots (`read_file`, `write_file`, `edit_file`) continue to function normally via project sandboxing. Operations outside project roots default to `DENY` until explicitly granted.

### 2.3 Bot Registry & Liveness (`bots.json`)
- **Format Invariant:** `BotRecordSchema` retains `schema_version: '1.0.0'`.
- **PID Lifecycle Synchronization:** The `pid` field continues to track OS process IDs. v0.3.2 adds automatic clearance of stale PIDs when bots stop, preventing zombie lock contention without modifying existing bot IDs or display names.

### 2.4 Command & Shell Execution
- **Tool Schema Invariant:** The AI-facing tool schema for `run_command` remains identical:
  ```json
  { "command": "<shell command>", "working_dir": "<optional relative/absolute path>" }
  ```
- **Underlying Delegation:** Instead of raw `child_process.spawn({ shell: true })`, `run_command` delegates to `ExecutionController.getInstance().executeCommand()`. Inside registered project roots, commands execute smoothly under sanitized environment bounds.

---

## 3. Migration Verification Results

1. **Regression Test Suite:** All 201 baseline v0.3.1 tests pass without modification under the v0.3.2 runtime.
2. **Crash Resilience:** Existing lock and inbox crash recovery tests (`tests/core/lock.test.ts`, `tests/messaging/inbox-state.test.ts`, `tests/messaging/transactional-inbox.test.ts`) demonstrate zero data loss across simulated consumer crashes.
3. **Rollback Safety:** If an operator reverts code to v0.3.1, existing session folders remain valid, as all added capability metadata and delivery fields are non-destructive supersets.
