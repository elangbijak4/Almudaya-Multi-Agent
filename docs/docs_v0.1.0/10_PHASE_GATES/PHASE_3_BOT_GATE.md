# Phase 3 Gate — Bot Registration and Discovery

## Required deliverables

- Architecture Decision Record: `ADR-004-bot-identity-and-registry.md`.
- Bot schema and validation (`src/bot/schema.ts`).
- Bot registry persistence in Blackboard (`src/blackboard/interface.ts`, `src/blackboard/filesystem.ts`).
- Bot application service (`src/bot/service.ts`).
- CLI bot commands: `join`/`start`, `list`, `inspect`, `rename` (`src/cli/commands/bot.ts`).
- Automated tests:
  - Unit, lifecycle, naming, and renaming tests (`tests/bot/bot-registry.test.ts`).
  - Concurrent multi-process registration tests (`tests/bot/concurrent-registration.test.ts`).
  - CLI bot integration tests (`tests/cli/bot-cli.test.ts`).

## Exit criteria

- [x] Two or more independent processes/callers can join the same Session without identity collision (`tests/bot/concurrent-registration.test.ts`).
- [x] Each bot has a stable Bot ID distinct from its editable display name (`tests/bot/bot-registry.test.ts`).
- [x] Each bot has a display name, status, PID, timestamps, and optional description.
- [x] Default name generation is deterministic (`<session_name>_<seq>`) and safe under concurrent registration (`generateNextDisplayName`).
- [x] User-specified display name and Bot ID are supported (`tests/bot/bot-registry.test.ts`).
- [x] Duplicate display names are rejected with `DisplayNameConflictError` (`tests/bot/bot-registry.test.ts`).
- [x] Renaming preserves immutable Bot ID and timestamps while updating display name (`tests/bot/bot-registry.test.ts`, CLI test).
- [x] Peer discovery accurately lists and retrieves registered bots (`tests/bot/bot-registry.test.ts`).
- [x] CLI commands (`almudaya bot join|start`, `list`, `inspect`, `rename`) verified (`tests/cli/bot-cli.test.ts`, smoke test).
- [x] TypeScript build passes without warnings or errors.
- [x] Full automated test suite passes (42 tests across 8 test suites).
- [x] `npm pack --dry-run` succeeds and outputs clean distribution tarball.

## Gate decision

- Result: PASSED
- Evidence:
  - Automated tests: 42 passed (8 test files, 1.62s).
  - Multi-process concurrency: `tests/bot/concurrent-registration.test.ts` verified 5 simultaneous joins without ID or name collision.
  - CLI smoke test: verified session creation, two-bot registration, peer listing, renaming, and inspection.
- Open issues: `OI-003` resolved via `ADR-004`. `OI-005` (liveness), `OI-006` (read cursor), `OI-007` (messaging ack) queued for Phase 4.
- Date: 2026-10-31
