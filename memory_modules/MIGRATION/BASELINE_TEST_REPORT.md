# Baseline Test Report (`Phase 0`)

**Repository:** `almudaya-multiagent@0.3.3`  
**Git Commit SHA:** `4af6fa1f9534c186ff6ea5ef2d4b6bb6be4eab16` (`HEAD -> main, tag: v0.3.3`)  
**Execution Date:** 2026-11-09  
**Host OS:** Windows (`win32 x64`)  
**Node.js Version:** `v24.21.0` (`engines.node: ">=22.12.0"`)  
**npm Version:** `11.19.0`  
**Git Version:** `git version 2.56.0.windows.3`

---

## 1. Production Source Tree Integrity Check

Before and after running the baseline build and test suite, `git status` was inspected to confirm zero modifications to tracked production source files:

```text
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
  PKU_Memory_Modules_Scaffold_v0.1.0.zip
  memory_modules/
```

- Tracked files modified: **0** (`git diff` is completely empty).

---

## 2. TypeScript Build Verification (`npm run build`)

- **Command:** `npm run build` (`tsc`)
- **Exit Code:** `0` (PASS)
- **Output:** Clean compilation of all 63 TypeScript files under `src/` to `dist/` with strict mode flags (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `noUncheckedIndexedAccess: true`).

---

## 3. Full Test Suite Execution (`npx vitest run`)

- **Command:** `npx vitest run`
- **Exit Code:** `0` (PASS)
- **Test Runner:** Vitest `v5.0.5`
- **Summary:**
  - **Test Files:** `47 passed (47)`
  - **Total Tests:** `379 passed (379)`, `0 failed`, `0 skipped`
  - **Duration:** `14.60s` (47 isolated workers)

### Complete Breakdown of All 47 Passing Test Suites

