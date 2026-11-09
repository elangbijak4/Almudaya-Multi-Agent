# Canonical Audit Findings Register — SRP-1

This is the canonical register for the 20 findings in the audit report dated 8 November 2026. The descriptions below are concise; the full audit report remains the detailed evidence source.

| ID | Severity | Area | Finding summary | Required outcome |
|---|---|---|---|---|
| AUD-01 | Critical | OS isolation | Current platform backends terminate process trees/groups but do not sandbox host filesystem/network | Real OS isolation or sensitive execution disabled/fail-closed |
| AUD-02 | High | ACG context | Missing session ID skips policy evaluation | Session and authenticated bot identity mandatory |
| AUD-03 | High | Capability persistence | Session ID path traversal escapes workspace | Strict ID validation + canonical containment |
| AUD-04 | High | Bot-bound grant | Missing caller bot ID can match bot-bound grant | Exact authenticated bot ID required |
| AUD-05 | High | Path scope | Lowercase comparison weakens case-sensitive path scope | Platform-aware canonical path containment |
| AUD-06 | High | Inbox | `readInbox` marks all matches read before applying limit | Limit before mutation; ack only returned/processed messages |
| AUD-07 | High | Broadcast | Filter/cursor/limit and pre-callback advancement can skip events | Delivery/ack or per-category cursor; advance only after success |
| AUD-08 | High | Delivery lease | Stale consumer can mutate another consumer's lease | Owner + fencing token required for ACK/fail |
| AUD-09 | High | Lock | Stale recovery/release/renew races; fencing not enforced at write boundary | Atomic ownership-safe lock + storage-enforced fencing |
| AUD-10 | High | Sender identity | Messaging service trusts caller-supplied sender ID | Authenticate sender at service boundary |
| AUD-11 | High | Secrets | argv API key and incomplete/non-central redaction | Remove normal argv secret path; central recursive redaction |
| AUD-12 | High | Approval | External filesystem per-action approval has no functioning prompt path | Wire trusted approval or reject unsupported grant mode |
| AUD-13 | Medium | Presets | Preset scopes/operation mapping conflict with evaluator | End-to-end valid preset semantics |
| AUD-14 | Medium | Capability enforcement | Registered capabilities are not all enforced | Unsupported capabilities explicitly DENY |
| AUD-15 | Medium | Prompt injection | Untrusted delimiters can be injected verbatim | Structured encoding/escaping + adversarial tests |
| AUD-16 | Medium | Audit durability | Audit write failures are swallowed | Mandatory audit durable before protected action |
| AUD-17 | Medium | Filesystem | Hardlink and TOCTOU remain beyond path validation | Descriptor-safe operations and OS isolation |
| AUD-18 | Medium | Traceability | Finding IDs/counts differ across docs | One canonical ID map and reconciled docs |
| AUD-19 | Medium | Release hygiene | Lockfile version/docs/archive metadata inconsistent | Reproducible metadata and clean source distribution |
| AUD-20 | Medium | Cancellation | Runtime does not propagate abort to in-flight provider calls | End-to-end AbortSignal lifecycle |

## Status fields
For each finding record: `Not started`, `In progress`, `Implemented`, `Tested`, `Verified`, `Blocked`, `Deferred`, or `Rejected`. `Verified` requires independent evidence and reviewer approval.

## Closure record
| ID | Status | Fix commit | Regression test | Evidence path | Reviewer/date |
|---|---|---|---|---|---|
| AUD-01 | Implemented | 910db4b | tests/execution/controller.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_1_REPORT.md | Gate Approved (User prompt 10) |
| AUD-02 | Implemented | 910db4b | tests/execution/controller.test.ts, tests/tools/command-tools.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_1_REPORT.md | Gate Approved (User prompt 10) |
| AUD-03 | Implemented | 95914d6 | tests/capability/capability.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_2_REPORT.md | Gate Approved (User prompt 11) |
| AUD-04 | Implemented | 910db4b | tests/capability/capability.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_1_REPORT.md | Gate Approved (User prompt 10) |
| AUD-05 | Implemented | 95914d6 | tests/capability/capability.test.ts, tests/tools/sandbox.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_2_REPORT.md | Gate Approved (User prompt 11) |
| AUD-06 | Implemented | 00b10ff | tests/messaging/direct-message.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_3_REPORT.md | Gate Approved (User prompt 12) |
| AUD-07 | Implemented | 00b10ff | tests/messaging/broadcast-cursor-atomic.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_3_REPORT.md | Gate Approved (User prompt 12) |
| AUD-08 | Implemented | 00b10ff | tests/messaging/inbox-state.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_3_REPORT.md | Gate Approved (User prompt 12) |
| AUD-09 | Implemented | df55c20 | tests/core/lock.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_4_REPORT.md | Gate Approved (User prompt 13) |
| AUD-10 | Implemented | 00b10ff | tests/messaging/direct-message.test.ts, tests/messaging/broadcast.test.ts, tests/cli/messaging-cli.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_3_REPORT.md | Gate Approved (User prompt 12) |
| AUD-11 | Implemented | 115aac0 | tests/security/secret-redaction-canary.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_5_REPORT.md | Gate Approved (User prompt 14) |
| AUD-12 | Implemented | df55c20 | tests/execution/controller.test.ts, tests/capability/capability.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_4_REPORT.md | Gate Approved (User prompt 13) |
| AUD-13 | Implemented | 115aac0 | tests/capability/presets-table.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_5_REPORT.md | Gate Approved (User prompt 14) |
| AUD-14 | Implemented | 910db4b | tests/execution/controller.test.ts, tests/capability/capability.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_1_REPORT.md | Gate Approved (User prompt 10) |
| AUD-15 | Implemented | 115aac0 | tests/security/prompt-injection.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_5_REPORT.md | Gate Approved (User prompt 14) |
| AUD-16 | Implemented | df55c20 | tests/capability/capability.test.ts, tests/execution/controller.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_4_REPORT.md | Gate Approved (User prompt 13) |
| AUD-17 | Implemented | 95914d6 | tests/tools/file-tools.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_2_REPORT.md | Gate Approved (User prompt 11) |
| AUD-18 | Implemented | 82aa536 | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/05_TRACEABILITY_MATRIX.md | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/FINAL_VERIFICATION_REPORT.md | Gate Approved (User prompt 14) |
| AUD-19 | Implemented | 82aa536 | package.json, package-lock.json, tests/cli.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/FINAL_VERIFICATION_REPORT.md | Gate Approved (User prompt 14) |
| AUD-20 | Implemented | 115aac0 | tests/bot/cancellation.test.ts | docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/PHASE_5_REPORT.md | Gate Approved (User prompt 14) |
