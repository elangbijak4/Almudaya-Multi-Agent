import { redactSecrets } from '../../execution/environment.js';
import type {
  KnowledgeHierarchyLevel,
  KnowledgeId,
  KnowledgeObject,
  KnowledgeQuery,
  KnowledgeQueryResult,
  KnowledgeRelation,
  MemoryPermissionContext,
} from '../contracts/types.js';
import type {
  AssembledKnowledgeContext,
  ContextAssemblyRequest,
  IKnowledgeOptimizationEngine,
} from '../ports/knowledge-optimization.js';
import type { IPKUStore } from '../ports/pku-store.js';
import { canReadKnowledgeObject } from '../registers/memory-client.js';

export interface KOEngineOptions {
  defaultTokenBudget?: number;
  minEvidenceCoverage?: number;
  customSecrets?: string[];
  enableProgressiveExpansion?: boolean;
}

export interface ShadowRetrievalComparison {
  task: string;
  koeContext: AssembledKnowledgeContext;
  legacyEstimatedTokens: number;
  koeEstimatedTokens: number;
  tokenCompressionRatio: number;
  evidenceCoverage: number;
  sufficient: boolean;
  latencyMs: number;
}

const HIERARCHY_PRIORITY: Record<KnowledgeHierarchyLevel, number> = {
  L0: 4,
  L1: 3,
  L2: 2,
  L3: 1,
};

/**
 * Estimates token count deterministically (~4 characters per token, minimum 1 for non-empty text).
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

/**
 * Extracts normalized search terms from a natural-language task or query string.
 */
function extractTaskKeywords(task: string): string[] {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'into',
    'please',
    'using',
    'based',
    'what',
    'how',
    'when',
    'where',
    'which',
    'dalam',
    'untuk',
    'yang',
    'dengan',
    'dari',
    'pada',
  ]);
  return Array.from(
    new Set(
      task
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !stopWords.has(t))
    )
  );
}

/**
 * Knowledge Optimization Engine (Phase 6 — Spec v0.2 §2.4 & §8, PKU-012, PKU-013, PKU-009).
 *
 * Responsibilities:
 * - Hierarchical retrieval (L0 -> L1 -> L2 -> L3)
 * - Permission-enforced knowledge graph traversal
 * - Task-aware & progressive retrieval
 * - Version-aware retrieval & stale compiled summary refresh from raw evidence (PKU-013)
 * - Evidence-grounded context assembly with token budget optimization & sufficiency evaluation (PKU-012)
 */
export class KnowledgeOptimizationEngine implements IKnowledgeOptimizationEngine {
  private readonly pkuStore: IPKUStore;
  private readonly defaultTokenBudget: number;
  private readonly minEvidenceCoverage: number;
  private readonly customSecrets: string[];
  private readonly enableProgressiveExpansion: boolean;

  constructor(pkuStore: IPKUStore, options: KOEngineOptions = {}) {
    this.pkuStore = pkuStore;
    this.defaultTokenBudget = options.defaultTokenBudget ?? 2048;
    this.minEvidenceCoverage = options.minEvidenceCoverage ?? 1.0;
    this.customSecrets = options.customSecrets ?? [];
    this.enableProgressiveExpansion = options.enableProgressiveExpansion ?? true;
  }

  private hasValidEvidence(obj: KnowledgeObject): boolean {
    const prov = obj.provenance;
    if (!prov || !prov.sourceSystem || !prov.sourceType) {
      return false;
    }
    return Boolean(
      (prov.sourceId && prov.sourceId.trim().length > 0) ||
        (prov.sourcePath && prov.sourcePath.trim().length > 0) ||
        (prov.contentHash && prov.contentHash.trim().length > 0)
    );
  }

  private formatEvidenceCitation(obj: KnowledgeObject): string {
    const prov = obj.provenance;
    const locator = prov.sourcePath ?? prov.sourceId ?? obj.id;
    return `${prov.sourceSystem}:${prov.sourceType}:${locator}@v${obj.version}`;
  }

