import path from 'node:path';
import type { IBlackboardStorage } from '../../blackboard/interface.js';
import type { BotRecord } from '../../bot/schema.js';
import {
  computeContentHash,
  deriveIdempotencyKey,
  deriveProjectUniverseId,
} from '../contracts/identity.js';
import { qualifiesBotRegistryMutation } from '../contracts/ownership.js';
import type {
  KnowledgeId,
  KnowledgeScope,
  MemoryIdentity,
  MemoryPermissionContext,
  ProjectUniverseId,
} from '../contracts/types.js';
import { LocalFilesystemPKUStore } from '../pku/local-store.js';
import { DurableOutboxQueue } from '../pku/shadow-ingestion.js';
import type { IPKUStore } from '../ports/pku-store.js';
import type { IRegisterPersistence } from '../ports/registers.js';
import type { IUnifiedMemoryInterface } from '../ports/umi.js';
import {
  MemoryIntegrationGateway,
  UnifiedMemoryInterface,
} from '../adapters/memory-integration-gateway.js';
import { KnowledgeOptimizationEngine } from '../koe/knowledge-optimization-engine.js';
import { MemoryLifecycleService } from '../lifecycle/memory-lifecycle-service.js';
import { KnowledgeAwareMessagingBridge } from '../messaging/knowledge-messaging-bridge.js';
import { ProjectMemoryUniverseService } from '../pmu/project-memory-universe.js';
import { BlackboardGlobalRegisterBridge } from './global-register.js';
import { ACMAIndividualRegisterBridge } from './individual-register.js';
import { MemoryAccessDeniedError, ScopedMemoryClient } from './memory-client.js';

export interface MemoryRuntimeOptions {
  mode?: 'read_only' | 'capture' | 'read_through';
  enabled?: boolean;
  outbox?: DurableOutboxQueue;
  customSecrets?: string[];
  defaultTokenBudget?: number;
}

/**
 * MemoryRuntime Composition Root (Phase 4–9 — INTEGRATION_MAP.md, PKU-001..PKU-020).
 *
 * Centralizes PKU store, Global Register bridge, Individual Register bridge,
 * Knowledge-Aware Messaging bridge, Knowledge Optimization Engine (KOE),
 * Project Memory Universe (PMU) service, Memory Lifecycle service,
 * Memory Integration Gateway (MIG), Unified Memory Interface (UMI), durable outbox,
 * and scoped bot client creation.
 * Supports non-destructive rollback (`disable()`) and graceful degradation on PKU outage.
 */
export class MemoryRuntime implements IUnifiedMemoryInterface {
  public readonly storage: IBlackboardStorage;
  public readonly pkuStore: IPKUStore & IRegisterPersistence;
  public readonly globalBridge: BlackboardGlobalRegisterBridge;
  public readonly individualBridge: ACMAIndividualRegisterBridge;
  public readonly messagingBridge: KnowledgeAwareMessagingBridge;
  public readonly koe: KnowledgeOptimizationEngine;
  public readonly pmuService: ProjectMemoryUniverseService;
  public readonly lifecycleService: MemoryLifecycleService;
  public readonly gateway: MemoryIntegrationGateway;
  public readonly umi: UnifiedMemoryInterface;
  public readonly outbox: DurableOutboxQueue;
  private isEnabled: boolean;

  constructor(
    storage: IBlackboardStorage,
    pkuStore: IPKUStore & IRegisterPersistence,
    options: MemoryRuntimeOptions = {}
  ) {
    this.storage = storage;
    this.pkuStore = pkuStore;
    this.isEnabled = options.enabled ?? true;
    this.outbox = options.outbox ?? new DurableOutboxQueue();

    this.globalBridge = new BlackboardGlobalRegisterBridge(storage, pkuStore, {
      mode: options.mode ?? 'capture',
      enabled: this.isEnabled,
      outbox: this.outbox,
      bridgeOptions: { customSecrets: options.customSecrets },
    });

    this.individualBridge = new ACMAIndividualRegisterBridge(storage, pkuStore, {
      customSecrets: options.customSecrets,
      outbox: this.outbox,
      enabled: this.isEnabled,
    });

    this.messagingBridge = new KnowledgeAwareMessagingBridge(storage, pkuStore, {
      customSecrets: options.customSecrets,
      enabled: this.isEnabled,
      individualBridge: this.individualBridge,
    });

    this.koe = new KnowledgeOptimizationEngine(pkuStore, {
      customSecrets: options.customSecrets,
      defaultTokenBudget: options.defaultTokenBudget,
    });

    this.pmuService = new ProjectMemoryUniverseService(pkuStore, {
      customSecrets: options.customSecrets,
    });

    this.lifecycleService = new MemoryLifecycleService(pkuStore, this.pmuService, {
      customSecrets: options.customSecrets,
    });

    this.gateway = new MemoryIntegrationGateway(pkuStore, {
      outbox: this.outbox,
      customSecrets: options.customSecrets,
    });

    this.umi = new UnifiedMemoryInterface({
      pku: pkuStore,
      registers: pkuStore,
      globalBridge: this.globalBridge,
      individualBridge: this.individualBridge,
      koe: this.koe,
      messagingBridge: this.messagingBridge,
      lifecycle: this.lifecycleService,
      gateway: this.gateway,
    });
  }

  public get pku(): IPKUStore {
    return this.pkuStore;
  }

