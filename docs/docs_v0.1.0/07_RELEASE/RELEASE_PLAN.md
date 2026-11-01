# Release Plan & Verification Checklist — v0.1.0

## 1. Release Objective

Deliver a local, persistent, multi-process collaboration foundation for AI coding agents and human developers, complete with:
- Unified CLI (`almudaya`)
- Shared persistent Session Blackboard
- Individual Blackboard / inboxes with idempotent acknowledgements
- Broadcast event stream with per-bot read cursors
- Shared project context registry (project roots, host environment metadata, SDLC document references) with automatic secret redaction
- Independent bot runtime with periodic heartbeats, stale detection, and process isolation.

---

## 2. Pre-Release Verification Checklist

- [x] **All Must requirements verified:** Verified across 77 automated tests (100% passing) and documented in `docs/docs_v0.1.0/02_REQUIREMENTS/REQUIREMENT_TRACEABILITY.md`.
- [x] **Full test suite passes:** 18 test suites, 77 tests passing in ~4.4s via Vitest.
- [x] **Cross-platform assumptions tested:** Path normalization, Windows file locking contention handled (`EEXIST`, `EPERM`, `EBUSY`, `EACCES`), POSIX/Windows signal handling verified.
- [x] **README includes install/use instructions and limitations:** Comprehensive root `README.md` authored.
- [x] **Changelog updated:** `docs/docs_v0.1.0/09_CHANGE_CONTROL/CHANGE_LOG.md` fully up to date through Phase 8.
- [x] **License selected and included:** MIT License included in `LICENSE` file and mapped in `package.json`.
- [x] **Package metadata and executable mapping verified:** `bin.almudaya` maps to `./dist/cli/bin.js`, `engines.node` >= 22.12.0.
- [x] **`npm pack --dry-run` reviewed:** Produces clean tarball `almudaya-multiagent-0.1.0.tgz` (45.3 kB, 94 files, zero temporary or workspace files).
- [x] **No secrets or local workspace data included:** Workspace files excluded via `.gitignore` and `package.json` `"files": ["dist"]`.
- [x] **Package name availability checked:** `npm view almudaya-multiagent` checked (returned 404 Not Found, name is unclaimed and available).
- [x] **Version number confirmed:** Version `0.1.0` aligned in `package.json`, `src/core/version.ts`, and CLI `--version`.
- [x] **No publication without explicit authorization:** Code held in local Git repository until user explicitly authorizes `git push` to remote `https://github.com/elangbijak4/Almudaya-Multi-Agent.git`.

---

## 3. Verified CLI Smoke Sequence

The following sequence has been verified through automated integration tests and manual execution:

```bash
# 1. Inspect version and help
almudaya --version
almudaya --help

# 2. Create a session
almudaya session create my-project --session S001

# 3. Join / run bots in independent terminals
almudaya bot join --session S001 --bot BOT001 --display-name "Architect" --role "System Architect"
almudaya bot join --session S001 --bot BOT002 --display-name "Coder" --role "Software Engineer"

# 4. List registered bots in session
almudaya bot list --session S001

# 5. Publish a broadcast event
almudaya broadcast publish --session S001 --bot BOT001 --category DECISION --payload '{"decision": "Use TypeScript strict mode"}'

# 6. Read broadcast as BOT002
almudaya broadcast read --session S001 --bot BOT002

# 7. Send direct message from BOT002 to BOT001
almudaya message send --session S001 --sender BOT002 --recipient "Architect" --body "Design approved"

# 8. Read and acknowledge inbox message
almudaya message read --session S001 --bot BOT001
almudaya message ack --session S001 --bot BOT001 --message-id <msg_id>

# 9. Register shared project context
almudaya context root add --session S001 --name backend --path ./backend
almudaya context env set --session S001 --key API_KEY --value "secret_live_key"
almudaya context doc add --session S001 --doc-id SRS-01 --title "Software Requirements Specification" --doc-path docs/SRS.md --type SRS

# 10. Run bot runtime daemon with heartbeat loop
almudaya bot run --session S001 --bot BOT001 --interval 2000
```

---

## 4. Release Notes — v0.1.0

### Delivered Features
- **Session Management:** Persistent session lifecycle with customizable or default workspaces (`ALMUDAYA_WORKSPACE_ROOT`), state persistence across restarts, and corruption validation.
- **Bot Identity & Registry:** Guaranteed stable `bot_id`, editable and unique `display_name` per session, automatic `<session>_<seq>` naming, peer discovery, and rename invariant preservation (stable Bot ID and historical message references remain unaltered).
- **Messaging Architecture:** Append-only broadcast event log (`events.jsonl`) with per-bot cursor advancement, individual bot inboxes (`inbox/<bot_id>/messages.json`), recipient resolution by display name, and idempotent acknowledgements.
- **Shared Project Context:** Multi-root project paths with normalization, host environment discovery, token & sensitive key credential scanner with automatic `[REDACTED]` redaction, and SDLC document catalog.
- **Independent Bot Runtime:** Process isolation with PID tracking, periodic heartbeating (`last_seen_at`), automatic dead-PID and stale bot detection (`reconcileBotLiveness`), and graceful shutdown (`SIGINT`/`SIGTERM`).
- **Unified CLI:** High-performance CLI built with Commander 14+, rich formatting, JSON output mode (`--json`), and comprehensive error diagnostics.

### Supported Platforms & Environment
- **Node.js:** >= 22.12.0 (Tested on Node.js v24.21.0)
- **Operating Systems:** Windows 10/11, macOS, Linux (POSIX).
- **Filesystem Concurrency:** Kernel-atomic cooperative lock (`fs.open(..., 'wx')`) with stale lock breaking and retry jitter.

### Out of Scope & Deferred Features
- Real LLM inference or provider API integrations.
- Autonomous orchestration or supervisor daemon.
- MCP client/server integration.
- Vector database, embeddings, RAG, or knowledge graph.
- Web/Desktop GUI.
- Distributed/remote network synchronization.