  /**
   * Checks whether `candidate` is a stale compiled summary relative to its underlying
   * source/raw evidence objects or a superseding object (`PKU-013`).
   */
  private async detectAndRefreshStaleSummary(
    candidate: KnowledgeObject,
    permission: MemoryPermissionContext
  ): Promise<{
    isStale: boolean;
    replacementObjects: KnowledgeObject[];
    reason?: string;
  }> {
    const replacements: KnowledgeObject[] = [];
    const reasons: string[] = [];

    // Case 1: Explicitly marked superseded
    if (candidate.validationStatus === 'superseded') {
      reasons.push(`Object "${candidate.id}" has validationStatus="superseded"`);
    }

    // Case 2: Inspect relations (`derived_from`, `supersedes`) if store supports `getRelations`
    if (this.pkuStore.getRelations) {
      const relations = await this.pkuStore.getRelations(candidate.id);
      for (const rel of relations) {
        // Another object supersedes this candidate (`fromId` supersedes `candidate.id`)
        if (rel.relationType === 'supersedes' && rel.toId === candidate.id) {
          const newer = await this.pkuStore.getKnowledge(rel.fromId);
          if (newer && newer.lifecycleStatus === 'active' && canReadKnowledgeObject(newer, permission)) {
            reasons.push(`Superseded by "${newer.id}" (v${newer.version})`);
            replacements.push(newer);
          }
        }

        // Candidate is a summary derived from raw evidence (`candidate.id` derived_from `toId`)
        if (rel.relationType === 'derived_from' && rel.fromId === candidate.id && rel.toId !== candidate.id) {
          const rawEvidence = await this.pkuStore.getKnowledge(rel.toId);
          if (rawEvidence && canReadKnowledgeObject(rawEvidence, permission)) {
            const compiledSourceVersion =
              typeof candidate.metadata?.['compiledFromSourceVersion'] === 'number'
                ? (candidate.metadata['compiledFromSourceVersion'] as number)
                : typeof rel.metadata?.['sourceVersion'] === 'number'
                  ? (rel.metadata['sourceVersion'] as number)
                  : undefined;

            const isVersionBehind =
              compiledSourceVersion !== undefined && rawEvidence.version > compiledSourceVersion;
            const isTimestampBehind =
              new Date(rawEvidence.updatedAt).getTime() > new Date(candidate.updatedAt).getTime();

            if (isVersionBehind || isTimestampBehind) {
              reasons.push(
                `Stale summary relative to raw evidence "${rawEvidence.id}" (evidence v${rawEvidence.version} updated ${rawEvidence.updatedAt} vs summary v${candidate.version} updated ${candidate.updatedAt})`
              );
              replacements.push(rawEvidence);
            }
          }
        }
      }
    }

    // Case 3: Check explicit `metadata.sourceEvidenceIds` and `metadata.compiledFromSourceVersion`
    const sourceEvidenceIds = Array.isArray(candidate.metadata?.['sourceEvidenceIds'])
      ? (candidate.metadata?.['sourceEvidenceIds'] as string[])
      : [];
    const compiledVersion =
      typeof candidate.metadata?.['compiledFromSourceVersion'] === 'number'
        ? (candidate.metadata['compiledFromSourceVersion'] as number)
        : undefined;

    for (const rawId of sourceEvidenceIds) {
      const rawObj = await this.pkuStore.getKnowledge(rawId);
      if (!rawObj || !canReadKnowledgeObject(rawObj, permission)) {
        continue;
      }
      const isVersionBehind = compiledVersion !== undefined && rawObj.version > compiledVersion;
      const isTimestampBehind =
        new Date(rawObj.updatedAt).getTime() > new Date(candidate.updatedAt).getTime();

      if (isVersionBehind || isTimestampBehind) {
        if (!replacements.some((r) => r.id === rawObj.id)) {
          reasons.push(
            `Metadata sourceEvidence "${rawObj.id}" has newer version/timestamp (v${rawObj.version})`
          );
          replacements.push(rawObj);
        }
      }
    }

    return {
      isStale: reasons.length > 0,
      replacementObjects: replacements,
      ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    };
  }

  /**
   * Computes a relevance score for `obj` given task keywords.
   */
  private scoreObjectRelevance(obj: KnowledgeObject, keywords: string[]): number {
    const levelBoost = obj.hierarchyLevel ? (HIERARCHY_PRIORITY[obj.hierarchyLevel] ?? 2) * 0.5 : 1;
    if (keywords.length === 0) {
      return 1 + levelBoost;
    }

    const titleLower = (obj.title ?? '').toLowerCase();
    const summaryLower = (obj.summary ?? '').toLowerCase();
    const typeLower = obj.type.toLowerCase();
    const tagsLower = (obj.tags ?? []).map((t) => t.toLowerCase());
    const contentLower = JSON.stringify(obj.content ?? '').toLowerCase();

    let matchScore = 0;
    for (const kw of keywords) {
      if (titleLower.includes(kw)) matchScore += 4;
      if (tagsLower.some((t) => t.includes(kw))) matchScore += 3;
      if (summaryLower.includes(kw)) matchScore += 2.5;
      if (typeLower.includes(kw)) matchScore += 1.5;
      if (contentLower.includes(kw)) matchScore += 1;
    }

    return matchScore > 0 ? matchScore + levelBoost : 0;
  }

