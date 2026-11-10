import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, ensureDir, pathExists } from '../../core/fs-utils.js';
import type { LegacySessionExportBundle } from '../bridges/legacy-blackboard-bridge.js';
import { computeContentHash, deriveIdempotencyKey } from '../contracts/identity.js';
import type {
  KnowledgeObject,
  KnowledgeRelation,
  KnowledgeTreeNode,
  MemoryEvent,
  ProjectMemoryUniverse,
  RegisterSnapshot,
} from '../contracts/types.js';
import type { IPKUStore } from '../ports/pku-store.js';
import type { IRegisterPersistence } from '../ports/registers.js';

export type OutboxOperationKind =
  | 'create_universe'
  | 'put_tree_node'
  | 'put_knowledge'
  | 'put_relation'
  | 'append_event'
  | 'save_snapshot';

export interface OutboxEntry {
  idempotencyKey: string;
  operation: OutboxOperationKind;
  payload: unknown;
  status: 'pending' | 'completed' | 'failed';
  attempts: number;
  lastError?: string;
  updatedAt: string;
}

/**
 * Durable Outbox Queue for replay-safe PKU writes and interrupted batch recovery (PKU-018).
 */
export class DurableOutboxQueue {
  private readonly entries = new Map<string, OutboxEntry>();
  private readonly filePath?: string;

  constructor(filePath?: string) {
    this.filePath = filePath;
  }

  public async load(): Promise<void> {
    if (!this.filePath || !(await pathExists(this.filePath))) {
      return;
    }
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf-8')) as OutboxEntry[];
      for (const item of raw) {
        this.entries.set(item.idempotencyKey, item);
      }
    } catch {
      // Ignore corrupt/empty outbox file on load
    }
  }

  public async flushToDisk(): Promise<void> {
    if (!this.filePath) return;
    await ensureDir(path.dirname(this.filePath));
    await atomicWriteJson(this.filePath, Array.from(this.entries.values()));
  }

  public enqueue(idempotencyKey: string, operation: OutboxOperationKind, payload: unknown): void {
    const existing = this.entries.get(idempotencyKey);
    if (existing && existing.status === 'completed') {
      return;
    }
    this.entries.set(idempotencyKey, {
      idempotencyKey,
      operation,
      payload,
      status: existing?.status ?? 'pending',
      attempts: existing?.attempts ?? 0,
      lastError: existing?.lastError,
      updatedAt: new Date().toISOString(),
    });
  }

  public getPendingAndFailed(): OutboxEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.status !== 'completed');
  }

  public getAll(): OutboxEntry[] {
    return Array.from(this.entries.values());
  }

  public markCompleted(idempotencyKey: string): void {
    const entry = this.entries.get(idempotencyKey);
    if (entry) {
      entry.status = 'completed';
      entry.attempts += 1;
      entry.lastError = undefined;
      entry.updatedAt = new Date().toISOString();
    }
  }

  public markFailed(idempotencyKey: string, error: string): void {
    const entry = this.entries.get(idempotencyKey);
    if (entry) {
      entry.status = 'failed';
      entry.attempts += 1;
      entry.lastError = error;
      entry.updatedAt = new Date().toISOString();
    }
  }
}

export interface ShadowIngestionOptions {
  /**
   * Simulates an interrupted migration batch after executing N operations (PKU-018 test hook).
   */
  stopAfterOperations?: number;
}

export interface ShadowIngestionResult {
  sessionId: string;
  migrationBatchId: string;
  completed: boolean;
  operationsExecuted: number;
  pendingOutboxCount: number;
  createdKnowledgeCount: number;
  replayedKnowledgeCount: number;
}

/**
 * Shadow Ingestion Service (Phase 3 — Gate 3, PKU-002, PKU-018).
 *
 * Ingests a `LegacySessionExportBundle` into `IPKUStore & IRegisterPersistence`
 * via a durable outbox queue using deterministic idempotency keys.
 * Legacy Blackboard remains 100% authoritative for live coordination.
 */