| Category | Test File | Tests Passed | Key Coverage Verified |
|---|---|---:|---|
| **Core & Concurrency** | `tests/core/config.test.ts` | 4 | Workspace root resolution precedence (`ADR-001`) |
| | `tests/core/fs-utils.test.ts` | 5 | Atomic JSON writes, schema validation, corruption detection |
| | `tests/core/jsonl.test.ts` | 5 | Resilient JSONL parsing and `.corrupt.jsonl` quarantine |
| | `tests/core/lock.test.ts` | 12 | Cooperative `.lock`, `.lock_barrier`, stale lock recovery, monotonic `.fencing_token`, `StaleLockFencingError` (`AUD-09`) |
| **Session & Shared Context** | `tests/session/session.test.ts` | 10 | Session creation, inspection, update, listing, ID validation (`AUD-03`) |
| | `tests/shared/shared-context.test.ts` | 9 | Project roots registry, SDLC documents registry, environment secret redaction |
| | `tests/shared/work-log.test.ts` | 11 | Cross-root work log recording, filtering, Markdown summary, strict corruption check |
| **Bot Registry, Runtime & REPL** | `tests/bot/bot-registry.test.ts` | 14 | Sequential `BOT001` ID allocation, display name collision, rename, status, heartbeat, liveness reconciliation |
| | `tests/bot/runtime.test.ts` | 6 | BotRuntime lifecycle, single-flight polling, post-callback cursor advancement |
| | `tests/bot/process-isolation.test.ts` | 1 | Multi-process bot crash isolation and independent operation |
| | `tests/bot/execution-mode.test.ts` | 7 | `REQUEST_REVIEW` vs `TURBO` HITL approval controller |
| | `tests/bot/agent-loop.test.ts` | 6 | Bounded ReAct loop, tool dispatch, automated peer reply, audit broadcasts |
| | `tests/bot/agent-loop-worklog.test.ts` | 4 | Automatic work-log recording on `write_file`, `edit_file`, `run_command` |
| | `tests/bot/rate-limit-pause.test.ts` | 4 | HTTP 429 `RateLimitPauseError` pause-and-resume without losing ReAct iteration |
| | `tests/bot/cancellation.test.ts` | 5 | `AbortSignal` propagation across runtime, ReAct loop, and Gemini backoff (`AUD-20`) |
| | `tests/bot/console.test.ts` | 18 | Interactive Bot Console REPL (`/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`, `/status`, `/clear`, `/help`, `/exit`, FIFO queue) |
| **Messaging & Delivery** | `tests/messaging/broadcast.test.ts` | 6 | Broadcast publish/read, category filter, cursor tracking, sender auth (`AUD-10`) |
| | `tests/messaging/broadcast-cursor-atomic.test.ts` | 3 | Per-category cursor preservation (`CONC-02`), FIFO pagination (`AUD-07`), callback failure redelivery |
| | `tests/messaging/direct-message.test.ts` | 11 | Direct message routing, display-name resolution, inbox limit before mutation (`AUD-06`), sender auth (`AUD-10`) |
| | `tests/messaging/inbox-state.test.ts` | 16 | 5-state delivery machine, claiming, lease expiry recovery, DLQ requeue, idempotency key, monotonic `fence_token` (`AUD-08`) |
| | `tests/messaging/transactional-inbox.test.ts` | 3 | Transactional inbox read/markAsRead and crash redelivery |
| | `tests/messaging/concurrent-messaging.test.ts` | 2 | Multi-process concurrent broadcast and inbox appends without data loss |
| **ACG & Execution Isolation** | `tests/capability/capability.test.ts` | 28 | ACG registry, policy engine, bot-bound grants (`AUD-04`), scope checks, fail-closed audit (`AUD-16`), path traversal (`AUD-03`) |
| | `tests/capability/presets-table.test.ts` | 36 | Preset grant generation and table-driven policy evaluation (`AUD-13`) |
| | `tests/execution/controller.test.ts` | 20 | 9-step `ExecutionController`, mandatory `(sessionId, botId)` (`AUD-02`), backend capability enforcement (`AUD-01`, `AUD-14`), HITL approval (`AUD-12`), durable audit (`AUD-16`) |
| | `tests/execution/environment.test.ts` | 9 | `ExecutionEnvironmentBuilder`, allowlist, `PATH`/`COMSPEC` sanitization, secret redaction |
| | `tests/execution/isolation.test.ts` | 7 | Windows Job Object and Linux namespace isolation backends |
| **Tools, AI & Security** | `tests/tools/sandbox.test.ts` | 9 | Path traversal defense, symlink escape prevention, case-sensitive scope (`AUD-05`) |
| | `tests/tools/file-tools.test.ts` | 11 | `read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`, hardlink/TOCTOU defense (`AUD-17`) |
| | `tests/tools/command-tools.test.ts` | 9 | `run_command` execution, timeout termination, fail-closed ACG integration |
| | `tests/tools/env-sanitization.test.ts` | 7 | Subprocess environment sanitization and secret stripping |
| | `tests/tools/messaging-tools.test.ts` | 5 | Native `send_message` tool with trusted runtime sender identity (`IDV-01`) |
| | `tests/tools/work-log-tool.test.ts` | 4 | `get_work_log` LLM tool execution and filtering |
| | `tests/ai/credentials.test.ts` | 7 | API key resolution and masking |
| | `tests/ai/provider.test.ts` | 4 | MockAIProvider and interface conformance |
| | `tests/ai/gemini.test.ts` | 9 | Gemini SDK integration, function calling, rate-limit extraction |
| | `tests/ai/prompts.test.ts` | 6 | Dynamic system prompt assembly and `<<<UNTRUSTED_*>>>` boundary formatting |
| | `tests/security/prompt-injection.test.ts` | 8 | Prompt delimiter breakout prevention (`AUD-15`) and ACG privilege non-escalation |
| | `tests/security/secret-redaction-canary.test.ts` | 9 | End-to-end secret canary redaction across CLI, Blackboard, work log, and errors (`AUD-11`) |
| **CLI & End-to-End** | `tests/cli.test.ts` | 3 | Root CLI program metadata and version (`0.3.3`) |
| | `tests/cli/session-cli.test.ts` | 4 | `almudaya session create/list/inspect` |
| | `tests/cli/bot-cli.test.ts` | 5 | `almudaya bot join/list/inspect/rename` |
| | `tests/cli/messaging-cli.test.ts` | 3 | `almudaya broadcast publish/read` and `message send/read/ack` (`AUD-10`) |
| | `tests/cli/context-cli.test.ts` | 4 | `almudaya context root/env/doc` commands |
| | `tests/e2e/two-terminal-poc.test.ts` | 1 | Two-bot cross-process collaboration proof of concept |
| | `tests/e2e/autonomous-coding.test.ts` | 1 | Autonomous multi-bot coding & file verification benchmark |
| | `tests/e2e/multi-root-orchestration.test.ts` | 1 | Multi-root collaborative coding with persistent work memory (`v0.3.0`) |

---

## 4. Baseline Conclusion

The repository baseline (`v0.3.3`, commit `4af6fa1`) is **100% green** on the target Windows + Node.js `v24.21.0` environment. This serves as the mandatory regression floor for all subsequent PKU integration phases.
