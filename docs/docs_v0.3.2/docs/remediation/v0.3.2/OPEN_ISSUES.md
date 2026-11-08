# Open Issues Register — v0.3.2

- **Last Updated:** 2026-11-08
- **Current Phase:** Phase 6 (Final Verification & Release)
- **Status:** All 10 Remediation Issues 100% CLOSED & Verified

---

## Remediation Issues Summary

| Issue ID | Area | Severity | Description | Phase Target | Status | Resolution / Verification Evidence |
|---|---|:---:|---|:---:|:---:|---|
| **ISSUE-01** | Lock Concurrency | Critical | File lock release only validates PID and lacks cryptographically unique ownership token, lease renewal, and fencing token (`CONC-01`). | Phase 1 | **CLOSED** | Hardened in `src/core/lock.ts` (`owner_id`, monotonic fencing token). Verified by `tests/core/lock.test.ts` (9 tests PASS). See `PHASE_1_REPORT.md`. |
| **ISSUE-02** | Environment Security | Critical | Subprocess environment uses basic allowlist but lacks dedicated `src/execution/environment.ts` builder and variable audit (`SEC-01`, `NT-02`). | Phase 1 & 5 | **CLOSED** | Dedicated builder in `src/execution/environment.ts` purging dangerous vars (`PYTHONPATH`, `LD_PRELOAD`, etc.) and CLI `--api-key` warnings. Verified by `tests/execution/environment.test.ts` & `tests/cli/bot-cli.test.ts`. See `PHASE_1_REPORT.md` & `PHASE_5_REPORT.md`. |
| **ISSUE-03** | JSONL Reliability | High | Single corrupted line in `.jsonl` files causes unhandled JSON parse failure across entire storage read stream (`RELIA-03`). | Phase 1 | **CLOSED** | Resilient per-record parser with quarantine support in `src/core/jsonl.ts`. Verified by `tests/core/jsonl.test.ts` (5 tests PASS). See `PHASE_1_REPORT.md`. |
| **ISSUE-04** | Agent Capability Governance | Critical | No ACG subsystem exists in v0.3.1. External operations default to system access rather than explicit deny; no grant persistence exists (`SEC-03`, ADR-001). | Phase 2 | **CLOSED** | Implemented full ACG subsystem (`src/capability/`) with default-deny, schemas, presets, approvals, persistence, and CLI. Verified by `tests/capability/capability.test.ts` (20 tests PASS). See `PHASE_2_REPORT.md`. |
| **ISSUE-05** | Execution Enforcement | Critical | Shell commands execute directly on host via `child_process.spawn({ shell: true })` without central controller or OS boundary enforcement (`SEC-03`, ADR-002, ADR-003). | Phase 3 | **CLOSED** | Implemented 9-step `ExecutionController` and OS isolation backends (`src/execution/`). Verified by `tests/execution/controller.test.ts` & `tests/tools/command-tools.test.ts`. See `PHASE_3_REPORT.md`. |
| **ISSUE-06** | Messaging State Machine | High | Inbox lacks explicit multi-state lifecycle (`RECEIVED -> PROCESSING -> COMPLETED/RETRY_PENDING/DEAD_LETTER`) and attempt counters (`RELIA-01`). | Phase 4 | **CLOSED** | Implemented inbox state machine and `InboxDeliveryService` (`src/messaging/`). Verified by `tests/messaging/inbox-state.test.ts` (13 tests PASS). See `PHASE_4_REPORT.md`. |
| **ISSUE-07** | Native Messaging Tool | Medium | Agent loop lacks built-in `send_message` tool; relies on CLI or workarounds (`NT-03`). | Phase 4 | **CLOSED** | Implemented `send_message` tool with trusted context-derived sender validation in `src/tools/messaging-tools.ts`. Verified by `tests/tools/messaging-tools.test.ts` (4 tests PASS). See `PHASE_4_REPORT.md`. |
| **ISSUE-08** | Untrusted Prompt Data | High | Peer messages and work logs are injected directly into system prompts without untrusted boundary delimiters (`SEC-02`, `IDV-01`). | Phase 4 | **CLOSED** | Implemented delimiter formatting (`<<<UNTRUSTED_*>>>`) and bot sender verification in `src/ai/prompts.ts` and `src/bot/agent-loop.ts`. Verified by `tests/security/prompt-injection.test.ts` (4 tests PASS). See `PHASE_4_REPORT.md`. |
| **ISSUE-09** | Polling Reentrancy | Medium | `BotRuntime.pollCycle()` uses simple local boolean lock rather than storage-level reentrancy lease (`PERF-01`). | Phase 4 & 5 | **CLOSED** | Implemented `pollInFlight` single-flight guard + storage leases in `src/bot/runtime.ts` and non-reentrant FIFO queue in `src/bot/console.ts`. Verified by `tests/bot/runtime.test.ts` & `tests/bot/console.test.ts`. See `PHASE_4_REPORT.md` & `PHASE_5_REPORT.md`. |
| **ISSUE-10** | Documentation & Versioning | Low | Need version bump to `0.3.2` and synchronization of architectural docs and badges (`DOC-01`). | Phase 6 | **CLOSED** | Bumped version to `0.3.2` in `package.json`, `src/core/version.ts`, `tests/cli.test.ts`, updated `README.md`, created `CHANGELOG.md`, and published release reports. See `FINAL_VERIFICATION_REPORT.md`. |

---

## Known Residual System Limitations (Documented per §13.18)

1. **Host-Level Isolation Boundary:** Windows Job Objects restrict process tree execution and resources, but Windows does not provide unprivileged filesystem/network namespaces identical to Linux. Broad external host authority (`command.arbitrary` without scoping) requires dedicated container/VM virtualization.
2. **At-Least-Once Delivery Invariant:** In the absence of a distributed 2-phase commit transaction manager between the local disk and external AI model endpoints, message delivery guarantees are strictly **at-least-once**. Consumers must remain idempotent.
