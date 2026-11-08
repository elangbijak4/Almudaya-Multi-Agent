# Security Architecture & Boundary Notes — v0.3.2

- **Target Version:** `0.3.2` — Security & Concurrency Hardening Implementation
- **Classification:** Technical Reference / Security Architecture
- **Date:** 2026-11-08

---

## 1. Core Security Principles

Almudaya Multi-Agent v0.3.2 implements defense-in-depth across six distinct architectural boundaries:

```
[ Model Prompt / Peer Data ] (Untrusted)
              │
              ▼
[ Agent Loop / Context Assembly ] (Untrusted Boundary Delimiters)
              │
              ▼
[ ExecutionController ] (Central 9-Step Verification Pipeline)
              │
              ├─► [ ACG Policy Engine ] (Default-Deny, Scoped Grants)
              ├─► [ Operator Approval ] (Human-in-the-Loop Review)
              └─► [ Environment Sanitizer ] (Purge dangerous vars & secrets)
              │
              ▼
[ OS Isolation Backend ] (Windows Job Objects / Linux Namespaces)
              │
              ▼
[ Target Host Execution ] (Bounded, Contained & Redacted)
```

### 1.1 Outside-the-Model Enforcement
Security enforcement is strictly located outside of the LLM. An autonomous model cannot grant itself capabilities, alter authorization policies, or bypass tool validation via prompt engineering, peer direct messages, shared work logs, or tool results.

### 1.2 Default-Deny Authorization (ACG)
All host-level capabilities (`filesystem.read_external`, `filesystem.write_external`, `filesystem.delete_external`, `command.arbitrary`, `process.execute_external`, `network.outbound`, `system.config_access`, `system.environment_access`, `system.process_control`) default to `DENY`. Operations outside registered project roots require an explicit, time-bounded, and auditable capability grant issued by an operator.

### 1.3 TURBO Execution Mode vs. Privilege Separation
`TURBO` mode automates execution by bypassing interactive confirmation prompts for *already-authorized* operations. It does **not** grant additional privileges:
- `TURBO + No Grant = DENY`
- `TURBO + Wrong Scope = DENY`
- `TURBO + Revoked Grant = DENY`
- `TURBO + Valid Grant = ALLOW (unattended execution)`

### 1.4 Untrusted Data Boundaries
All data originating outside the local trusted runtime—including peer agent messages, shared session work logs, external file contents, and external documents—is treated as untrusted input. Messages are encapsulated in `<<<UNTRUSTED_MESSAGE_*>>>` delimiters to alert the model, while host-level runtime validators actively check sender authenticity against the registered bot table.

### 1.5 Environment Sanitization & Secret Protection
Subprocesses spawned via `run_command` run in a scrubbed environment constructed by `ExecutionEnvironmentBuilder`:
- Dangerous runtime override variables (`PYTHONPATH`, `PYTHONHOME`, `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_LIBRARY_PATH`) are unconditionally purged.
- System secrets (`GEMINI_API_KEY`, tokens, passwords) are scrubbed from child process environments.
- Stdout and stderr streams pass through centralized regex redactors before being displayed, logged, or recorded to Blackboard.
- CLI arguments warn against `--api-key` usage to prevent leakage in process listings (`ps`) and shell history (`NT-02`).

---

## 2. OS-Level Isolation Boundaries

### Windows Platform Isolation
- **Job Objects (`src/execution/isolation/windows.ts`):** Windows environments enforce process containment using Win32 Job Objects. Subprocesses and their child trees (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) are constrained to prevent orphaned daemon processes or detached process leaks.
- **Limitation Note:** Windows Job Objects do not provide unprivileged filesystem or network namespaces. User-level token restriction alone does not provide a complete OS sandbox. For broad host execution (`command.arbitrary`), running Almudaya inside a dedicated Virtual Machine or container (Docker/WSL) is strongly recommended.

### Linux Platform Isolation
- **Namespaces (`src/execution/isolation/linux.ts`):** Linux environments leverage kernel namespaces (`unshare` / cgroups / network isolation) where supported to restrict filesystem mounts and network access.

### Unsupported OS / Fail-Closed Guarantee
- If a required enforcement capability is unavailable on the host platform, `ExecutionController` immediately aborts with a fail-closed `DENY` decision (`ISOLATION_FAILURE` audit event), preventing uncontained fallback execution.

---

## 3. Distributed Concurrency & Storage Invariants

1. **Monotonic Fencing Tokens:** Storage locks (`src/core/lock.ts`) emit monotonically increasing fencing tokens. Stale lock holders whose leases have expired cannot overwrite data written by newer lock holders.
2. **Cryptographic Ownership Tokens:** Lock release requires matching the `owner_id` generated during acquisition, preventing process A from releasing a lock acquired by process B.
3. **At-Least-Once Delivery & Idempotency:** The inbox state machine (`RECEIVED -> PROCESSING -> COMPLETED | RETRY_PENDING | DEAD_LETTER`) guarantees at-least-once delivery. Poison-pill messages are isolated into `DEAD_LETTER` after maximum retry attempts.
4. **Resilient JSONL Parsing:** Append-only logs (`events.jsonl`, `work_log.jsonl`, `grants.jsonl`, `audit.jsonl`) utilize resilient per-record parsing (`src/core/jsonl.ts`) so single-line corruption never aborts downstream consumers.
