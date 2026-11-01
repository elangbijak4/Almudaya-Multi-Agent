# System Analysis

## 1. Actors

- Human operator: creates sessions, starts bots, inspects state, configures shared context.
- Bot process: joins a session, discovers peers, broadcasts, sends/receives messages.
- Filesystem: durable storage provider.
- OS process manager: starts and terminates independent bot processes.

## 2. Logical context

```text
Human / CLI
    |
    v
Application Services
    |
    +---- Session Service
    +---- Bot Registry
    +---- Messaging Service
    +---- Shared Context Service
    |
    v
Blackboard Interface
    |
    v
Filesystem Persistence
```

CLI is an adapter; it should not contain business rules. Each bot process uses the same application services and accesses the same Session workspace.

## 3. Runtime collaboration model

- One process per bot.
- Multiple processes may use the same Session ID.
- Session registry is the discovery source.
- Broadcast log contains session-wide events.
- Each bot inbox contains direct messages addressed to that bot.
- No process is inherently the leader.
- Optional notification/watcher mechanisms may wake a process, but must not decide tasks.

## 4. Data ownership

| Data | Scope | Owner |
|---|---|---|
| Session metadata | Session | Session service |
| Bot identity/registry | Session | Bot registry |
| Broadcast events | Session | Messaging service |
| Direct messages | Individual bot | Inbox service |
| Project roots | Session | Shared context service |
| Environment metadata | Session | Shared context service |
| SDLC document references | Session | Shared context service |

## 5. Key failure scenarios

- Process crashes during write.
- Two bots register simultaneously.
- Two bots send messages simultaneously.
- Display name collision.
- Session directory is moved/deleted.
- Registry file is malformed or from a newer schema.
- Bot restarts with stale status.
- Message is delivered twice or acknowledged twice.
- Project root path becomes unavailable.

## 6. Analysis decisions to finalize

The design phase must specify:
- workspace default and override;
- session ID generation/validation;
- bot ID generation/validation;
- default display-name sequencing;
- lock and atomic-write strategy;
- bot liveness/status semantics;
- broadcast read cursor semantics;
- message acknowledgement semantics;
- schema migration policy.
