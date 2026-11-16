import {
  PROTOCOL_PRIORITY_ORDER,
  type IProtocol,
  type InterventionPriority,
  type ProtocolDecision,
  type ProtocolEvaluation,
  type ProtocolId,
} from './contracts.js';
import {
  generateProtocolId,
  type ProtocolConfig,
} from './schema.js';

export interface InterventionQueueItem {
  interventionId: string;
  priority: InterventionPriority;
  protocolId: ProtocolId;
  sessionId: string;
  action: ProtocolDecision['action'];
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  sequence: number;
}

/**
 * Deterministic priority queue (P0 highest ... P5 lowest) preventing
 * protocol race conditions when multiple triggers fire concurrently.
 */
export class MasterInterventionQueue {
  private items: InterventionQueueItem[] = [];
  private seqCounter = 0;

  public enqueue(input: {
    priority?: InterventionPriority;
    protocolId: ProtocolId;
    sessionId: string;
    action: ProtocolDecision['action'];
    summary: string;
    payload?: Record<string, unknown>;
  }): InterventionQueueItem {
    const item: InterventionQueueItem = {
      interventionId: generateProtocolId('INTV'),
      priority: input.priority ?? PROTOCOL_PRIORITY_ORDER[input.protocolId],
      protocolId: input.protocolId,
      sessionId: input.sessionId,
      action: input.action,
      summary: input.summary,
      payload: input.payload ?? {},
      createdAt: new Date().toISOString(),
      sequence: ++this.seqCounter,
    };

    this.items.push(item);
    this.items.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.sequence - b.sequence;
    });
    return item;
  }

  public dequeue(): InterventionQueueItem | undefined {
    return this.items.shift();
  }

  public peek(): InterventionQueueItem | undefined {
    return this.items[0];
  }

  public list(): InterventionQueueItem[] {
    return [...this.items];
  }

  public size(): number {
    return this.items.length;
  }

  public hasPending(): boolean {
    return this.items.length > 0;
  }

  public clear(): void {
    this.items = [];
  }
}

const INTERVENTION_ACTIONS = new Set<ProtocolDecision['action']>([
  'ESCALATE_HITL',
  'MASTER_TAKEOVER',
  'MASTER_MEDIATION',
  'MASTER_MIGRATE',
  'FAILOVER_SWITCH',
  'GATE_FAILED',
]);

/**
 * Registry coordinating the 10 modular atomic IProtocol instances,
 * configuration broadcasting, snapshot inspection, and priority conflict resolution.
 */
export class ProtocolRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly protocols = new Map<ProtocolId, IProtocol<any, ProtocolDecision>>();
  public readonly queue: MasterInterventionQueue;

  constructor(queue = new MasterInterventionQueue()) {
    this.queue = queue;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public register(protocol: IProtocol<any, ProtocolDecision>): void {
    this.protocols.set(protocol.protocolId, protocol);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public get(protocolId: ProtocolId): IProtocol<any, ProtocolDecision> | undefined {
    return this.protocols.get(protocolId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public listProtocols(): Array<IProtocol<any, ProtocolDecision>> {
    return Array.from(this.protocols.values());
  }

  public configureAll(config: Partial<ProtocolConfig>): void {
    for (const protocol of this.protocols.values()) {
      protocol.configure(config);
    }
  }

  public async evaluate<TContext extends { sessionId: string }>(
    protocolId: ProtocolId,
    ctx: TContext,
    options?: { enforce?: boolean; enqueueIntervention?: boolean }
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    const protocol = this.protocols.get(protocolId);
    if (!protocol) {
      throw new Error(`Protocol not registered: ${protocolId}`);
    }

    const evaluation = await protocol.evaluate(ctx);

    if (options?.enforce !== false) {
      await protocol.enforce(evaluation.decision, ctx);
    }

    if (
      options?.enqueueIntervention !== false &&
      evaluation.triggered &&
      (!evaluation.decision.allowed ||
        INTERVENTION_ACTIONS.has(evaluation.decision.action))
    ) {
      this.queue.enqueue({
        priority: evaluation.priority,
        protocolId: evaluation.protocolId,
        sessionId: ctx.sessionId,
        action: evaluation.decision.action,
        summary: evaluation.decision.reason,
        payload: evaluation.decision.metadata,
      });
    }

    return evaluation;
  }

  /**
   * Orders concurrent triggered evaluations by canonical P0..P5 priority.
   */
  public resolvePriorityConflicts(
    evaluations: ProtocolEvaluation<ProtocolDecision>[]
  ): ProtocolEvaluation<ProtocolDecision>[] {
    return [...evaluations]
      .filter((e) => e.triggered)
      .sort((a, b) => {
        const pa = PROTOCOL_PRIORITY_ORDER[a.protocolId];
        const pb = PROTOCOL_PRIORITY_ORDER[b.protocolId];
        return pa - pb;
      });
  }

  public getAllSnapshots(): Record<string, Record<string, unknown>> {
    const snapshots: Record<string, Record<string, unknown>> = {};
    for (const [id, protocol] of this.protocols.entries()) {
      snapshots[id] = {
        ...protocol.getStateSnapshot(),
        version: protocol.version,
        enabled: protocol.isEnabled,
        priority: PROTOCOL_PRIORITY_ORDER[id],
      };
    }
    return snapshots;
  }
}
