# Rollback and Reconciliation Contract

## Invariants

1. Legacy Blackboard remains usable until a domain-specific cutover is approved.
2. Every imported legacy record retains its original identity and provenance.
3. Re-import is idempotent.
4. A partial PKU outage must not silently lose a legacy write.
5. No destructive migration is permitted during shadow mode.
6. PKU purge cannot delete externally owned source data without explicit adapter capability and authorization.

## Required event identity

Each captured record must carry:

- `source_system`
- `source_path` or stable source locator
- `source_record_id`
- `source_schema_version`
- `source_updated_at` when available
- `ingested_at`
- `content_hash`
- `migration_batch_id`

## Reconciliation checks

- Record count by entity type and source file.
- Stable-ID uniqueness.
- Content hash equality where canonicalization permits.
- Event ordering and timestamp preservation.
- Bot/session/project ownership mapping.
- Relationship target existence.
- Permission/scope parity.
- Quarantine count and reason.

## Rollback procedure

1. Disable PKU read-through and event capture flags.
2. Keep existing Blackboard and ACMA-compatible paths active.
3. Stop PKU primary writes if enabled; retain durable outbox for replay.
4. Reconcile any writes since last checkpoint.
5. Re-import missing PKU events or export required records to recovery package.
6. Verify session, bot, inbox, broadcast, cursor and work-log behavior.
7. Record rollback reason and evidence.

Rollback must not delete PKU data; it disables integration and restores legacy runtime authority.
