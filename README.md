# Almudaya Multi-Agent (`almudaya-multiagent` v0.3.0)

[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Tests: 179 Passed](https://img.shields.io/badge/Tests-179%20Passed-brightgreen.svg)](./docs/docs_v0.3.0/10_PHASE_GATES/PHASE_6_VERIFICATION_GATE.md)
[![AI Engine: Google Gemini](https://img.shields.io/badge/AI%20Engine-Google%20Gemini-orange.svg)](https://deepmind.google/technologies/gemini/)

A session-centric, multi-process autonomous AI coding agent collaboration foundation featuring **Interactive All-in-One Bot Console REPL** and **Cross-Root Location-Aware Session Work Memory**.

Almudaya Multi-Agent empowers multiple autonomous AI bots and human engineers to collaborate across multiple project directories within an isolated, persistent **Session Blackboard**, executing real-world software engineering tasks directly against registered project codebases.

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
$env:GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere"
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
almudaya broadcast publish --session S001 --bot BOT001 --category SPEC_READY --payload '{"spec": "v1.0"}'
almudaya broadcast read --session S001 --bot BOT002
```

### 5. Send Direct Messages & Acknowledge
```bash
# Send by display name or stable Bot ID
almudaya message send --session S001 --sender BOT002 --recipient "Architect" --body "Design review ready."

# Read and acknowledge
almudaya message read --session S001 --bot BOT001
almudaya message ack --session S001 --bot BOT001 --message-id <msg_id>
```

### 6. Register Shared Project Context
```bash
# Register project roots
almudaya context root add --session S001 --name backend --path ./backend

# Register environment metadata (sensitive values automatically masked)
almudaya context env set --session S001 --key GITHUB_TOKEN --value "ghp_abcdef1234567890"

# Register SDLC document references
almudaya context doc add --session S001 --doc-id SRS-01 --title "Software Requirements Specification" --doc-path docs/SRS.md --type SRS
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

- **18 Test Suites / 77 Tests:** 100% passing across all modules.
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
