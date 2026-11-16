import os from 'node:os';
import type { ProtocolConfig, ProtocolRuntimeState } from './schema.js';
import { ProtocolStore } from './store.js';

export interface HardwareSpecSnapshot {
  cpuCores: number;
  freeRamMb: number;
  totalRamMb: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  limitType?: 'TOKEN_BUDGET' | 'TIME_BUDGET' | 'HARDWARE_MEMORY';
  reason: string;
  metrics: {
    totalTokensUsed: number;
    tokenBudget: number;
    elapsedMs: number;
    freeRamMb: number;
    minFreeMemoryMb: number;
  };
}

/**
 * Computes conservative concurrency ceiling from live laptop/workstation CPU and free RAM.
 * Keeps headroom for OS + Master Bot + spawned Node runtimes (~300MB/worker).
 */
export function calculateHardwareBotCap(
  spec: HardwareSpecSnapshot,
  minFreeMemoryMb = 256
): number {
  const cpuCap = Math.max(1, spec.cpuCores - 1);
  const usableRamMb = Math.max(0, spec.freeRamMb - minFreeMemoryMb);
  const ramCap = Math.max(1, Math.floor(usableRamMb / 300));
  const rawCap = Math.min(cpuCap, ramCap);
  return Math.max(1, Math.min(12, rawCap));
}

/**
 * Tracks session-wide token consumption, elapsed wall time (`infinite` or bounded),
 * and hardware free-RAM capacity for PrBotGlobal.
 */
export class BudgetTracker {
  private readonly store: ProtocolStore;
  private readonly hardwareProvider: () => HardwareSpecSnapshot;

  constructor(
    store: ProtocolStore,
    hardwareProvider?: () => HardwareSpecSnapshot
  ) {
    this.store = store;
    this.hardwareProvider =
      hardwareProvider ??
      (() => ({
        cpuCores: Math.max(1, os.cpus().length),
        freeRamMb: Math.floor(os.freemem() / (1024 * 1024)),
        totalRamMb: Math.floor(os.totalmem() / (1024 * 1024)),
      }));
  }

  public getHardwareSnapshot(): HardwareSpecSnapshot {
    return this.hardwareProvider();
  }

  public resolveHardwareBotCap(config: ProtocolConfig): number {
    if (typeof config.prBotGlobalMax === 'number') {
      return Math.max(1, config.prBotGlobalMax);
    }
    return calculateHardwareBotCap(this.hardwareProvider(), config.minFreeMemoryMb);
  }

  public async recordTokenUsage(
    sessionId: string,
    tokensDelta: number
  ): Promise<ProtocolRuntimeState> {
    const safeDelta = Math.max(0, Math.round(tokensDelta));
    return await this.store.updateRuntimeState(sessionId, (current) => ({
      ...current,
      totalTokensUsed: current.totalTokensUsed + safeDelta,
    }));
  }

  public evaluateBudget(
    config: ProtocolConfig,
    state: ProtocolRuntimeState,
    nowMs = Date.now()
  ): BudgetCheckResult {
    const hardware = this.hardwareProvider();
    const startedMs = Date.parse(state.sessionStartedAt);
    const elapsedMs = Number.isFinite(startedMs) ? Math.max(0, nowMs - startedMs) : 0;

    const metrics = {
      totalTokensUsed: state.totalTokensUsed,
      tokenBudget: config.tokenBudget,
      elapsedMs,
      freeRamMb: hardware.freeRamMb,
      minFreeMemoryMb: config.minFreeMemoryMb,
    };

    if (state.totalTokensUsed >= config.tokenBudget) {
      return {
        allowed: false,
        limitType: 'TOKEN_BUDGET',
        reason: `Global token budget exceeded (${state.totalTokensUsed} / ${config.tokenBudget}).`,
        metrics,
      };
    }

    if (
      config.globalTimeoutMs !== 'infinite' &&
      elapsedMs >= config.globalTimeoutMs
    ) {
      return {
        allowed: false,
        limitType: 'TIME_BUDGET',
        reason: `Global time limit exceeded (${elapsedMs}ms / ${config.globalTimeoutMs}ms).`,
        metrics,
      };
    }

    if (hardware.freeRamMb < config.minFreeMemoryMb) {
      return {
        allowed: false,
        limitType: 'HARDWARE_MEMORY',
        reason: `Free RAM below safety floor (${hardware.freeRamMb}MB < ${config.minFreeMemoryMb}MB).`,
        metrics,
      };
    }

    return {
      allowed: true,
      reason: 'Within global token, time, and hardware budgets.',
      metrics,
    };
  }
}
