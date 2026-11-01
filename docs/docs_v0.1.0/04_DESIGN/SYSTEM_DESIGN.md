# System and Software Design

**Status:** APPROVED (Phase 2 Session and Blackboard boundaries finalized)

## 1. Logical modules

```text
CLI Adapter
  |
Application Services
  +-- Session Service
  +-- Bot Registry Service
  +-- Messaging Service
  +-- Shared Context Service
  |
Domain Models and Validation
  |
Blackboard Repository Interfaces
  |
Filesystem Repository Implementation
```

Suggested source boundaries:

- `cli/`: Commander commands, argument parsing, output formatting.
- `core/`: errors, IDs, clocks, config, shared types.
- `session/`: session lifecycle and metadata.
- `bot/`: bot identity, registry, status, rename, lifecycle contracts.
- `blackboard/`: repository interfaces, filesystem persistence, atomic writes, locking.
- `messaging/`: broadcast, direct messages, inbox, acknowledgements.
- `shared/`: project roots, environment metadata, SDLC document references.

## 2. Process model

A bot is a separate Node.js process. The CLI starts or runs the process. A bot process initializes a session client and its own bot identity. Independent processes coordinate only through the persistent Blackboard and optional notification mechanism.

Do not require a supervisor process to remain alive for the Blackboard to be usable.

## 3. Session storage concept

Illustrative layout; final details are decided in the persistence design:

```text
workspace/
└── sessions/
    └── S001/
        ├── session.json
        ├── registry/
        │   ├── bots.json
        │   ├── project_roots.json
        │   ├── environment.json
        │   └── documents.json
        ├── broadcast/
        │   └── events.jsonl
        ├── inbox/
        │   ├── BOT001/
        │   └── BOT002/
        └── artifacts/
```

Mutable runtime data must not be mixed with package source files.

## 4. API boundaries

Design service methods around domain operations, for example:

- `createSession(...)`
- `getSession(...)`
- `registerBot(...)`
- `listBots(...)`
- `renameBot(...)`
- `setBotStatus(...)`
- `appendBroadcast(...)`
- `readBroadcast(...)`
- `sendDirectMessage(...)`
- `readInbox(...)`
- `acknowledgeMessage(...)`
- `registerProjectRoot(...)`
- `registerEnvironment(...)`
- `registerDocumentReference(...)`

These are conceptual names, not mandatory public API signatures. Define typed contracts during design.

## 5. Design constraints

- CLI is thin.
- Storage access is behind interfaces.
- Data is validated at persistence boundaries.
- Bot ID is the stable reference in messages.
- Display name resolution is scoped to a Session.
- No LLM dependency in infrastructure tests.
- No always-on orchestrator.
