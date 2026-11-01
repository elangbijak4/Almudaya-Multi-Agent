# ADR-004: Bot Identity, Display Naming, and Registry Strategy

- **Status:** ACCEPTED
- **Date:** 2026-10-31
- **Deciders:** Principal Software Architect
- **Consulted:** SRS (FR-003..009), Master Prompt Sections 2.1, 2.2, 5.3, 6.1

## Context

Almudaya Multi-Agent requires multiple bot processes to join the same Session independently. Per architectural invariants 5, 6, 7, and 8:
- Stable Bot IDs must be distinct from editable display names.
- Historical messages and internal references must always use stable Bot IDs.
- Display names must be unique within a Session.
- Renaming a bot must not alter its Bot ID or invalidate historical messages.
- Concurrent bot joins from separate terminal processes must safely allocate IDs and sequence numbers without collisions or race conditions.

## Decision

1. **Bot ID Format & Allocation Strategy (Resolves OI-003):**
   - Format: alphanumeric string matching `/^[a-zA-Z0-9_-]{1,64}$/`. Canonical examples: `BOT001`, `BOT002`.
   - Explicit Allocation: Users/processes may supply an explicit `--bot <bot_id>`. If already registered in the session, registration is rejected with `BotAlreadyRegisteredError`.
   - Default Auto-Allocation: If not supplied, the system inspects registered bots inside the session lock and allocates the next sequential identifier `BOT` + 3-digit padded number (`BOT001`, `BOT002`, ...).

2. **Display Name Rules & Default Sequencing:**
   - Display names are human-readable, unique per Session, matching `/^[a-zA-Z0-9_ -]{1,64}$/`.
   - Default Generated Name: If not explicitly supplied, generated from the session name and sequence number:
     `<session_name>_<sequence>` (e.g. `research-app_001`).
   - Sequence generation inspects existing bots in the session to find the lowest unused sequential number (e.g. `001`, `002`), ensuring deterministic numbering even if bots are removed or joined out of order.
   - Explicit Display Name: If supplied via `--display-name`, it is validated for uniqueness across the session. If already in use, `DisplayNameConflictError` is raised.

3. **Renaming Invariant:**
   - Operation: `renameBot(sessionId, botId, newDisplayName)`.
   - Enforces display name uniqueness among all other bots in the session.
   - Updates `display_name` and `updated_at`.
   - Retains immutable `bot_id`, `joined_at`, and historical integrity.

4. **Bot Status & Peer Discovery:**
   - Status Enum: `starting`, `active`, `idle`, `stopped`, `failed`, `stale`.
   - Registry File: `<session_dir>/registry/bots.json` containing:
     ```json
     {
       "schema_version": "1.0.0",
       "session_id": "S001",
       "updated_at": "...",
       "bots": [
         {
           "bot_id": "BOT001",
           "display_name": "research-app_001",
           "description": "...",
           "status": "active",
           "pid": 1234,
           "joined_at": "...",
           "last_seen_at": "...",
           "metadata": {}
         }
       ]
     }
     ```
   - Peer Discovery: Returns all registered bots in the session, allowing lookup by `bot_id` or `display_name`.
   - Concurrency: All reads/modifications to `bots.json` occur under `withSessionLock`.

## Consequences

- Stable IDs never change, enabling durable message histories in Phase 4.
- Renaming is fully supported without data corruption.
- Multi-process joins are race-condition-free due to session locking.
- Resolves Open Issue `OI-003`.
