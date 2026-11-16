import type { ProtocolConfig } from './schema.js';

export type ProtocolId =
  | 'PrBot'
  | 'PrBotGlobal'
  | 'PrIterasi'
  | 'PrDE'
  | 'PrMEend'
  | 'PrModerator'
  | 'PrTransfer'
  | 'PrMasterFailover'
  | 'PrGate'
  | 'PrReattach';

export type InterventionPriority = 0 | 1 | 2 | 3 | 4 | 5;

export const PROTOCOL_PRIORITY_ORDER: Record<ProtocolId, InterventionPriority> = {
  PrMasterFailover: 0,
  PrBotGlobal: 0,
  PrIterasi: 1,
  PrDE: 2,
  PrMEend: 3,
  PrGate: 3,
  PrModerator: 4,
  PrTransfer: 4,
  PrBot: 5,
  PrReattach: 0,
};

export type ProtocolAction =
  | 'CONTINUE'
  | 'ALLOW'
  | 'DENY'
  | 'MASTER_TAKEOVER'
  | 'MASTER_MEDIATION'
  | 'MASTER_MIGRATE'
  | 'ESCALATE_HITL'
  | 'GATE_FAILED'
  | 'GOAL_ACHIEVED'
  | 'FAILOVER_SWITCH'
  | 'REATTACHED'
  | 'RESPAWNED';

export interface ProtocolDecision {
  allowed: boolean;
  protocol: ProtocolId | 'Budget';
  action: ProtocolAction;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ProtocolEvaluation<TDecision = ProtocolDecision> {
  protocolId: ProtocolId;
  triggered: boolean;
  priority: InterventionPriority;
  decision: TDecision;
  auditMetadata?: Record<string, unknown>;
}

/**
 * Atomic interface contract implemented by all 10 Almudaya v0.3.5 cycle protocols.
 * Each protocol class can be configured, evaluated, enforced, and snapshot-inspected independently.
 */
export interface IProtocol<TContext = unknown, TDecision = ProtocolDecision> {
  readonly protocolId: ProtocolId;
  readonly version: string;
  readonly isEnabled: boolean;
  configure(limits: Partial<ProtocolConfig>): void;
  evaluate(ctx: TContext): Promise<ProtocolEvaluation<TDecision>>;
  enforce(decision: TDecision, ctx: TContext): Promise<void>;
  getStateSnapshot(): Record<string, unknown>;
}
