# Changelog

All notable changes to the `almudaya-multiagent` project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.3] - 2026-11-09

### Security & Reliability Remediation (SRP-1)

#### Fixed & Hardened
- **Fail-Closed Execution & Identity (AUD-01, AUD-02, AUD-04, AUD-14 / REQ-01, REQ-02):**
  - Enforced mandatory authenticated `sessionId` and `botId` identity context across `ExecutionController`, `run_command`, `write_file`, `edit_file`, and messaging boundaries; removed policy skip when context is absent.
  - Strict bot binding: bot-specific capability grants match only the authenticated bot principal.
  - Truthful isolation contracts: Windows process tree and Linux process group backends accurately report lack of OS-level filesystem/network sandboxing (`os_isolation_required`).
  - Added platform-specific negative tests verifying access to sentinel files and disallowed resources is denied.
- **Scope & Persistence Integrity (AUD-03, AUD-05, AUD-17 / REQ-03):**
  - Enforced session ID regex format validation before constructing any filesystem path across all persistence layers, preventing directory traversal via path manipulation.
  - Canonical, platform-aware path containment checks with case preservation respecting filesystem semantics.
  - Hardened against symlink, Windows Directory Junction, and traversal attacks.
- **Messaging Delivery Correctness & Lease Fencing (AUD-06, AUD-07, AUD-08, AUD-10 / REQ-04, REQ-05, REQ-02):**
  - Fixed `readInbox` to apply filters and limits before altering delivery state; messages outside the returned page are never marked read.
  - Monotonic lease fencing tokens (`fence_token`) required on worker message ACK (`completeMessage`) and failure (`failMessage`), preventing stale workers from mutating reclaimed messages.
  - Fixed broadcast event cursors to advance strictly after consumer callback succeeds; pagination and filtering never skip unread events across categories.
  - Authenticated sender identity at service boundary: unknown or inactive senders are rejected; system/human principals require explicit typed identification.
- **Lock Coordination, Storage Fencing & Approval Integrity (AUD-09, AUD-12, AUD-16 / REQ-06, REQ-08, REQ-11):**
  - Atomic mutual-exclusion barrier (`.lock_barrier`) for stale lock recovery and lease renewal, eliminating TOCTOU races where a new owner lock could be unlinked.
  - Enforced monotonic fencing token validation at the storage write boundary (`verifyStorageFencing`) so stale lock holders cannot commit after lease expiry.
  - Interactive human approval callback wired into `ExecutionController.authorizeFileAccess` for `per_action` filesystem access with `CAPABILITY_APPROVED` / `CAPABILITY_DENIED` audit recording; rejection of unsupported `per_action` grants at creation time if no approval interface is available.
  - Mandatory security audit persistence: capability grants roll back and sensitive executions fail closed if audit logs cannot be durably written.
- **Secret Lifecycle, Presets, Prompt Trust & Cancellation (AUD-11, AUD-13, AUD-15, AUD-20 / REQ-07, REQ-09, REQ-10, REQ-12):**
  - Deprecated `--api-key` in CLI with explicit security warning; registered provider secrets on init and unregistered on `dispose()`.
  - Centralized recursive secret redaction (`redactRecursively`) across work logs, broadcast logs, direct message inboxes, security audit logs, exceptions, and command outputs.
  - Reconciled capability preset definitions (`controlled`, `extended`, `unrestricted`) with explicit `paths: ['*']` and `commands: ['*']` wildcards, supporting caller path overrides. Unenforced capabilities fail closed.
  - Escaped delimiter sequences (`<<<` to `\<\<\<`, `>>>` to `\>\>\>`) in untrusted peer messages, metadata attributes, and shared work logs; declared delimiters as defense-in-depth in prompt boundary notice.
  - Integrated `AbortController` cancellation propagation across `BotRuntime`, `AutonomousAgentLoop`, provider inference calls, and rate-limit retry backoffs (`sleepWithSignal`).
- **Release Hygiene & Consistency (AUD-18, AUD-19 / REQ-13):**
  - Canonical reconciliation of audit finding IDs AUD-01 through AUD-20 across all documentation, tests, and traceability registers.
  - Synchronized package version `0.3.3` across `package.json`, `package-lock.json`, and core runtime version constants.

---

## [0.3.2] - 2026-11-08

### Added
- **Agent Capability Governance (ACG):**
  - Centralized default-deny authorization engine (`src/capability/`) governing filesystem, command execution, environment, process control, and network access.
  - Capability schemas with strict session, bot, operation, resource scope, and time-bounded validity (`src/capability/schema.ts`).
  - Pre-packaged capability presets: `restricted` (zero external access), `controlled` (scoped read/write), `extended` (scoped commands), and `unrestricted` (requires explicit confirmation).
  - Operator approval workflow with `PER_ACTION`, `SESSION`, and `TIMED` approval durations (`src/capability/approval.ts`).
  - Append-only structured capability and execution audit trail (`src/capability/persistence.ts`).
  - Dedicated CLI command group: `almudaya capability list`, `inspect`, `grant`, `revoke`, `history`, `reset`, and `preset` (`src/cli/commands/capability.ts`).
