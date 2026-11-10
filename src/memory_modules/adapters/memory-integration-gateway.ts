import { redactRecursively } from '../../execution/environment.js';
import {
  computeContentHash,
  deriveIdempotencyKey,
  deriveMemoryEventId,
} from '../contracts/identity.js';
import {
  validateKnowledgeObject,
} from '../contracts/schemas.js';
import type {
  KnowledgeId,
  KnowledgeObject,
  KnowledgeQuery,
  KnowledgeQueryResult,
  MemoryEvent,
  ProjectUniverseId,
} from '../contracts/types.js';
import { DurableOutboxQueue } from '../pku/shadow-ingestion.js';
import type {
  IExternalMemoryAdapter,
  MemoryAdapterCapabilities,
  MemoryAdapterManifest,
} from '../ports/external-adapter.js';
import type { IKnowledgeOptimizationEngine } from '../ports/knowledge-optimization.js';
import type { IMemoryLifecycleManager } from '../ports/lifecycle.js';
import type { IKnowledgeAwareMessagingBridge } from '../ports/messaging.js';
import type { IPKUStore } from '../ports/pku-store.js';
import type {
  IGlobalRegisterBridge,
  IIndividualRegisterBridge,
  IRegisterPersistence,
} from '../ports/registers.js';
import type {
  IMemoryIntegrationGateway,
  IUnifiedMemoryInterface,
} from '../ports/umi.js';

export class UnsupportedAdapterCapabilityError extends Error {
  public readonly code = 'UNSUPPORTED_ADAPTER_CAPABILITY';
  public readonly adapterId: string;
  public readonly capability: keyof MemoryAdapterCapabilities;

  constructor(adapterId: string, capability: keyof MemoryAdapterCapabilities) {
    super(`External adapter "${adapterId}" does not support capability "${capability}".`);
    this.name = 'UnsupportedAdapterCapabilityError';
    this.adapterId = adapterId;
    this.capability = capability;
  }
}

export interface IExtendedExternalMemoryAdapter extends IExternalMemoryAdapter {
  pushKnowledge?(object: KnowledgeObject, idempotencyKey: string): Promise<void>;
  pullKnowledge?(knowledgeId: KnowledgeId): Promise<KnowledgeObject | null>;
  searchExternal?(query: KnowledgeQuery): Promise<KnowledgeQueryResult>;
  exportBatch?(projectUniverseId: ProjectUniverseId): Promise<KnowledgeObject[]>;
  importBatch?(objects: KnowledgeObject[], idempotencyKeyPrefix: string): Promise<number>;
  deleteExternal?(knowledgeId: KnowledgeId): Promise<void>;
}

export interface AdapterWriteSyncResult {
  adapterId: string;
  knowledgeId: KnowledgeId;
  localCommitted: boolean;
  adapterSynced: boolean;
  degraded: boolean;
  queuedForRetry: boolean;
  unsupportedCapability?: keyof MemoryAdapterCapabilities;
  reason?: string;
}

export interface AdapterReadFallbackResult {
  adapterId: string;
  result: KnowledgeQueryResult;
  degraded: boolean;
  source: 'external_adapter' | 'local_pku_fallback';
  unsupportedCapability?: keyof MemoryAdapterCapabilities;
  reason?: string;
}

export interface AdapterReplayReport {
  adapterId: string;
  attemptedCount: number;
  replayedCount: number;
  remainingPendingCount: number;
}

/**
 * Reference External Memory Adapter implementation (Phase 9 — PKU-020).
 * Supports configurable capabilities, connection state, outage simulation, and idempotency.
 */
export class InMemoryExternalAdapter implements IExtendedExternalMemoryAdapter {
  private readonly adapterManifest: MemoryAdapterManifest;
  private connected: boolean = false;
  private simulatedFailureReason: string | null = null;
  private readonly store = new Map<KnowledgeId, KnowledgeObject>();
  private readonly idempotencyKeys = new Set<string>();
  private readonly customSecrets: string[];

