# ADR-001: Workspace Root Location and Configuration Strategy

- **Status:** ACCEPTED
- **Date:** 2026-10-31
- **Deciders:** Principal Software Architect
- **Consulted:** Requirements SRS (FR-022, NFR-002), Implementation Plan Phase 2

## Context

The Almudaya Multi-Agent system requires a persistent storage root for sessions, blackboards, registries, and messages. Per architectural invariant 9 and requirement FR-022, mutable runtime data must not be stored inside the package source code (`src/` or `dist/`), and must be cross-platform compatible across Windows, Linux, and macOS.

We need a deterministic precedence model for resolving the workspace root in both production usage and isolated automated testing environments.

## Decision

We establish the following precedence hierarchy for resolving the workspace root:

1. **Explicit CLI option:** `--workspace <path>` (highest priority).
2. **Environment variable:** `ALMUDAYA_WORKSPACE` (if set and non-empty).
3. **Platform-standard user application data directory:**
   - **Windows:** `%LOCALAPPDATA%\almudaya` (fallback: `~/.almudaya`)
   - **macOS:** `~/Library/Application Support/almudaya`
   - **Linux / Other POSIX:** `$XDG_DATA_HOME/almudaya` (fallback: `~/.local/share/almudaya`)

In development/testing environments, developers or tests can supply `--workspace ./tmp-workspace` or set `ALMUDAYA_WORKSPACE` to keep test fixtures isolated without polluting user directories.

## Alternatives Considered

1. **Always default to current working directory (`./.almudaya`):**
   - *Rejected:* Would litter project repositories when users run the CLI from arbitrary folders, creating git pollution and risk of accidental commits.
2. **Hardcoded single directory (`~/.almudaya` across all OSes):**
   - *Rejected:* Violates OS platform conventions (Windows uses `LOCALAPPDATA`, Linux uses XDG specs).

## Consequences

- Cross-platform portability is maintained automatically.
- Tests can run in temporary isolated directories using `ALMUDAYA_WORKSPACE` or `--workspace`.
- Resolves Open Issue `OI-001`.
