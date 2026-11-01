# ADR-007: Shared Project Context Registries and Secret Redaction

- **Status:** ACCEPTED
- **Date:** 2026-11-01
- **Deciders:** Principal Software Architect
- **Consulted:** SRS (FR-017..FR-019, NFR-007), Data Model, Master Prompt Sections 2.1, 5.1, 6.1

## Context

Almudaya Multi-Agent allows multiple independent bots in the same Session to share project context without coupling themselves to hardcoded paths or exposing sensitive host secrets:
1. **Multiple Project Roots:** A session may involve multiple repositories or subdirectories (e.g. frontend, backend, shared-libs).
2. **Environment Metadata:** Bots need to know the shared runtime environment (Node version, OS, tooling) to ensure compatible code generation and tool usage.
3. **SDLC Document Registry:** References to requirements, design specifications, architecture records, and test plans must be discoverable by all bots.
4. **Mandatory Secret Redaction:** Per NFR-007 and architectural rules, no API keys, tokens, passwords, or credentials may ever be persisted in Blackboard registries.

## Decision

1. **Storage Layout:**
   Persistent records are stored in the Session's `registry/` folder:
   - `<sessionDir>/registry/project_roots.json`
   - `<sessionDir>/registry/environment.json`
   - `<sessionDir>/registry/documents.json`

2. **Schemas & Data Models:**
   - **Project Root Record:**
     - `root_id`: Alphanumeric slug (`/^[a-zA-Z0-9_-]{1,64}$/`)
     - `name`: Human-readable root name
     - `path`: Normalized path (`path.resolve()`)
     - `root_type`: Enum (`primary`, `dependency`, `reference`, `docs`)
     - `description`: Optional text
     - `created_at`, `updated_at`: ISO 8601 UTC
   - **Environment Record:**
     - `os`: Host operating system and release
     - `arch`: CPU architecture
     - `shell`: Current detected shell
     - `node_version`: Node.js version
     - `npm_version`: npm version
     - `git_version`: Optional Git version
     - `variables`: Safe key-value dictionary
     - `updated_at`: ISO 8601 UTC
   - **SDLC Document Reference:**
     - `document_id`: Alphanumeric slug (`/^[a-zA-Z0-9_-]{1,64}$/`)
     - `title`: Document title
     - `document_type`: Enum (`SRS`, `REQUIREMENTS`, `ARCHITECTURE`, `DESIGN`, `API_SPEC`, `TEST_PLAN`, `USER_GUIDE`, `OTHER`)
     - `uri_or_path`: File path or document URI
     - `version`: Optional version string
     - `status`: Enum (`draft`, `approved`, `deprecated`)
     - `updated_at`: ISO 8601 UTC

3. **Secret Redaction Algorithm:**
   - Any key or value in environment variables or metadata matching `/token|secret|password|private|credential|api[_-]?key|bearer/i` is automatically masked to `"[REDACTED]"`.
   - String values resembling JWTs (`/^[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+$/`) or standard API key patterns are automatically masked before saving.

4. **Concurrency & Atomic Persistence:**
   - All shared context files are read/written under `withSessionLock` using `atomicWriteJson` and validated on read via Zod schemas.

## Consequences

- Bots across different processes can discover all registered project roots, technical tooling, and SDLC docs.
- Zero risk of credential leaks into session blackboards.
- Multiple project roots allow monorepo and polyrepo collaboration.