  constructor(
    manifest?: Partial<MemoryAdapterManifest>,
    options: { customSecrets?: string[]; autoConnect?: boolean } = {}
  ) {
    this.customSecrets = options.customSecrets ?? [];
    this.adapterManifest = {
      adapterId: manifest?.adapterId ?? 'ext_inmemory_01',
      displayName: manifest?.displayName ?? 'In-Memory External Knowledge Adapter',
      backendType: manifest?.backendType ?? 'in-memory-external',
      version: manifest?.version ?? '1.0.0',
      capabilities: manifest?.capabilities ?? {
        read: true,
        write: true,
        search: true,
        semanticSearch: false,
        graphTraversal: false,
        export: true,
        import: true,
        incrementalSync: true,
        delete: true,
      },
    };
    if (options.autoConnect) {
      this.connected = true;
    }
  }

  public manifest(): MemoryAdapterManifest {
    return JSON.parse(JSON.stringify(this.adapterManifest)) as MemoryAdapterManifest;
  }

  public async connect(): Promise<void> {
    if (this.simulatedFailureReason) {
      throw new Error(`Adapter connect failed: ${this.simulatedFailureReason}`);
    }
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
  }

  public simulateOutage(reason: string | null): void {
    this.simulatedFailureReason = reason;
    if (reason !== null) {
      this.connected = false;
    }
  }

