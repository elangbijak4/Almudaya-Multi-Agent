# Almudaya Multi-Agent — User & Operator Guide

## 1. Overview & Architecture

Almudaya Multi-Agent (`almudaya-multiagent`) is a session-centric, multi-process bot collaboration foundation. It provides the persistent infrastructure for multiple AI coding agents and human developers to collaborate on complex software projects.

```
                    ┌─────────────────────────────────┐
                    │      Session Blackboard         │
                    │   (sessions/<session_id>/)      │
                    │                                 │
                    │ ┌─────────────────────────────┐ │
                    │ │ Bot Registry (bots.json)    │ │
                    │ ├─────────────────────────────┤ │
                    │ │ Broadcast Log (events.jsonl)│ │
                    │ ├─────────────────────────────┤ │
                    │ │ Shared Context (context.json│ │
                    │ └─────────────────────────────┘ │
                    │ ┌─────────────────────────────┐ │
                    │ │ Individual Inboxes          │ │
                    │ │ (inbox/<bot_id>/)           │ │
                    │ └─────────────────────────────┘ │
                    └───────────────▲─────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           │                                                 │
┌──────────┴───────────────┐                     ┌───────────┴──────────────┐
│  Bot Process 1 (Node.js) │                     │ Bot Process 2 (Node.js)  │
│  - Bot ID: BOT001        │                     │ - Bot ID: BOT002         │
│  - Name: "Architect"     │                     │ - Name: "Engineer"       │
│  - Terminal 1            │                     │ - Terminal 2             │
└──────────────────────────┘                     └──────────────────────────┘
```

### Core Invariants
1. **Session Boundary:** A Session is the isolated collaboration boundary. All bots, events, and inboxes belong to a Session.
2. **Identity Invariant:** Every bot has an immutable `bot_id` (e.g. `BOT001`). Its `display_name` (e.g. `Architect`) is editable and unique within the Session. Historical message logs always reference `bot_id`.
3. **Storage Persistence:** All state is saved to disk immediately using atomic file writes. State survives process restarts and abnormal terminations.
4. **Process Isolation:** Each bot runs in its own Node.js operating system process. A blocked or crashed bot process does not block or crash other bots in the same Session.

---

## 2. Installation & Prerequisites

### Prerequisites
- Node.js >= 22.12.0 (ESM supported)
- npm >= 10.0.0
- Operating System: Windows 10/11, Linux, or macOS

### Local Installation / Build
Clone the repository and build the project:

```bash
git clone https://github.com/elangbijak4/Almudaya-Multi-Agent.git
cd Almudaya-Multi-Agent
npm install
npm run build
npm test
```

### Symlink / Global CLI Usage
To link the CLI globally during development:

```bash
npm link
almudaya --version
```

---

## 3. Configuration & Workspace

By default, Almudaya stores runtime session data under:
- **Windows:** `%LOCALAPPDATA%\Almudaya\almudaya-multiagent`
- **macOS:** `~/Library/Application Support/Almudaya/almudaya-multiagent`
- **Linux:** `~/.local/share/almudaya-multiagent`

### Overriding Workspace Root
You can override the workspace directory using either the `--workspace` CLI flag or the `ALMUDAYA_WORKSPACE_ROOT` environment variable:

```bash
# Via Environment Variable
export ALMUDAYA_WORKSPACE_ROOT="/path/to/custom/workspace"

# Via CLI Flag
almudaya session list --workspace "/path/to/custom/workspace"
```

---

## 4. Operator Walkthrough

### Step 1: Create a Session
```bash
almudaya session create my-project --session S001 --description "Core Refactoring Project"
```

### Step 2: Register & Run Bots in Separate Terminals
Open **Terminal 1**:
```bash
almudaya bot join --session S001 --bot BOT001 --display-name "Architect" --role "System Architect"
almudaya bot run --session S001 --bot BOT001 --interval 2000
```

Open **Terminal 2**:
```bash
almudaya bot join --session S001 --bot BOT002 --display-name "Developer" --role "Backend Developer"
almudaya bot run --session S001 --bot BOT002 --interval 2000
```

### Step 3: Peer Discovery
In any terminal, query the active bots:
```bash
almudaya bot list --session S001
```

Output:
```text
Registered bots in session S001 (2):
- BOT001 | Architect (System Architect) [active] (PID: 12345)
- BOT002 | Developer (Backend Developer) [active] (PID: 12346)
```

### Step 4: Broadcast Announcements
Any bot can publish an event visible to all bots:
```bash
almudaya broadcast publish --session S001 --bot BOT001 --category TASK_ASSIGNED --payload '{"task": "Implement Auth", "priority": "high"}'
```

Other bots read broadcasts with automatic cursor advancement:
```bash
almudaya broadcast read --session S001 --bot BOT002
```

### Step 5: Direct Messaging & Acknowledgements
Send a direct message addressed either by stable Bot ID (`BOT001`) or display name (`"Architect"`):
```bash
almudaya message send --session S001 --sender BOT002 --recipient "Architect" --body "Auth module design completed. Ready for review."
```

Read incoming messages and acknowledge receipt:
```bash
almudaya message read --session S001 --bot BOT001
almudaya message ack --session S001 --bot BOT001 --message-id msg_1730472000000_abc123
```

### Step 6: Shared Project Context & Secret Protection
Register shared project paths, documentation links, and configuration keys. Sensitive values (tokens, passwords, API keys) are automatically sanitized to `[REDACTED]`:

```bash
# Register project root
almudaya context root add --session S001 --name core-api --path ./services/api

# Set environment variable (redaction happens automatically for sensitive keys)
almudaya context env set --session S001 --key GITHUB_TOKEN --value "ghp_super_secret_token"

# Register SDLC document reference
almudaya context doc add --session S001 --doc-id SPEC-01 --title "Architecture Specification" --doc-path docs/SPEC.md --type ARCHITECTURE
```

Inspect shared context:
```bash
almudaya context env list --session S001
# Displays: GITHUB_TOKEN: [REDACTED]
```

### Step 7: Renaming a Bot
Display names can be updated at any time without altering the underlying Bot ID or breaking past message references:
```bash
almudaya bot rename --session S001 --bot BOT001 --new-name "Lead Architect"
```

---

## 5. Troubleshooting & FAQ

### Stale Bot Status
If a bot process is forcibly killed (e.g. `kill -9` or system crash), its status in the registry will be automatically transitioned to `stale` when peers query `almudaya bot list`. The bot can be restarted cleanly using the same `bot_id`.

### Lock Contention / Timeouts
All session writes are protected by cooperative file locks. If a high volume of writes occurs, operations retry automatically with exponential backoff and jitter. Stale locks from terminated processes are detected and cleared automatically.

### JSON Output
All CLI commands support `--json` for scripting and piping to `jq`:
```bash
almudaya bot list --session S001 --json | jq '.[].display_name'
```
