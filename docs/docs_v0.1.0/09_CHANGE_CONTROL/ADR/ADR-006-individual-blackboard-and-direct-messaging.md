# ADR-006: Individual Blackboard and Direct Messaging Strategy

- **Status:** ACCEPTED
- **Date:** 2026-11-01
- **Deciders:** Principal Software Architect
- **Consulted:** SRS (FR-012..FR-016), Master Prompt Sections 2.1, 2.2, 5.2, 5.4, 6.1

## Context

In Almudaya Multi-Agent, each bot registered in a Session has an Individual Blackboard for incoming direct messages, pending requests, and acknowledgements.
Key architectural invariants:
- Stable Bot IDs must be used for message addressing and historical references (Invariant 7 & 8).
- Humans or bots may specify a recipient by display name or stable Bot ID; the system must resolve display names to stable Bot IDs before recording delivery.
- Messaging must support delivery tracking, read state, and acknowledgement across independent processes without losing messages.

## Decision

1. **Storage Layout:**
   - Location per bot: `<sessionDir>/inbox/<bot_id>/`
   - Messages file: `<sessionDir>/inbox/<bot_id>/messages.json`
   - Cursor file: `<sessionDir>/inbox/<bot_id>/broadcast_cursor.json`

2. **Direct Message Schema:**
   - `message_id`: Unique string `msg_<timestamp>_<randomHex>`
   - `session_id`: Stable Session ID
   - `sender_bot_id`: Stable Bot ID or `'HUMAN'`
   - `recipient_bot_id`: Canonical stable Bot ID (always resolved before save)
   - `timestamp`: ISO 8601 UTC
   - `message_type`: Enum (`DIRECT`, `REQUEST`, `RESPONSE`, `NOTIFICATION`)
   - `content`: Message body text
   - `status`: Enum (`unread`, `read`, `acknowledged`)
   - `read_at`: Optional ISO 8601 UTC
   - `acknowledged_at`: Optional ISO 8601 UTC
   - `metadata`: Optional key-value object

3. **Recipient Resolution:**
   - When sending a message, the recipient string is resolved against the session registry using `botService.resolveBotId(sessionId, recipient)`.
   - If the recipient does not exist (neither by Bot ID nor display name), transmission is rejected with `BotNotFoundError`.
   - The recipient's inbox directory `<sessionDir>/inbox/<recipient_bot_id>/` is automatically ensured.

4. **Delivery & Acknowledgement Model (Resolves OI-007):**
   - **At-Least-Once Durable Delivery:** Messages are appended atomically to `<sessionDir>/inbox/<recipient_bot_id>/messages.json` under session lock using `atomicWriteJson`.
   - **Idempotent Acknowledgement:**
     - `acknowledgeMessage(sessionId, recipientBotId, messageId)` transitions message status to `acknowledged` and records `acknowledged_at`.
     - Calling acknowledge multiple times on the same message is safe, idempotent, and returns the acknowledged record.
   - **Read State:**
     - `readInbox(sessionId, botId, { markAsRead: true })` marks any unread messages as `read` with timestamp `read_at`, unless already acknowledged.

## Consequences

- Resolves Open Issue `OI-007`.
- Guarantees message durability across process restarts.
- Renaming a bot does not break historical direct messages because records persist stable `bot_id`s.
