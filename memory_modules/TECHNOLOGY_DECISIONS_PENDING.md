# Technology Decisions — Pending

No database or external backend is selected by this scaffold.

The following decisions require separate ADRs after contracts and migration constraints are approved:

1. Primary canonical object/event persistence backend.
2. Graph representation and traversal engine.
3. Full-text and semantic/vector retrieval engine.
4. Blob/artifact storage and content-addressing strategy.
5. Transaction, outbox, idempotency and consistency model.
6. Encryption-at-rest and key management.
7. Backup, retention and purge verification.
8. Local-first versus remote/cloud deployment topology.
9. External adapter capability and credential management.
10. Multi-process locking and concurrency strategy across supported Windows/Linux environments.

Selection criteria: Windows/Linux support, Node.js 22 compatibility, local-first operation, data portability, backup/restore, incremental sync, query performance, operational complexity, license, security, and ability to preserve existing filesystem-backed workflows.
