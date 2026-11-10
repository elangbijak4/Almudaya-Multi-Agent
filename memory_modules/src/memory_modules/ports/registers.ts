import type { MemoryIdentity, RegisterSnapshot } from '../contracts/types.js';

export interface IRegisterPersistence {
  loadSnapshot<TState = unknown>(identity: MemoryIdentity): Promise<RegisterSnapshot<TState> | null>;
  saveSnapshot<TState = unknown>(snapshot: RegisterSnapshot<TState>, idempotencyKey: string): Promise<void>;
  appendRegisterEvent<TPayload = unknown>(identity: MemoryIdentity, eventType: string, payload: TPayload, idempotencyKey: string): Promise<void>;
}

/** Existing Blackboard remains the operational global register during migration. */
export interface IGlobalRegisterBridge {
  readonly mode: 'read_only' | 'capture' | 'read_through';
  exportSession(sessionId: string): Promise<unknown>;
  captureEvent(sessionId: string, eventType: string, payload: unknown, idempotencyKey: string): Promise<void>;
}

/** ACMA adapter is capability-based; do not assume an ACMA implementation exists in every host version. */
export interface IIndividualRegisterBridge {
  discoverCapabilities(): Promise<string[]>;
  loadIndividualState(botId: string, sessionId?: string): Promise<unknown | null>;
  persistIndividualEvent(botId: string, eventType: string, payload: unknown, idempotencyKey: string): Promise<void>;
}
