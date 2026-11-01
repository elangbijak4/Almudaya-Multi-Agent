# Test Strategy

## 1. Objectives

Verify functional correctness, persistence, process isolation, cross-process coordination, CLI usability, and package integrity without real LLM services.

## 2. Test levels

### Unit
- Schema validation.
- Session and Bot ID validation.
- Display-name generation and uniqueness.
- Registry operations.
- Message/event validation.
- Path resolution and workspace configuration.

### Persistence
- Create/read/update.
- Restart persistence.
- Missing/corrupt records.
- Atomic replacement.
- Lock timeout and recovery.

### Multi-process integration
- Two bot processes join one Session.
- Concurrent bot registration.
- Concurrent broadcast/direct-message writes.
- Peer discovery.
- Inbox read and acknowledgement.
- Process shutdown and restart.

### CLI and package
- `--help`, `--version`.
- Invalid arguments and exit codes.
- Executable mapping.
- Build output.
- `npm pack --dry-run`.
- Temporary-directory installation/smoke test where feasible.

## 3. Test data

Use temporary directories and deterministic fixtures. Do not read or modify the developer's actual project workspace during automated tests.

## 4. Reliability

- Tests must clean up child processes even on failure.
- Use bounded timeouts.
- Capture stdout/stderr for diagnosis.
- Avoid sleep-based synchronization when an explicit readiness signal or polling condition is available.
- Test idempotency of acknowledgements and safe duplicate operations.

## 5. Reporting

Record command, date/time, environment, passed/failed/skipped counts, and known flaky tests. Never report a test as passing if it was not executed.