export class ShadowIngestionService {
  private readonly store: IPKUStore & IRegisterPersistence;
  private readonly outbox: DurableOutboxQueue;

  constructor(store: IPKUStore & IRegisterPersistence, outbox?: DurableOutboxQueue) {
    this.store = store;
    this.outbox = outbox ?? new DurableOutboxQueue();
  }

  public getOutbox(): DurableOutboxQueue {
    return this.outbox;
  }

  /**
   * Stages all records from a `LegacySessionExportBundle` into the outbox and executes them.
   * Safe to call repeatedly or resume after an interrupted batch (`PKU-018`).
   */
  public async ingestExportBundle(
    bundle: LegacySessionExportBundle,
    options: ShadowIngestionOptions = {}
  ): Promise<ShadowIngestionResult> {
    await this.outbox.load();

    // 1. Stage universes
    for (const u of bundle.projectUniverses) {
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.blackboard',
        scopeId: bundle.sessionId,
        sourceType: 'ProjectMemoryUniverse',
        sourceRecordId: u.id,
        contentHash: computeContentHash(u),
      });
      this.outbox.enqueue(idemKey, 'create_universe', u);
    }

    // 2. Stage tree nodes
    for (const node of bundle.treeNodes) {
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.blackboard',
        scopeId: bundle.sessionId,
        sourceType: 'KnowledgeTreeNode',
        sourceRecordId: node.nodeId,
        contentHash: computeContentHash(node),
      });
      this.outbox.enqueue(idemKey, 'put_tree_node', node);
    }

    // 3. Stage knowledge objects
    for (const ko of bundle.knowledgeObjects) {
      const idemKey = deriveIdempotencyKey({
        sourceSystem: ko.provenance.sourceSystem,
        scopeId: bundle.sessionId,
        sourceType: `KnowledgeObject:${ko.type}`,
        sourceRecordId: ko.id,
        contentHash: ko.provenance.contentHash ?? computeContentHash(ko.content),
      });
      this.outbox.enqueue(idemKey, 'put_knowledge', ko);
    }

    // 4. Stage graph relations
    for (const rel of bundle.relations) {
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.blackboard',
        scopeId: bundle.sessionId,
        sourceType: 'KnowledgeRelation',
        sourceRecordId: rel.relationId,
        contentHash: computeContentHash(rel),
      });
      this.outbox.enqueue(idemKey, 'put_relation', rel);
    }

    // 5. Stage memory events
    for (const evt of bundle.memoryEvents) {
      this.outbox.enqueue(evt.idempotencyKey, 'append_event', evt);
    }

    // 6. Stage global and individual register snapshots
    const globalSnapIdem = deriveIdempotencyKey({
      sourceSystem: 'almudaya.blackboard',
      scopeId: bundle.sessionId,
      sourceType: 'RegisterSnapshot.Global',
      sourceRecordId: bundle.globalRegisterSnapshot.id,
      contentHash: bundle.globalRegisterSnapshot.sourceRevision,
    });
    this.outbox.enqueue(globalSnapIdem, 'save_snapshot', bundle.globalRegisterSnapshot);

    for (const indSnap of bundle.individualRegisterSnapshots) {
      const indSnapIdem = deriveIdempotencyKey({
        sourceSystem: 'almudaya.blackboard',
        scopeId: bundle.sessionId,
        sourceType: 'RegisterSnapshot.Individual',
        sourceRecordId: indSnap.id,
        contentHash: indSnap.sourceRevision,
      });
      this.outbox.enqueue(indSnapIdem, 'save_snapshot', indSnap);
    }

    await this.outbox.flushToDisk();

    return await this.drainOutbox(bundle.sessionId, bundle.migrationBatchId, options);
  }

  /**
   * Executes pending/failed outbox entries against the PKU store.
   */
  public async drainOutbox(
    sessionId: string,
    migrationBatchId: string,
    options: ShadowIngestionOptions = {}
  ): Promise<ShadowIngestionResult> {
    const pending = this.outbox.getPendingAndFailed();
    let operationsExecuted = 0;
    let createdKnowledgeCount = 0;
    let replayedKnowledgeCount = 0;

    for (const entry of pending) {
      if (
        options.stopAfterOperations !== undefined &&
        operationsExecuted >= options.stopAfterOperations
      ) {
        await this.outbox.flushToDisk();
        return {
          sessionId,
          migrationBatchId,
          completed: false,
          operationsExecuted,
          pendingOutboxCount: this.outbox.getPendingAndFailed().length,
          createdKnowledgeCount,
          replayedKnowledgeCount,
        };
      }

      try {
        switch (entry.operation) {
          case 'create_universe':
            await this.store.createUniverse(entry.payload as ProjectMemoryUniverse);
            break;
          case 'put_tree_node':
            if (this.store.putTreeNode) {
              await this.store.putTreeNode(
                entry.payload as KnowledgeTreeNode,
                entry.idempotencyKey
              );
            }
            break;
          case 'put_knowledge': {
            const res = await this.store.putKnowledge(
              entry.payload as KnowledgeObject,
              entry.idempotencyKey
            );
            if (res.created) {
              createdKnowledgeCount++;
            } else if (res.idempotentReplay) {
              replayedKnowledgeCount++;
            }
            break;
          }
          case 'put_relation':
            await this.store.putRelation(
              entry.payload as KnowledgeRelation,
              entry.idempotencyKey
            );
            break;
          case 'append_event':
            await this.store.appendEvent(entry.payload as MemoryEvent, entry.idempotencyKey);
            break;
          case 'save_snapshot':
            await this.store.saveSnapshot(
              entry.payload as RegisterSnapshot,
              entry.idempotencyKey
            );
            break;
        }

        this.outbox.markCompleted(entry.idempotencyKey);
        operationsExecuted++;
      } catch (err: unknown) {
        this.outbox.markFailed(entry.idempotencyKey, (err as Error).message);
        await this.outbox.flushToDisk();
        throw err;
      }
    }

    await this.outbox.flushToDisk();
    return {
      sessionId,
      migrationBatchId,
      completed: this.outbox.getPendingAndFailed().length === 0,
      operationsExecuted,
      pendingOutboxCount: this.outbox.getPendingAndFailed().length,
      createdKnowledgeCount,
      replayedKnowledgeCount,
    };
  }
}

