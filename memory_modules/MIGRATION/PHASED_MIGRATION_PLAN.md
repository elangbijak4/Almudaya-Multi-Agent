# PKU Phased Migration Plan

## Gate 0 — Freeze and inspect baseline

- Record repository commit, working-tree diff, package version, Node/npm versions.
- Run clean install, build, complete test suite on supported OS.
- Capture fixtures for existing session folders and all legacy JSON/JSONL schemas.
- Confirm whether ACMA source exists in another branch/submodule/repository.
- No production writes or refactors.

**Exit:** inventory approved; fixture set checksummed; baseline build/tests green.

## Gate 1 — Canonical contracts

- Implement stable IDs, KnowledgeObject, provenance, relation, scope, lifecycle and event contracts.
- Define schema versioning and migration policy.
- Define PMU identity and project/session/bot scope mapping.
- Keep all runtime paths unchanged.

**Exit:** schema validation, serialization fixtures, compatibility review.

## Gate 2 — Read-only legacy bridge

- Implement a read-only adapter over `IBlackboardStorage`.
- Export sessions, bot registry, project roots, safe environment metadata, SDLC documents, broadcasts, inboxes, cursors and work logs.
- Preserve original source path, source IDs, timestamps, schema version and hash.
- Do not mutate legacy files.

**Exit:** repeatable export; source-to-PKU mapping report; zero unexplained missing records.

## Gate 3 — PKU persistence in shadow mode

- Add PKU store behind a port; choose storage backend only after technology ADR.
- Ingest legacy snapshots and eligible events idempotently.
- Use stable source identity such as `(sourceSystem, sourcePath, sourceRecordId)`.
- Quarantine invalid records; never silently discard.
- Compare counts, hashes, ordering, references and permissions.

**Exit:** replay produces no duplicates; reconciliation report accepted.

## Gate 4 — Register bridge, still legacy-authoritative

- Blackboard remains authoritative for live session coordination.
- ACMA integration only after actual ACMA source/API has been audited.
- PKU captures persistent records; registers remain the live operational interfaces.
- Preserve callback/ACK/fencing behavior.

**Exit:** runtime behavior parity under PKU outage and PKU success.

## Gate 5 — KOE shadow retrieval

- Assemble candidate context without changing prompts.
- Compare KOE context against existing prompt context and task outcomes.
- Record token counts, evidence coverage, latency and retrieval misses.
- Never silently remove legacy context until sufficiency criteria pass.

**Exit:** benchmark and regression acceptance.

## Gate 6 — Controlled read-through / reconstruction

- Enable PKU read-through for selected non-critical knowledge types.
- Reconstruct register snapshots in a separate validation mode.
- Compare reconstructed state with live legacy register state.
- No production replacement of message delivery/cursor state until explicit design approval.

**Exit:** parity, restart, crash recovery, stale-event and rollback tests pass.

## Gate 7 — Optional primary-write cutover

- Per-domain cutover only; never big-bang migration.
- Maintain compatibility facade and reversible data export.
- Dual-write only with idempotency, outbox/retry, reconciliation and conflict policy.
- Cutover requires human approval and a rollback rehearsal.

**Exit:** explicit owner GO; legacy deprecation plan approved.

## Gate 8 — Lifecycle management

- Implement archive, restore, prune, detach, soft delete, purge, reuse, fork and export.
- Reference-count shared nodes and analyze graph dependencies.
- Purge only owned data and only after retention/authorization checks.
- Preserve tombstones/audit records where policy requires.

**Exit:** deletion safety, restore, shared-reference and audit tests pass.
