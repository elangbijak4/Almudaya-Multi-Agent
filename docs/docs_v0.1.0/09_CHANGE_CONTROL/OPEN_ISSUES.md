# Open Issues

Track unresolved decisions. Do not silently decide high-impact issues.

| Issue ID | Question | Impact | Proposed options | Owner/status |
|---|---|---|---|---|
| OI-001 | What is the default workspace root on Windows/Linux/macOS? | Data location and portability | OS application-data directory; explicit config; project-local dev default | Resolved (ADR-001) |
| OI-002 | How are Session IDs generated and validated? | Identity and CLI | Alphanumeric slug regex `/^[a-zA-Z0-9_-]{1,64}$/`; custom or generated | Resolved (ADR-002) |
| OI-003 | How are Bot IDs allocated safely under concurrent joins? | Registry consistency | Sequential padded ID under lock; explicit or auto-allocated | Resolved (ADR-004) |
| OI-004 | What locking mechanism is selected for local multi-process writes? | Data integrity | Kernel-atomic `wx` file lock with timeout and stale PID recovery | Resolved (ADR-003) |
| OI-005 | How is bot liveness determined after a crash? | Registry accuracy | Heartbeat/lease with PID liveness check and stale transition | Resolved (ADR-008) |
| OI-006 | What is the broadcast read-cursor model? | Message consumption | Per-bot persistent cursor + flexible timestamp/ID filters | Resolved (ADR-005) |
| OI-007 | What is the direct-message delivery/ack model? | Messaging semantics | At-least-once persistent inbox with idempotent ack | Resolved (ADR-006) |
| OI-008 | Which license should be used? | Distribution/legal | MIT License selected; LICENSE file created and package.json updated | Resolved (Phase 8) |
| OI-009 | Is `almudaya-multiagent` available on npm at release time? | Package publication | Checked via npm registry (returned 404 Not Found, name is unclaimed and available) | Resolved (Phase 8) |
