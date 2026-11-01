# ADR-008: Bot Runtime Process Lifecycle, Liveness, and Isolation Strategy

- **Status:** ACCEPTED
- **Date:** 2026-11-01
- **Deciders:** Principal Software Architect
- **Consulted:** SRS (FR-009, FR-023, NFR-002), Master Prompt Sections 2.2 (Invariants 3, 4), 5.3, 6.1

## Context

Almudaya Multi-Agent mandates that bots participate in a Session as independent OS processes rather than in-process worker threads.
Per Architectural Invariants 3 & 4:
- Each bot has its own process and runtime state.
- One bot waiting for an LLM/network or compute operation must not block other bot processes.
- The system must accurately determine bot liveness and handle abrupt process termination without corrupting the session registry (Resolves `OI-005`).

## Decision

1. **Process Isolation Model:**
   - Each bot is launched as an independent Node.js process (`node dist/cli/bin.js bot run ...` or programmatically via `node:child_process.spawn`).
   - Bot memory, call stacks, timers, and event loops are strictly isolated by the OS process boundary.
   - Long-running or blocked operations in Bot 1 do not block Bot 2's event loop or communication channel.

2. **Bot Runtime Class (`BotRuntime`):**
   - Implemented in `src/bot/runtime.ts`.
   - **Startup:**
     - Registers or activates the bot in the session registry.
     - Records its OS PID (`process.pid`) and status (`active`).
     - Initializes periodic heartbeat timer (`heartbeatIntervalMs`, default 2000ms).
   - **Heartbeat:**
     - Periodically refreshes `last_seen_at` in `registry/bots.json` under lock.
   - **Graceful Shutdown:**
     - Hooks `SIGINT`, `SIGTERM`, and `beforeExit`.
     - On signal, cleanly updates status in `bots.json` to `stopped`, clears timers, and exits with code 0.

3. **Liveness & Stale Status Detection (Resolves OI-005):**
   - Registry operations provide `reconcileBotLiveness(sessionId, staleThresholdMs)`.
   - A bot is detected as `stale` if its status is `active` and either:
     1. Its OS PID is no longer alive (`process.kill(pid, 0)` fails with `ESRCH`), OR
     2. `Date.now() - new Date(last_seen_at).getTime() > staleThresholdMs` (default 10,000ms).
   - If detected as stale, the registry updates its status to `stale` without deleting historical messages or records.

4. **CLI Entrypoint:**
   - `almudaya bot run --session <id> --bot <id> [options]`:
     - Runs the bot runtime process until interrupted (`Ctrl+C` or termination signal).

## Consequences

- Resolves Open Issue `OI-005`.
- True process-level fault tolerance: a crashed bot does not crash the session or other bots.
- Peer discovery displays accurate liveness (`active`, `idle`, `stopped`, `stale`).
