import { AlmudayaError } from '../core/errors.js';
import type { AIRequest, AIResponse, IAIModelProvider } from './provider.js';
import {
  PrMasterFailoverProtocol,
  isFailoverWorthyError,
} from '../protocol/protocols/pr-master-failover.protocol.js';
import type { ModelSpec } from '../protocol/schema.js';

export class MasterFailoverExhaustedError extends AlmudayaError {
  constructor(
    public readonly failedModels: string[],
    public readonly lastError: unknown
  ) {
    super(
      `All failover models exhausted (${failedModels.join(', ')}): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
    this.name = 'MasterFailoverExhaustedError';
  }
}

export interface FailoverCandidate {
  spec: ModelSpec;
  provider?: IAIModelProvider;
}

export interface FailoverAIProviderOptions {
  candidates: FailoverCandidate[];
  providerFactory?: (spec: ModelSpec) => Promise<IAIModelProvider> | IAIModelProvider;
  sessionId?: string;
  prMasterFailover?: PrMasterFailoverProtocol;
  onSwitch?: (from: ModelSpec, to: ModelSpec, reason: string) => void;
}

function formatSpecKey(spec: ModelSpec): string {
  return `${spec.provider}:${spec.model}`;
}

function extractStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as { status?: unknown; statusCode?: unknown; code?: unknown; message?: string };
  if (typeof anyErr.status === 'number') return anyErr.status;
  if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
  if (typeof anyErr.code === 'number') return anyErr.code;
  const msg = anyErr.message ?? '';
  const match = msg.match(/\b(401|402|403|404|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : undefined;
}

/**
 * AI Provider wrapper enforcing PrMasterFailover across a prioritized ModelSpec chain
 * whenever primary endpoints fail with 401/402/403/404/429/5xx or timeout errors.
 */
export class FailoverAIProvider implements IAIModelProvider {
  private readonly candidates: FailoverCandidate[];
  private readonly resolvedProviders = new Map<number, IAIModelProvider>();
  private readonly providerFactory?: (
    spec: ModelSpec
  ) => Promise<IAIModelProvider> | IAIModelProvider;
  private readonly sessionId?: string;
  private readonly prMasterFailover?: PrMasterFailoverProtocol;
  private readonly onSwitch?: (from: ModelSpec, to: ModelSpec, reason: string) => void;
  private readonly failedRefs: string[] = [];
  private activeIndex = 0;

  constructor(options: FailoverAIProviderOptions) {
    if (options.candidates.length === 0) {
      throw new Error('FailoverAIProvider requires at least one candidate ModelSpec.');
    }
    this.candidates = options.candidates;
    this.providerFactory = options.providerFactory;
    this.sessionId = options.sessionId;
    this.prMasterFailover = options.prMasterFailover;
    this.onSwitch = options.onSwitch;

    for (let i = 0; i < this.candidates.length; i++) {
      const cand = this.candidates[i];
      if (cand?.provider) {
        this.resolvedProviders.set(i, cand.provider);
      }
    }
  }

  public get providerId(): string {
    return this.getActiveSpec().provider;
  }

  public get modelName(): string {
    return this.getActiveSpec().model;
  }

  public getActiveSpec(): ModelSpec {
    return this.candidates[this.activeIndex]!.spec;
  }

  public getActiveIndex(): number {
    return this.activeIndex;
  }

  public getFailedModelRefs(): string[] {
    return [...this.failedRefs];
  }

  private async getOrCreateProvider(index: number): Promise<IAIModelProvider> {
    const existing = this.resolvedProviders.get(index);
    if (existing) {
      return existing;
    }
    const cand = this.candidates[index];
    if (!cand) {
      throw new Error(`Invalid failover candidate index: ${index}`);
    }
    if (!this.providerFactory) {
      throw new Error(
        `No provider instance or providerFactory supplied for ${formatSpecKey(cand.spec)}.`
      );
    }
    const created = await this.providerFactory(cand.spec);
    this.resolvedProviders.set(index, created);
    return created;
  }

  public async generateResponse(request: AIRequest): Promise<AIResponse> {
    let lastError: unknown;

    while (this.activeIndex < this.candidates.length) {
      const currentSpec = this.getActiveSpec();
      const currentProvider = await this.getOrCreateProvider(this.activeIndex);

      try {
        return await currentProvider.generateResponse(request);
      } catch (err) {
        lastError = err;
        const statusCode = extractStatusCode(err);
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (!isFailoverWorthyError(statusCode, errorMessage)) {
          throw err;
        }

        const failedKey = formatSpecKey(currentSpec);
        if (!this.failedRefs.includes(failedKey)) {
          this.failedRefs.push(failedKey);
        }

        if (this.prMasterFailover && this.sessionId) {
          const evaluation = await this.prMasterFailover.evaluate({
            sessionId: this.sessionId,
            currentModel: currentSpec,
            failedModelRefs: this.failedRefs,
            errorStatusCode: statusCode,
            errorMessage,
          });
          await this.prMasterFailover.enforce(evaluation.decision, {
            sessionId: this.sessionId,
            currentModel: currentSpec,
            failedModelRefs: this.failedRefs,
            errorStatusCode: statusCode,
            errorMessage,
          });
        }

        const nextIndex = this.activeIndex + 1;
        if (nextIndex >= this.candidates.length) {
          if (this.prMasterFailover && this.sessionId) {
            await this.prMasterFailover.enforce(
              {
                allowed: false,
                protocol: 'PrMasterFailover',
                action: 'ESCALATE_HITL',
                reason: `All configured FailoverAIProvider candidates exhausted (${this.failedRefs.join(', ')}); pausing for HITL rescue.`,
                metadata: { failedModels: this.failedRefs, errorMessage },
              },
              {
                sessionId: this.sessionId,
                currentModel: currentSpec,
                failedModelRefs: this.failedRefs,
                errorStatusCode: statusCode,
                errorMessage,
              },
            );
          }
          throw new MasterFailoverExhaustedError(this.getFailedModelRefs(), lastError);
        }

        const nextSpec = this.candidates[nextIndex]!.spec;
        this.activeIndex = nextIndex;
        this.onSwitch?.(currentSpec, nextSpec, errorMessage);
      }
    }

    throw new MasterFailoverExhaustedError(this.getFailedModelRefs(), lastError);
  }

  public dispose(): void {
    for (const provider of this.resolvedProviders.values()) {
      provider.dispose?.();
    }
  }
}
