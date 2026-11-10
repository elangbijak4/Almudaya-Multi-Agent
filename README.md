# Almudaya Multi-Agent (`almudaya-multiagent` v0.3.3)

[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Tests: 379 Passed](https://img.shields.io/badge/Tests-379%20Passed-brightgreen.svg)](./docs/docs_v0.3.3/docs/remediation/v0.3.3-srp1/reports/FINAL_VERIFICATION_REPORT.md)
[![AI Engine: Google Gemini](https://img.shields.io/badge/AI%20Engine-Google%20Gemini-orange.svg)](https://deepmind.google/technologies/gemini/)

A session-centric, multi-process autonomous AI coding agent collaboration foundation featuring **Agent Capability Governance (ACG)**, **OS-Level Boundary Enforcement**, **Transactional Inbox State Machine**, **Interactive All-in-One Bot Console REPL**, and **Cross-Root Location-Aware Session Work Memory**.

Almudaya Multi-Agent empowers multiple autonomous AI bots and human engineers to collaborate across multiple project directories within an isolated, persistent **Session Blackboard**, executing real-world software engineering tasks directly against registered project codebases with strict security boundaries.

---

## What's New in Version 0.3.3 (Security Remediation Package 1 — SRP-1)

Version 0.3.3 successfully remediates all 20 findings (AUD-01 through AUD-20) identified in the independent security and runtime audit:

1. **Fail-Closed Execution & Identity (AUD-01, AUD-02, AUD-04, AUD-14):**
   - Mandatory session identity and authenticated bot principal required for all sensitive executions and message dispatches; zero bypass when context is absent.
   - Capability grants bound to specific bots require exact authenticated caller matching.
   - Truthful isolation reporting; execution fails closed with exit code 127 when required OS sandboxing (`os_isolation_required`) is unsupported by the platform backend.

2. **Scope & Path Traversal Hardening (AUD-03, AUD-05, AUD-17):**
   - Session identifier format validation (`SESSION_ID_REGEX`) prior to path construction prevents directory traversal across all storage operations.
   - Canonical, platform-aware path containment with case preservation respecting OS filesystem semantics.
   - Symlink, directory junction, and hardlink TOCTOU defenses.

3. **Messaging Delivery Correctness & Lease Fencing (AUD-06, AUD-07, AUD-08, AUD-10):**
   - Fixed inbox pagination/limit to never mark unreturned messages as read.
   - Broadcast cursors advance strictly after successful callback execution; category filtering never loses unread events.
   - Worker lease fencing tokens prevent stale workers from mutating reclaimed messages.
   - Authenticated sender verification at service boundary.

4. **Lock Coordination, Write Fencing & Durable Audit (AUD-09, AUD-12, AUD-16):**
   - Atomic mutual-exclusion barrier (`.lock_barrier`) eliminates stale lock recovery and renewal race conditions.
   - Monotonic fencing validation at the storage write boundary (`verifyStorageFencing`) prevents stale lock holders from committing after lease expiration.
   - Wired interactive human approval callback for `per_action` filesystem access; rejection of unsupported grants at creation time.
   - Mandatory security audit persistence: operations fail closed and grants roll back if audit logs cannot be written.

5. **Secret Redaction, Presets, Prompt Delimiters & Cancellation (AUD-11, AUD-13, AUD-15, AUD-20):**
   - Centralized recursive secret redaction (`redactRecursively`) across work logs, broadcasts, inboxes, and audit trails; API key deprecation on CLI; provider secret registration and disposal.
   - Reconciled capability preset definitions (`controlled`, `extended`, `unrestricted`) with explicit wildcard scopes and path override support. Unenforced capabilities fail closed.
   - Prompt delimiter escaping (`<<<` to `\<\<\<`, `>>>` to `\>\>\>`) for untrusted peer messages, metadata, and shared work logs.
   - Clean `AbortSignal` cancellation propagation across bot runtime, agent loop, provider calls, and rate-limit wait delays without post-stop retry.

6. **Release Hygiene & Verification (AUD-18, AUD-19):**
   - Synchronized package version (`0.3.3`) and lockfile metadata.
   - 47 test suites / 379 tests passing with 100% pass rate.

---

## What's New in Version 0.3.2 (Security & Concurrency Hardening)

1. **Agent Capability Governance (ACG) (`SEC-03`, `ADR-001`):**
   - Central default-deny authorization engine governing all sensitive operations (filesystem, process execution, environment, process control, and network).
   - Scoped, expiring, and auditable capability grants (`almudaya capability grant / revoke / list / inspect`).
   - Four pre-packaged security presets: `restricted`, `controlled`, `extended`, and `unrestricted`.
   - Explicit operator approval workflows (`PER_ACTION`, `SESSION`, `TIMED`).
   - **TURBO is an execution mode, not a security privilege:** TURBO skips manual confirmations for already-granted capabilities, but strictly cannot bypass missing or denied capabilities.

2. **Execution Enforcement & OS Isolation (`SEC-03`, `ADR-002`, `ADR-003`):**
   - Central 9-step `ExecutionController` pipeline mediating all sensitive execution requests.
   - OS-level process boundary enforcement via Windows Job Objects (process tree containment) and Linux namespaces, with fail-closed denial for unsupported environments.
   - Refactored command tools (`run_command`) and file tools (`write_file`, `edit_file`) ensuring zero direct shell bypasses.

3. **Distributed Locking Hardening (`CONC-01`):**
   - Cryptographically random ownership tokens (`owner_id`), monotonic fencing tokens, and process-aware lease renewal preventing stale lock hijack and split-brain states.

4. **Transactional Inbox Delivery State Machine (`RELIA-01`, `ADR-004`):**
   - Multi-state lifecycle (`RECEIVED -> PROCESSING -> COMPLETED | RETRY_PENDING | DEAD_LETTER`).
   - Atomic storage leases, attempt counters, poison-pill dead-letter queue, and automatic recovery of expired leases from crashed workers.
   - Publisher idempotency keys preventing duplicate message submission upon retries.

5. **Native Typed Messaging Tool (`NT-03`, `IDV-01`):**
   - Autonomous agent reasoning loop includes native `send_message` tool communicating directly via Blackboard without shell or CLI workarounds.
   - Sender identity derived exclusively from trusted runtime execution context, preventing model-supplied sender forgery.

6. **Prompt Injection & Trust Boundary Defense (`SEC-02`):**
   - Peer messages, work logs, and external documents are enclosed within explicit delimiter tags (`<<<UNTRUSTED_*>>>`).
   - Active sender authentication verified against the session bot registry.

7. **AI Provider Reliability & Retry Hardening (`NT-01`):**
   - Error classification distinguishing retryable transient errors (`RATE_LIMIT`, `TRANSIENT`) from permanent fail-fast errors (`AUTH`, `CLIENT`).
   - Strictly respects server `RetryInfo` delays (e.g. 39 seconds preserved in `RateLimitPauseError`, never truncated).
   - Bounded exponential backoff with randomized jitter, overall total retry deadlines, and cancellation via `AbortSignal`.
   - Non-reentrant REPL line processing queue ensuring strict FIFO command execution (`PERF-01`).
   - CLI security warning on `--api-key` recommending secure `GEMINI_API_KEY` environment injection (`NT-02`).

---

## What's New in Version 0.3.1 (Security, Concurrency & Reliability Patch)

1. **Subprocess Environment Sanitization & Output Redaction (`SEC-01`, Invariant 7):**
   - Subprocess shells spawned via `run_command` only inherit an explicit allowlist of non-sensitive system environment variables (`PATH`, `SYSTEMROOT`, `TEMP`, etc.).
   - Host secrets, API keys (`GEMINI_API_KEY`, tokens, auth credentials) are stripped to prevent child processes from exfiltrating credentials.
   - Command stdout/stderr is filtered through regex patterns redacting accidentally printed API keys.
2. **Canonical Sandbox Isolation & Symlink/Junction Defense (`§14/6`, Invariant 5):**
   - File sandboxing enforces dual canonical physical (`fs.realpathSync`) and lexical boundary verification, defeating Windows directory junction (`mklink /J`) and Unix symlink traversal attacks.
3. **Transactional Inbox Processing & At-Least-Once Delivery (`RELIA-01`, Invariant 4):**
   - Inbox messages remain `status: 'unread'` until the bot completes its reasoning and action turn, preventing dropped messages during crashes or unhandled exceptions.
4. **Adaptive Gemini 429 Rate-Limit Throttling Latch (`NT-05`, `NT-06`):**
   - Parses `RetryInfo: retryDelay` duration headers from Gemini 429 quota exhaustion responses, pausing gracefully with non-destructive operator notification before automatically retrying without losing the ReAct turn.
5. **Atomic Broadcast Cursor Tracking (`CONC-02`):**
   - Session-locked broadcast reader advances cursor positions only to delivered events, preventing missed events when reading filtered categories.
6. **CLI Improvements & Documentation Sync:**
   - Added `--no-mark-read` option to `almudaya message read`.
   - Added `--doc-id` alias support in `almudaya context doc add`.
   - Updated documentation to strictly reference valid Zod broadcast categories (`ACTIVITY`, `OBSERVATION`, `DECISION`, `TASK`, `ARTIFACT`, `QUESTION`, `STATUS`, `ALERT`).

---

## What's New in Version 0.3.0

1. **All-in-One Interactive Bot Console REPL (`almudaya bot run`):**
   - Transformed the passive blocking daemon into an active non-blocking interactive command prompt (`<BotName>> `).
   - Full slash command set: `/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`, `/status`, `/clear`, `/help`, `/exit`.
   - Direct natural language typing forwards instructions directly to local AI ReAct reasoning.
   - **Non-Destructive TTY Output Rendering (ANSI `\r\x1b[K`):** Incoming Blackboard messages or broadcasts never corrupt or overwrite the operator's active keyboard typing buffer.
2. **Cross-Root Location-Aware Session Work Memory (`work_log.jsonl`):**
   - Every file mutation (`write_file`, `edit_file`) and shell execution (`run_command`) automatically records a structured work log entry with complete multi-root coordinates (`target_root_id`, `target_root_name`, `target_root_path`, `relative_path`).
   - Model ReAct loop automatically injects recent work logs into dynamic system prompts for full team situational awareness.
   - Built-in AI Function Calling tool: `get_work_log(limit, root_id, bot_id)` for dynamic cross-root dependency discovery.

---

## Architecture Overview

```
                      ┌───────────────────────────────────────────────┐
                      │              Session Blackboard               │
                      │         (sessions/<session_id>/)              │
                      │                                               │
                      │  ┌──────────────────────────────────────────┐ │
                      │  │ Bot Registry (bots.json)                 │ │
                      │  ├──────────────────────────────────────────┤ │
                      │  │ Broadcast Event Stream (events.jsonl)    │ │
                      │  ├──────────────────────────────────────────┤ │
                      │  │ Shared Project Roots (roots.json)        │ │
                      │  ├──────────────────────────────────────────┤ │
                      │  │ Shared Work Memory (work_log.jsonl)      │ │
                      │  └──────────────────────────────────────────┘ │
                      │  ┌──────────────────────────────────────────┐ │
                      │  │ Individual Inboxes (inbox/<bot_id>/)     │ │
                      │  │ - messages.json                          │ │
                      │  │ - broadcast_cursor.json                  │ │
                      │  └──────────────────────────────────────────┘ │
                      └──────────────────────▲────────────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │                                           │
          ┌────────────┴─────────────┐                ┌────────────┴─────────────┐
          │  Bot Console 1 (Terminal)│                │  Bot Console 2 (Terminal)│
          │  Prompt: "Architect> "   │                │  Prompt: "Coder> "       │
          │  PID: 1420 (active REPL) │                │  PID: 8520 (active REPL) │
          │  Root: [backend, frontend│                │  Root: [backend]         │
          └──────────────────────────┘                └──────────────────────────┘
```

### Core Invariants

1. **Session-Centric Boundary:** A Session is the collaboration boundary. All bots, events, inboxes, work logs, and shared context reside inside their respective session workspace.
2. **Stable Bot Identity:** Each bot is allocated an immutable, permanent `bot_id` (e.g., `BOT001`). Its human-friendly `display_name` (e.g., `"Architect"`) can be edited at any time without altering identity or breaking historical message references.
3. **Storage Persistence & Durability:** All state is saved to disk immediately using atomic file writes and kernel-atomic cooperative locking. Sessions survive process crashes and full system restarts.
4. **Independent Process Isolation:** Every bot runs in its own operating system process (e.g., distinct CLI terminals or background daemon processes). A slow, blocked, or crashed bot cannot crash or stall other bots in the session.
5. **Sandbox Isolation (FR-210, FR-316):** All AI coding file tools (`read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`) and shell commands (`run_command`) are strictly confined to registered project roots. Path traversal attempts (`..`) are denied immediately.
6. **Review Sovereignty (FR-213, FR-317):** In `REQUEST_REVIEW` mode, no file mutation or system command executes without explicit human approval (`y/n/d`).
7. **Credential Privacy (FR-204):** API keys (e.g. `GEMINI_API_KEY`) reside exclusively in local process memory and are never written to Blackboard storage or logs.

---

## Quick Start

### Installation

```bash
git clone https://github.com/elangbijak4/Almudaya-Multi-Agent.git
cd Almudaya-Multi-Agent
npm install
npm run build
npm link
```

### 1. Create a Session
```bash
almudaya session create my-workspace --session S001 --description "Core Development Session"
```

### 2. Run Bots in Interactive REPL Mode (Separate Terminals)
**Terminal 1 (Architect Console):**
```bash
almudaya bot run --session S001 --bot BOT001 --name "Architect" --role "System Architect"
# Directly opens the non-blocking interactive REPL:
# Architect> /peers
# Architect> /msg Coder Buatkan REST endpoint di backend/src/server.js
```

**Terminal 2 (Coder Console with Gemini AI & Turbo Mode):**
```powershell
$env:GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
almudaya bot run --session S001 --bot BOT002 --name "Coder" --role "Software Engineer" --provider gemini --mode turbo
# Coder automatically handles incoming messages, executes tools, and logs to work_log.jsonl:
# Coder> /log
```

### 3. Discover Peers
```bash
almudaya bot list --session S001
```

### 4. Broadcast Announcements
```bash
# Valid categories: ACTIVITY, OBSERVATION, DECISION, TASK, ARTIFACT, QUESTION, STATUS, ALERT
almudaya broadcast publish --session S001 --bot BOT001 --category DECISION --payload '{"spec": "v1.0", "status": "approved"}'
almudaya broadcast read --session S001 --bot BOT002
```

### 5. Send Direct Messages & Acknowledge
```bash
# Send by display name or stable Bot ID
almudaya message send --session S001 --sender BOT002 --recipient "Architect" --body "Design review ready."

# Read (marks unread messages as read by default)
almudaya message read --session S001 --bot BOT001

# Inspect inbox without marking messages as read (FR-325)
almudaya message read --session S001 --bot BOT001 --no-mark-read

# Acknowledge message idempotently
almudaya message ack --session S001 --bot BOT001 --message-id <msg_id>
```

### 6. Register Shared Project Context
```bash
# Register project roots
almudaya context root add --session S001 --name backend --path ./backend

# Register environment metadata (sensitive values automatically masked)
almudaya context env set --session S001 --key GITHUB_TOKEN --value "ghp_abcdef1234567890"

# Register SDLC document references (--id or --doc-id)
almudaya context doc add --session S001 --id SRS-01 --title "Software Requirements Specification" --doc-path docs/SRS.md --type SRS
```

---

## CLI Reference

| Command | Description |
|---|---|
| `almudaya session create <name>` | Create a persistent session with optional `--session <id>` |
| `almudaya session list` | List all sessions and their metadata |
| `almudaya session inspect --session <id>` | Inspect detailed session metadata and statistics |
| `almudaya bot join --session <id>` | Register a bot with `--bot <id>`, `--display-name <name>`, `--role <role>` |
| `almudaya bot list --session <id>` | List all bots with PID and liveness status |
| `almudaya bot inspect --session <id> --bot <id>` | Inspect detailed bot record |
| `almudaya bot rename --session <id> --bot <id> --new-name <name>` | Rename bot display name preserving stable ID |
| `almudaya bot run --session <id> --bot <id>` | Start bot runtime daemon with periodic heartbeat loop |
| `almudaya broadcast publish --session <id> --bot <id>` | Publish a broadcast event to `events.jsonl` |
| `almudaya broadcast read --session <id> --bot <id>` | Read broadcast events with cursor tracking |
| `almudaya message send --session <id> --sender <id>` | Send direct message by Bot ID or recipient display name |
| `almudaya message read --session <id> --bot <id>` | Read messages from bot's inbox |
| `almudaya message ack --session <id> --bot <id> --message-id <id>`| Acknowledge message receipt idempotently |
| `almudaya context root add\|list` | Manage shared project directory roots |
| `almudaya context env set\|list` | Store environment configuration with secret redaction |
| `almudaya context doc add\|list` | Catalog SDLC document references |
| `almudaya capability list --session <id>` | List all active, expired, and revoked capability grants |
| `almudaya capability inspect <grantId>` | Inspect granular capability grant details |
| `almudaya capability grant <capability>` | Issue a scoped capability grant (`--session`, `--bot`, `--scope`) |
| `almudaya capability revoke <grantId>` | Revoke an active capability grant |
| `almudaya capability history --session <id>` | View structured append-only capability audit events |
| `almudaya capability preset list\|show\|apply` | Inspect and apply pre-packaged capability security presets |

All commands accept `--json` for machine readability and `--workspace <path>` to override the storage root.

---

## Testing & Quality Assurance

Almudaya Multi-Agent adheres strictly to a Waterfall engineering lifecycle with comprehensive verification:

```bash
# Run unit, integration, persistence, and multi-process tests
npm test

# Run build verification
npm run build

# Verify packaging integrity
npm pack --dry-run
```

- **44 Test Suites / 295 Tests:** 100% passing across all modules (201 baseline + 94 v0.3.2 hardening tests).
- **Independent Multi-Process Testing:** Validated with real spawned Node.js child processes for concurrent joins, message appends, and process crash recovery.
- **Two-Terminal E2E Acceptance:** Validates the complete 12-step Proof of Concept specified in `MASTER_PROMPT.md` Section 10.

---

## Project Scope & Non-Goals for v0.1.0

Almudaya Multi-Agent v0.1.0 is intentionally **infrastructure-first**. The following capabilities are explicitly out of scope for v0.1.0 and deferred to future releases:
- Real LLM inference or provider API keys.
- Autonomous task orchestration or supervisor daemon.
- MCP client/server integration.
- Vector database, embeddings, RAG, or knowledge graph.
- Web or Desktop graphical user interface (GUI).
- Cloud synchronization or remote distributed bot execution.

---

## Documentation & User Manuals

Panduan penggunaan dan referensi teknis lengkap:
- 📖 [**USER_MANUAL.md**](./USER_MANUAL.md) — Manual referensi teknis perintah CLI, opsi, environment variables, skema filesystem, dan error handling.
- 📘 [**USER_GUIDE.md**](./USER_GUIDE.md) — Panduan konseptual, arsitektur proses, filosofi pemisahan 3 direktori (Engine, Blackboard, Target Project), dan ketahanan crash.
- 📗 [**USER_TUTORIAL.md**](./USER_TUTORIAL.md) — Tutorial praktis hands-on langkah demi langkah simulasi multi-terminal dari nol.

Full architectural specifications, decision records, and test reports are maintained under [`docs/docs_v0.1.0/`](./docs/docs_v0.1.0/):
- [`01_PROJECT_CHARTER.md`](./docs/docs_v0.1.0/01_PROJECT_CHARTER.md) — Charter, vision, principles, and stakeholders.
- [`02_REQUIREMENTS/SRS.md`](./docs/docs_v0.1.0/02_REQUIREMENTS/SRS.md) — Software Requirements Specification.
- [`02_REQUIREMENTS/REQUIREMENT_TRACEABILITY.md`](./docs/docs_v0.1.0/02_REQUIREMENTS/REQUIREMENT_TRACEABILITY.md) — Full requirement traceability matrix.
- [`04_DESIGN/ADR/`](./docs/docs_v0.1.0/04_DESIGN/ADR/) — Architecture Decision Records (ADR-001 through ADR-008).
- [`06_TESTING/VERIFICATION_REPORT.md`](./docs/docs_v0.1.0/06_TESTING/VERIFICATION_REPORT.md) — Test verification and validation report.
- [`07_RELEASE/RELEASE_PLAN.md`](./docs/docs_v0.1.0/07_RELEASE/RELEASE_PLAN.md) — Release checklist and verification.
- [`08_OPERATIONS/USER_GUIDE.md`](./docs/docs_v0.1.0/08_OPERATIONS/USER_GUIDE.md) — Operator walkthrough & architecture guide.
- [`08_OPERATIONS/USER_MANUAL.md`](./docs/docs_v0.1.0/08_OPERATIONS/USER_MANUAL.md) — CLI commands technical manual.
- [`08_OPERATIONS/USER_TUTORIAL.md`](./docs/docs_v0.1.0/08_OPERATIONS/USER_TUTORIAL.md) — Step-by-step hands-on tutorial.
- [`10_PHASE_GATES/`](./docs/docs_v0.1.0/10_PHASE_GATES/) — Formal Phase Gate approval records.

---

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
