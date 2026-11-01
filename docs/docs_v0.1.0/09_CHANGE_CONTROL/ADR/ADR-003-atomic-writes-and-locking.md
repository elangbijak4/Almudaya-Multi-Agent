# ADR-003: Persistence, Atomic Write, and Locking Strategy

- **Status:** ACCEPTED
- **Date:** 2026-10-31
- **Deciders:** Principal Software Architect
- **Consulted:** SRS (NFR-003, NFR-004), Master Prompt Section 5.2, Persistence Design

## Context

Almudaya Multi-Agent coordinates independent OS processes accessing the same filesystem-backed Session Blackboard simultaneously.
Without concurrency control:
1. Two processes modifying `session.json` or registry files at the same time can cause partial writes or corrupt files.
2. Direct overwrite using `fs.writeFile` is not atomic; a crash during write truncates or damages existing data.

We need a lightweight, zero-external-dependency, cross-platform locking and atomic write mechanism suitable for local multi-process execution.

## Decision

1. **Atomic File Replacement:**
   - When writing structured files (e.g. `session.json`, `bots.json`), write first to a temporary file in the same directory:
     `<targetPath>.<pid>.<timestamp>.<random>.tmp`
   - Ensure the content is fully flushed to disk.
   - Atomically rename the temporary file to the target path using `fs.promises.rename`.
   - On Windows, if `rename` encounters `EPERM` or `EBUSY` due to transient anti-virus or file handle timing, apply a short bounded retry with exponential backoff (up to 5 retries, ~50ms).
   - If write fails, clean up the temporary file immediately.

2. **Cross-Process Cooperative File Locking:**
   - Cooperative lock per Session: `<workspace>/sessions/<session_id>/.lock`.
   - Implementation uses atomic file creation via Node's `fs.promises.open(lockPath, 'wx')` (`O_CREAT | O_EXCL`). This is guaranteed atomic by the OS kernel on Windows and POSIX.
   - The lock payload records JSON: `{ "pid": process.pid, "locked_at": ISO8601, "holder": string }`.
   - Bounded timeout: Acquiring a lock polls with exponential backoff and jitter up to a configurable timeout (default 5000ms). If timeout is reached, throws `LockTimeoutError`.
   - Stale lock detection: If the lock file is older than a stale threshold (default 30 seconds), verify whether the holder process is still running via `process.kill(pid, 0)`:
     - If the process is dead (throws `ESRCH`), the stale lock is safely broken and reacquired.
     - On Windows where process PID reuse is possible, timestamps provide an additional guard.
   - Lock release safely removes the `.lock` file only if owned by the current process.

## Consequences

- Zero external native or binary dependencies required.
- Robust against concurrent writes and process crashes.
- Prevents file corruption and partial reads.
- Resolves Open Issue `OI-004`.
