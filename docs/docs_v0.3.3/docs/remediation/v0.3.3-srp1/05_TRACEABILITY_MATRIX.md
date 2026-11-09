# Traceability Matrix — SRP-1

| Finding | Requirement | Main test evidence required | Phase | Status |
|---|---|---|---|---|
| AUD-01 | REQ-01 | Host-file and network isolation negative tests per OS (`tests/execution/controller.test.ts`) | 1 | Implemented (910db4b) |
| AUD-02 | REQ-02 | Missing session/bot context denied (`tests/execution/controller.test.ts`, `tests/tools/command-tools.test.ts`) | 1 | Implemented (910db4b) |
| AUD-03 | REQ-03 | Traversal cannot escape workspace (`tests/capability/capability.test.ts`) | 2 | Implemented (95914d6) |
| AUD-04 | REQ-02 | Bot-bound grant rejects absent/mismatched bot ID (`tests/capability/capability.test.ts`) | 1 | Implemented (910db4b) |
| AUD-05 | REQ-03 | Case-sensitive path scope test (`tests/capability/capability.test.ts`, `tests/tools/sandbox.test.ts`) | 2 | Implemented (95914d6) |
| AUD-06 | REQ-04 | limit=1 mutates only returned/acked message (`tests/messaging/direct-message.test.ts`) | 3 | Implemented (00b10ff) |
| AUD-07 | REQ-05 | Mixed-category, callback-failure, restart redelivery (`tests/messaging/broadcast-cursor-atomic.test.ts`) | 3 | Implemented (00b10ff) |
| AUD-08 | REQ-04 | Stale lease owner/fencing token rejected (`tests/messaging/inbox-state.test.ts`) | 3 | Implemented (00b10ff) |
| AUD-09 | REQ-06 | Stale lock holder cannot write after reacquire (`tests/core/lock.test.ts`) | 4 | Implemented (df55c20) |
| AUD-10 | REQ-02 | Unknown sender rejected by service (`tests/messaging/direct-message.test.ts`, `tests/messaging/broadcast.test.ts`, `tests/cli/messaging-cli.test.ts`) | 3 | Implemented (00b10ff) |
| AUD-11 | REQ-07 | Canary secret absent from argv and all sinks (`tests/security/secret-redaction-canary.test.ts`) | 5 | Implemented (115aac0) |
| AUD-12 | REQ-08 | Per-action approval invokes trusted approver or grant rejected (`tests/execution/controller.test.ts`, `tests/capability/capability.test.ts`) | 4 | Implemented (df55c20) |
| AUD-13 | REQ-09 | Table-driven end-to-end preset tests (`tests/capability/presets-table.test.ts`) | 5 | Implemented (115aac0) |
| AUD-14 | REQ-01/09 | Unsupported capability denies (`tests/execution/controller.test.ts`, `tests/capability/capability.test.ts`, `tests/capability/presets-table.test.ts`) | 1/5 | Implemented (910db4b, 115aac0) |
| AUD-15 | REQ-10 | Embedded delimiter/injection adversarial tests (`tests/security/prompt-injection.test.ts`) | 5 | Implemented (115aac0) |
| AUD-16 | REQ-11 | Audit store failure prevents protected action (`tests/capability/capability.test.ts`, `tests/execution/controller.test.ts`) | 4 | Implemented (df55c20) |
| AUD-17 | REQ-03/01 | Hardlink/TOCTOU tests + OS boundary tests (`tests/tools/file-tools.test.ts`) | 2 | Implemented (95914d6) |
| AUD-18 | REQ-13 | All docs and tests use canonical finding IDs (`01_AUDIT_FINDINGS_REGISTER.md`, `05_TRACEABILITY_MATRIX.md`) | 6 | Implemented (82aa536) |
| AUD-19 | REQ-13 | lockfile/package/archive hygiene checks (`package.json`, `package-lock.json`, `dist-release/`) | 6 | Implemented (82aa536) |
| AUD-20 | REQ-12 | Stop aborts provider request and retry wait (`tests/bot/cancellation.test.ts`) | 5 | Implemented (115aac0) |

## Required per-row completion fields
Source path/symbol, fix commit, exact test command, test result, report path, reviewer, verification date.