  public async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    if (!this.connected || this.simulatedFailureReason) {
      return {
        healthy: false,
        details: this.simulatedFailureReason ?? 'Adapter is disconnected.',
      };
    }
    return {
      healthy: true,
      details: `Connected (${this.store.size} objects stored)`,
    };
  }

  private ensureConnected(operation: string): void {
    if (!this.connected || this.simulatedFailureReason) {
      throw new Error(
        `External adapter "${this.adapterManifest.adapterId}" unavailable during ${operation}: ${
          this.simulatedFailureReason ?? 'disconnected'
        }`
      );
    }
  }

  public async pushKnowledge(
    object: KnowledgeObject,
    idempotencyKey: string
  ): Promise<void> {
    this.ensureConnected('pushKnowledge');
    if (this.idempotencyKeys.has(idempotencyKey)) {
      return;
    }
    const sanitized = validateKnowledgeObject(redactRecursively(object, this.customSecrets));
    this.store.set(sanitized.id, sanitized);
    this.idempotencyKeys.add(idempotencyKey);
  }

  public async pullKnowledge(knowledgeId: KnowledgeId): Promise<KnowledgeObject | null> {
    this.ensureConnected('pullKnowledge');
    return this.store.get(knowledgeId) ?? null;
  }

  public async searchExternal(query: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    this.ensureConnected('searchExternal');
    const universeSet = new Set(query.projectUniverseIds);
    const matched = Array.from(this.store.values()).filter((obj) => {
      if (!universeSet.has(obj.projectUniverseId)) return false;
      if (query.types && query.types.length > 0 && !query.types.includes(obj.type)) {
        return false;
      }
      if (query.text && query.text.trim().length > 0) {
        const needle = query.text.trim().toLowerCase();
        const hay = `${obj.title ?? ''} ${obj.summary ?? ''} ${JSON.stringify(obj.content)}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    return {
      items: query.limit ? matched.slice(0, query.limit) : matched,
      total: matched.length,
      evidenceCoverage: 1,
    };
  }

  public async exportBatch(projectUniverseId: ProjectUniverseId): Promise<KnowledgeObject[]> {
    this.ensureConnected('exportBatch');
    return Array.from(this.store.values()).filter(
      (o) => o.projectUniverseId === projectUniverseId
    );
  }

  public async importBatch(
    objects: KnowledgeObject[],
    idempotencyKeyPrefix: string
  ): Promise<number> {
    this.ensureConnected('importBatch');
    let imported = 0;
    for (const obj of objects) {
      await this.pushKnowledge(obj, `${idempotencyKeyPrefix}:${obj.id}:${obj.version}`);
      imported++;
    }
    return imported;
  }

  public async deleteExternal(knowledgeId: KnowledgeId): Promise<void> {
    this.ensureConnected('deleteExternal');
    this.store.delete(knowledgeId);
  }
}

interface PendingAdapterSyncPayload {
  adapterId: string;
  object: KnowledgeObject;
  idempotencyKey: string;
}

/**
 * Memory Integration Gateway — MIG (Phase 9 — Spec v0.2 §11 & §12, PKU-020).
 *
 * Coordinates external memory adapters with:
 * - Explicit capability checking (`MemoryAdapterCapabilities`)
 * - Local-first PKU commit + durable outbox buffering on external disconnect (`PKU-020` zero hidden data loss)
 * - Automatic fallback to local PKU store when external search/read is unavailable
 * - Idempotent replay of buffered adapter writes upon reconnection
 */
export class MemoryIntegrationGateway implements IMemoryIntegrationGateway {
  private readonly pkuStore: IPKUStore;
  private readonly outbox: DurableOutboxQueue;
  private readonly adapters = new Map<string, IExtendedExternalMemoryAdapter>();
  private readonly customSecrets: string[];

  constructor(
    pkuStore: IPKUStore,
    options: { outbox?: DurableOutboxQueue; customSecrets?: string[] } = {}
  ) {
    this.pkuStore = pkuStore;
    this.outbox = options.outbox ?? new DurableOutboxQueue();
    this.customSecrets = options.customSecrets ?? [];
  }

  public registerAdapter(adapter: IExternalMemoryAdapter): void {
    const manifest = adapter.manifest();
    if (!manifest.adapterId || !manifest.adapterId.trim()) {
      throw new Error('Cannot register external memory adapter without a valid adapterId.');
    }
    this.adapters.set(manifest.adapterId, adapter as IExtendedExternalMemoryAdapter);
  }

  public getAdapter(adapterId: string): IExtendedExternalMemoryAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  public listAdapters(): readonly IExternalMemoryAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Checks whether `adapterId` supports a specific capability.
   */
  public hasCapability(
    adapterId: string,
    capability: keyof MemoryAdapterCapabilities
  ): boolean {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return false;
    return Boolean(adapter.manifest().capabilities[capability]);
  }

  /**
   * Writes a `KnowledgeObject` to the authoritative local PKU store first, then attempts
   * to replicate it to `adapterId` (`PKU-020`).
   *
   * - If the adapter does not support `write`, returns `degraded: true` with `unsupportedCapability: 'write'`
   *   while keeping `localCommitted: true`.
   * - If the adapter is disconnected or fails health/write, buffers the write in `DurableOutboxQueue`
   *   and records an audit `MemoryEvent` so **zero data is lost** (`PKU-020`).
   */
  public async writeThroughAdapter(
    adapterId: string,
    object: KnowledgeObject,
    idempotencyKey?: string
  ): Promise<AdapterWriteSyncResult> {
    const sanitized = validateKnowledgeObject(
      redactRecursively(object, this.customSecrets)
    );
    const idemKey =
      idempotencyKey ??
      deriveIdempotencyKey({
        sourceSystem: 'almudaya.mig',
        scopeId: sanitized.projectUniverseId,
        sourceType: sanitized.type,
        sourceRecordId: sanitized.id,
        contentHash: computeContentHash(sanitized, this.customSecrets),
      });

    // 1. Always commit to authoritative local PKU store first (zero hidden data loss — PKU-020)
    await this.pkuStore.putKnowledge(sanitized, idemKey);

    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      return {
        adapterId,
        knowledgeId: sanitized.id,
        localCommitted: true,
        adapterSynced: false,
        degraded: true,
        queuedForRetry: false,
        reason: `External adapter "${adapterId}" is not registered.`,
      };
    }

    const caps = adapter.manifest().capabilities;
    if (!caps.write || !adapter.pushKnowledge) {
      return {
        adapterId,
        knowledgeId: sanitized.id,
        localCommitted: true,
        adapterSynced: false,
        degraded: true,
        queuedForRetry: false,
        unsupportedCapability: 'write',
        reason: `External adapter "${adapterId}" does not support "write" capability.`,
      };
    }

    try {
      const health = await adapter.healthCheck();
      if (!health.healthy) {
        throw new Error(health.details ?? 'Adapter reported unhealthy status.');
      }

      await adapter.pushKnowledge(sanitized, idemKey);

      return {
        adapterId,
        knowledgeId: sanitized.id,
        localCommitted: true,
        adapterSynced: true,
        degraded: false,
        queuedForRetry: false,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const outboxKey = `adapter_sync:${adapterId}:${idemKey}`;
      const payload: PendingAdapterSyncPayload = {
        adapterId,
        object: sanitized,
        idempotencyKey: idemKey,
      };
      this.outbox.enqueue(outboxKey, 'put_knowledge', payload);

      await this.recordAdapterEvent(
        sanitized.projectUniverseId,
        adapterId,
        'adapter.degraded_write_buffered',
        {
          adapterId,
          knowledgeId: sanitized.id,
          localCommitted: true,
          queuedForRetry: true,
          reason: errorMsg,
        }
      );

      return {
        adapterId,
        knowledgeId: sanitized.id,
        localCommitted: true,
        adapterSynced: false,
        degraded: true,
        queuedForRetry: true,
        reason: errorMsg,
      };
    }
  }

  /**
   * Replays buffered adapter writes from the `DurableOutboxQueue` once `adapterId` reconnects (`PKU-020`).
   */
  public async replayBufferedWrites(adapterId: string): Promise<AdapterReplayReport> {
    const adapter = this.adapters.get(adapterId);
    if (!adapter || !adapter.pushKnowledge) {
      throw new Error(`Cannot replay buffered writes: adapter "${adapterId}" unavailable.`);
    }

    const prefix = `adapter_sync:${adapterId}:`;
    const pendingEntries = this.outbox
      .getPendingAndFailed()
      .filter((entry) => entry.idempotencyKey.startsWith(prefix));

    let replayedCount = 0;
    for (const entry of pendingEntries) {
      const payload = entry.payload as PendingAdapterSyncPayload;
      try {
        await adapter.pushKnowledge(payload.object, payload.idempotencyKey);
        this.outbox.markCompleted(entry.idempotencyKey);
        replayedCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.outbox.markFailed(entry.idempotencyKey, msg);
      }
    }

    const remainingPendingCount = this.outbox
      .getPendingAndFailed()
      .filter((entry) => entry.idempotencyKey.startsWith(prefix)).length;

    return {
      adapterId,
      attemptedCount: pendingEntries.length,
      replayedCount,
      remainingPendingCount,
    };
  }

  /**
   * Queries an external adapter with capability verification and automatic graceful fallback
   * to the local PKU store on backend disconnect or unsupported capability (`PKU-020`).
   */
  public async queryWithFallback(
    adapterId: string,
    query: KnowledgeQuery,
    options?: { requireSemanticSearch?: boolean; requireGraphTraversal?: boolean }
  ): Promise<AdapterReadFallbackResult> {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      const localRes = await this.pkuStore.queryKnowledge(query);
      return {
        adapterId,
        result: localRes,
        degraded: true,
        source: 'local_pku_fallback',
        reason: `Adapter "${adapterId}" is not registered.`,
      };
    }

    const caps = adapter.manifest().capabilities;

    if (options?.requireSemanticSearch && !caps.semanticSearch) {
      const localRes = await this.pkuStore.queryKnowledge(query);
      return {
        adapterId,
        result: localRes,
        degraded: true,
        source: 'local_pku_fallback',
        unsupportedCapability: 'semanticSearch',
        reason: `Adapter "${adapterId}" does not support capability "semanticSearch"; degraded to local PKU query.`,
      };
    }

    if (
      (options?.requireGraphTraversal || (query.relationTraversalDepth ?? 0) > 0) &&
      !caps.graphTraversal
    ) {
      const localRes = await this.pkuStore.queryKnowledge(query);
      return {
        adapterId,
        result: localRes,
        degraded: true,
        source: 'local_pku_fallback',
        unsupportedCapability: 'graphTraversal',
        reason: `Adapter "${adapterId}" does not support capability "graphTraversal"; degraded to local PKU graph traversal.`,
      };
    }

    if (!caps.search || !adapter.searchExternal) {
      const localRes = await this.pkuStore.queryKnowledge(query);
      return {
        adapterId,
        result: localRes,
        degraded: true,
        source: 'local_pku_fallback',
        unsupportedCapability: 'search',
        reason: `Adapter "${adapterId}" does not support capability "search"; degraded to local PKU query.`,
      };
    }

    try {
      const health = await adapter.healthCheck();
      if (!health.healthy) {
        throw new Error(health.details ?? 'Adapter unhealthy');
      }
      const externalResult = await adapter.searchExternal(query);
      return {
        adapterId,
        result: externalResult,
        degraded: false,
        source: 'external_adapter',
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const localRes = await this.pkuStore.queryKnowledge(query);
      return {
        adapterId,
        result: localRes,
        degraded: true,
        source: 'local_pku_fallback',
        reason: errorMsg,
      };
    }
  }

  private async recordAdapterEvent(
    projectUniverseId: ProjectUniverseId,
    adapterId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const eventId = deriveMemoryEventId({
      sourceSystem: 'almudaya.mig',
      sessionId: projectUniverseId,
      sourceType: eventType,
      sourceRecordId: `${adapterId}:${nowIso}`,
    });
    const idemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.mig',
      scopeId: projectUniverseId,
      sourceType: eventType,
      sourceRecordId: `${adapterId}:${nowIso}`,
    });

    const event: MemoryEvent = {
      id: eventId,
      eventType,
      identity: {
        projectUniverseId,
        principalId: `ADAPTER:${adapterId}`,
        registerKind: 'global',
      },
      payload: redactRecursively(payload, this.customSecrets) as Record<string, unknown>,
      occurredAt: nowIso,
      recordedAt: nowIso,
      idempotencyKey: idemKey,
      provenance: {
        sourceSystem: 'almudaya.mig',
        sourceType: 'ExternalAdapterEvent',
        sourceId: adapterId,
        createdAt: nowIso,
        ingestedAt: nowIso,
        originProjectUniverseId: projectUniverseId,
      },
    };

    try {
      await this.pkuStore.appendEvent(event, idemKey);
    } catch {
      // Outage-safe
    }
  }
}

/**
 * Unified Memory Interface (UMI) implementation (Phase 9 — Spec v0.2 §11).
 */
export class UnifiedMemoryInterface implements IUnifiedMemoryInterface {
  public readonly pku: IPKUStore;
  public readonly registers: IRegisterPersistence;
  public readonly globalBridge: IGlobalRegisterBridge;
  public readonly individualBridge: IIndividualRegisterBridge;
  public readonly koe: IKnowledgeOptimizationEngine;
  public readonly messagingBridge: IKnowledgeAwareMessagingBridge;
  public readonly lifecycle: IMemoryLifecycleManager;
  public readonly gateway: MemoryIntegrationGateway;

  constructor(params: {
    pku: IPKUStore;
    registers: IRegisterPersistence;
    globalBridge: IGlobalRegisterBridge;
    individualBridge: IIndividualRegisterBridge;
    koe: IKnowledgeOptimizationEngine;
    messagingBridge: IKnowledgeAwareMessagingBridge;
    lifecycle: IMemoryLifecycleManager;
    gateway: MemoryIntegrationGateway;
  }) {
    this.pku = params.pku;
    this.registers = params.registers;
    this.globalBridge = params.globalBridge;
    this.individualBridge = params.individualBridge;
    this.koe = params.koe;
    this.messagingBridge = params.messagingBridge;
    this.lifecycle = params.lifecycle;
    this.gateway = params.gateway;
  }
}
