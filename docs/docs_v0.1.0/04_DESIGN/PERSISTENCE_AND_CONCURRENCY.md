# Persistence and Concurrency Design

- **Status:** APPROVED (Finalized for Phase 2 via ADR-001, ADR-002, ADR-003)
- **Updated:** 2026-10-31

## 1. Durability model

Filesystem storage is the durable source of truth. In-memory objects are caches/buffers only. A process restart must reconstruct state from persistent data.

## 2. Directory Layout

The physical directory hierarchy under the resolved workspace root is structured as follows:

```text
<workspace_root>/
└── sessions/
    └── <session_id>/
        ├── session.json         # Session metadata (validated with Zod, atomic writes)
        ├── .lock                # Cooperative process lock file
        ├── registry/
        │   ├── bots.json        # Bot registry
        │   ├── project_roots.json
        │   ├── environment.json
        │   └── documents.json
        ├── broadcast/
        │   └── events.jsonl     # Append-only session broadcast log
        └── inbox/
            └── <bot_id>/        # Per-bot direct message stores
```

## 3. Workspace Root Strategy (ADR-001)

Precedence:
1. `--workspace <path>` CLI argument
2. `ALMUDAYA_WORKSPACE` environment variable
3. OS User Application Data:
   - Windows: `%LOCALAPPDATA%\almudaya`
   - macOS: `~/Library/Application Support/almudaya`
   - Linux: `$XDG_DATA_HOME/almudaya` or `~/.local/share/almudaya`

## 4. Atomic Write Method (ADR-003)

For all structured JSON writes (`session.json`, `bots.json`, etc.):
1. Serialize payload to JSON.
2. Write to a unique temporary sibling file: `<targetPath>.<pid>.<timestamp>.<random>.tmp`.
3. Flush and close handle.
4. Atomically rename temporary file to target path (`fs.promises.rename`).
5. Include transient retry logic on Windows for `EPERM`/`EBUSY`.

## 5. Locking Strategy (ADR-003)

For operations requiring read-modify-write coordination across separate processes:
1. Open `.lock` with `wx` flag (`O_CREAT | O_EXCL`).
2. If lock exists:
   - Check if stale (holder PID dead or timestamp > 30 seconds old).
   - If active, sleep with exponential backoff and jitter, retrying until timeout (5000ms default).
3. Execute critical section within `withLock(sessionPath, async () => { ... })`.
4. Release lock by removing `.lock` file in a `finally` block, ensuring only the locking process removes it.

## 6. Schema Validation

Every read from disk is parsed and validated against the Zod schema (`SessionMetadataSchema`). If the file is malformed, truncated, or incompatible, a typed `ValidationError` or `CorruptedDataError` is raised, preventing silent data loss.
