import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import type { BotRecord } from '../bot/schema.js';
import { BotService } from '../bot/service.js';
import { CapabilityPersistence } from '../capability/persistence.js';
import type { CapabilityScope } from '../capability/schema.js';
import { CapabilityService } from '../capability/service.js';
import { ValidationError } from '../core/errors.js';
import { atomicWriteJson, ensureDir, pathExists, readJsonValidated } from '../core/fs-utils.js';
import { appendJsonlRecord, readJsonlFile } from '../core/jsonl.js';
import type { ProtocolConfig } from '../protocol/schema.js';
import type { ProtocolSupervisor } from '../protocol/supervisor.js';
import { SkillService } from '../skills/service.js';
import {
  buildSessionPredicateState,
  evaluatePredicateExpr,
} from './predicates.js';
import { OperationRegistry } from './registry.js';
import {
  AgenticOperationV03Schema,
  OPERATION_API_VERSION,
  OperationEventSchema,
  OperationInstanceStateSchema,
  type AgenticOperationV03,
  type OperationEvent,
  type OperationInstanceState,
  type RoleArchetype,
} from './schema.js';
import {
  validateJsonAgainstSchema,
  validateLoadedOperation,
  validateOperationPackage,
} from './validator.js';
import { stringifyOperationYaml } from './yaml-lite.js';

export interface OperationManifoldServiceOptions {
  storage: IBlackboardStorage;
  supervisor: ProtocolSupervisor;
  skillService?: SkillService;
  capabilityService?: CapabilityService;
  registry?: OperationRegistry;
}

export interface PrepareWorkerRealizationResult {
  matched: boolean;
  roleArchetype?: RoleArchetype;
  deniedReason?: string;
  rejectRecycleCandidate?: boolean;
  alternativeRecycleBotId?: string;
  antiAffinityReason?: string;
  inheritedAllowedPaths?: string[];
  defaultAccessMode?: 'EXCLUSIVE_WRITE' | 'SHARED_READ' | 'REVIEW_ONLY';
}

export interface SynthesizeOperationInput {
  id?: string;
  name: string;
  objective: string;
  orchestrationRegime?: 'emergent' | 'blueprint_seeded' | 'stage_gated';
  topologyShape?: 'stigmergic' | 'hierarchical' | 'hybrid' | 'pipeline' | 'sub_manifold';
  roles?: RoleArchetype[];
  seedStages?: AgenticOperationV03['workflow']['seed_stages'];
  dynamicRules?: AgenticOperationV03['governance']['dynamic_rules'];
  l1SingleAgentFallback?: boolean;
  allowRoleCoalescing?: boolean;
  actorBotId?: string;
}

export interface EvaluateBehaviorResult {
  operationId: string;
  status: OperationInstanceState['status'];
  termination: {
    success: boolean;
    failure: boolean;
    cancellation: boolean;
    deadline: boolean;
  };
  loops: Array<{
    id: string;
    scope: string;
    continuation: boolean;
    acceptance: boolean;
    rollback: boolean;
  }>;
}

function getWorkspaceRootFromStorage(storage: IBlackboardStorage): string | undefined {
  const candidate = storage as { workspaceRoot?: unknown };
  return typeof candidate.workspaceRoot === 'string' ? candidate.workspaceRoot : undefined;
}

export class OperationManifoldService {
  private readonly storage: IBlackboardStorage;
  private readonly supervisor: ProtocolSupervisor;
  private readonly skillService: SkillService;
  private readonly capabilityService?: CapabilityService;
  private readonly registry: OperationRegistry;

  constructor(options: OperationManifoldServiceOptions) {
    this.storage = options.storage;
    this.supervisor = options.supervisor;
    const wsRoot = getWorkspaceRootFromStorage(this.storage);
    this.skillService = options.skillService ?? new SkillService({ storage: this.storage });
    this.capabilityService =
      options.capabilityService ??
      (wsRoot ? new CapabilityService(new CapabilityPersistence({ workspaceRoot: wsRoot })) : undefined);
    this.registry = options.registry ?? new OperationRegistry({ workspaceRoot: wsRoot });
  }

  private getOperationDir(sessionId: string): string {
    return path.join(this.storage.getSessionDir(sessionId), 'operation');
  }

  private getActiveInstancePath(sessionId: string): string {
    return path.join(this.getOperationDir(sessionId), 'active_instance.json');
  }

  private getEventsPath(sessionId: string): string {
    return path.join(this.getOperationDir(sessionId), 'events.jsonl');
  }

  public async getActiveInstance(sessionId: string): Promise<OperationInstanceState | undefined> {
    const filePath = this.getActiveInstancePath(sessionId);
    if (!(await pathExists(filePath))) {
      return undefined;
    }
    return await readJsonValidated(filePath, OperationInstanceStateSchema);
  }

