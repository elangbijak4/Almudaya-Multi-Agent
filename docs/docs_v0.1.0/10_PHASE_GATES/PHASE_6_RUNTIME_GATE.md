# Phase 6 Gate — Independent Bot Runtime

## Required deliverables

- Architecture Decision Record: `ADR-008-bot-runtime-process-lifecycle-and-liveness.md`.
- Bot runtime class (`src/bot/runtime.ts`):
  - Periodic heartbeat loop (`touchHeartbeat`).
  - Graceful shutdown on `SIGINT`/`SIGTERM` (updates status to `stopped`).
  - Message consumption and auto-acknowledgement loop.
- Stale bot liveness detection in `BotService` (`reconcileBotLiveness`, resolving `OI-005`).
- CLI command `almudaya bot run` (`src/cli/commands/bot.ts`).
- Automated tests:
  - Runtime lifecycle and heartbeat tests (`tests/bot/runtime.test.ts`).
  - Stale detection tests (`tests/bot/liveness.test.ts`).
  - Real multi-process isolation and crash recovery test (`tests/bot/process-isolation.test.ts`).

## Exit criteria

- [x] Each bot runs in its own process and runtime state (Invariants 3, 4).
- [x] Blocked operation or crash in one bot does not block another bot process (`tests/bot/process-isolation.test.ts`).
- [x] Periodic heartbeat updates `last_seen_at` in Blackboard (`tests/bot/runtime.test.ts`).
- [x] Abnormal termination / dead PID detected and transitioned to `stale` without data loss (`tests/bot/liveness.test.ts`, `tests/bot/process-isolation.test.ts`).
- [x] Graceful shutdown updates status to `stopped` (`tests/bot/runtime.test.ts`).
- [x] CLI command `almudaya bot run` verified.
- [x] TypeScript strict compilation passes without errors.
- [x] Full automated test suite passes (76 tests across 17 test files).
- [x] `npm pack --dry-run` succeeds and outputs clean distribution tarball.

## Gate decision

- Result: PASSED
- Evidence:
  - Automated tests: 76 tests passed (17 test suites, 2.70s).
  - Multi-process isolation verified by spawning real independent Node.js processes with simulated crash.
- Open issues: `OI-005` resolved. Remaining open issues: `OI-008` (license in Phase 8), `OI-009` (npm availability in Phase 8).
- Date: 2026-11-01
