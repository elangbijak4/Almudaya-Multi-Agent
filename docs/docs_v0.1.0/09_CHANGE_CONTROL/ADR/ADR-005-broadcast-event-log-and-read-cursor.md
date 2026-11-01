# ADR-005: Broadcast Event Log Format, Append Strategy, and Read-Cursor Model

- **Status:** ACCEPTED
- **Date:** 2026-11-01
- **Deciders:** Principal Software Architect
- **Consulted:** SRS (FR-010, FR-011, FR-015, NFR-004), Master Prompt Sections 2.1, 2.2, 5.2, 6.1

## Context

The Session Blackboard includes a shared broadcast log for session-wide events, discoveries, and state changes.
Per architectural invariant 11:
- Broadcasts are shared information, not mandatory instructions that every bot must execute.
- Broadcast writes can occur simultaneously from independent bot processes.
- Bots need a clear, non-blocking way to track which broadcasts they have already consumed without coupling their reading pace to other bots.

## Decision

1. **Storage Format & Location:**
   - Location: `<sessionDir>/broadcast/events.jsonl`
   - File format: JSON Lines (JSONL) with UTF-8 encoding. Each entry is a single-line valid JSON object ending with a newline (`\n`).
   - Event Schema (validated via Zod in `src/messaging/schema.ts`):
     - `event_id`: Unique identifier formatted as `evt_<timestamp>_<randomHex>`
     - `session_id`: Stable Session ID
     - `sender_bot_id`: Stable Bot ID or `'HUMAN'` / `'SYSTEM'`
     - `timestamp`: ISO 8601 UTC string
     - `category`: Enum (`ACTIVITY`, `OBSERVATION`, `DECISION`, `TASK`, `ARTIFACT`, `QUESTION`, `STATUS`, `ALERT`)
     - `content`: String describing the event
     - `metadata`: Optional key-value object

2. **Append Strategy:**
   - Writes to `events.jsonl` are guarded by the session's cooperative lock (`withSessionLock`) using `fs.promises.appendFile`.
   - Locking ensures concurrent writes from multiple processes never interleave partial JSON fragments across lines.
   - If `events.jsonl` does not exist, it is created automatically.

3. **Read-Cursor Model (Resolves OI-006):**
   - **Per-Bot Cursor Persistence:** Each bot maintains its own persistent cursor in its Individual Blackboard:
     `<sessionDir>/inbox/<bot_id>/broadcast_cursor.json`
     Schema: `{ "last_read_event_id": string | null, "last_read_timestamp": string | null }`
   - **Cursor Semantics:**
     - A bot can call `readBroadcasts(sessionId, { botId, autoAdvanceCursor: true })` to fetch all unread events published after its `last_read_event_id` and advance its stored cursor.
     - Alternatively, bots or humans can query events with flexible filters: `afterEventId`, `since` (timestamp), `category`, or `limit` without mutating any bot's cursor.
   - Readers never lock the broadcast log for long periods, allowing concurrent reads and writes.

## Consequences

- Resolves Open Issue `OI-006`.
- Ensures zero data loss and corruption on concurrent broadcast writes.
- Bots operate completely decoupled with independent consumption cursors.
