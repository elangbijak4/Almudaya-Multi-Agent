# Compatibility Matrix

| Legacy surface | Compatibility requirement | Forbidden migration regression | Verification |
|---|---|---|---|
| `IBlackboardStorage` | Keep interface and semantics stable during initial PKU rollout | Replace interface or require PKU in existing consumers | Existing blackboard/session/bot/messaging/shared tests pass |
| `FilesystemSessionStorage` | Keep current workspace/session paths and formats readable/writable | Move or rename files in first rollout | Fixture round-trip + legacy read/write tests |
| `withSessionLock` / fencing | Preserve lock scope and fencing semantics | Write PKU-backed state outside lock or accept stale token | Concurrency and stale-fencing tests |
| Bot registry | Preserve IDs, display names, status, heartbeat, PID | Reassign bot IDs during import | Identity reconciliation tests |
| Inbox messages | Preserve IDs, order, status, delivery state, attempts, leases | Duplicate delivery or premature completion | Replay/idempotency/lease tests |
| Broadcast events | Preserve event IDs, ordering, categories and callback-then-cursor semantics | Advance cursor before successful callback | Callback-failure/restart redelivery tests |
| Work log | Preserve timestamps, bot/root references, action types and redaction | Store unredacted details or drop legacy entries | Import/export parity and secret-canary tests |
| Agent prompt context | Preserve existing fallback prompt assembly | Replace current context with empty/partial KOE response | Prompt parity test with PKU disabled/unavailable |
| CLI/library API | Existing commands and exports continue to work | Breaking constructor or command signature | CLI/API regression suite |
| ACMA bridge | No invented legacy API; adapt only audited ACMA implementation | Treat inbox/cursor as full ACMA cognitive memory | Explicit capability inventory and contract tests |

## Feature-flagged rollout

Recommended flags (names provisional):

- `PKU_ENABLED=false` — default off during initial contract integration.
- `PKU_SHADOW_READ=false` — compare PKU reads without affecting runtime decisions.
- `PKU_EVENT_CAPTURE=false` — capture eligible events to PKU without changing runtime behavior.
- `PKU_REGISTER_RECONSTRUCTION=false` — disabled until parity/recovery tests pass.
- `PKU_WRITE_PRIMARY=false` — must remain false until explicit cutover approval.

Do not implement all flags as active behavior in the scaffold; first add validated configuration and telemetry.
