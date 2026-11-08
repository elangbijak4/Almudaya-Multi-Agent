# Baseline Test Report — Almudaya Multi-Agent v0.3.1

**Date:** 2026-11-07  
**Commit SHA:** `6c617febfb9e7185a46ecfc92f6dd3ac18dc9a94`  
**Node.js:** v24.21.0  
**npm:** 11.19.0  
**Test Framework:** Vitest v5.0.5  
**Result:** 37 Test Files Passed, 201 Tests Passed, 0 Failed, 0 Skipped (Duration: 3.88s)  

---

## 1. Test Execution Command
```bash
npm test
# (vitest run)
```

---

## 2. Comprehensive Test Suite Inventory & Results

| # | Test Suite (File) | Test Count | Pass | Fail | Duration | Area / Scope |
|---|---|:---:|:---:|:---:|:---:|---|
| 1 | `tests/tools/file-tools.test.ts` | 16 | 16 | 0 | 165ms | Workspace file read/write/edit/list tools |
| 2 | `tests/tools/env-sanitization.test.ts` | 7 | 7 | 0 | 493ms | SEC-01 child env allowlist & secret redaction |
| 3 | `tests/blackboard/persistence.test.ts` | 9 | 9 | 0 | 291ms | Session Blackboard filesystem persistence |
| 4 | `tests/shared/shared-context.test.ts` | 9 | 9 | 0 | 344ms | Project roots & document context registry |
| 5 | `tests/cli/context-cli.test.ts` | 3 | 3 | 0 | 136ms | CLI commands for context (`roots`, `docs`) |
| 6 | `tests/cli/bot-cli.test.ts` | 5 | 5 | 0 | 206ms | CLI bot register/heartbeat/list commands |
| 7 | `tests/bot/bot-registry.test.ts` | 14 | 14 | 0 | 491ms | Bot registration, discovery & display naming |
| 8 | `tests/messaging/direct-message.test.ts` | 7 | 7 | 0 | 469ms | Individual inbox DM send/read/ack operations |
| 9 | `tests/e2e/autonomous-coding.test.ts` | 1 | 1 | 0 | 577ms | v0.2.0 multi-bot collaborative coding benchmark |
| 10 | `tests/messaging/transactional-inbox.test.ts` | 3 | 3 | 0 | 679ms | RELIA-01 transactional inbox crash recovery |
| 11 | `tests/ai/provider.test.ts` | 4 | 4 | 0 | 13ms | AI model provider interface & MockProvider |
| 12 | `tests/e2e/multi-root-orchestration.test.ts` | 1 | 1 | 0 | 766ms | v0.3.0 cross-root multi-bot coding orchestration |
| 13 | `tests/tools/sandbox.test.ts` | 10 | 10 | 0 | 71ms | Dual lexical & physical canonical path validation |
| 14 | `tests/ai/gemini.test.ts` | 6 | 6 | 0 | 1096ms | Google Gemini provider adapter & transient retry |
| 15 | `tests/tools/symlink-defense.test.ts` | 3 | 3 | 0 | 335ms | §14/6 Windows junction & symlink escape defense |
| 16 | `tests/messaging/broadcast.test.ts` | 4 | 4 | 0 | 700ms | Broadcast publish & cursor tracking |
| 17 | `tests/bot/console.test.ts` | 17 | 17 | 0 | 1072ms | Interactive REPL console & slash command dispatch |
| 18 | `tests/bot/execution-mode.test.ts` | 7 | 7 | 0 | 10ms | REQUEST_REVIEW vs TURBO execution modes |
| 19 | `tests/bot/agent-loop.test.ts` | 5 | 5 | 0 | 1176ms | AutonomousAgentLoop ReAct tool iteration |
| 20 | `tests/cli/session-cli.test.ts` | 4 | 4 | 0 | 142ms | CLI session create/list/inspect commands |
| 21 | `tests/tools/work-log-tool.test.ts` | 5 | 5 | 0 | 314ms | `get_work_log` AI tool function declaration |
| 22 | `tests/cli/messaging-cli.test.ts` | 2 | 2 | 0 | 349ms | CLI messaging commands |
| 23 | `tests/cli/message-read-flag.test.ts` | 2 | 2 | 0 | 162ms | CLI `--no-mark-read` option verification |
| 24 | `tests/ai/credentials.test.ts` | 6 | 6 | 0 | 10ms | Gemini API key resolution & masking |
| 25 | `tests/core/config.test.ts` | 4 | 4 | 0 | 8ms | Workspace & session configuration loader |
| 26 | `tests/messaging/broadcast-cursor-atomic.test.ts` | 1 | 1 | 0 | 95ms | CONC-02 filtered broadcast cursor locking |
| 27 | `tests/bot/liveness.test.ts` | 3 | 3 | 0 | 123ms | Bot heartbeat & stale detection |
| 28 | `tests/shared/work-log.test.ts` | 16 | 16 | 0 | 1638ms | Shared session work log engine & concurrency |
| 29 | `tests/core/lock.test.ts` | 4 | 4 | 0 | 199ms | File-based mutex locking primitives |
| 30 | `tests/bot/runtime.test.ts` | 3 | 3 | 0 | 400ms | Bot runtime polling cycle & message handling |
| 31 | `tests/cli.test.ts` | 3 | 3 | 0 | 11ms | CLI Commander root program & metadata |
| 32 | `tests/bot/concurrent-registration.test.ts` | 1 | 1 | 0 | 237ms | Multi-process concurrent bot registration |
| 33 | `tests/messaging/concurrent-messaging.test.ts` | 2 | 2 | 0 | 1011ms | Multi-process concurrent inbox & broadcast append |
| 34 | `tests/ai/gemini-retry.test.ts` | 6 | 6 | 0 | 2080ms | NT-05/06 429 RetryInfo parsing & adaptive latch |
| 35 | `tests/e2e/two-terminal-poc.test.ts` | 1 | 1 | 0 | 2229ms | Two-terminal multi-process PoC benchmark |
| 36 | `tests/bot/process-isolation.test.ts` | 1 | 1 | 0 | 1738ms | Independent OS process survival & crash recovery |
| 37 | `tests/tools/command-tools.test.ts` | 6 | 6 | 0 | 1793ms | Shell command execution, timeout & error capture |
| **TOTAL** | **37 files** | **201** | **201** | **0** | **3.88s** | **100% PASS** |

---

## 3. Discrepancy Analysis vs Historical Audit Reports
- **AUDIT.md & TESTING.md Baseline:** Formulated against v0.3.0 which contained 31 test suites and 179 passing tests.
- **Current v0.3.1 Baseline:** Reflects 37 test suites and 201 passing tests, incorporating intermediate fixes for:
  - Basic child environment allowlist (`SAFE_ENV_ALLOWLIST`).
  - Windows junction & symlink canonical defense (`fs.realpathSync`).
  - Transactional inbox message retrieval.
  - Gemini 429 adaptive backoff latch.
  - `--no-mark-read` CLI option and atomic broadcast cursor locking.
- **Residual Deficiencies in Baseline:**
  - `SEC-03`: Subprocess execution still invokes the host shell via Node.js `child_process.spawn(cmd, { shell: true })` without true OS-level container/job/sandbox isolation.
  - `CONC-01`: Lock releases check PID, but lack cryptographically unique ownership tokens, explicit fencing tokens, and monotonic sequence validation.
  - `RELIA-03`: JSONL parsing lacks resilient per-record isolation; corrupted lines can crash stream parsing.
  - `NT-02`: `--api-key` is still exposed as a CLI option in `src/cli/commands/bot.ts`.
  - `NT-03`: Native messaging tool is absent from agent reasoning loop; agents currently have no direct tool to send peer messages.
  - `ACG Subsystem`: Entire Agent Capability Governance framework (registry, grants, policy engine, presets, audit trail) does not yet exist.
