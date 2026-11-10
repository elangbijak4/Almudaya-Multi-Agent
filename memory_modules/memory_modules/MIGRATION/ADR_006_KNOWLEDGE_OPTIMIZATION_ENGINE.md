# ADR-006: Knowledge Optimization Engine (KOE) & Evidence-Grounded Context Assembly

- **Status:** Accepted
- **Phase:** Phase 6 — Knowledge Optimization Engine (KOE)
- **Date:** 2026-11-09
- **Spec Reference:** PKU Unified Persistent Memory Architecture v0.2 (§2.4, §8), `ACCEPTANCE_TEST_MATRIX.md` (`PKU-012`, `PKU-013`, `PKU-008`, `PKU-009`), `PHASED_MIGRATION_PLAN.md` (Gate 5)

---

## 1. Context

Multi-agent coding sessions accumulate extensive Blackboard events, shared artifacts, work logs, and individual ACMA cognitive memories. Feeding raw session history directly into agent prompts causes context bloat, high token consumption, and potential inclusion of stale summaries or unauthorized cross-bot records.

PKU Spec v0.2 (§2.4 & §8) defines the **Knowledge Optimization Engine (KOE)** to retrieve and assemble the minimum sufficient, evidence-grounded knowledge context for a given task without sacrificing correctness.

---

## 2. Decision

1. **Hierarchical & Graph-Aware Retrieval (`KnowledgeOptimizationEngine.retrieve`):**
   - Prioritize hierarchical abstraction levels (`L0` Project Index -> `L1` Domain/Module Summaries -> `L2` Specifications/Contracts -> `L3` Raw Evidence/Logs).
   - Traverse graph relations (`relationTraversalDepth`) while enforcing `canReadKnowledgeObject(item, permission)` on every candidate and traversed neighbor (`PKU-009`).

2. **Version-Aware Stale Summary Detection & Raw Evidence Refresh (`PKU-013`):**
   - Before ranking or assembling any compiled summary (`L0`/`L1`/`L2`), `detectAndRefreshStaleSummary` checks:
     - Whether `validationStatus === 'superseded'` or an active `supersedes` relation points to a newer object.
     - Whether any linked `derived_from` raw evidence object (`L3`) or `metadata.sourceEvidenceIds` has a higher `version` than `metadata.compiledFromSourceVersion` or a newer `updatedAt` timestamp than the compiled summary.
   - When staleness is detected, KOE excludes the stale summary, substitutes the latest authorized raw evidence object(s), and records `staleSummaryIds`, `refreshedFromRawEvidenceIds`, and `staleReasons` in `retrievalDiagnostics`.

3. **Token-Budget Optimization, Progressive Compression & Sufficiency Evaluation (`PKU-012`):**
   - `assembleContext(request)` scores candidates by task keyword overlap and hierarchy priority, progressively expanding linked `L3` raw evidence when budget permits.
   - Each selected block includes its canonical provenance citation (`sourceSystem:sourceType:locator@vN`).
   - If a full-detail block exceeds the remaining `tokenBudget`, KOE attempts lossless summary compression before dropping the item.
   - If no evidence-backed knowledge fits within `tokenBudget` (or no relevant objects exist), KOE returns `sufficient: false` with explicit `insufficiencyReason` and preserves `request.legacyFallback` when supplied (satisfying Gate 5: never silently remove legacy context until sufficiency criteria pass).

4. **Shadow Retrieval Benchmarking (`compareShadowContext`):**
   - Provides non-intrusive shadow comparison against legacy prompt context, reporting `legacyEstimatedTokens`, `koeEstimatedTokens`, `tokenCompressionRatio`, `evidenceCoverage`, `sufficient`, and `latencyMs`.

---

## 3. Consequences

- **Guaranteed Freshness:** Stale compiled summaries never mislead agents when underlying raw evidence has been updated (`PKU-013`).
- **Predictable Token Footprint:** Context assembly strictly respects `tokenBudget` and explicitly signals insufficiency (`PKU-012`).
- **Zero Unauthorized Leakage:** All retrieval and graph expansion steps are gated by `MemoryPermissionContext` (`PKU-009`) and `redactSecrets` (`PKU-008`).
