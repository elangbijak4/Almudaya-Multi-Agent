import type { IExternalMemoryAdapter } from './external-adapter.js';
import type { IKnowledgeOptimizationEngine } from './knowledge-optimization.js';
import type { IMemoryLifecycleManager } from './lifecycle.js';
import type { IKnowledgeAwareMessagingBridge } from './messaging.js';
import type { IPKUStore } from './pku-store.js';
import type {
  IGlobalRegisterBridge,
  IIndividualRegisterBridge,
  IRegisterPersistence,
} from './registers.js';

/**
 * Unified Memory Interface (UMI): internal memory contract connecting PKU,
 * Global Register (Blackboard), Individual Register (ACMA), KOE, Messaging, and Lifecycle.
 */
export interface IUnifiedMemoryInterface {
  readonly pku: IPKUStore;
  readonly registers: IRegisterPersistence;
  readonly globalBridge: IGlobalRegisterBridge;
  readonly individualBridge: IIndividualRegisterBridge;
  readonly koe: IKnowledgeOptimizationEngine;
  readonly messagingBridge: IKnowledgeAwareMessagingBridge;
  readonly lifecycle: IMemoryLifecycleManager;
}

/**
 * Memory Integration Gateway (MIG): registry and coordinator for external memory adapters.
 */
export interface IMemoryIntegrationGateway {
  registerAdapter(adapter: IExternalMemoryAdapter): void;
  getAdapter(adapterId: string): IExternalMemoryAdapter | undefined;
  listAdapters(): readonly IExternalMemoryAdapter[];
}
