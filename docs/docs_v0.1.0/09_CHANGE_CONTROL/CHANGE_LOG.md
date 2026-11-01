# Change Log and Change Control

Record every approved change that affects requirements, architecture, scope, or release behavior.

| Change ID | Date | Description | Reason | Impact | Decision |
|---|---|---|---|---|---|
| CHG-001 | 2026-10-31 | Initial baseline | Establish v0.1.0 session-centric multi-process and persistent Blackboard scope | Project initiation | Baseline accepted as draft |
| CHG-002 | 2026-10-31 | Complete Phase 1 Project Scaffold | Execute Phase 1 First Task from MASTER_PROMPT.md | Project scaffold, TypeScript strict config, CLI entry, tests, package verification | Passed Phase 1 Gate |
| CHG-003 | 2026-10-31 | Complete Phase 2 Session and Blackboard | Implement ADR-001..003, Session metadata, atomic writes, locking, persistence, CLI session commands | Session lifecycle, persistent storage, concurrency controls, 23 automated tests | Passed Phase 2 Gate |
| CHG-004 | 2026-10-31 | Complete Phase 3 Bot Registration and Discovery | Implement ADR-004, Bot ID & display name rules, default sequencing, peer discovery, rename invariants, CLI bot commands | Bot registry, identity management, multi-process concurrent registration tests, 42 automated tests | Passed Phase 3 Gate |
| CHG-005 | 2026-11-01 | Complete Phase 4 Messaging | Implement ADR-005..006, broadcast events (`events.jsonl`), per-bot cursors, direct messaging inboxes, idempotent acknowledgements, CLI messaging commands | Broadcast and direct messaging subsystem, multi-process concurrency verification, 57 automated tests | Passed Phase 4 Gate |
| CHG-006 | 2026-11-01 | Complete Phase 5 Shared Project Context | Implement ADR-007, project roots, environment metadata with secret redaction, SDLC document references, CLI context commands | Shared context subsystem, credential protection, 69 automated tests | Passed Phase 5 Gate |

## Change process

1. Describe the requested change.
2. Identify affected requirements, design documents, implementation modules, and tests.
3. Estimate scope/risk.
4. Record approval or rejection.
5. Update traceability and affected documents.
6. Implement only after approval when the change materially alters scope or architecture.
