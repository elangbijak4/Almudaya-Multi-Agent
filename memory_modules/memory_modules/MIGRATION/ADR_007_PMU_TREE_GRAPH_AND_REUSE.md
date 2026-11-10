# ADR-007: Project Memory Universe (PMU), Hierarchical Tree Separation & Cross-Project Reuse

- **Status:** Accepted
- **Phase:** Phase 7 — Project Memory Universe (PMU), Hierarchical Tree & Knowledge Graph Operations, and Cross-Project Reuse/Fork
- **Date:** 2026-11-09
- **Spec Reference:** PKU Unified Persistent Memory Architecture v0.2 (§2.5, §5.2, §9.3), `ACCEPTANCE_TEST_MATRIX.md` (`PKU-014`, `PKU-015`)

---

## 1. Context

Multi-agent software engineering across multiple projects requires:
1. Strict per-project namespace isolation so identical local identifiers (`REQ-001`, `COMP-AUTH`, etc.) in different projects never collide or leak across project queries (`PKU-014`).
2. A structured 8-domain hierarchical knowledge tree (`Identity`, `Requirements`, `Architecture` + `Modules`/`Components`/`Interfaces`, `Development`, `Experiments`, `Decisions`, `Tests`, `Roadmap`) alongside a rich Knowledge Graph (`depends_on`, `implements`, `derived_from`, `supersedes`, `reuses`, etc.).
3. Structural tree branch pruning that detaches tree memberships without destroying shared `KnowledgeObject` nodes still referenced by other tree branches or graph relations (`PKU-015`).
4. Controlled cross-project knowledge reuse (`reference` and `copy`) and PMU forking with full provenance lineage.

---

## 2. Decision

1. **PMU-Scoped Deterministic Identity (`PKU-014`):**
   - `ProjectMemoryUniverseService.createProjectUniverse` derives `ProjectUniverseId` deterministically from `projectKey` (`deriveProjectUniverseId`) and seeds the `L0` root `KnowledgeObject` plus the 11 standard `KnowledgeTreeNode` entries (8 top-level domains + 3 `Architecture/*` sub-domains).
   - `putProjectKnowledge` scopes `deriveKnowledgeId` by `projectUniverseId`, guaranteeing zero ID collision even when two PMUs use identical `localRecordId` and `type`.

2. **Orthogonal Tree Membership vs. Knowledge Graph Storage (`PKU-015`):**
   - Hierarchical tree membership is stored in `KnowledgeTreeNode.knowledgeIds` and `KnowledgeObject.treeNodeIds`, completely decoupled from `KnowledgeObject` lifecycle state and `KnowledgeRelation` edges.
   - `pruneTreeBranch(projectUniverseId, domainPath, requestedBy)` clears `knowledgeIds` on the target `KnowledgeTreeNode`(s) and removes those `nodeId`s from `KnowledgeObject.treeNodeIds`, while leaving the underlying `KnowledgeObject` records (`lifecycleStatus: 'active'`) and `KnowledgeRelation` edges untouched.

3. **Controlled Cross-Project Reuse & Forking (`Spec §2.5 & §9.3`):**
   - `reuseKnowledgeAcrossProjects` verifies `reusable !== false` (unless explicitly overridden), creates a target `KnowledgeObject` (`scope: 'cross_project'`) with `provenance.originProjectUniverseId` preserved, and links it to the source object via a `reuses` `KnowledgeRelation`.
   - `forkProjectUniverse` creates an independent child PMU (`parentUniverseId`), clones reusable knowledge objects into the new PMU namespace, and records `derived_from` lineage relations.

---

## 3. Consequences

- **Guaranteed PMU Isolation (`PKU-014`):** Multi-project workspaces can safely host any number of projects without ID collisions.
- **Safe Structural Pruning (`PKU-015`):** Pruning an experimental or obsolete tree branch never breaks shared architectural components or graph dependencies.
- **Traceable Reuse:** Every reused or forked knowledge object retains cryptographic and graph lineage back to its `originProjectUniverseId`.
