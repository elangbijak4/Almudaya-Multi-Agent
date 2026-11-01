# Requirement Traceability Matrix

Status awal: baseline draft. Isi kolom desain, implementasi, dan test saat fase terkait selesai.

| Requirement | Design reference | Implementation module | Verification |
|---|---|---|---|
| FR-001 | Create Session with stable ID & metadata | `session/`, `blackboard/` | `tests/blackboard/persistence.test.ts` (Phase 2 verified) |
| FR-002 | Bot join existing session | `session/`, `bot/` | `tests/bot/bot-registry.test.ts` (Phase 3 verified) |
| FR-003 | Register bot in session registry | `bot/`, `blackboard/` | `tests/bot/bot-registry.test.ts` (Phase 3 verified) |
| FR-004 | Stable Bot ID distinct from display name | `bot/` | `tests/bot/bot-registry.test.ts` (Phase 3 verified) |
| FR-005 | Default display name `<session>_<seq>` | `bot/` | `tests/bot/bot-registry.test.ts` (Phase 3 verified) |
| FR-006 | Custom and editable display name | `bot/` | `tests/bot/bot-registry.test.ts` (Phase 3 verified) |
| FR-007 | Display name uniqueness within session | `bot/` | `tests/bot/bot-registry.test.ts` (Phase 3 verified) |
| FR-008 | Discover peer bots via registry | `bot/` | `tests/bot/bot-registry.test.ts` (Phase 3 verified) |
| FR-009 | Store bot status, PID, and timestamps | `bot/` | `tests/bot/bot-registry.test.ts` (Phase 3 verified) |
| FR-010 | Session broadcast log | `messaging/`, `blackboard/` | `tests/messaging/broadcast.test.ts` (Phase 4 verified) |
| FR-011 | Bot read available broadcasts | `messaging/` | `tests/messaging/broadcast.test.ts` (Phase 4 verified) |
| FR-012 | Individual Blackboard per bot | `messaging/`, `blackboard/` | `tests/messaging/direct-message.test.ts` (Phase 4 verified) |
| FR-013 | Send direct message to bot ID | `messaging/` | `tests/messaging/direct-message.test.ts` (Phase 4 verified) |
| FR-014 | Read and acknowledge direct messages | `messaging/` | `tests/messaging/direct-message.test.ts` (Phase 4 verified) |
| FR-015 | Unique message and event IDs with timestamps | `messaging/schema.ts` | `tests/messaging/broadcast.test.ts`, `tests/messaging/direct-message.test.ts` (Phase 4 verified) |
| FR-016 | Messaging state survives process restart | `blackboard/`, `messaging/` | `tests/messaging/broadcast.test.ts`, `tests/messaging/direct-message.test.ts` (Phase 4 verified) |
| FR-017 | Register & list multiple project roots | `shared/`, `blackboard/` | `tests/shared/shared-context.test.ts` (Phase 5 verified) |
| FR-018 | Register shared environment metadata | `shared/`, `blackboard/` | `tests/shared/shared-context.test.ts` (Phase 5 verified) |
| FR-019 | Register & filter SDLC document references | `shared/`, `blackboard/` | `tests/shared/shared-context.test.ts` (Phase 5 verified) |
| FR-020 | CLI help & version | `cli/` | `tests/cli.test.ts` (Phase 1 verified) |
| FR-021 | CLI commands (session, bot, message, context) | `cli/` | Verified across CLI test suites (Phase 1..5 verified) |
| FR-022 | Configurable workspace root | `core/config.ts` | `tests/core/config.test.ts` (Phase 2 verified) |
| FR-023 | Resilient to process crash / abnormal stop | `core/lock.ts`, `blackboard/` | `tests/core/lock.test.ts`, `tests/bot/concurrent-registration.test.ts` (Phase 2 & 3 verified) |

Update this matrix with exact test file names and test case IDs before release.
