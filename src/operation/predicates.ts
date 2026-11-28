import type { ProtocolSupervisor } from '../protocol/supervisor.js';
import type { PredicateExpr } from './schema.js';

function resolveVarPath(state: Record<string, unknown>, dottedPath: string): unknown {
  const parts = dottedPath.split('.');
  let current: unknown = state;
  for (const seg of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !(seg in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

export function evaluatePredicateExpr(
  expr: PredicateExpr,
  state: Record<string, unknown>
): boolean {
  if ('all' in expr) {
    return expr.all.every((sub) => evaluatePredicateExpr(sub, state));
  }
  if ('any' in expr) {
    return expr.any.some((sub) => evaluatePredicateExpr(sub, state));
  }
  if ('not' in expr) {
    return !evaluatePredicateExpr(expr.not, state);
  }

  const lhs = resolveVarPath(state, expr.var);
  const rhs = expr.ref !== undefined ? resolveVarPath(state, expr.ref) : expr.value;

  switch (expr.op) {
    case 'eq':
      return lhs === rhs;
    case 'neq':
      return lhs !== rhs;
    case 'gt':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs > rhs;
    case 'gte':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs >= rhs;
    case 'lt':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs < rhs;
    case 'lte':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs <= rhs;
    case 'in':
      return Array.isArray(rhs) ? rhs.includes(lhs) : false;
    default:
      return false;
  }
}

function deepMergeObjects(
  base: Record<string, unknown>,
  override?: Record<string, unknown>
): Record<string, unknown> {
  if (!override) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] !== null &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMergeObjects(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function buildSessionPredicateState(
  supervisor: ProtocolSupervisor,
  sessionId: string,
  overrides?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const [config, runtimeState, ledger] = await Promise.all([
    supervisor.store.getConfig(sessionId),
    supervisor.store.getRuntimeState(sessionId),
    supervisor.ledger.getLedger(sessionId),
  ]);

  const totalTasks = ledger.tasks.length;
  const doneTasks = ledger.tasks.filter((t) => t.status === 'DONE').length;
  const openTasks = ledger.tasks.filter(
    (t) => t.status !== 'DONE' && t.status !== 'CANCELLED'
  ).length;
  const allTestsPassed =
    totalTasks > 0 &&
    ledger.tasks.every((t) => t.status !== 'DONE' || t.verificationEvidence?.tested !== false);

  const tokensRemaining = Math.max(0, config.tokenBudget - runtimeState.totalTokensUsed);
  const startedMs = Date.parse(runtimeState.sessionStartedAt);
  const deadlineReached =
    typeof config.globalTimeoutMs === 'number' && Number.isFinite(startedMs)
      ? Date.now() - startedMs >= config.globalTimeoutMs
      : false;

  const gatePassed =
    runtimeState.macroLoopStatus === 'GOAL_ACHIEVED' ||
    (totalTasks > 0 && openTasks === 0 && doneTasks > 0);

  const base: Record<string, unknown> = {
    ledger: {
      total_tasks: totalTasks,
      done_tasks: doneTasks,
      open_tasks: openTasks,
      tests_passed: allTestsPassed,
      reviewer_approved: gatePassed,
    },
    protocol: {
      no_progress_count: runtimeState.noProgressHandoffCount,
      cancelled: runtimeState.macroLoopStatus === 'STOPPED',
      total_spawned_workers: runtimeState.totalSpawnedWorkers,
      active_bots: runtimeState.activeGlobalBotCount,
      fence_epoch: runtimeState.currentFenceEpoch,
    },
    budget: {
      tokens_used: runtimeState.totalTokensUsed,
      tokens_remaining: tokensRemaining,
      deadline_reached: deadlineReached,
    },
    gate: {
      passed: gatePassed,
      human_signoff_recorded: runtimeState.macroLoopStatus === 'GOAL_ACHIEVED',
    },
    artifact: {
      latex_compiled: false,
    },
    candidate: {},
    accepted: {},
    error: {
      retryable: false,
      idempotent_or_checkpointed: true,
      unrecoverable: false,
      required_input_missing: false,
    },
    child: {
      quality_gate_passed: false,
      revision_actionable: true,
      contract_valid: true,
      all_required_succeeded_or_waived: false,
      unrecoverable_failure: false,
    },
  };

  return deepMergeObjects(base, overrides);
}
