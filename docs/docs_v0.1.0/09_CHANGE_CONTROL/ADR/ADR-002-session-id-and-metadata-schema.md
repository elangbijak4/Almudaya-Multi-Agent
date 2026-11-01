# ADR-002: Session ID Format and Metadata Schema

- **Status:** ACCEPTED
- **Date:** 2026-10-31
- **Deciders:** Principal Software Architect
- **Consulted:** SRS (FR-001, NFR-005), Data Model, Master Prompt Section 2.1 & 2.2

## Context

A Session is the primary collaboration boundary identified by a stable `session_id`. We need:
1. A clear grammar and validation rule for `session_id` so that it is safe across filesystem path conventions on Windows, macOS, and Linux.
2. A deterministic mechanism for users to supply custom session IDs or derive them from session names.
3. A formal, versioned schema (`schema_version`) for `session.json` validated at runtime.

## Decision

1. **Session ID Rules:**
   - Allowed characters: alphanumeric characters, hyphens, and underscores: `/^[a-zA-Z0-9_-]{1,64}$/`.
   - Reserved directory characters (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`) are forbidden to ensure cross-platform path safety.
   - If a user provides an explicit `--id <id>`, it must strictly match this pattern.
   - If only a session name is provided (e.g., `almudaya session create research-app`), the default generated session ID will sanitize the name and append a short deterministic timestamp/hash suffix if needed, or if an ID pattern like `S001` is supplied directly, it is preserved.
2. **Metadata Schema (`session.json`):**
   - Runtime validation with `zod`.
   - `schema_version`: Semantic version string, starting at `"1.0.0"`.
   - `session_id`: String (matches regex).
   - `session_name`: Human-readable name.
   - `description`: Optional text.
   - `created_at`: ISO 8601 UTC string (`z.string().datetime()`).
   - `updated_at`: ISO 8601 UTC string.
   - `status`: Enum (`"active" | "archived" | "closed"`).
   - `metadata`: Optional key-value dictionary for future extension.

## Consequences

- Direct path mapping: `<workspace>/sessions/<session_id>/` is always safe on Windows, Linux, and macOS.
- Metadata is validated upon read and write, catching any schema mismatch or corruption early.
- Resolves Open Issue `OI-002`.
