import { describe, expect, it } from 'vitest';
import {
  InMemoryPKUStore,
  ProjectMemoryUniverseService,
  STANDARD_ARCHITECTURE_SUBDOMAINS,
  STANDARD_PMU_TOP_DOMAINS,
} from '../../src/memory_modules/index.js';

describe('Phase 7: Project Memory Universe (PMU), Hierarchical Tree & Knowledge Graph Operations (PKU-014, PKU-015)', () => {
  it('PKU-014: isolates two Project Memory Universes even when identical local record IDs and types are used', async () => {
    const store = new InMemoryPKUStore();
    const pmuService = new ProjectMemoryUniverseService(store);

    const { universe: pmuAlpha, treeNodes: alphaNodes } = await pmuService.createProjectUniverse({
      projectKey: 'project-alpha',
      displayName: 'Project Alpha',
      description: 'First payment gateway service',
    });

    const { universe: pmuBeta, treeNodes: betaNodes } = await pmuService.createProjectUniverse({
      projectKey: 'project-beta',
      displayName: 'Project Beta',
      description: 'Second analytics service',
    });

    expect(pmuAlpha.id).not.toBe(pmuBeta.id);
    expect(alphaNodes).toHaveLength(
      STANDARD_PMU_TOP_DOMAINS.length + STANDARD_ARCHITECTURE_SUBDOMAINS.length
    );
    expect(betaNodes).toHaveLength(
      STANDARD_PMU_TOP_DOMAINS.length + STANDARD_ARCHITECTURE_SUBDOMAINS.length
    );

    // Both projects insert a requirement with the exact same localRecordId ('REQ-AUTH-001') and type ('requirement.spec')
    const alphaReq = await pmuService.putProjectKnowledge({
      projectUniverseId: pmuAlpha.id,
      localRecordId: 'REQ-AUTH-001',
      type: 'requirement.spec',
      title: 'Alpha Auth Requirement',
      content: { authType: 'mTLS', project: 'alpha' },
      domainPaths: ['Requirements'],
    });

    const betaReq = await pmuService.putProjectKnowledge({
      projectUniverseId: pmuBeta.id,
      localRecordId: 'REQ-AUTH-001',
      type: 'requirement.spec',
      title: 'Beta Auth Requirement',
      content: { authType: 'OAuth2', project: 'beta' },
      domainPaths: ['Requirements'],
    });

    // Deterministic IDs are scoped by PMU ID, so they never collide (PKU-014)
    expect(alphaReq.id).not.toBe(betaReq.id);

    // Querying PMU Alpha never returns PMU Beta objects
    const alphaQuery = await store.queryKnowledge({
      projectUniverseIds: [pmuAlpha.id],
      types: ['requirement.spec'],
    });
    expect(alphaQuery.items).toHaveLength(1);
    expect(alphaQuery.items[0]?.id).toBe(alphaReq.id);
    expect(alphaQuery.items[0]?.content).toEqual({ authType: 'mTLS', project: 'alpha' });

    // Querying PMU Beta never returns PMU Alpha objects
    const betaQuery = await store.queryKnowledge({
      projectUniverseIds: [pmuBeta.id],
      types: ['requirement.spec'],
    });
    expect(betaQuery.items).toHaveLength(1);
    expect(betaQuery.items[0]?.id).toBe(betaReq.id);
    expect(betaQuery.items[0]?.content).toEqual({ authType: 'OAuth2', project: 'beta' });
  });

  it('PKU-015: pruning a hierarchical tree branch detaches branch membership without deleting or breaking shared graph nodes', async () => {
    const store = new InMemoryPKUStore();
    const pmuService = new ProjectMemoryUniverseService(store);

    const { universe } = await pmuService.createProjectUniverse({
      projectKey: 'project-shared-graph',
      displayName: 'Shared Graph Project',
    });

    // 1. Create a shared component node attached to BOTH 'Experiments' and 'Architecture/Components'
    const sharedCryptoModule = await pmuService.putProjectKnowledge({
      projectUniverseId: universe.id,
      localRecordId: 'COMP-CRYPTO-CORE',
      type: 'arch.component',
      title: 'Shared Ed25519 Signature Verifier',
      content: { algorithm: 'Ed25519', curve: 'Curve25519' },
      domainPaths: ['Experiments', 'Architecture/Components'],
    });

    // 2. Create an interface node in 'Architecture/Interfaces' that depends_on the shared component in the Knowledge Graph
    const apiInterface = await pmuService.putProjectKnowledge({
      projectUniverseId: universe.id,
      localRecordId: 'IFACE-WEBHOOK-VERIFY',
      type: 'arch.interface',
      title: 'Webhook Verification Interface',
      content: { header: 'X-Signature-Ed25519' },
      domainPaths: ['Architecture/Interfaces'],
    });

    await pmuService.linkKnowledgeObjects({
      projectUniverseId: universe.id,
      fromId: apiInterface.id,
      toId: sharedCryptoModule.id,
      relationType: 'depends_on',
    });

    // 3. Create an experiment-only scratch node attached only to 'Experiments'
    const expOnlyNode = await pmuService.putProjectKnowledge({
      projectUniverseId: universe.id,
      localRecordId: 'EXP-BENCHMARK-01',
      type: 'experiment.log',
      title: 'Experimental Latency Benchmark',
      content: { p99Ms: 1.4 },
      domainPaths: ['Experiments'],
    });

    // Verify 'Experiments' branch initially contains both sharedCryptoModule and expOnlyNode
    const beforePruneExp = await store.queryKnowledge({
      projectUniverseIds: [universe.id],
      treeDomainPrefix: 'Experiments',
    });
    expect(beforePruneExp.items.map((i) => i.id)).toContain(sharedCryptoModule.id);
    expect(beforePruneExp.items.map((i) => i.id)).toContain(expOnlyNode.id);

    // 4. Prune the 'Experiments' tree branch (PKU-015)
    const pruneResult = await pmuService.pruneTreeBranch(universe.id, 'Experiments', 'ARCHITECT');
    expect(pruneResult.detachedKnowledgeIds).toContain(sharedCryptoModule.id);
    expect(pruneResult.detachedKnowledgeIds).toContain(expOnlyNode.id);
    expect(pruneResult.preservedSharedKnowledgeIds).toContain(sharedCryptoModule.id);

    // 5. 'Experiments' tree branch is now empty
    const afterPruneExp = await store.queryKnowledge({
      projectUniverseIds: [universe.id],
      treeDomainPrefix: 'Experiments',
    });
    expect(afterPruneExp.items).toHaveLength(0);

    // 6. CRITICAL (PKU-015): Shared node remains active in 'Architecture/Components' AND via graph traversal from 'Architecture/Interfaces'
    const archComponentsQuery = await store.queryKnowledge({
      projectUniverseIds: [universe.id],
      treeDomainPrefix: 'Architecture/Components',
    });
    expect(archComponentsQuery.items.map((i) => i.id)).toContain(sharedCryptoModule.id);

    const graphTraversalQuery = await store.queryKnowledge({
      projectUniverseIds: [universe.id],
      treeDomainPrefix: 'Architecture/Interfaces',
      relationTraversalDepth: 1,
    });
    expect(graphTraversalQuery.items.map((i) => i.id)).toContain(apiInterface.id);
    expect(graphTraversalQuery.items.map((i) => i.id)).toContain(sharedCryptoModule.id);
  });

  it('supports controlled cross-project knowledge reuse (reference & copy) and PMU forking with provenance lineage', async () => {
    const store = new InMemoryPKUStore();
    const pmuService = new ProjectMemoryUniverseService(store);

    const { universe: sourceUniverse } = await pmuService.createProjectUniverse({
      projectKey: 'core-platform-v1',
      displayName: 'Core Platform v1',
    });

    const { universe: targetUniverse } = await pmuService.createProjectUniverse({
      projectKey: 'billing-service-v1',
      displayName: 'Billing Service v1',
    });

    const reusablePattern = await pmuService.putProjectKnowledge({
      projectUniverseId: sourceUniverse.id,
      localRecordId: 'DEC-IDEMPOTENCY-OUTBOX',
      type: 'arch.decision',
      title: 'Transactional Outbox Pattern',
      summary: 'Use durable outbox for idempotent cross-service event publishing.',
      content: { pattern: 'transactional-outbox', retryBackoff: 'exponential' },
      domainPaths: ['Decisions'],
      reusable: true,
    });

    const privateInternalNote = await pmuService.putProjectKnowledge({
      projectUniverseId: sourceUniverse.id,
      localRecordId: 'INTERNAL-SEC-NOTE',
      type: 'internal.note',
      title: 'Non-Reusable Legacy Quirk',
      content: { note: 'Do not reuse outside core-platform-v1' },
      domainPaths: ['Development'],
      reusable: false,
    });

    // 1. Reusing a non-reusable object without override is rejected
    await expect(
      pmuService.reuseKnowledgeAcrossProjects({
        sourceUniverseId: sourceUniverse.id,
        targetUniverseId: targetUniverse.id,
        sourceKnowledgeIds: [privateInternalNote.id],
        requestedBy: 'BOT_ARCHITECT',
      })
    ).rejects.toThrow(/non-reusable/);

    // 2. Reusing the reusable decision in reference mode succeeds and links via 'reuses' relation
    const reuseRes = await pmuService.reuseKnowledgeAcrossProjects({
      sourceUniverseId: sourceUniverse.id,
      targetUniverseId: targetUniverse.id,
      sourceKnowledgeIds: [reusablePattern.id],
      mode: 'reference',
      targetTreeDomain: 'Decisions',
      requestedBy: 'BOT_ARCHITECT',
    });

    expect(reuseRes.reusedObjects).toHaveLength(1);
    expect(reuseRes.reusedObjects[0]?.projectUniverseId).toBe(targetUniverse.id);
    expect(reuseRes.reusedObjects[0]?.provenance.originProjectUniverseId).toBe(sourceUniverse.id);
    expect(reuseRes.relations[0]?.relationType).toBe('reuses');
    expect(reuseRes.relations[0]?.toId).toBe(reusablePattern.id);

    // 3. Forking sourceUniverse into a new PMU copies only reusable knowledge and preserves lineage
    const forkRes = await pmuService.forkProjectUniverse({
      sourceUniverseId: sourceUniverse.id,
      newProjectKey: 'core-platform-v2-fork',
      newDisplayName: 'Core Platform v2 Fork',
      onlyReusable: true,
      requestedBy: 'BOT_ARCHITECT',
    });

    expect(forkRes.universe.parentUniverseId).toBe(sourceUniverse.id);
    expect(forkRes.forkedKnowledgeCount).toBe(1);
    expect(forkRes.lineageRelations[0]?.relationType).toBe('derived_from');
    expect(forkRes.lineageRelations[0]?.toId).toBe(reusablePattern.id);

    // Mutating the forked universe does not affect sourceUniverse
    await pmuService.putProjectKnowledge({
      projectUniverseId: forkRes.universe.id,
      localRecordId: 'DEC-IDEMPOTENCY-OUTBOX',
      type: 'arch.decision',
      title: 'Transactional Outbox Pattern v2 (Fork Modified)',
      content: { pattern: 'transactional-outbox-v2', streaming: true },
      domainPaths: ['Decisions'],
    });

    const originalInSource = await store.getKnowledge(reusablePattern.id);
    expect(originalInSource?.title).toBe('Transactional Outbox Pattern');
    expect(originalInSource?.version).toBe(1);
  });
});
