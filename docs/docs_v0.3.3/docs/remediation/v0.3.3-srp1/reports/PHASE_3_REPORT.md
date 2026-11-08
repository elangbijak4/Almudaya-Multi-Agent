# SRP-1 Phase 3 Report — Messaging Delivery Correctness

- **Phase:** 3 — Messaging Delivery Correctness
- **Date:** 2026-11-08
- **Commit SHA:** `00b10ff`
- **OS/Runtime:** Windows 11 (NT 10.0.26200.0), Node.js v24.21.0, npm 11.19.0
- **Implementer/Reviewer:** Antigravity AI / User Project Owner

---

## 1. Findings and Requirements in Scope

| Finding ID | Severity | Requirement ID | Summary & Target Outcome |
|---|---|---|---|
| **AUD-06** | High | REQ-04 | `readInbox()` mutates status to `read` before applying `limit`, marking unreturned messages as read. Target outcome: Apply filters and limits before mutation; only returned messages change state. |
| **AUD-07** | High | REQ-05 | Broadcast cursor advances before consumer callback and skips unconsumed events across mixed categories or pagination. Target outcome: Independent per-category cursors and delivery acknowledgement; cursor advances only after successful consumer callback. |
| **AUD-08** | High | REQ-04 | Stale inbox consumers can mutate another consumer's lease via `failMessage` / `completeMessage`. Target outcome: Monotonically increasing per-message lease fencing token (`fence_token`); require exact consumer ownership; separate explicit admin overrides. |
| **AUD-10** | High | REQ-02 | Messaging service trusts caller-supplied `senderBotId` without verifying active registration. Target outcome: Authenticate sender identity against active session bot registry inside `MessagingService`; reject unregistered/inactive senders; permit explicit typed principals (`HUMAN`, `SYSTEM`, `OPERATOR`). |

---

## 2. Files and Symbols Changed

1. **`src/messaging/schema.ts`**:
   - `BroadcastCursorSchema`: Added `category_cursors` (`Record<string, string>`) and `acknowledged_event_ids` (`string[]`).
   - `DirectMessageSchema`: Added monotonically increasing `fence_token` (`number`, default 0).
   - Exported `MessageAckOptions` interface.

2. **`src/messaging/delivery.ts`**:
   - `claimNextMessage`: Increments `candidate.fence_token = (candidate.fence_token ?? 0) + 1` upon every lease acquisition or recovery.
   - `completeMessage`: Enforces that worker must provide `consumerId`, must match current `lease_owner`, lease must not be expired, and `fenceToken` (if provided) must match `target.fence_token`.
   - `failMessage`: Enforces that worker must provide `consumerId`, must match current `lease_owner`, lease must not be expired, and `fenceToken` (if provided) must match `target.fence_token`.
   - Added explicit administrative overrides `forceCompleteMessage` and `forceFailMessage` supporting emergency operator bypass with reason auditing.

3. **`src/messaging/service.ts`**:
   - Added private `authenticateSender(sessionId: string, sender: string): Promise<string>`:
     - Rejects empty sender strings with `ValidationError`.
     - Permits explicit typed principals (`HUMAN`, `SYSTEM`, `OPERATOR`, `ADMIN`, `CONSOLE`).
     - Verifies sender against `BotService.getBot()`, throwing `BotNotFoundError` if unregistered and rejecting inactive bots.
   - Wired `authenticateSender` into `publishBroadcast` and `sendDirectMessage`.
   - `readInbox`: Reordered execution to apply `options.limit` *before* mutating unread status to `read`.
   - `readBroadcasts`: Implemented per-category cursor stream tracking (`category_cursors`) and delivery acknowledgement (`acknowledged_event_ids`), with FIFO pagination (`slice(0, limit)`) preventing unconsumed event loss.
   - Added `advanceBroadcastCursor` and `acknowledgeBroadcasts` methods for reliable consumer-driven cursor advancement.

4. **`src/bot/runtime.ts`**:
   - In `pollCycle`: reads broadcasts with `autoAdvanceCursor: false` and calls `advanceBroadcastCursor` only *after* each individual `onBroadcastCallback(evt)` completes successfully. If a callback fails or crashes, cursor remains unadvanced, enabling redelivery.
   - When completing or failing claimed direct messages, passes worker `consumerId` and `msg.fence_token` to enforce lease ownership.

