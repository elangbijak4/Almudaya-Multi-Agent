# Phase 4 Gate — Messaging (Broadcast & Direct Messages)

## Required deliverables

- Architecture Decision Records:
  - `ADR-005-broadcast-event-log-and-read-cursor.md`
  - `ADR-006-individual-blackboard-and-direct-messaging.md`
- Messaging schemas and validation (`src/messaging/schema.ts`).
- Storage extensions for broadcast log and inboxes in Blackboard (`src/blackboard/interface.ts`, `src/blackboard/filesystem.ts`).
- Messaging domain service (`src/messaging/service.ts`).
- CLI commands: `almudaya broadcast publish|read`, `almudaya message send|read|ack` (`src/cli/commands/messaging.ts`).
- Automated tests:
  - Broadcast tests and per-bot cursor tracking (`tests/messaging/broadcast.test.ts`).
  - Direct message delivery, recipient name resolution, and acknowledgement (`tests/messaging/direct-message.test.ts`).
  - Multi-process concurrent stress tests (`tests/messaging/concurrent-messaging.test.ts`).
  - CLI messaging integration tests (`tests/cli/messaging-cli.test.ts`).

## Exit criteria

- [x] Broadcast events persist in `events.jsonl` with unique IDs, categories, timestamps, and can be read by peer bots (`tests/messaging/broadcast.test.ts`).
- [x] Per-bot broadcast cursors track read progress independently (`tests/messaging/broadcast.test.ts`).
- [x] Direct messages are durably stored in recipient's inbox (`inbox/<bot_id>/messages.json`).
- [x] Recipient display names are resolved to stable Bot IDs before message storage (`tests/messaging/direct-message.test.ts`).
- [x] Unknown recipient is rejected with `BotNotFoundError` (`tests/messaging/direct-message.test.ts`).
- [x] Read status and idempotent message acknowledgement persist across restarts (`tests/messaging/direct-message.test.ts`).
- [x] Concurrent writes from independent processes do not corrupt records or drop messages (`tests/messaging/concurrent-messaging.test.ts`: 20 concurrent broadcasts, 15 concurrent direct messages verified).
- [x] CLI commands (`almudaya broadcast`, `almudaya message`) verified (`tests/cli/messaging-cli.test.ts`, live POC smoke test).
- [x] TypeScript strict compilation passes without errors.
- [x] All automated tests pass (57 tests across 12 test files).
- [x] `npm pack --dry-run` succeeds and outputs clean distribution tarball.

## Gate decision

- Result: PASSED
- Evidence:
  - Automated tests: 57 tests passed (12 test suites, 1.92s).
  - Multi-process concurrency: `tests/messaging/concurrent-messaging.test.ts` passed.
  - CLI smoke test: Full POC flow (session create -> bot join -> broadcast publish/read -> message send/read/ack) executed and verified.
- Open issues: `OI-006` and `OI-007` resolved. Remaining open issues: `OI-005` (stale bot liveness check in Phase 6), `OI-008` (license in Phase 8), `OI-009` (npm availability in Phase 8).
- Date: 2026-11-01
