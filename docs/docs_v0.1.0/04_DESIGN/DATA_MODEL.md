# Data Model

**Status:** APPROVED (Session Metadata finalized for Phase 2 via ADR-002)

## 1. Session metadata (`session.json`)

Exact schema (validated by Zod in `src/session/schema.ts`):

- `schema_version`: String, semantic version (e.g. `"1.0.0"`)
- `session_id`: String, matching `/^[a-zA-Z0-9_-]{1,64}$/`
- `session_name`: String, length 1..128
- `description`: String (optional)
- `created_at`: String, ISO 8601 UTC
- `updated_at`: String, ISO 8601 UTC
- `status`: Enum (`"active" | "archived" | "closed"`)
- `metadata`: Record<string, unknown> (optional)

## 2. Bot registry record (`registry/bots.json`)

Exact schema (validated by Zod in `src/bot/schema.ts`):

- `schema_version`: String (e.g. `"1.0.0"`)
- `session_id`: String (matches `/^[a-zA-Z0-9_-]{1,64}$/`)
- `updated_at`: String (ISO 8601 UTC)
- `bots`: Array of `BotRecord`:
  - `bot_id`: String (matches `/^[a-zA-Z0-9_-]{1,64}$/`)
  - `display_name`: String (matches `/^[a-zA-Z0-9_ -]{1,64}$/`, unique per session)
  - `description`: String (optional)
  - `status`: Enum (`"starting" | "active" | "idle" | "stopped" | "failed" | "stale"`)
  - `pid`: Number (optional OS process ID)
  - `joined_at`: String (ISO 8601 UTC)
  - `last_seen_at`: String (ISO 8601 UTC)
  - `metadata`: Record<string, unknown> (optional)

## 3. Broadcast event (`broadcast/events.jsonl`)

Exact schema (validated by Zod in `src/messaging/schema.ts`):

- `event_id`: String (unique `evt_<timestamp>_<randomHex>`)
- `session_id`: String (matches `/^[a-zA-Z0-9_-]{1,64}$/`)
- `sender_bot_id`: String (stable Bot ID or `'HUMAN'` / `'SYSTEM'`)
- `timestamp`: String (ISO 8601 UTC)
- `category`: Enum (`"ACTIVITY" | "OBSERVATION" | "DECISION" | "TASK" | "ARTIFACT" | "QUESTION" | "STATUS" | "ALERT"`)
- `content`: String
- `metadata`: Record<string, unknown> (optional)

## 4. Direct message (`inbox/<bot_id>/messages.json`)

Exact schema (validated by Zod in `src/messaging/schema.ts`):

- `message_id`: String (unique `msg_<timestamp>_<randomHex>`)
- `session_id`: String (matches `/^[a-zA-Z0-9_-]{1,64}$/`)
- `sender_bot_id`: String (stable Bot ID or `'HUMAN'`)
- `recipient_bot_id`: String (stable Bot ID)
- `timestamp`: String (ISO 8601 UTC)
- `message_type`: Enum (`"DIRECT" | "REQUEST" | "RESPONSE" | "NOTIFICATION"`)
- `content`: String
- `status`: Enum (`"unread" | "read" | "acknowledged"`)
- `read_at`: String (optional ISO 8601 UTC)
- `acknowledged_at`: String (optional ISO 8601 UTC)
- `metadata`: Record<string, unknown> (optional)

## 5. Project root (`registry/project_roots.json`)

Exact schema (validated by Zod in `src/shared/schema.ts`):

- `schema_version`: String (`"1.0.0"`)
- `session_id`: String
- `updated_at`: String (ISO 8601 UTC)
- `roots`: Array of `ProjectRootRecord`:
  - `root_id`: String (matches `/^[a-zA-Z0-9_-]{1,64}$/`)
  - `name`: String
  - `path`: String (normalized absolute path)
  - `root_type`: Enum (`"primary" | "dependency" | "reference" | "docs"`)
  - `description`: String (optional)
  - `created_at`: String (ISO 8601 UTC)
  - `updated_at`: String (ISO 8601 UTC)

## 6. Environment metadata (`registry/environment.json`)

Exact schema (validated by Zod in `src/shared/schema.ts`):

- `schema_version`: String (`"1.0.0"`)
- `session_id`: String
- `os`: String
- `arch`: String
- `node_version`: String
- `npm_version`: String
- `git_version`: String (optional)
- `variables`: Record<string, string> (strictly redacted; keys matching secret/key/token/password/credential masked)
- `updated_at`: String (ISO 8601 UTC)

## 7. SDLC document reference (`registry/documents.json`)

Exact schema (validated by Zod in `src/shared/schema.ts`):

- `schema_version`: String (`"1.0.0"`)
- `session_id`: String
- `updated_at`: String (ISO 8601 UTC)
- `documents`: Array of `SdlcDocumentRecord`:
  - `document_id`: String (matches `/^[a-zA-Z0-9_-]{1,64}$/`)
  - `title`: String
  - `document_type`: Enum (`"SRS" | "REQUIREMENTS" | "ARCHITECTURE" | "DESIGN" | "API_SPEC" | "TEST_PLAN" | "USER_GUIDE" | "OTHER"`)
  - `uri_or_path`: String
  - `version`: String (optional)
  - `status`: Enum (`"draft" | "approved" | "deprecated"`)
  - `updated_at`: String (ISO 8601 UTC)

## 8. Identity and naming

- Bot IDs are stable and immutable.
- Display names may be edited.
- Historical records refer to Bot ID.
- Display names must be unique within one Session unless a documented disambiguation mechanism is selected.
- Default display name format: `<session-name>_<sequence>`, e.g. `research-app_001`.
- Sequence allocation must be safe under concurrent bot creation.
