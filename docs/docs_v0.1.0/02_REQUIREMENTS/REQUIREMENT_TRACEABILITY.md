# Requirement Traceability Matrix

**Version:** 0.1.0  
**Status:** FULLY TRACED AND VERIFIED  
**Date:** 2026-11-01  

## 1. Functional Requirements

| Requirement | Description | Design Reference | Implementation Module | Verification Suite | Status |
|---|---|---|---|---|:---:|
| FR-001 | Create Session with stable ID & metadata | ADR-001, ADR-002 | `src/session/`, `src/blackboard/` | `tests/blackboard/persistence.test.ts`, `tests/cli/session-cli.test.ts` | VERIFIED |
| FR-002 | Bot join existing session | ADR-004 | `src/bot/service.ts` | `tests/bot/bot-registry.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-003 | Register bot in session registry | ADR-004 | `src/bot/service.ts`, `src/blackboard/` | `tests/bot/bot-registry.test.ts`, `tests/bot/concurrent-registration.test.ts` | VERIFIED |
| FR-004 | Stable Bot ID distinct from display name | ADR-004 | `src/bot/schema.ts`, `src/bot/service.ts` | `tests/bot/bot-registry.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-005 | Default display name `<session>_<seq>` | ADR-004 | `src/bot/service.ts` | `tests/bot/bot-registry.test.ts` | VERIFIED |
| FR-006 | Custom and editable display name | ADR-004 | `src/bot/service.ts` | `tests/bot/bot-registry.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-007 | Display name uniqueness within session | ADR-004 | `src/bot/service.ts` | `tests/bot/bot-registry.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-008 | Discover peer bots via registry | ADR-004 | `src/bot/service.ts` | `tests/bot/bot-registry.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-009 | Store bot status, PID, and timestamps | ADR-004, ADR-008 | `src/bot/schema.ts`, `src/bot/runtime.ts` | `tests/bot/bot-registry.test.ts`, `tests/bot/runtime.test.ts`, `tests/bot/liveness.test.ts` | VERIFIED |
| FR-010 | Session broadcast log (`events.jsonl`) | ADR-005 | `src/messaging/service.ts`, `src/blackboard/` | `tests/messaging/broadcast.test.ts`, `tests/messaging/concurrent-messaging.test.ts` | VERIFIED |
| FR-011 | Bot read available broadcasts | ADR-005 | `src/messaging/service.ts` | `tests/messaging/broadcast.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-012 | Individual Blackboard per bot | ADR-006 | `src/blackboard/filesystem.ts`, `src/messaging/`| `tests/messaging/direct-message.test.ts`, `tests/messaging/concurrent-messaging.test.ts` | VERIFIED |
| FR-013 | Send direct message to bot ID | ADR-006 | `src/messaging/service.ts` | `tests/messaging/direct-message.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-014 | Read and acknowledge direct messages | ADR-006 | `src/messaging/service.ts`, `src/bot/runtime.ts`| `tests/messaging/direct-message.test.ts`, `tests/bot/runtime.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-015 | Unique message and event IDs with timestamps | ADR-005, ADR-006 | `src/messaging/schema.ts` | `tests/messaging/broadcast.test.ts`, `tests/messaging/direct-message.test.ts` | VERIFIED |
| FR-016 | Messaging state survives process restart | ADR-002, ADR-005 | `src/blackboard/filesystem.ts` | `tests/messaging/broadcast.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| FR-017 | Register & list multiple project roots | ADR-007 | `src/shared/service.ts` | `tests/shared/shared-context.test.ts`, `tests/cli/context-cli.test.ts` | VERIFIED |
| FR-018 | Register shared environment metadata | ADR-007 | `src/shared/service.ts` | `tests/shared/shared-context.test.ts`, `tests/cli/context-cli.test.ts` | VERIFIED |
| FR-019 | Register & filter SDLC document references | ADR-007 | `src/shared/service.ts` | `tests/shared/shared-context.test.ts`, `tests/cli/context-cli.test.ts` | VERIFIED |
| FR-020 | CLI help & version | Architecture Baseline | `src/cli/index.ts` | `tests/cli.test.ts` | VERIFIED |
| FR-021 | CLI commands (session, bot, message, context)| Architecture Baseline | `src/cli/commands/` | `tests/cli/*.test.ts` (All 4 CLI test suites) | VERIFIED |
| FR-022 | Configurable workspace root | ADR-001 | `src/core/config.ts` | `tests/core/config.test.ts` | VERIFIED |
| FR-023 | Resilient to process crash / abnormal stop | ADR-003, ADR-008 | `src/core/lock.ts`, `src/bot/runtime.ts` | `tests/core/lock.test.ts`, `tests/bot/process-isolation.test.ts`, `tests/bot/liveness.test.ts` | VERIFIED |

---

## 2. Non-Functional Requirements & Invariants

| ID | Description | Design & Implementation Principle | Verification Evidence | Status |
|---|---|---|---|:---:|
| NFR-001 | TypeScript strict mode | Strict `tsconfig.json` (`strict: true`, `noImplicitAny: true`, etc.) | `npm run build` (tsc strict clean build) | VERIFIED |
| NFR-002 | Cross-platform OS support | Path normalization with `node:path`, POSIX/Win32 signal handling | Tested on Windows 11 AMD64, path normalization test suites | VERIFIED |
| NFR-003 | Persistence across restarts | Filesystem atomic writes and JSON validation | `tests/blackboard/persistence.test.ts`, `tests/e2e/two-terminal-poc.test.ts` | VERIFIED |
| NFR-004 | Multi-process write concurrency | Cooperative file locking via `fs.open(..., 'wx')` | `tests/core/lock.test.ts`, `tests/messaging/concurrent-messaging.test.ts` | VERIFIED |
| NFR-005 | Schema versioning & validation | `schema_version` field on all stored JSON records | `src/*/schema.ts`, `tests/blackboard/persistence.test.ts` | VERIFIED |
| NFR-006 | Headless core service testability | Pure domain services with dependency injection (`BlackboardRepository`) | All unit/integration tests run without CLI invocations | VERIFIED |
| NFR-007 | Credential redaction | Pattern-based and key-based token scanner replacing with `[REDACTED]` | `tests/shared/shared-context.test.ts`, `tests/cli/context-cli.test.ts` | VERIFIED |
| NFR-008 | Actionable error reporting | Strongly typed error hierarchy (`AlmudayaError`) without credential leak | `src/core/errors.ts`, negative test cases across all suites | VERIFIED |
| NFR-009 | Minimal runtime dependencies | Zero production runtime dependencies (Commander is the sole prod dep) | `package.json` inspection (`commander` 14.x only) | VERIFIED |
| NFR-010 | Zero external LLM/cloud dependency | Simulated deterministic bot runtime in tests | Full 77-test suite runs offline without API keys in ~4.7s | VERIFIED |

---

## 3. Section 10 Two-Terminal Acceptance Scenario

| Step | Scenario Step | Verification Test Case | Result |
|:---:|---|---|:---:|
| 1 | Create Session S001 | `tests/e2e/two-terminal-poc.test.ts` Step 1 | PASSED |
| 2 | Start BOT001 in Terminal 1 | `tests/e2e/two-terminal-poc.test.ts` Step 2 | PASSED |
| 3 | Start BOT002 in Terminal 2 | `tests/e2e/two-terminal-poc.test.ts` Step 3 | PASSED |
| 4 | Confirm presence in Session Blackboard | `tests/e2e/two-terminal-poc.test.ts` Step 4 | PASSED |
| 5 | Peer discovery | `tests/e2e/two-terminal-poc.test.ts` Step 5 | PASSED |
| 6 | Broadcast event publication and read | `tests/e2e/two-terminal-poc.test.ts` Step 6 | PASSED |
| 7 | Send direct message | `tests/e2e/two-terminal-poc.test.ts` Step 7 | PASSED |
| 8 | Read and acknowledge direct message | `tests/e2e/two-terminal-poc.test.ts` Step 8 | PASSED |
| 9 | Stop both processes cleanly | `tests/e2e/two-terminal-poc.test.ts` Step 9 | PASSED |
| 10 | Restart and verify state persistence | `tests/e2e/two-terminal-poc.test.ts` Step 10 | PASSED |
| 11 | Bot rename & invariant preservation | `tests/e2e/two-terminal-poc.test.ts` Step 11 | PASSED |
| 12 | Duplicate display name rejection | `tests/e2e/two-terminal-poc.test.ts` Step 12 | PASSED |
