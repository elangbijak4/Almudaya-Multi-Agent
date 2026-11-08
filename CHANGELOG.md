# Changelog

All notable changes to the `almudaya-multiagent` project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
