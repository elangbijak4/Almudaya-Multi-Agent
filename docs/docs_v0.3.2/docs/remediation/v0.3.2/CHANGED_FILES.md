# Changed & Added Files Catalog — v0.3.2

- **Baseline Version:** `0.3.1` (`6c617febfb9e7185a46ecfc92f6dd3ac18dc9a94`)
- **Release Version:** `0.3.2`
- **Release Date:** 2026-11-08

---

## 1. Production Source Changes

### Subsystem: Core & Foundation (`src/core/`)
| File | Action | Phase | Description |
|---|:---:|:---:|---|
| [`src/core/lock.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/core/lock.ts) | Modified | 1 | Ownership token (`owner_id`), monotonic fencing token, process-aware lease renewal, and stale lock reclamation (`CONC-01`). |
| [`src/core/jsonl.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/core/jsonl.ts) | Added | 1 | Resilient per-record JSONL parser (`parseJsonl`, `readJsonlFile`), error isolation, and quarantine support (`RELIA-03`). |
| [`src/core/version.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/core/version.ts) | Modified | 6 | Bumped version constant to `'0.3.2'`. |

### Subsystem: Agent Capability Governance (`src/capability/`)
| File | Action | Phase | Description |
|---|:---:|:---:|---|
| [`src/capability/schema.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/schema.ts) | Added | 2 | Granular capability identifiers, scope interfaces, grant schemas, and audit event schemas (`ADR-001`, `ADR-005`). |
| [`src/capability/registry.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/registry.ts) | Added | 2 | Default standard capability registry with validation and duplicate prevention. |
| [`src/capability/persistence.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/persistence.ts) | Added | 2 | Append-only storage for session capability grants (`grants.jsonl`) and audit events (`audit.jsonl`). |
| [`src/capability/policy-engine.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/policy-engine.ts) | Added | 2 | Central default-deny policy evaluator matching resource, operation, and time bounds. |
| [`src/capability/approval.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/approval.ts) | Added | 2 | Human-in-the-Loop approval manager for `PER_ACTION`, `SESSION`, and `TIMED` authorizations. |
| [`src/capability/presets.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/presets.ts) | Added | 2 | Capability preset manager for `restricted`, `controlled`, `extended`, and `unrestricted`. |
| [`src/capability/service.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/service.ts) | Added | 2 | High-level facade for issuing, revoking, listing, and resetting capability grants under session lock. |
| [`src/capability/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/index.ts) | Added | 2 | Barrel export for ACG subsystem. |

### Subsystem: Execution Enforcement & OS Isolation (`src/execution/`)
| File | Action | Phase | Description |
|---|:---:|:---:|---|
| [`src/execution/types.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/types.ts) | Added | 3 | Type definitions for execution requests, results, contexts, and isolation backends. |
| [`src/execution/environment.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/environment.ts) | Added | 1 | Subprocess environment sanitizer purging dangerous variables (`PYTHONPATH`, `LD_PRELOAD`, etc.) and output secret redactor. |
| [`src/execution/isolation/interface.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/isolation/interface.ts) | Added | 3 | Contract for OS-level isolation backends. |
| [`src/execution/isolation/windows.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/isolation/windows.ts) | Added | 3 | Windows Job Objects process tree containment backend. |
| [`src/execution/isolation/linux.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/isolation/linux.ts) | Added | 3 | Linux namespace containerization backend. |
| [`src/execution/isolation/unsupported.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/isolation/unsupported.ts) | Added | 3 | Fail-closed stub for unsupported operating systems. |
| [`src/execution/isolation/factory.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/isolation/factory.ts) | Added | 3 | Platform detector instantiating appropriate isolation backend. |
| [`src/execution/isolation/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/isolation/index.ts) | Added | 3 | Barrel export for isolation module. |
| [`src/execution/controller.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/controller.ts) | Added | 3 | Central 9-step `ExecutionController` enforcing ACG authorization, approvals, and OS boundaries. |
| [`src/execution/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/execution/index.ts) | Added | 3 | Barrel export for execution subsystem. |

### Subsystem: Messaging & Concurrency (`src/messaging/`)
| File | Action | Phase | Description |
|---|:---:|:---:|---|
| [`src/messaging/schema.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/messaging/schema.ts) | Modified | 4 | Extended direct message schema with delivery states, lease ownership, attempt counters, and idempotency keys. |
| [`src/messaging/inbox-state.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/messaging/inbox-state.ts) | Added | 4 | State machine definitions (`RECEIVED -> PROCESSING -> COMPLETED/RETRY_PENDING/DEAD_LETTER`) and transition validator. |
| [`src/messaging/delivery.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/messaging/delivery.ts) | Added | 4 | `InboxDeliveryService` managing atomic claims, leases, acknowledgments, failure transitions, and expired lease recovery. |
| [`src/messaging/service.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/messaging/service.ts) | Modified | 4 | Integrated `InboxDeliveryService`, publisher idempotency deduplication in `sendDirectMessage`, and delivery filtering in `readInbox`. |
| [`src/messaging/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/messaging/index.ts) | Added | 4 | Barrel export for messaging subsystem. |