- **Execution Enforcement & OS Isolation (`src/execution/`):**
  - Unified 9-step `ExecutionController` pipeline enforcing request validation, trusted context assembly, ACG evaluation, operator approval, OS boundary checks, output redaction, and audit logging.
  - OS-level process boundary enforcement: Windows Job Objects process tree containment (`src/execution/isolation/windows.ts`), Linux namespaces (`src/execution/isolation/linux.ts`), and fail-closed fallback for unsupported environments.
  - Refactored `executeRunCommand` and `executeFileTool` to delegate sensitive operations through the execution controller.
- **Transactional Inbox Delivery State Machine (`src/messaging/inbox-state.ts`, `src/messaging/delivery.ts`):**
  - Multi-state lifecycle: `RECEIVED -> PROCESSING -> COMPLETED | RETRY_PENDING | DEAD_LETTER`.
  - Atomic storage-level message leasing, attempt tracking, and automatic expired lease recovery for worker crash resilience.
  - Publisher idempotency keys preventing duplicate message submissions across retries.
- **Native Typed Messaging Tool (`src/tools/messaging-tools.ts`):**
  - Registered `send_message` tool enabling autonomous bots to communicate directly via Blackboard without shell or CLI workarounds.
  - Enforced context-derived sender validation (`IDV-01`), preventing models from forging sender identities.
- **Untrusted Prompt Boundary Protections (`src/ai/prompts.ts`):**
  - Enclosed peer messages, work logs, and external documents within explicit boundary delimiters (`formatUntrustedDirectMessage`, `UNTRUSTED_BOUNDARY_NOTICE`).
  - Active sender authentication against the session bot registry.
- **Provider & Runtime Reliability (`src/ai/gemini.ts`):**
  - Robust error classification distinguishing retryable transient errors (`RATE_LIMIT`, `TRANSIENT`) from permanent fail-fast errors (`AUTH`, `CLIENT`).
  - Preserved server `RetryInfo` headers (e.g. 39 seconds) in `RateLimitPauseError` and backoff calculations without truncation.
  - Bounded exponential backoff with randomized jitter, overall total retry deadlines (`totalTimeoutMs`), and immediate cancellation interruption via `AbortSignal`.
  - Non-reentrant REPL line processing queue ensuring strict FIFO command execution (`src/bot/console.ts`).
  - Consistent PID tracking and lifecycle synchronization across bot start, stop, and reactivation (`src/bot/service.ts`).
  - Strict CLI enum and numeric validation across bot commands (`src/cli/commands/bot.ts`).

### Changed
- Re-architected `src/core/lock.ts` to use cryptographically unique ownership tokens (`owner_id`), monotonic fencing tokens, and process-aware lease renewal (`CONC-01`).
- Separated environment variable construction into `src/execution/environment.ts` with explicit allowlisting and purging of dangerous runtime variables (`SEC-01`, `NT-02`).
- Replaced vulnerable JSONL parsing with resilient per-record parsing and quarantine support (`src/core/jsonl.ts`, `RELIA-03`).
- Added security warning for `--api-key` CLI argument usage, recommending `GEMINI_API_KEY` environment variable injection (`NT-02`).
- TURBO execution mode strictly decoupled from security privilege: TURBO remains an execution mode, never granting unauthorized capabilities.

---

## [0.3.1] - 2026-11-02

### Added
- Subprocess environment sanitization and credential protection (`SEC-01`, Invariant 7).
- Symlink and directory junction traversal defense with dual canonical path verification (`§14/6`, Invariant 5).
- Transactional inbox message processing with at-least-once delivery (`RELIA-01`).
- Adaptive Gemini 429 rate-limit throttling latch with `RetryInfo` header parsing (`NT-05`, `NT-06`).
- Atomic broadcast cursor tracking under category filtering (`CONC-02`).
- CLI `--no-mark-read` flag for message inspection without status mutation.

---

## [0.3.0] - 2026-10-31

### Added
- All-in-One Interactive Bot Console REPL (`almudaya bot run`) with slash commands (`/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`, `/status`, `/clear`, `/help`, `/exit`).
- Non-destructive TTY output rendering preserving active terminal typing buffers.
- Cross-root location-aware session work memory engine (`work_log.jsonl`).
- Function calling tool `get_work_log` for cross-root context exploration.