  public get registers(): IRegisterPersistence {
    return this.pkuStore;
  }

  public get lifecycle(): MemoryLifecycleService {
    return this.lifecycleService;
  }

  public get enabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Disables PKU capture and read-through without deleting any PKU data,
   * restoring 100% legacy runtime authority (PKU-019 rollback contract).
   */
  public disable(): void {
    this.isEnabled = false;
    this.globalBridge.setEnabled(false);
    this.individualBridge.setEnabled(false);
    this.messagingBridge.setEnabled(false);
  }

  /**
   * Re-enables PKU integration.
   */
  public enable(mode: 'read_only' | 'capture' | 'read_through' = 'capture'): void {
    this.isEnabled = true;
    this.globalBridge.setMode(mode);
    this.globalBridge.setEnabled(true);
    this.individualBridge.setEnabled(true);
    this.messagingBridge.setEnabled(true);
  }

  /**
   * Creates a `ScopedMemoryClient` for a bot only after canonical `botId` is known
   * (INTEGRATION_MAP.md, PKU-009).
   */
  public createScopedClientForBot(params: {
    sessionId: string;
    botId: string;
    projectUniverseId?: ProjectUniverseId;
    additionalUniverseIds?: ProjectUniverseId[];
    scopes?: KnowledgeScope[];
    capabilities?: string[];
    explicitSharedKnowledgeIds?: KnowledgeId[];
  }): ScopedMemoryClient {
    if (!params.botId || !params.botId.trim()) {
      throw new MemoryAccessDeniedError(
        'Cannot create ScopedMemoryClient: canonical botId must be initialized first.'
      );
    }

    const primaryPmuId =
      params.projectUniverseId ??
      deriveProjectUniverseId(`session_${params.sessionId.toLowerCase()}`);

    const universeIds = Array.from(
      new Set([primaryPmuId, ...(params.additionalUniverseIds ?? [])])
    );

    const identity: MemoryIdentity = {
      projectUniverseId: primaryPmuId,
      sessionId: params.sessionId,
      botId: params.botId,
      principalId: params.botId,
      registerKind: 'individual',
    };

    const permission: MemoryPermissionContext = {
      principalId: params.botId,
      sessionId: params.sessionId,
      botId: params.botId,
      projectUniverseIds: universeIds,
      scopes: params.scopes ?? ['project', 'session', 'agent', 'shared'],
      capabilities: params.capabilities ?? [],
      explicitSharedKnowledgeIds: params.explicitSharedKnowledgeIds ?? [],
    };

    return new ScopedMemoryClient(this.pkuStore, identity, permission);
  }

  /**
   * Observes a bot registry mutation and persists it to PKU ONLY if it qualifies
   * under `qualifiesBotRegistryMutation` (ignoring 2-second heartbeat ticks — RISK-03).
   */
  public async observeBotRegistryMutation(
    sessionId: string,
    previous: BotRecord | undefined,
    next: BotRecord
  ): Promise<boolean> {
    if (!this.isEnabled) {
      return false;
    }

    if (!qualifiesBotRegistryMutation(previous, next)) {
      return false;
    }

    const idemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.blackboard',
      scopeId: sessionId,
      sourceType: 'BotRegistryMutation',
      sourceRecordId: `${next.bot_id}:${next.status}`,
      contentHash: computeContentHash({
        bot_id: next.bot_id,
        display_name: next.display_name,
        status: next.status,
        description: next.description,
        metadata: next.metadata,
      }),
    });

    await this.globalBridge.captureEvent(
      sessionId,
      previous ? 'bot.status_updated' : 'bot.registered',
      next,
      idemKey
    );

    return true;
  }

  /**
   * Synchronizes the current Blackboard session state into PKU in fail-open mode.
   * Never throws on PKU errors so legacy coordination remains unaffected (PKU-004).
   */
  public async captureSessionSafely(sessionId: string): Promise<boolean> {
    if (!this.isEnabled) {
      return false;
    }
    try {
      const res = await this.globalBridge.syncSessionToPKU(sessionId);
      return res !== null;
    } catch {
      return false;
    }
  }
}

/**
 * Creates a workspace-backed `MemoryRuntime` in capture mode when the provided
 * `IBlackboardStorage` exposes a `workspaceRoot` (such as `FilesystemSessionStorage`)
 * or when an explicit `pkuRootDir` is supplied. Returns `null` for in-memory/mock
 * storages without a filesystem root.
 */
export function createWorkspaceMemoryRuntime(
  storage: IBlackboardStorage,
  options: MemoryRuntimeOptions & { pkuRootDir?: string } = {}
): MemoryRuntime | null {
  const workspaceRoot = (storage as { workspaceRoot?: unknown }).workspaceRoot;
  const pkuRootDir =
    options.pkuRootDir ??
    (typeof workspaceRoot === 'string' && workspaceRoot.trim().length > 0
      ? path.join(workspaceRoot, 'pku')
      : undefined);

  if (!pkuRootDir) {
    return null;
  }

  const pkuStore = new LocalFilesystemPKUStore(pkuRootDir);
  const outbox = options.outbox ?? new DurableOutboxQueue(path.join(pkuRootDir, 'outbox.json'));
  return new MemoryRuntime(storage, pkuStore, {
    mode: 'capture',
    ...options,
    outbox,
  });
}