### Subsystem: AI Provider & Tools (`src/ai/`, `src/tools/`)
| File | Action | Phase | Description |
|---|:---:|:---:|---|
| [`src/ai/provider.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/ai/provider.ts) | Modified | 5 | Added optional `signal?: AbortSignal` to `AIRequest`. |
| [`src/ai/gemini.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/ai/gemini.ts) | Modified | 5 | Error classification (`classifyGeminiError`), server `RetryInfo` preservation (39s), bounded exponential backoff + jitter, total deadline, cancellation via `AbortSignal`, and `sleepWithSignal`. |
| [`src/ai/prompts.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/ai/prompts.ts) | Modified | 4 | Prompt untrusted delimiters (`formatUntrustedDirectMessage`, `UNTRUSTED_BOUNDARY_NOTICE`, `<<<UNTRUSTED_*>>>`). |
| [`src/tools/messaging-tools.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/tools/messaging-tools.ts) | Added | 4 | Typed `send_message` tool with trusted execution context sender derivation. |
| [`src/tools/command-tools.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/tools/command-tools.ts) | Modified | 3 | Refactored `executeRunCommand` to delegate execution through `ExecutionController`. |
| [`src/tools/file-tools.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/tools/file-tools.ts) | Modified | 3 | Added `resolvePathWithAuthorization` delegating external filesystem mutations to `ExecutionController`. |
| [`src/tools/sandbox.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/tools/sandbox.ts) | Modified | 1 | Preserved canonical project sandboxing; re-exported path normalization utilities. |
| [`src/tools/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/tools/index.ts) | Modified | 3 & 4 | Exported new execution and messaging tool adapters. |

### Subsystem: Bot Runtime & CLI (`src/bot/`, `src/cli/`)
| File | Action | Phase | Description |
|---|:---:|:---:|---|
| [`src/bot/agent-loop.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/bot/agent-loop.ts) | Modified | 3 & 4 | Registered `SEND_MESSAGE_TOOL`, validated senders, injected execution context, and encapsulated untrusted messages. |
| [`src/bot/console.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/bot/console.ts) | Modified | 4 & 5 | Added delivery metadata to synthetic REPL messages; added FIFO `inputQueue` and `isProcessingInput` reentrancy guard. |
| [`src/bot/runtime.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/bot/runtime.ts) | Modified | 4 | Added `pollInFlight` single-flight guard, integrated message leasing and expired lease recovery in `pollCycle`. |
| [`src/bot/service.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/bot/service.ts) | Modified | 5 | Updated `updateStatus` to synchronize `record.pid` upon reactivation and clear PID upon bot shutdown. |
| [`src/cli/commands/capability.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/cli/commands/capability.ts) | Added | 2 | Implemented CLI command group `almudaya capability` (`list`, `inspect`, `grant`, `revoke`, `history`, `reset`, `preset`). |
| [`src/cli/commands/bot.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/cli/commands/bot.ts) | Modified | 5 | Added security warning for `--api-key`, strict validation for `--provider`, `--mode`, `--interval`, `--max-iterations`. |
| [`src/cli/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/cli/index.ts) | Modified | 2 | Registered capability command group. |
| [`src/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/index.ts) | Modified | 2, 3, 4 | Barrel export for ACG, execution, and messaging modules. |

---

## 2. Test Suite Additions & Enhancements

| Test File | Type | Tests Added / Total | Focus Area |
|---|:---:|:---:|---|
| [`tests/core/lock.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/core/lock.test.ts) | Extended | +2 / 9 | Ownership token verification, fencing tokens, stale lock reclamation |
| [`tests/core/jsonl.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/core/jsonl.test.ts) | Added | +5 / 5 | Resilient line parsing, malformed record isolation, quarantine |
| [`tests/execution/environment.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/execution/environment.test.ts) | Added | +9 / 9 | Environment purging, allowlisting, secret redaction |
| [`tests/capability/capability.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/capability/capability.test.ts) | Added | +20 / 20 | ACG policy engine, default-deny, grants, presets, approval, audit |
| [`tests/execution/controller.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/execution/controller.test.ts) | Added | +11 / 11 | ExecutionController pipeline, approval enforcement, OS isolation |
| [`tests/messaging/inbox-state.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/messaging/inbox-state.test.ts) | Added | +13 / 13 | State machine transitions, storage leases, dead-letter, idempotency |
| [`tests/tools/messaging-tools.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/tools/messaging-tools.test.ts) | Added | +4 / 4 | Native `send_message` tool, trusted sender derivation |
| [`tests/security/prompt-injection.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/security/prompt-injection.test.ts) | Added | +4 / 4 | Untrusted prompt delimiters, policy immunity from peer data |
| [`tests/ai/gemini-retry.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/ai/gemini-retry.test.ts) | Extended | +17 / 23 | Error classification, RetryInfo 39s, deadline, cancellation, fail-fast |
| [`tests/bot/console.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/bot/console.test.ts) | Extended | +1 / 18 | REPL non-reentrancy, sequential FIFO input ordering |
| [`tests/bot/liveness.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/bot/liveness.test.ts) | Extended | +1 / 4 | PID lifecycle synchronization upon reactivation and stop |
| [`tests/cli/bot-cli.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/cli/bot-cli.test.ts) | Extended | +4 / 9 | `--api-key` security warning, enum and numeric argument validation |
| [`tests/cli.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/cli.test.ts) | Modified | 0 / 3 | Version constant and CLI version flag assertion for v0.3.2 |
| **Total Test Impact** | — | **+94 tests** | **295 total tests passing (100%)** |
