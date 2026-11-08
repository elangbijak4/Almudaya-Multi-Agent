# Traceability Matrix — SRP-1

| Finding | Requirement | Main test evidence required | Phase | Status |
|---|---|---|---|---|
| AUD-01 | REQ-01 | Host-file and network isolation negative tests per OS (`tests/execution/controller.test.ts`) | 1 | Implemented (910db4b) |
| AUD-02 | REQ-02 | Missing session/bot context denied (`tests/execution/controller.test.ts`, `tests/tools/command-tools.test.ts`) | 1 | Implemented (910db4b) |
| AUD-03 | REQ-03 | Traversal cannot escape workspace | 2 | Not started |
| AUD-04 | REQ-02 | Bot-bound grant rejects absent/mismatched bot ID (`tests/capability/capability.test.ts`) | 1 | Implemented (910db4b) |
| AUD-05 | REQ-03 | Case-sensitive path scope test | 2 | Not started |
| AUD-06 | REQ-04 | limit=1 mutates only returned/acked message | 3 | Not started |
| AUD-07 | REQ-05 | Mixed-category, callback-failure, restart redelivery | 3 | Not started |
| AUD-08 | REQ-04 | Stale lease owner/fencing token rejected | 3 | Not started |
| AUD-09 | REQ-06 | Stale lock holder cannot write after reacquire | 4 | Not started |
| AUD-10 | REQ-02 | Unknown sender rejected by service | 3 | Not started |
| AUD-11 | REQ-07 | Canary secret absent from argv and all sinks | 5 | Not started |
| AUD-12 | REQ-08 | Per-action approval invokes trusted approver or grant rejected | 4 | Not started |
| AUD-13 | REQ-09 | Table-driven end-to-end preset tests | 5 | Not started |
| AUD-14 | REQ-01/09 | Unsupported capability denies (`tests/execution/controller.test.ts`, `tests/capability/capability.test.ts`) | 1/5 | Implemented (910db4b) |
| AUD-15 | REQ-10 | Embedded delimiter/injection adversarial tests | 5 | Not started |
| AUD-16 | REQ-11 | Audit store failure prevents protected action | 4 | Not started |
| AUD-17 | REQ-03/01 | Hardlink/TOCTOU tests + OS boundary tests | 2 | Not started |
| AUD-18 | REQ-13 | All docs and tests use canonical finding IDs | 6 | Not started |
| AUD-19 | REQ-13 | lockfile/package/archive hygiene checks | 6 | Not started |
| AUD-20 | REQ-12 | Stop aborts provider request and retry wait | 5 | Not started |

## Required per-row completion fields
Source path/symbol, fix commit, exact test command, test result, report path, reviewer, verification date.
