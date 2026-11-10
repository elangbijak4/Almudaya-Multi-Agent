# ADR-008: Memory Lifecycle Management & Reference-Counted Deletion Safety

- **Status:** Accepted
- **Phase:** Phase 8 — Memory Lifecycle Management
- **Date:** 2026-11-09
- **Spec Reference:** PKU Unified Persistent Memory Architecture v0.2 (§2.6, §10), `ACCEPTANCE_TEST_MATRIX.md` (`PKU-015`, `PKU-016`, `PKU-017`), `PHASED_MIGRATION_PLAN.md` (Gate 8)

---

## 1. Context

Persistent project and agent knowledge evolves over time: decisions are archived, obsolete drafts are soft-deleted or purged, experimental branches are pruned, and validated components are reused, forked, exported, or merged across projects.

Without explicit lifecycle planning and reference analysis:
- Soft-deleted records might lose provenance or become unrecoverable (`PKU-016`).
- Purging a knowledge object could break dependent objects or cross-project reuse references (`PKU-017`).
- Destructive operations could execute without explicit authorization or audit trails.

---

## 2. Decision

1. **Two-Phase Plan & Execute Protocol (`IMemoryLifecycleManager`):**
   - `MemoryLifecycleService.plan(request)` inspects target objects, tree nodes, inbound `KnowledgeRelation` edges, and cross-project metadata (`reusedFromKnowledgeId`, `forkedFromKnowledgeId`) across all registered universes to compute `affectedKnowledgeIds`, `protectedKnowledgeIds`, `externalReferences`, `requiresExplicitConfirmation`, and `irreversible`.
   - `MemoryLifecycleService.execute(plan, confirmationToken?)` enforces mandatory confirmation tokens for destructive/structural operations (`purge`, `soft_delete`, `prune`, `merge`) and records an immutable `MemoryEvent` (`lifecycle.<operation>.executed` or `dry_run`) for every operation.

2. **Reversible Soft Delete & Full Provenance Recovery (`PKU-016`):**
   - `soft_delete` transitions `lifecycleStatus` to `'deleted'`, recording `previousLifecycleStatus` in `metadata` while preserving the full `content` and `provenance` payload.
   - `restore` transitions `'deleted'`, `'archived'`, or `'dormant'` objects back to `'active'` with 100% data and provenance fidelity unless the object has already been permanently `'purged'`.

3. **External Reference Protection & Tombstone Scrubbing on Purge (`PKU-017`):**
   - If `plan.externalReferences.length > 0` or `plan.protectedKnowledgeIds.length > 0`, `execute` strictly blocks `purge` with `LifecycleSafetyError` unless `request.includeSharedDependencies === true` was explicitly authorized.
   - When an unreferenced object is purged, its payload is scrubbed into an irreversible audit tombstone (`lifecycleStatus: 'purged'`, `content: { purged: true, purgedAt, purgedBy, reason }`).

4. **Envelope-Aware Idempotency in PKU Store (`computeKnowledgeStateHash`):**
   - Updated `InMemoryPKUStore.putKnowledge` and `LocalFilesystemPKUStore.putKnowledge` to hash the full lifecycle/structural envelope (`content`, `lifecycleStatus`, `validationStatus`, `reusable`, `scope`, `title`, `summary`, `treeNodeIds`, `relationIds`) so lifecycle state transitions increment object version and persist cleanly while identical replays remain idempotent (`PKU-002`).

---

## 3. Consequences

- **Zero Accidental Data Loss (`PKU-016`, `PKU-017`):** Soft deletes are fully reversible before purge, and referenced objects cannot be purged accidentally.
- **Complete Auditability:** Every lifecycle plan dry-run and execution is recorded in the PMU event log.
