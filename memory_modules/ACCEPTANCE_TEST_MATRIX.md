# PKU Acceptance Test Matrix

| ID | Area | Test | Expected result |
|---|---|---|---|
| PKU-001 | Contracts | Validate canonical KnowledgeObject | Invalid schema rejected with actionable diagnostics |
| PKU-002 | Identity | Same legacy record imported twice | One canonical object; second import idempotent |
| PKU-003 | Provenance | Import broadcast/work-log/inbox fixture | Original IDs, timestamps, source locator and hash retained |
| PKU-004 | Blackboard | PKU disabled/unavailable | Existing session and coordination flows continue |
| PKU-005 | Blackboard | Read-only export of session | No legacy file mutation |
| PKU-006 | Messaging | Callback failure | Broadcast cursor not advanced; message remains retryable |
| PKU-007 | Messaging | Stale worker ACK | Rejected by existing fencing/lease validation |
| PKU-008 | Redaction | Secret canary in candidate memory event | Secret absent from PKU payload/logs |
| PKU-009 | Individual | Bot A queries Bot B private memory | Access denied unless explicit permission exists |
| PKU-010 | Reconstruction | Rebuild Global Register from snapshot | Equivalent state and ordering for supported fields |
| PKU-011 | Reconstruction | Rebuild Individual Register | Correct bot/session scope; no cross-bot leakage |
| PKU-012 | KOE | Retrieval with constrained token budget | Evidence-backed sufficient context or explicit insufficient result |
| PKU-013 | KOE | Stale compiled summary | Version mismatch triggers refresh/raw evidence retrieval |
| PKU-014 | PMU | Two project universes with same local IDs | Namespaces remain isolated |
| PKU-015 | Graph | Prune a tree branch containing shared graph nodes | Shared nodes remain available to other owners/references |
| PKU-016 | Lifecycle | Soft delete then restore | Data and provenance recoverable before purge |
| PKU-017 | Lifecycle | Purge with external references | Operation blocked or requires resolution/explicit policy |
| PKU-018 | Migration | Interrupted batch replay | No duplicate records; resumable batch |
| PKU-019 | Rollback | Disable PKU after shadow capture | Legacy paths remain operational |
| PKU-020 | Adapter | Backend disconnect | Capability-specific graceful degradation; no hidden data loss |