export interface ShadowReconciliationReport {
  sessionId: string;
  migrationBatchId: string;
  checkedAt: string;
  counts: {
    expectedUniverses: number;
    actualUniverses: number;
    expectedKnowledgeObjects: number;
    actualKnowledgeObjects: number;
    expectedMemoryEvents: number;
    actualMemoryEvents: number;
    expectedSnapshots: number;
    actualSnapshots: number;
  };
  duplicateIds: string[];
  hashMismatches: string[];
  orderingPreserved: boolean;
  ownershipMismatches: string[];
  danglingRelations: string[];
  scopeMismatches: string[];
  quarantinedCount: number;
  reconciled: boolean;
}

/**
 * Shadow Reconciliation Service (Phase 3 — Gate 3, ROLLBACK_AND_RECONCILIATION.md).
 *
 * Verifies count parity, stable-ID uniqueness, content hash equality, event ordering,
 * ownership mapping, relationship target existence, and scope parity between a
 * `LegacySessionExportBundle` and the populated `IPKUStore & IRegisterPersistence`.
 */
export class ShadowReconciliationService {
  private readonly store: IPKUStore & IRegisterPersistence;

  constructor(store: IPKUStore & IRegisterPersistence) {
    this.store = store;
  }

  public async reconcile(
    bundle: LegacySessionExportBundle
  ): Promise<ShadowReconciliationReport> {
    const checkedAt = new Date().toISOString();
    const universeIds = bundle.projectUniverses.map((u) => u.id);

    const actualUniverses = await this.store.listUniverses();
    const matchedUniverses = actualUniverses.filter((u) => universeIds.includes(u.id));

    const queryRes = await this.store.queryKnowledge({
      projectUniverseIds: universeIds,
      includeArchived: true,
      limit: 1000,
    });
    const actualObjects = queryRes.items;
    const actualById = new Map(actualObjects.map((o) => [o.id, o]));

    const duplicateIds: string[] = [];
    const seenIds = new Set<string>();
    for (const obj of actualObjects) {
      if (seenIds.has(obj.id)) {
        duplicateIds.push(obj.id);
      }
      seenIds.add(obj.id);
    }

    const hashMismatches: string[] = [];
    const ownershipMismatches: string[] = [];
    const scopeMismatches: string[] = [];

    for (const expectedKo of bundle.knowledgeObjects) {
      const actualKo = actualById.get(expectedKo.id);
      if (!actualKo) {
        hashMismatches.push(`Missing KnowledgeObject: ${expectedKo.id}`);
        continue;
      }
      const expectedHash = computeContentHash(expectedKo.content);
      const actualHash = computeContentHash(actualKo.content);
      if (expectedHash !== actualHash) {
        hashMismatches.push(expectedKo.id);
      }
      if (expectedKo.ownerId !== actualKo.ownerId) {
        ownershipMismatches.push(expectedKo.id);
      }
      if (expectedKo.scope !== actualKo.scope) {
        scopeMismatches.push(expectedKo.id);
      }
    }

    // Check relations target existence
    const danglingRelations: string[] = [];
    for (const rel of bundle.relations) {
      if (!actualById.has(rel.fromId) || !actualById.has(rel.toId)) {
        danglingRelations.push(rel.relationId);
      }
    }

    // Check events across universes
    let actualEvents: MemoryEvent[] = [];
    if (this.store.listEvents) {
      for (const uid of universeIds) {
        const evts = await this.store.listEvents(uid);
        actualEvents.push(...evts);
      }
    }
    const seenEvtIds = new Set<string>();
    for (const e of actualEvents) {
      if (seenEvtIds.has(e.id)) {
        duplicateIds.push(e.id);
      }
      seenEvtIds.add(e.id);
    }

    // Verify event ordering for broadcast & work_log events
    const expectedEvtIds = bundle.memoryEvents.map((e) => e.id);
    const actualEvtIds = actualEvents.map((e) => e.id);
    const orderingPreserved =
      expectedEvtIds.length === actualEvtIds.length &&
      expectedEvtIds.every((id, idx) => actualEvtIds[idx] === id);

    // Check snapshots
    let actualSnapshots = 0;
    const globalSnap = await this.store.loadSnapshot(bundle.globalRegisterSnapshot.identity);
    if (globalSnap) actualSnapshots++;
    for (const ind of bundle.individualRegisterSnapshots) {
      const snap = await this.store.loadSnapshot(ind.identity);
      if (snap) actualSnapshots++;
    }
    const expectedSnapshots = 1 + bundle.individualRegisterSnapshots.length;

    const countsMatch =
      matchedUniverses.length === bundle.projectUniverses.length &&
      actualObjects.length === bundle.knowledgeObjects.length &&
      actualEvents.length === bundle.memoryEvents.length &&
      actualSnapshots === expectedSnapshots;

    const reconciled =
      countsMatch &&
      duplicateIds.length === 0 &&
      hashMismatches.length === 0 &&
      orderingPreserved &&
      ownershipMismatches.length === 0 &&
      danglingRelations.length === 0 &&
      scopeMismatches.length === 0;

    return {
      sessionId: bundle.sessionId,
      migrationBatchId: bundle.migrationBatchId,
      checkedAt,
      counts: {
        expectedUniverses: bundle.projectUniverses.length,
        actualUniverses: matchedUniverses.length,
        expectedKnowledgeObjects: bundle.knowledgeObjects.length,
        actualKnowledgeObjects: actualObjects.length,
        expectedMemoryEvents: bundle.memoryEvents.length,
        actualMemoryEvents: actualEvents.length,
        expectedSnapshots,
        actualSnapshots,
      },
      duplicateIds,
      hashMismatches,
      orderingPreserved,
      ownershipMismatches,
      danglingRelations,
      scopeMismatches,
      quarantinedCount: bundle.quarantinedRecords.length,
      reconciled,
    };
  }
}
