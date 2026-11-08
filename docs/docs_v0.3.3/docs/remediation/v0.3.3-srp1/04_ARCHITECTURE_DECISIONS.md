# Architecture Decisions — SRP-1

## ADR-SRP1-001 — Baseline v0.3.2 remains immutable
**Status:** Accepted  
Keep v0.3.2 as the audited baseline. Release successful remediation as v0.3.3 unless the project owner explicitly approves another version.

## ADR-SRP1-002 — Fail-closed on unsupported isolation
**Status:** Accepted  
A process group or process-tree termination backend is not a sandbox. If filesystem/network/process isolation cannot be enforced for the requested operation, deny sensitive execution. No silent fallback to host shell.

## ADR-SRP1-003 — Identity is mandatory context
**Status:** Accepted  
Sensitive actions require trusted session and bot principal resolved from runtime/session authority. Caller-supplied IDs alone are not authentication.

## ADR-SRP1-004 — Delivery requires acknowledgment semantics
**Status:** Accepted  
Inbox and broadcast delivery must not consume events before successful processing/acknowledgment. At-least-once plus idempotency is preferred over false exactly-once claims.

## ADR-SRP1-005 — Fencing enforced at write boundary
**Status:** Accepted  
Fencing token must be checked by the storage resource being protected. A token that is generated but not validated by writes does not fence stale writers.

## ADR-SRP1-006 — Mandatory security audit
**Status:** Accepted  
Grant/revoke and sensitive execution require durable audit. If audit persistence is a security precondition and fails, operation fails closed.

## ADR-SRP1-007 — Redaction at trust boundaries
**Status:** Accepted  
All sensitive data must pass through one recursive redaction layer before persistence or output. Redaction is defense-in-depth, not a substitute for secret minimization.

## ADR template
- ID/title:
- Status:
- Context:
- Decision:
- Alternatives:
- Consequences:
- Related AUD IDs / REQ IDs:
- Tests/evidence:
