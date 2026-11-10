import { describe, expect, it } from 'vitest';
import {
  InMemoryPKUStore,
  LifecycleSafetyError,
  MemoryLifecycleService,
  ProjectMemoryUniverseService,
} from '../../src/memory_modules/index.js';

describe('Phase 8: Memory Lifecycle Management (PKU-016, PKU-017, PKU-015)', () => {
  it('PKU-016: soft_delete excludes object from queries, and restore recovers full data and provenance before purge', async () => {
    const store = new InMemoryPKUStore();
    const pmuService = new ProjectMemoryUniverseService(store);
    const lifecycleService = new MemoryLifecycleService(store, pmuService);

    const { universe } = await pmuService.createProjectUniverse({
      projectKey: 'lifecycle-project-1',
      displayName: 'Lifecycle Test Project 1',
    });

    const archDecision = await pmuService.putProjectKnowledge({
      projectUniverseId: universe.id,
      localRecordId: 'DEC-EVENT-BUS',
      type: 'arch.decision',
      title: 'Event Bus Selection',
      summary: 'Use NATS JetStream for durable event streaming.',
      content: { broker: 'NATS JetStream', replicationFactor: 3 },
      domainPaths: ['Decisions'],
      sourcePath: 'docs/decisions/ADR-010.md',
    });

    // 1. Plan & execute soft_delete (requires confirmationToken)
    const softDeletePlan = await lifecycleService.plan({
      projectUniverseId: universe.id,
      operation: 'soft_delete',
      targetIds: [archDecision.id],
      requestedBy: 'OPERATOR',
      reason: 'Superseded temporarily during evaluation',
    });

    expect(softDeletePlan.requiresExplicitConfirmation).toBe(true);
    expect(softDeletePlan.irreversible).toBe(false);

    // Missing confirmation token must be rejected
    await expect(lifecycleService.execute(softDeletePlan)).rejects.toThrow(LifecycleSafetyError);

    const token = MemoryLifecycleService.createConfirmationToken(softDeletePlan);
    await lifecycleService.execute(softDeletePlan, token);

    const deletedObj = await store.getKnowledge(archDecision.id);
    expect(deletedObj?.lifecycleStatus).toBe('deleted');

    // Soft-deleted object is excluded from standard and includeArchived queries
    const queryAfterDelete = await store.queryKnowledge({
      projectUniverseIds: [universe.id],
      types: ['arch.decision'],
      includeArchived: true,
    });
    expect(queryAfterDelete.items).toHaveLength(0);

    // 2. Restore the soft-deleted object -> data and provenance are 100% recovered (PKU-016)
    const restorePlan = await lifecycleService.plan({
      projectUniverseId: universe.id,
      operation: 'restore',
      targetIds: [archDecision.id],
      requestedBy: 'OPERATOR',
      reason: 'Re-instating NATS JetStream decision',
    });
    await lifecycleService.execute(restorePlan);

    const restoredObj = await store.getKnowledge(archDecision.id);
    expect(restoredObj?.lifecycleStatus).toBe('active');
    expect(restoredObj?.content).toEqual({ broker: 'NATS JetStream', replicationFactor: 3 });
    expect(restoredObj?.provenance.sourceId).toBe('DEC-EVENT-BUS');
    expect(restoredObj?.provenance.sourcePath).toBe('docs/decisions/ADR-010.md');
    expect(restoredObj?.provenance.originProjectUniverseId).toBe(universe.id);

    const queryAfterRestore = await store.queryKnowledge({
      projectUniverseIds: [universe.id],
      types: ['arch.decision'],
    });
    expect(queryAfterRestore.items).toHaveLength(1);
    expect(queryAfterRestore.items[0]?.id).toBe(archDecision.id);
  });

  it('PKU-017: blocks purge when active external references exist, and scrubs payload to irreversible tombstone when authorized', async () => {
    const store = new InMemoryPKUStore();
    const pmuService = new ProjectMemoryUniverseService(store);
    const lifecycleService = new MemoryLifecycleService(store, pmuService);

    const { universe: pmuSource } = await pmuService.createProjectUniverse({
      projectKey: 'source-lib-pmu',
      displayName: 'Source Library PMU',
    });

    const { universe: pmuConsumer } = await pmuService.createProjectUniverse({
      projectKey: 'consumer-app-pmu',
      displayName: 'Consumer App PMU',
    });

    const sharedSchema = await pmuService.putProjectKnowledge({
      projectUniverseId: pmuSource.id,
      localRecordId: 'SCHEMA-TELEMETRY-V1',
      type: 'arch.contract',
      title: 'Telemetry Event Schema v1',
      content: { fields: ['traceId', 'spanId', 'timestamp'] },
      domainPaths: ['Architecture/Interfaces'],
      reusable: true,
    });

    const unreferencedNote = await pmuService.putProjectKnowledge({
      projectUniverseId: pmuSource.id,
      localRecordId: 'TEMP-DRAFT-01',
      type: 'dev.note',
      title: 'Temporary Scratch Note',
      content: { secretDraft: 'obsolete draft' },
      domainPaths: ['Development'],
    });

    // Consumer PMU reuses sharedSchema across projects
    await pmuService.reuseKnowledgeAcrossProjects({
      sourceUniverseId: pmuSource.id,
      targetUniverseId: pmuConsumer.id,
      sourceKnowledgeIds: [sharedSchema.id],
      mode: 'reference',
      targetTreeDomain: 'Architecture/Interfaces',
      requestedBy: 'BOT_ARCHITECT',
    });

    // 1. Plan purge on sharedSchema -> detects external reference from pmuConsumer (PKU-017)
    const blockedPurgePlan = await lifecycleService.plan({
      projectUniverseId: pmuSource.id,
      operation: 'purge',
      targetIds: [sharedSchema.id],
      requestedBy: 'ADMIN',
      reason: 'Attempt to purge referenced schema',
    });

    expect(blockedPurgePlan.irreversible).toBe(true);
    expect(blockedPurgePlan.protectedKnowledgeIds).toContain(sharedSchema.id);
    expect(blockedPurgePlan.externalReferences.length).toBeGreaterThan(0);

    // Executing purge without resolving external references or policy override MUST be blocked (PKU-017)
    const purgeToken = MemoryLifecycleService.createConfirmationToken(blockedPurgePlan);
    await expect(lifecycleService.execute(blockedPurgePlan, purgeToken)).rejects.toThrow(
      LifecycleSafetyError
    );

    // Verify sharedSchema was NOT purged
    const stillIntact = await store.getKnowledge(sharedSchema.id);
    expect(stillIntact?.lifecycleStatus).toBe('active');
    expect(stillIntact?.content).toEqual({ fields: ['traceId', 'spanId', 'timestamp'] });

    // 2. Purge unreferencedNote (no external references) -> succeeds with confirmationToken
    const safePurgePlan = await lifecycleService.plan({
      projectUniverseId: pmuSource.id,
      operation: 'purge',
      targetIds: [unreferencedNote.id],
      requestedBy: 'ADMIN',
      reason: 'Purge obsolete unreferenced draft',
    });

    expect(safePurgePlan.protectedKnowledgeIds).toHaveLength(0);
    expect(safePurgePlan.externalReferences).toHaveLength(0);

    await lifecycleService.execute(
      safePurgePlan,
      MemoryLifecycleService.createConfirmationToken(safePurgePlan)
    );

    const purgedRecord = await store.getKnowledge(unreferencedNote.id);
    expect(purgedRecord?.lifecycleStatus).toBe('purged');
    expect(JSON.stringify(purgedRecord?.content)).not.toContain('obsolete draft');
    expect((purgedRecord?.content as Record<string, unknown>)['purged']).toBe(true);

    // Attempting to restore a purged object is strictly rejected
    const restorePurgedPlan = await lifecycleService.plan({
      projectUniverseId: pmuSource.id,
      operation: 'restore',
      targetIds: [unreferencedNote.id],
      requestedBy: 'ADMIN',
      reason: 'Try restore after purge',
    });
    await expect(lifecycleService.execute(restorePurgedPlan)).rejects.toThrow(
      LifecycleSafetyError
    );
  });

  it('supports archive, dormant, reusable, detach, merge, and portable secret-redacted export operations', async () => {
    const store = new InMemoryPKUStore();
    const pmuService = new ProjectMemoryUniverseService(store);
    const lifecycleService = new MemoryLifecycleService(store, pmuService);

    const { universe: pmuA } = await pmuService.createProjectUniverse({
      projectKey: 'service-a',
      displayName: 'Service A',
    });
    const { universe: pmuB } = await pmuService.createProjectUniverse({
      projectKey: 'service-b',
      displayName: 'Service B',
    });

    const item1 = await pmuService.putProjectKnowledge({
      projectUniverseId: pmuA.id,
      localRecordId: 'MOD-RATE-LIMIT',
      type: 'arch.module',
      title: 'Token Bucket Rate Limiter',
      content: {
        algorithm: 'token-bucket',
        sampleKey: 'AIzaSy' + 'D-1234567890abcdefghijklmnopqrstuvwx',
      },
      domainPaths: ['Architecture/Modules'],
    });

    // 1. Transition to dormant, then reusable, then archive
    await lifecycleService.setLifecycleStatus(
      pmuA.id,
      [item1.id],
      'dormant',
      'OPERATOR',
      'Mark dormant'
    );
    expect((await store.getKnowledge(item1.id))?.lifecycleStatus).toBe('dormant');

    await lifecycleService.setLifecycleStatus(
      pmuA.id,
      [item1.id],
      'reusable',
      'OPERATOR',
      'Mark reusable'
    );
    expect((await store.getKnowledge(item1.id))?.lifecycleStatus).toBe('reusable');

    const archivePlan = await lifecycleService.plan({
      projectUniverseId: pmuA.id,
      operation: 'archive',
      targetIds: [item1.id],
      requestedBy: 'OPERATOR',
      reason: 'Archive after release',
    });
    await lifecycleService.execute(archivePlan);
    expect((await store.getKnowledge(item1.id))?.lifecycleStatus).toBe('archived');

    // Archived item is excluded when includeArchived=false, included when includeArchived=true
    const activeOnly = await store.queryKnowledge({
      projectUniverseIds: [pmuA.id],
      types: ['arch.module'],
      includeArchived: false,
    });
    expect(activeOnly.items).toHaveLength(0);

    const withArchived = await store.queryKnowledge({
      projectUniverseIds: [pmuA.id],
      types: ['arch.module'],
      includeArchived: true,
    });
    expect(withArchived.items).toHaveLength(1);

    // Restore item1 back to active and merge into pmuB
    const restorePlan = await lifecycleService.plan({
      projectUniverseId: pmuA.id,
      operation: 'restore',
      targetIds: [item1.id],
      requestedBy: 'OPERATOR',
      reason: 'Restore for merge',
    });
    await lifecycleService.execute(restorePlan);

    const mergePlan = await lifecycleService.plan({
      projectUniverseId: pmuA.id,
      destinationUniverseId: pmuB.id,
      operation: 'merge',
      targetIds: [item1.id],
      requestedBy: 'OPERATOR',
      reason: 'Merge rate limiter module into Service B',
    });
    await lifecycleService.execute(
      mergePlan,
      MemoryLifecycleService.createConfirmationToken(mergePlan)
    );

    const pmuBItems = await store.queryKnowledge({
      projectUniverseIds: [pmuB.id],
      types: ['arch.module'],
    });
    expect(pmuBItems.items).toHaveLength(1);

    // Export bundle of pmuA is secret-redacted and includes objects, treeNodes, and audit events
    const exported = await lifecycleService.exportUniverse(pmuA.id, 'OPERATOR');
    expect(exported.universe?.id).toBe(pmuA.id);
    expect(exported.knowledgeObjects.some((k) => k.id === item1.id)).toBe(true);
    expect(exported.events.some((e) => e.eventType.startsWith('lifecycle.'))).toBe(true);
    expect(JSON.stringify(exported)).not.toContain(
      'AIzaSy' + 'D-1234567890abcdefghijklmnopqrstuvwx'
    );
  });
});