5. **`src/blackboard/filesystem.ts`**:
   - `getBroadcastCursor`: Returns complete cursor schema with empty `category_cursors` and `acknowledged_event_ids` when no cursor file exists.

6. **`src/bot/console.ts`**:
   - Updated synthetic direct message payload with `fence_token: 1`.

7. **Regression Tests**:
   - **`tests/messaging/direct-message.test.ts`**:
     - Added AUD-06 regression test: 3 unread messages with `limit: 1, markAsRead: true` marks *only* the 1 returned message as read; remaining 2 messages remain unread in storage.
     - Added AUD-10 regression tests: `sendDirectMessage` rejects unregistered bot ID (`BotNotFoundError`), rejects inactive/stopped bot, and accepts typed principals (`HUMAN`, `SYSTEM`).
   - **`tests/messaging/broadcast-cursor-atomic.test.ts`**:
     - Updated test to assert that reading `DECISION` category does *not* skip earlier unconsumed `ACTIVITY` event `E1`; subsequent read returns `[E1, E3]`.
     - Added FIFO pagination test: reading with `limit: 1` yields `E1`, then `E2`, then `E3` in order without skipping.
     - Added callback failure & redelivery test: failed callback leaves event unacknowledged for subsequent poll redelivery.
   - **`tests/messaging/broadcast.test.ts`**:
     - Added AUD-10 regression tests: `publishBroadcast` rejects unregistered sender bot ID and accepts typed principals (`HUMAN`, `SYSTEM`).
   - **`tests/messaging/inbox-state.test.ts`**:
     - Added AUD-08 regression tests: monotonically increasing `fence_token` on successive claims.
     - Rejection of `failMessage` and `completeMessage` from stale consumer after lease expiry and reclaim.
     - Rejection of stale fencing token.
     - Administrative overrides `forceCompleteMessage` and `forceFailMessage` succeed.
   - **`tests/cli/messaging-cli.test.ts`**:
     - Added AUD-10 regression test: CLI rejects message send with unregistered `--sender`.

---

## 3. Verification Commands and Raw Outputs

### 3.1 Build Verification
```powershell
npm run build
```
- **Exit Code:** 0
- **Output:**
```
> almudaya-multiagent@0.3.2 build
> tsc
```

### 3.2 Messaging Direct Message & Inbox Tests
```powershell
npx vitest run tests/messaging/direct-message.test.ts
```
- **Exit Code:** 0
- **Summary:** 11 passed (11)

### 3.3 Broadcast Cursor & Filter Loss Tests
```powershell
npx vitest run tests/messaging/broadcast-cursor-atomic.test.ts
```
- **Exit Code:** 0
- **Summary:** 3 passed (3)

### 3.4 Broadcast Service Tests
```powershell
npx vitest run tests/messaging/broadcast.test.ts
```
- **Exit Code:** 0
- **Summary:** 6 passed (6)

### 3.5 Inbox State Machine & Fencing Tests
```powershell
npx vitest run tests/messaging/inbox-state.test.ts
```
- **Exit Code:** 0
- **Summary:** 16 passed (16)

### 3.6 Full Project Test Suite Run
```powershell
npx vitest run
```
- **Exit Code:** 0
- **Summary:**
```
Test Files  44 passed (44)
     Tests  328 passed (328)
  Duration  7.14s
```

---

## 4. Known Limitations & Environment Notes
1. **Fencing Token Scope:** `fence_token` increments per message claim. If storage is restored from a backup predating a claim, monotonic increment restarts from persisted message state.
2. **Cursor Acknowledgement Window:** To bound storage file size, `acknowledged_event_ids` retains the most recent 1000 event IDs per bot cursor alongside high-water marks in `category_cursors`.

---

## 5. Phase 3 Gate Evaluation

- [x] `readInbox` limit applied before mutation (AUD-06).
- [x] Per-category broadcast cursor tracking, FIFO pagination, and post-callback advancement prevent skipped events (AUD-07).
- [x] Lease fencing tokens and exact consumer ownership enforced on worker complete/fail; administrative overrides separate (AUD-08).
- [x] Sender identity authenticated at `MessagingService` boundary against active bot registry (AUD-10).
- [x] Full build and all 44 test suites pass cleanly (328 tests, 0 failures).
- [x] Gate status: Phase 3 Complete, awaiting human approval before proceeding to Phase 4.