  /**
   * Executes permission-filtered, version-aware, hierarchical + graph retrieval (`IKnowledgeOptimizationEngine.retrieve`).
   */
  public async retrieve(
    query: KnowledgeQuery,
    permission: MemoryPermissionContext
  ): Promise<KnowledgeQueryResult> {
    const allowedUniverses = query.projectUniverseIds.filter((pmuId) =>
      permission.projectUniverseIds.includes(pmuId)
    );

    if (allowedUniverses.length === 0) {
      return {
        items: [],
        total: 0,
        evidenceCoverage: 1,
        traversedRelations: [],
      };
    }

    // Query underlying store without text restriction first if we want to do version refresh + keyword ranking,
    // or pass the query directly and post-filter by permission & version freshness.
    const rawResult = await this.pkuStore.queryKnowledge({
      ...query,
      projectUniverseIds: allowedUniverses,
      limit: undefined,
    });

    const authorizedItems: KnowledgeObject[] = [];
    const seenIds = new Set<KnowledgeId>();

    for (const item of rawResult.items) {
      if (!canReadKnowledgeObject(item, permission)) {
        continue;
      }

      const staleness = await this.detectAndRefreshStaleSummary(item, permission);
      if (staleness.isStale && staleness.replacementObjects.length > 0) {
        for (const replacement of staleness.replacementObjects) {
          if (!seenIds.has(replacement.id) && canReadKnowledgeObject(replacement, permission)) {
            seenIds.add(replacement.id);
            authorizedItems.push(replacement);
          }
        }
      } else if (!staleness.isStale && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        authorizedItems.push(item);
      }
    }

    // Filter by requiredEvidence if requested
    const evidenceFiltered = query.requiredEvidence
      ? authorizedItems.filter((item) => this.hasValidEvidence(item))
      : authorizedItems;

    // Sort by hierarchy level (L0 -> L1 -> L2 -> L3) then version desc then updatedAt desc
    evidenceFiltered.sort((a, b) => {
      const levelA = a.hierarchyLevel ? (HIERARCHY_PRIORITY[a.hierarchyLevel] ?? 0) : 0;
      const levelB = b.hierarchyLevel ? (HIERARCHY_PRIORITY[b.hierarchyLevel] ?? 0) : 0;
      if (levelA !== levelB) {
        return levelB - levelA;
      }
      if (a.version !== b.version) {
        return b.version - a.version;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    const total = evidenceFiltered.length;
    const limited =
      query.limit && query.limit > 0
        ? evidenceFiltered.slice(0, query.limit)
        : evidenceFiltered;

    const withEvidenceCount = limited.filter((item) => this.hasValidEvidence(item)).length;
    const evidenceCoverage = limited.length > 0 ? withEvidenceCount / limited.length : 1;

    const authorizedRelations: KnowledgeRelation[] = (rawResult.traversedRelations ?? []).filter(
      (rel) => seenIds.has(rel.fromId) || seenIds.has(rel.toId)
    );

    return {
      items: limited,
      total,
      evidenceCoverage,
      traversedRelations: authorizedRelations,
    };
  }

  /**
   * Formats a `KnowledgeObject` into an evidence-grounded markdown block at either
   * full detail (`compressed = false`) or compressed summary (`compressed = true`).
   */
  private renderKnowledgeEntry(obj: KnowledgeObject, compressed: boolean): string {
    const levelTag = obj.hierarchyLevel ? `[${obj.hierarchyLevel}] ` : '';
    const title = redactSecrets(obj.title ?? obj.id, this.customSecrets);
    const citation = this.formatEvidenceCitation(obj);

    let body = '';
    if (compressed && obj.summary) {
      body = redactSecrets(obj.summary.trim(), this.customSecrets);
    } else if (typeof obj.content === 'string') {
      body = redactSecrets(obj.content.trim(), this.customSecrets);
    } else if (obj.summary && compressed) {
      body = redactSecrets(obj.summary.trim(), this.customSecrets);
    } else {
      const rawJson = JSON.stringify(obj.content);
      const summaryPrefix = obj.summary ? `${obj.summary.trim()} — ` : '';
      body = redactSecrets(`${summaryPrefix}${rawJson}`, this.customSecrets);
    }

    return `- ${levelTag}**${title}** (id: \`${obj.id}\`, evidence: \`${citation}\`)\n  ${body}`;
  }

  /**
   * Assembles minimum sufficient, evidence-grounded context for a task within `request.tokenBudget`
   * (`PKU-012`, `PKU-013`, `PKU-008`, `PKU-009`).
   */
  public async assembleContext(
    request: ContextAssemblyRequest
  ): Promise<AssembledKnowledgeContext> {
    const startMs = Date.now();
    const tokenBudget = request.tokenBudget ?? this.defaultTokenBudget;
    const keywords = extractTaskKeywords(request.task);

    // 1. Retrieve all authorized active candidates across allowed PMUs
    const allowedUniverses = request.permission.projectUniverseIds.includes(
      request.identity.projectUniverseId
    )
      ? request.permission.projectUniverseIds
      : [request.identity.projectUniverseId, ...request.permission.projectUniverseIds];

    const rawQueryResult = await this.pkuStore.queryKnowledge({
      projectUniverseIds: allowedUniverses,
      relationTraversalDepth: 2,
      includeArchived: false,
    });

    const staleSummaryIds: string[] = [];
    const refreshedFromRawEvidenceIds: string[] = [];
    const staleReasons: Record<string, string> = {};
    const candidateMap = new Map<KnowledgeId, KnowledgeObject>();

    for (const item of rawQueryResult.items) {
      if (!canReadKnowledgeObject(item, request.permission)) {
        continue;
      }

      const staleness = await this.detectAndRefreshStaleSummary(item, request.permission);
      if (staleness.isStale) {
        staleSummaryIds.push(item.id);
        if (staleness.reason) {
          staleReasons[item.id] = staleness.reason;
        }
        for (const replacement of staleness.replacementObjects) {
          if (canReadKnowledgeObject(replacement, request.permission)) {
            candidateMap.set(replacement.id, replacement);
            if (!refreshedFromRawEvidenceIds.includes(replacement.id)) {
              refreshedFromRawEvidenceIds.push(replacement.id);
            }
          }
        }
      } else {
        candidateMap.set(item.id, item);
      }
    }

    // 2. Score and filter candidates by task relevance and evidence validity
    const scoredCandidates: Array<{ obj: KnowledgeObject; score: number }> = [];
    for (const obj of candidateMap.values()) {
      if (!this.hasValidEvidence(obj)) {
        continue;
      }
      const score = this.scoreObjectRelevance(obj, keywords);
      if (score > 0) {
        scoredCandidates.push({ obj, score });
      }
    }

    // Progressive expansion: if a high-level summary is selected and has linked L3 evidence,
    // also include its L3 evidence at lower priority so details are included if budget allows.
    if (this.enableProgressiveExpansion && this.pkuStore.getRelations) {
      const currentIds = new Set(scoredCandidates.map((c) => c.obj.id));
      for (const { obj, score } of [...scoredCandidates]) {
        if (obj.hierarchyLevel === 'L0' || obj.hierarchyLevel === 'L1' || obj.hierarchyLevel === 'L2') {
          const rels = await this.pkuStore.getRelations(obj.id);
          for (const rel of rels) {
            const neighborId = rel.fromId === obj.id ? rel.toId : rel.fromId;
            if (!currentIds.has(neighborId)) {
              const neighbor = await this.pkuStore.getKnowledge(neighborId);
              if (
                neighbor &&
                neighbor.lifecycleStatus === 'active' &&
                canReadKnowledgeObject(neighbor, request.permission) &&
                this.hasValidEvidence(neighbor)
              ) {
                currentIds.add(neighbor.id);
                scoredCandidates.push({
                  obj: neighbor,
                  score: Math.max(0.5, score * 0.75),
                });
              }
            }
          }
        }
      }
    }

    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const levelA = a.obj.hierarchyLevel ? (HIERARCHY_PRIORITY[a.obj.hierarchyLevel] ?? 0) : 0;
      const levelB = b.obj.hierarchyLevel ? (HIERARCHY_PRIORITY[b.obj.hierarchyLevel] ?? 0) : 0;
      if (levelA !== levelB) {
        return levelB - levelA;
      }
      return b.obj.version - a.obj.version;
    });

    // 3. Budget-constrained assembly with automatic summary compression fallback
    const selectedIds: string[] = [];
    const evidenceRefs: string[] = [];
    const blocks: string[] = [];
    let currentTokens = 0;
    let compressedCount = 0;
    let droppedForBudgetCount = 0;

    for (const { obj } of scoredCandidates) {
      const fullBlock = this.renderKnowledgeEntry(obj, false);
      const fullTokens = estimateTokens(fullBlock);

      if (currentTokens + fullTokens <= tokenBudget) {
        blocks.push(fullBlock);
        currentTokens += fullTokens;
        selectedIds.push(obj.id);
        evidenceRefs.push(this.formatEvidenceCitation(obj));
        continue;
      }

      // Try compressed summary block if full block exceeds remaining token budget
      const compressedBlock = this.renderKnowledgeEntry(obj, true);
      const compressedTokens = estimateTokens(compressedBlock);

      if (currentTokens + compressedTokens <= tokenBudget) {
        blocks.push(compressedBlock);
        currentTokens += compressedTokens;
        selectedIds.push(obj.id);
        evidenceRefs.push(this.formatEvidenceCitation(obj));
        compressedCount++;
        continue;
      }

      droppedForBudgetCount++;
    }

    const evidenceCoverage = selectedIds.length > 0 ? evidenceRefs.length / selectedIds.length : 0;
    const sufficient =
      selectedIds.length > 0 &&
      currentTokens <= tokenBudget &&
      evidenceCoverage >= this.minEvidenceCoverage;

    let finalText = blocks.join('\n');
    let legacyFallbackUsed = false;
    let insufficiencyReason: string | undefined;

    if (!sufficient) {
      if (scoredCandidates.length === 0) {
        insufficiencyReason = 'No task-relevant evidence-backed knowledge objects found in authorized PMUs.';
      } else if (selectedIds.length === 0 && droppedForBudgetCount > 0) {
        insufficiencyReason = `Token budget (${tokenBudget}) is too small to fit any of the ${scoredCandidates.length} matching evidence-backed knowledge objects.`;
      } else {
        insufficiencyReason = 'Insufficient evidence coverage for the assembled context.';
      }

      // Gate 5 rule: never silently remove legacy context when KOE context is insufficient
      if (request.legacyFallback && request.legacyFallback.trim().length > 0) {
        const sanitizedFallback = redactSecrets(request.legacyFallback, this.customSecrets);
        if (estimateTokens(sanitizedFallback) <= tokenBudget || finalText.length === 0) {
          finalText = sanitizedFallback;
          currentTokens = estimateTokens(finalText);
          legacyFallbackUsed = true;
        }
      }
    }

    const latencyMs = Math.max(0, Date.now() - startMs);

    return {
      text: finalText,
      knowledgeIds: selectedIds,
      evidenceRefs,
      estimatedTokens: currentTokens,
      sufficient,
      retrievalDiagnostics: {
        tokenBudget,
        candidateCount: scoredCandidates.length,
        selectedCount: selectedIds.length,
        compressedCount,
        droppedForBudgetCount,
        evidenceCoverage,
        staleSummaryIds,
        refreshedFromRawEvidenceIds,
        staleReasons,
        legacyFallbackUsed,
        ...(insufficiencyReason ? { insufficiencyReason } : {}),
        latencyMs,
      },
    };
  }

  /**
   * Gate 5 Shadow Retrieval Benchmark helper: assembles KOE candidate context
   * and compares token footprint, evidence coverage, and latency against legacy context
   * without mutating active prompts.
   */
  public async compareShadowContext(
    request: ContextAssemblyRequest,
    legacyPromptContext: string
  ): Promise<ShadowRetrievalComparison> {
    const startMs = Date.now();
    const koeContext = await this.assembleContext({
      ...request,
      legacyFallback: undefined,
    });
    const latencyMs = Math.max(0, Date.now() - startMs);
    const legacyEstimatedTokens = estimateTokens(legacyPromptContext);
    const koeEstimatedTokens = koeContext.estimatedTokens;
    const tokenCompressionRatio =
      legacyEstimatedTokens > 0
        ? Number((koeEstimatedTokens / legacyEstimatedTokens).toFixed(4))
        : 1;
    const evidenceCoverage =
      typeof koeContext.retrievalDiagnostics['evidenceCoverage'] === 'number'
        ? (koeContext.retrievalDiagnostics['evidenceCoverage'] as number)
        : 0;

    return {
      task: request.task,
      koeContext,
      legacyEstimatedTokens,
      koeEstimatedTokens,
      tokenCompressionRatio,
      evidenceCoverage,
      sufficient: koeContext.sufficient,
      latencyMs,
    };
  }
}