  private async saveActiveInstance(
    sessionId: string,
    state: OperationInstanceState
  ): Promise<OperationInstanceState> {
    const validated = OperationInstanceStateSchema.parse(state);
    return await this.storage.withSessionLock(sessionId, async () => {
      await ensureDir(this.getOperationDir(sessionId));
      await atomicWriteJson(this.getActiveInstancePath(sessionId), validated);
      return validated;
    });
  }

  private async recordOperationEvent(
    sessionId: string,
    input: {
      instanceId: string;
      operationId: string;
      action: string;
      actorBotId?: string;
      reason: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<OperationEvent> {
    const evt = OperationEventSchema.parse({
      eventId: `OPEVT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      timestamp: new Date().toISOString(),
      sessionId,
      instanceId: input.instanceId,
      operationId: input.operationId,
      action: input.action,
      actorBotId: input.actorBotId,
      reason: input.reason,
      metadata: input.metadata ?? {},
    });
    await this.storage.withSessionLock(sessionId, async () => {
      await ensureDir(this.getOperationDir(sessionId));
      await appendJsonlRecord(this.getEventsPath(sessionId), evt);
    });
    return evt;
  }

  public async getEvents(sessionId: string): Promise<OperationEvent[]> {
    const filePath = this.getEventsPath(sessionId);
    if (!(await pathExists(filePath))) return [];
    const res = await readJsonlFile(filePath, OperationEventSchema, { strict: false });
    return res.records;
  }

  public async applyOperation(
    sessionId: string,
    idOrAlias: string,
    options: {
      parameters?: Record<string, unknown>;
      actorBotId?: string;
      extraDirs?: string[];
    } = {}
  ): Promise<OperationInstanceState> {
    const reg = options.extraDirs?.length
      ? new OperationRegistry({
          workspaceRoot: getWorkspaceRootFromStorage(this.storage),
          extraDirs: options.extraDirs,
        })
      : this.registry;

    const pkg = await reg.resolveOperation(idOrAlias);
    const allPkgs = await reg.listOperations();
    const regMap = new Map(allPkgs.map((p) => [p.op.identity.id, p]));
    const staticErrors = await validateOperationPackage(pkg.opDir, regMap);
    if (staticErrors.length > 0) {
      throw new ValidationError(
        `Operation "${pkg.op.identity.id}" failed static validation:\n- ${staticErrors.join('\n- ')}`
      );
    }

    if (options.parameters && pkg.inputSchema) {
      const paramErrors = validateJsonAgainstSchema(
        options.parameters,
        pkg.inputSchema,
        `[${pkg.op.identity.id}] parameters`
      );
      if (paramErrors.length > 0) {
        throw new ValidationError(
          `Operation parameters failed input_schema validation:\n- ${paramErrors.join('\n- ')}`
        );
      }
    }

    return await this.activateValidatedDefinition(sessionId, pkg.op, {
      parameters: options.parameters ?? {},
      actorBotId: options.actorBotId ?? 'BOT000',
      synthesizedOnTheFly: false,
      sourceDir: pkg.opDir,
    });
  }

  public async synthesizeAdHocOperation(
    sessionId: string,
    input: SynthesizeOperationInput
  ): Promise<OperationInstanceState> {
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'adhoc-swarm';
    const opId = input.id ?? `almudaya.operation.emergent.${slug}`;
    const regime = input.orchestrationRegime ?? 'emergent';
    const topology = input.topologyShape ?? (regime === 'emergent' ? 'stigmergic' : 'hybrid');

    const roles: RoleArchetype[] =
      input.roles && input.roles.length > 0
        ? input.roles
        : [
            {
              id: 'swarm_lead',
              kind: 'master',
              responsibilities: [
                'Coordinate dynamic swarm manifold, GoalLedger tasks, and worker spawning',
              ],
              skills: [{ skill_id: 'task-decomposition', required: true }],
              default_access_mode: 'REVIEW_ONLY',
              allowed_path_globs: [],
              acg_capabilities: ['system.process_control'],
              lifecycle: {
                cardinality: { min: 1, max: 1 },
                spawn_trigger: 'session_start',
                recycle_eligible: false,
                dissolve_on: 'session_end',
                coalescable: false,
              },
            },
            {
              id: 'specialist_worker',
              kind: 'worker',
              responsibilities: ['Execute dynamically assigned tasks inside authorized path fence'],
              skills: [{ skill_id: 'implementation', required: true, entry_point: 'implement' }],
              default_access_mode: 'EXCLUSIVE_WRITE',
              allowed_path_globs: ['src/**', 'tests/**', 'docs/**'],
              acg_capabilities: [
                'filesystem.read_external',
                'filesystem.write_external',
                'process.execute_external',
              ],
              lifecycle: {
                cardinality: { min: 0, max: 4 },
                spawn_trigger: 'worker_request',
                recycle_eligible: true,
                dissolve_on: 'task_completed',
                coalescable: true,
              },
            },
            {
              id: 'operator',
              kind: 'human',
              responsibilities: ['Approve HITL gates and mission completion'],
              skills: [],
              default_access_mode: 'REVIEW_ONLY',
              allowed_path_globs: [],
              acg_capabilities: [],
              lifecycle: {
                cardinality: { min: 1, max: 1 },
                spawn_trigger: 'session_start',
                recycle_eligible: false,
                dissolve_on: 'session_end',
                coalescable: false,
              },
            },
          ];

    const doc: AgenticOperationV03 = AgenticOperationV03Schema.parse({
      apiVersion: OPERATION_API_VERSION,
      kind: 'AgenticOperation',
      identity: {
        id: opId,
        name: input.name,
        version: '0.1.0',
        description: `On-the-fly synthesized Operation for: ${input.objective}`,
        tags: ['synthesized', regime, topology],
      },
      mission: {
        objective: input.objective,
        scope: [input.objective],
        deliverables: ['result_artifacts', 'execution_trace'],
        acceptance_criteria: ['All GoalLedger tasks completed with factual verification evidence'],
        input_schema: 'schemas/input.schema.json',
        output_schema: 'schemas/output.schema.json',
      },
      manifold: {
        orchestration_regime: regime,
        topology_shape: topology,
        roles,
        anti_affinity: [],
        continuity: {
          l1_single_agent_fallback: input.l1SingleAgentFallback ?? true,
          allow_role_coalescing: input.allowRoleCoalescing ?? true,
          max_coalesced_roles_per_bot: 3,
        },
        crystallization_policy: {
          allow_on_the_fly_synthesis: true,
          crystallize_on_success: true,
          target_registry_namespace: 'almudaya.operation.emergent',
        },
      },
      communication: {
        protocol: 'almudaya.operation-message.v1',
        state_channel: 'session_blackboard',
        artifact_passing: 'reference',
        correlation_required: true,
        dead_end_routing: 'pr_me_end_and_pr_de',
      },
      workflow: {
        seed_stages: input.seedStages ?? [],
        allow_dynamic_task_mutation: true,
      },
      behavior: {
        execution_mode: regime === 'emergent' ? 'emergent' : 'iterative',
        protocol_bindings: {
          pr_bot_limit: 10,
          pr_bot_global_max: 'auto',
          pr_iterasi_limit: 25,
          pr_iterasi_handover_limit: 3,
          pr_de_limit: 10,
          pr_de_escalation_limit: 10,
          pr_no_progress_limit: 3,
          pr_gate_enabled: true,
          pr_reattach_enabled: true,
          master_strict_orchestrator: true,
          task_timeout_ms: 180000,
          global_timeout_ms: 'infinite',
          token_budget: 10000000,
          spawn_mode_preference: 'runtime_default',
        },
        loops: [],
        termination: {
          success: { op: 'eq', var: 'gate.passed', value: true },
          failure: { op: 'eq', var: 'error.unrecoverable', value: true },
          cancellation: { op: 'eq', var: 'protocol.cancelled', value: true },
          deadline: { op: 'eq', var: 'budget.deadline_reached', value: true },
        },
        recovery: {
          checkpoint_before: ['handover'],
          restore_strategy: 'pr_transfer_checkpoint',
          reassignment_policy: {
            enabled: true,
            require_capability_match: true,
            max_handovers_per_task: 2,
          },
        },
      },
      resources: {
        contracts: [],
        write_fencing_policy: 'pr_moderator_exclusive_token',
        secret_policy: 'env_or_runtime_secret_ref_only',
      },
      governance: {
        least_privilege: true,
        audit_required: true,
        dynamic_rules: input.dynamicRules ?? [],
        hitl_gates: [],
        prohibited_actions: ['bypass_capability_token_fencing', 'access_host_secrets'],
      },
      integrations: {
        blackboard: { enabled: true, namespace: `operation/${slug}` },
        pku: { enabled: true, reading_policy: 'pku_first' },
        acg: { enabled: true, default_preset: 'controlled' },
        goal_ledger: {
          enabled: true,
          auto_seed_from_workflow: (input.seedStages?.length ?? 0) > 0,
        },
      },
    });

    const semanticErrors = validateLoadedOperation(doc);
    if (semanticErrors.length > 0) {
      throw new ValidationError(
        `Synthesized Operation failed semantic validation:\n- ${semanticErrors.join('\n- ')}`
      );
    }

    return await this.activateValidatedDefinition(sessionId, doc, {
      parameters: {},
      actorBotId: input.actorBotId ?? 'BOT000',
      synthesizedOnTheFly: true,
    });
  }

  private async activateValidatedDefinition(
    sessionId: string,
    op: AgenticOperationV03,
    meta: {
      parameters: Record<string, unknown>;
      actorBotId: string;
      synthesizedOnTheFly: boolean;
      sourceDir?: string;
    }
  ): Promise<OperationInstanceState> {
    const previous = await this.getActiveInstance(sessionId);
    if (previous) {
      for (const oldRuleId of previous.appliedDynamicRuleIds) {
        await this.supervisor.rules.deactivateRule(sessionId, oldRuleId);
      }
    }

    const pb = op.behavior.protocol_bindings;
    const cfgPatch: Partial<ProtocolConfig> = {
      prBotLimit: pb.pr_bot_limit,
      prBotGlobalMax: pb.pr_bot_global_max,
      prIterasiLimit: pb.pr_iterasi_limit,
      prIterasiHandoverLimit: pb.pr_iterasi_handover_limit,
      prDeLimit: pb.pr_de_limit,
      prDeEscalationLimit: pb.pr_de_escalation_limit,
      prNoProgressLimit: pb.pr_no_progress_limit,
      prGateEnabled: pb.pr_gate_enabled,
      prReattachEnabled: pb.pr_reattach_enabled,
      masterStrictOrchestrator: pb.master_strict_orchestrator,
      taskTimeoutMs: pb.task_timeout_ms,
      globalTimeoutMs: pb.global_timeout_ms,
      tokenBudget: pb.token_budget,
      ...(pb.spawn_mode_preference !== 'runtime_default'
        ? { spawnMode: pb.spawn_mode_preference }
        : {}),
      ...(op.resources.hardware_policy
        ? { minFreeMemoryMb: op.resources.hardware_policy.min_free_memory_mb }
        : {}),
    };

    const updatedConfig = await this.supervisor.store.updateConfig(sessionId, (curr) => ({
      ...curr,
      ...cfgPatch,
    }));
    this.supervisor.registry.configureAll(updatedConfig);

    const resolvedCap = this.supervisor.budget.resolveHardwareBotCap(updatedConfig);
    await this.supervisor.store.updateRuntimeState(sessionId, (curr) => ({
      ...curr,
      resolvedHardwareBotCap: resolvedCap,
      macroLoopStatus: 'RUNNING',
    }));

    const appliedRuleIds: string[] = [];
    for (const r of op.governance.dynamic_rules) {
      const created = await this.supervisor.rules.addRule(sessionId, {
        statement: `[Operation:${op.identity.id}:${r.rule_id}] ${r.statement}`,
        severity: r.severity,
        scope: r.scope,
        createdBy: meta.actorBotId,
      });
      appliedRuleIds.push(created.ruleId);
    }

    const seededTaskIds: string[] = [];
    if (op.integrations.goal_ledger.auto_seed_from_workflow && op.workflow.seed_stages.length > 0) {
      const ledger = await this.supervisor.ledger.initializeBlueprint(
        sessionId,
        op.mission.objective,
        op.workflow.seed_stages.map((st) => ({
          taskId: st.id,
          title: st.title,
          description: st.action,
          roleHint: st.owner_ref,
          dependsOn: st.depends_on,
          targetFiles: st.write_scope_globs ?? [],
          acceptanceCriteria: st.expected_outputs,
          status: 'PENDING',
        }))
      );
      for (const t of ledger.tasks) {
        seededTaskIds.push(t.taskId);
      }
    }

    const masterRole =
      op.manifold.roles.find((r) => r.kind === 'master') ??
      op.manifold.roles.find((r) => r.kind === 'moderator') ??
      op.manifold.roles[0]!;

    const roleRealizationMap: Record<string, string[]> = {
      [masterRole.id]: ['BOT000'],
    };
    const botRoleBindings: Record<string, string[]> = {
      BOT000: [masterRole.id],
    };

    await this.bindRoleSkillsAndCapabilities(sessionId, 'BOT000', masterRole, meta.actorBotId);

    const now = new Date().toISOString();
    const instanceState = await this.saveActiveInstance(sessionId, {
      instanceId: `OPINST-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      sessionId,
      operationId: op.identity.id,
      operationVersion: op.identity.version,
      operationName: op.identity.name,
      orchestrationRegime: op.manifold.orchestration_regime,
      topologyShape: op.manifold.topology_shape,
      status: 'running_l1',
      synthesizedOnTheFly: meta.synthesizedOnTheFly,
      sourceDir: meta.sourceDir,
      parameters: meta.parameters,
      roleRealizationMap,
      botRoleBindings,
      loopCounters: {},
      appliedDynamicRuleIds: appliedRuleIds,
      appliedGrantIds: [],
      seededTaskIds,
      createdAt: now,
      updatedAt: now,
      definitionSnapshot: op,
    });

    await this.recordOperationEvent(sessionId, {
      instanceId: instanceState.instanceId,
      operationId: op.identity.id,
      action: meta.synthesizedOnTheFly ? 'OPERATION_SYNTHESIZED' : 'OPERATION_APPLIED',
      actorBotId: meta.actorBotId,
      reason: `Activated Operation ${op.identity.id}@${op.identity.version} (${op.manifold.orchestration_regime}/${op.manifold.topology_shape}).`,
      metadata: {
        seededTaskCount: seededTaskIds.length,
        dynamicRulesCount: appliedRuleIds.length,
        masterRole: masterRole.id,
      },
    });

    return instanceState;
  }

  private async bindRoleSkillsAndCapabilities(
    sessionId: string,
    botId: string,
    role: RoleArchetype,
    grantedBy: string
  ): Promise<string[]> {
    const sessionExists = await this.storage.sessionExists(sessionId);
    if (!sessionExists) {
      return [];
    }

    for (const sk of role.skills) {
      try {
        await this.skillService.enableSkill(sessionId, {
          skillId: sk.skill_id,
          botId,
          allowLogicalSkill: true,
          config: sk.entry_point ? { entry_point: sk.entry_point } : {},
          updatedBy: grantedBy,
        });
      } catch {
        // Best-effort skill binding; never crash spawn pipeline
      }
    }

    const grantIds: string[] = [];
    if (this.capabilityService) {
      for (const cap of role.acg_capabilities) {
        const scope: CapabilityScope = {};
        if (cap.startsWith('filesystem.')) {
          scope.paths = role.allowed_path_globs.length > 0 ? role.allowed_path_globs : ['*'];
        } else if (cap === 'mcp.invoke') {
          scope.servers = ['*'];
          scope.tools = ['*'];
        } else if (cap === 'process.execute_external') {
          scope.commands = ['git', 'npm', 'tsc', 'node', 'python'];
        }
        try {
          const grant = await this.capabilityService.grantCapability({
            sessionId,
            capability: cap,
            scope,
            grantedBy,
            botId,
            approvalMode: 'session',
            reason: `Operation RoleArchetype "${role.id}" grant`,
          });
          grantIds.push(grant.grant_id);
        } catch {
          // Best-effort ACG grant (e.g. if capability service lacks audit dir permissions)
        }
      }
    }
    return grantIds;
  }

  private findMatchingRoleArchetype(
    op: AgenticOperationV03,
    requestedRole?: string,
    displayName?: string
  ): RoleArchetype | undefined {
    const candidates = [requestedRole, displayName].filter(
      (s): s is string => typeof s === 'string' && s.trim().length > 0
    );
    const workerRoles = op.manifold.roles.filter(
      (r) => r.kind === 'worker' || r.kind === 'moderator'
    );
    if (workerRoles.length === 0) return undefined;

    for (const raw of candidates) {
      const norm = raw.trim().toLowerCase().replace(/[-\s]+/g, '_');
      const exact = workerRoles.find((r) => r.id.toLowerCase() === norm);
      if (exact) return exact;
      const fuzzy = workerRoles.find(
        (r) => norm.includes(r.id.toLowerCase()) || r.id.toLowerCase().includes(norm)
      );
      if (fuzzy) return fuzzy;
    }

    return undefined;
  }

  private getConflictingRoles(op: AgenticOperationV03, targetRoleId: string): Set<string> {
    const conflicts = new Set<string>();
    for (const rule of op.manifold.anti_affinity ?? []) {
      if (rule.enforcement !== 'strict_distinct_bot') continue;
      if (rule.roles[0] === targetRoleId) conflicts.add(rule.roles[1]);
      if (rule.roles[1] === targetRoleId) conflicts.add(rule.roles[0]);
    }
    return conflicts;
  }

  private botCanBindRole(
    state: OperationInstanceState,
    botId: string,
    role: RoleArchetype
  ): { allowed: boolean; reason?: string } {
    const pastRoles = state.botRoleBindings[botId] ?? [];
    const conflicts = this.getConflictingRoles(state.definitionSnapshot, role.id);
    for (const prev of pastRoles) {
      if (conflicts.has(prev)) {
        return {
          allowed: false,
          reason: `Bot ${botId} previously held role "${prev}", violating strict_distinct_bot anti_affinity with "${role.id}".`,
        };
      }
    }
    const maxCoalesced = state.definitionSnapshot.manifold.continuity.max_coalesced_roles_per_bot;
    if (
      maxCoalesced !== undefined &&
      !pastRoles.includes(role.id) &&
      pastRoles.length >= maxCoalesced
    ) {
      return {
        allowed: false,
        reason: `Bot ${botId} already coalesced ${pastRoles.length} role(s) (limit ${maxCoalesced}).`,
      };
    }
    return { allowed: true };
  }

  public async prepareWorkerRealization(
    sessionId: string,
    input: {
      requestedRole?: string;
      displayName?: string;
      registeredBots: BotRecord[];
      candidateRecycleBotId?: string;
    }
  ): Promise<PrepareWorkerRealizationResult> {
    const state = await this.getActiveInstance(sessionId);
    if (!state) {
      return { matched: false };
    }
    const role = this.findMatchingRoleArchetype(
      state.definitionSnapshot,
      input.requestedRole,
      input.displayName
    );
    if (!role) {
      return { matched: false };
    }

    const activeHolders = state.roleRealizationMap[role.id] ?? [];
    if (activeHolders.length >= role.lifecycle.cardinality.max) {
      return {
        matched: true,
        roleArchetype: role,
        deniedReason: `Operation "${state.operationId}" role "${role.id}" reached cardinality.max (${role.lifecycle.cardinality.max}).`,
      };
    }

    let rejectRecycleCandidate = false;
    let alternativeRecycleBotId: string | undefined;
    let antiAffinityReason: string | undefined;

    if (input.candidateRecycleBotId) {
      const check = this.botCanBindRole(state, input.candidateRecycleBotId, role);
      if (!check.allowed) {
        rejectRecycleCandidate = true;
        antiAffinityReason = check.reason;
        const alt = input.registeredBots.find(
          (b) =>
            b.status === 'idle' &&
            b.bot_id !== 'BOT000' &&
            b.bot_id !== input.candidateRecycleBotId &&
            this.botCanBindRole(state, b.bot_id, role).allowed
        );
        if (alt) {
          alternativeRecycleBotId = alt.bot_id;
        }
      }
    }

    return {
      matched: true,
      roleArchetype: role,
      rejectRecycleCandidate,
      alternativeRecycleBotId,
      antiAffinityReason,
      inheritedAllowedPaths: role.allowed_path_globs,
      defaultAccessMode: role.default_access_mode,
    };
  }

  public async commitWorkerRealization(
    sessionId: string,
    botId: string,
    roleId: string
  ): Promise<OperationInstanceState | undefined> {
    const state = await this.getActiveInstance(sessionId);
    if (!state) return undefined;
    const role = state.definitionSnapshot.manifold.roles.find((r) => r.id === roleId);
    if (!role) return state;

    const grantIds = await this.bindRoleSkillsAndCapabilities(sessionId, botId, role, 'BOT000');

    const currentHolders = new Set(state.roleRealizationMap[roleId] ?? []);
    currentHolders.add(botId);
    const nextRealizationMap = {
      ...state.roleRealizationMap,
      [roleId]: Array.from(currentHolders),
    };

    const pastBindings = new Set(state.botRoleBindings[botId] ?? []);
    pastBindings.add(roleId);
    const nextBotBindings = {
      ...state.botRoleBindings,
      [botId]: Array.from(pastBindings),
    };

    const activeUniqueBots = new Set(Object.values(nextRealizationMap).flat());
    const nextStatus: OperationInstanceState['status'] =
      activeUniqueBots.size > 1 ? 'running_swarm' : 'running_l1';

    const updated = await this.saveActiveInstance(sessionId, {
      ...state,
      status: nextStatus,
      roleRealizationMap: nextRealizationMap,
      botRoleBindings: nextBotBindings,
      appliedGrantIds: [...state.appliedGrantIds, ...grantIds],
      updatedAt: new Date().toISOString(),
    });

    await this.recordOperationEvent(sessionId, {
      instanceId: updated.instanceId,
      operationId: updated.operationId,
      action: 'ROLE_REALIZED',
      actorBotId: botId,
      reason: `Bot ${botId} realized RoleArchetype "${roleId}" (manifold status: ${nextStatus}).`,
      metadata: {
        roleId,
        activeUniqueBots: Array.from(activeUniqueBots),
      },
    });

    return updated;
  }

  public async handleTaskCompletionLifecycle(
    sessionId: string,
    botId: string,
    taskId: string,
    botService: BotService
  ): Promise<{ dissolved: boolean; nextBotStatus?: 'idle' | 'stopped'; manifoldStatus?: string }> {
    if (botId === 'BOT000' || botId === 'MASTER') {
      return { dissolved: false };
    }
    const state = await this.getActiveInstance(sessionId);
    if (!state) return { dissolved: false };

    const boundRoleIds = Object.entries(state.roleRealizationMap)
      .filter(([, holders]) => holders.includes(botId))
      .map(([roleId]) => roleId);

    if (boundRoleIds.length === 0) {
      return { dissolved: false };
    }

    let shouldDissolve = false;
    let recycleEligible = true;
    const nextMap: Record<string, string[]> = { ...state.roleRealizationMap };

    for (const rid of boundRoleIds) {
      const roleDef = state.definitionSnapshot.manifold.roles.find((r) => r.id === rid);
      if (roleDef && roleDef.lifecycle.dissolve_on === 'task_completed') {
        shouldDissolve = true;
        if (!roleDef.lifecycle.recycle_eligible) {
          recycleEligible = false;
        }
        nextMap[rid] = (nextMap[rid] ?? []).filter((id) => id !== botId);
      }
    }

    if (!shouldDissolve) {
      return { dissolved: false };
    }

    const nextBotStatus: 'idle' | 'stopped' = recycleEligible ? 'idle' : 'stopped';
    try {
      await botService.updateStatus(sessionId, botId, nextBotStatus);
    } catch {
      // Bot may not be registered in lightweight unit fixtures
    }

    const remainingActiveBots = new Set(Object.values(nextMap).flat());
    const nextManifoldStatus: OperationInstanceState['status'] =
      remainingActiveBots.size > 1 ? 'running_swarm' : 'running_l1';

    await this.saveActiveInstance(sessionId, {
      ...state,
      status: nextManifoldStatus,
      roleRealizationMap: nextMap,
      updatedAt: new Date().toISOString(),
    });

    await this.recordOperationEvent(sessionId, {
      instanceId: state.instanceId,
      operationId: state.operationId,
      action: 'WORKER_APOPTOSIS',
      actorBotId: botId,
      reason: `Worker ${botId} dissolved after task ${taskId} -> status=${nextBotStatus} (manifold=${nextManifoldStatus}).`,
      metadata: {
        taskId,
        dissolvedRoles: boundRoleIds,
        nextBotStatus,
        nextManifoldStatus,
      },
    });

    return {
      dissolved: true,
      nextBotStatus,
      manifoldStatus: nextManifoldStatus,
    };
  }

  public async evaluateBehavior(
    sessionId: string,
    metricOverrides?: Record<string, unknown>
  ): Promise<EvaluateBehaviorResult> {
    const state = await this.getActiveInstance(sessionId);
    if (!state) {
      throw new ValidationError(`No active Operation in session "${sessionId}".`);
    }

    const predState = await buildSessionPredicateState(this.supervisor, sessionId, metricOverrides);
    const behavior = state.definitionSnapshot.behavior;

    return {
      operationId: state.operationId,
      status: state.status,
      termination: {
        success: evaluatePredicateExpr(behavior.termination.success, predState),
        failure: evaluatePredicateExpr(behavior.termination.failure, predState),
        cancellation: evaluatePredicateExpr(behavior.termination.cancellation, predState),
        deadline: evaluatePredicateExpr(behavior.termination.deadline, predState),
      },
      loops: behavior.loops.map((loop) => ({
        id: loop.id,
        scope: loop.scope,
        continuation: evaluatePredicateExpr(loop.continuation_predicate, predState),
        acceptance: evaluatePredicateExpr(loop.acceptance_predicate, predState),
        rollback: loop.rollback_predicate
          ? evaluatePredicateExpr(loop.rollback_predicate, predState)
          : false,
      })),
    };
  }

  public async crystallizeActiveOperation(
    sessionId: string,
    options: {
      targetId?: string;
      version?: string;
      force?: boolean;
      outputRootDir?: string;
      actorBotId?: string;
    } = {}
  ): Promise<{ operationId: string; version: string; outputDir: string }> {
    const state = await this.getActiveInstance(sessionId);
    if (!state) {
      throw new ValidationError(`No active Operation in session "${sessionId}".`);
    }

    const op = state.definitionSnapshot;
    if (!options.force) {
      const ledger = await this.supervisor.ledger.getLedger(sessionId);
      const runtimeState = await this.supervisor.store.getRuntimeState(sessionId);
      const allTasksDone =
        ledger.tasks.length > 0 &&
        ledger.tasks.every((t) => t.status === 'DONE' || t.status === 'CANCELLED');
      if (runtimeState.macroLoopStatus !== 'GOAL_ACHIEVED' && !allTasksDone) {
        throw new ValidationError(
          'Cannot crystallize Operation before GoalLedger tasks complete or PrGate passes (pass force=true to override).'
        );
      }
    }

    const targetId = options.targetId ?? op.identity.id;
    const version = options.version ?? op.identity.version;
    const slug = targetId.split('.').pop() ?? 'crystallized-operation';
    const wsRoot = options.outputRootDir ?? getWorkspaceRootFromStorage(this.storage);
    if (!wsRoot) {
      throw new ValidationError('Workspace root is required to crystallize an Operation onto disk.');
    }

    const outDir = path.join(wsRoot, 'operations', slug);
    const schemasDir = path.join(outDir, 'schemas');
    await ensureDir(schemasDir);

    const crystallizedDoc: AgenticOperationV03 = AgenticOperationV03Schema.parse({
      ...op,
      identity: {
        ...op.identity,
        id: targetId,
        version,
      },
    });

    const inputSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: `${crystallizedDoc.identity.name} Input`,
      type: 'object',
      required: ['objective'],
      properties: {
        objective: { type: 'string' },
        workspace_ref: { type: 'string' },
      },
      additionalProperties: true,
    };

    const deliverableProps: Record<string, { type: string }> = {};
    for (const deliv of crystallizedDoc.mission.deliverables) {
      deliverableProps[deliv] = { type: 'string' };
    }
    const outputSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: `${crystallizedDoc.identity.name} Output`,
      type: 'object',
      required: ['status', 'artifacts'],
      properties: {
        status: { enum: ['succeeded', 'partial', 'failed', 'terminated_by_guard', 'cancelled', 'expired'] },
        artifacts: {
          type: 'object',
          required: [...crystallizedDoc.mission.deliverables],
          properties: deliverableProps,
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    };

    await fs.writeFile(path.join(outDir, 'operation.yaml'), stringifyOperationYaml(crystallizedDoc), 'utf-8');
    await fs.writeFile(
      path.join(outDir, 'Operation.md'),
      `# Crystallized Operation: ${crystallizedDoc.identity.name}\n\n- **ID:** \`${targetId}\`\n- **Version:** \`${version}\`\n- **Regime:** \`${crystallizedDoc.manifold.orchestration_regime}\`\n- **Objective:** ${crystallizedDoc.mission.objective}\n`,
      'utf-8'
    );
    await atomicWriteJson(path.join(schemasDir, 'input.schema.json'), inputSchema);
    await atomicWriteJson(path.join(schemasDir, 'output.schema.json'), outputSchema);

    const validationErrors = await validateOperationPackage(outDir);
    if (validationErrors.length > 0) {
      throw new ValidationError(
        `Crystallized package failed validation:\n- ${validationErrors.join('\n- ')}`
      );
    }

    await this.saveActiveInstance(sessionId, {
      ...state,
      operationId: targetId,
      operationVersion: version,
      status: 'crystallized',
      crystallizedToPath: outDir,
      updatedAt: new Date().toISOString(),
    });

    await this.recordOperationEvent(sessionId, {
      instanceId: state.instanceId,
      operationId: targetId,
      action: 'OPERATION_CRYSTALLIZED',
      actorBotId: options.actorBotId ?? 'BOT000',
      reason: `Crystallized Operation ${targetId}@${version} to ${outDir}.`,
      metadata: { outputDir: outDir },
    });

    return { operationId: targetId, version, outputDir: outDir };
  }

  public async buildPromptContextMarkdown(sessionId: string, botId: string): Promise<string> {
    const state = await this.getActiveInstance(sessionId);
    if (!state) return '';

    const op = state.definitionSnapshot;
    const boundRoles = state.botRoleBindings[botId] ?? [];
    const lines: string[] = [
      `- Operation ID: \`${state.operationId}\` (v${state.operationVersion}) — "${state.operationName}"`,
      `- Rezim Manifold: \`${state.orchestrationRegime}\` | Topologi: \`${state.topologyShape}\` | Status: \`${state.status}\``,
      `- Objektif Misi: ${op.mission.objective}`,
    ];

    if (boundRoles.length > 0) {
      lines.push(`- Peran Archetype Anda (${botId}): ${boundRoles.map((r) => `\`${r}\``).join(', ')}`);
      for (const rid of boundRoles) {
        const rDef = op.manifold.roles.find((r) => r.id === rid);
        if (rDef) {
          lines.push(
            `  - [${rid}] Mode Akses: ${rDef.default_access_mode} | Lifecycle: dissolve_on=${rDef.lifecycle.dissolve_on} | Tanggung Jawab: ${rDef.responsibilities.join('; ')}`
          );
        }
      }
    }

    if ((op.manifold.anti_affinity?.length ?? 0) > 0) {
      lines.push(
        `- Batasan Pemisahan Tugas (Anti-Affinity): ${op.manifold.anti_affinity!
          .map((a) => `${a.roles[0]} ≠ ${a.roles[1]} (${a.enforcement})`)
          .join(' | ')}`
      );
    }

    if ((op.communication.blackboard_acl?.length ?? 0) > 0) {
      const relevantAcls =
        boundRoles.length > 0
          ? op.communication.blackboard_acl!.filter((a) => boundRoles.includes(a.role_id))
          : op.communication.blackboard_acl!;
      if (relevantAcls.length > 0) {
        lines.push(
          `- Blackboard ACL: ${relevantAcls
            .map((a) => `${a.role_id}@${a.namespace} (${a.access})`)
            .join(', ')}`
        );
      }
    }

    return lines.join('\n');
  }
}
