import { z } from 'zod';
import { KNOWN_CAPABILITIES, type CapabilityId } from '../capability/schema.js';
import { SkillEntryPointSchema } from '../skills/schema.js';

export const OPERATION_API_VERSION = 'almudaya.operation/v0.3' as const;

const STATE_VAR_PATTERN =
  /^(ledger|protocol|budget|gate|artifact|candidate|accepted|error|child)\.[a-zA-Z0-9_.]+$/;

export const PredicateOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
]);
export type PredicateOperator = z.infer<typeof PredicateOperatorSchema>;

export const PredicateValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export const PredicateAtomSchema = z
  .object({
    op: PredicateOperatorSchema,
    var: z.string().regex(STATE_VAR_PATTERN, 'Invalid PredicateAtom var namespace.'),
    value: PredicateValueSchema.optional(),
    ref: z.string().regex(STATE_VAR_PATTERN, 'Invalid PredicateAtom ref namespace.').optional(),
  })
  .strict()
  .refine(
    (atom) => (atom.value !== undefined) !== (atom.ref !== undefined),
    'PredicateAtom must specify exactly one of "value" or "ref".'
  );
export type PredicateAtom = z.infer<typeof PredicateAtomSchema>;

export type PredicateExpr =
  | PredicateAtom
  | { all: PredicateExpr[] }
  | { any: PredicateExpr[] }
  | { not: PredicateExpr };

export const PredicateExprSchema: z.ZodType<PredicateExpr> = z.lazy(() =>
  z.union([
    PredicateAtomSchema,
    z.object({ all: z.array(PredicateExprSchema).min(1) }).strict(),
    z.object({ any: z.array(PredicateExprSchema).min(1) }).strict(),
    z.object({ not: PredicateExprSchema }).strict(),
  ])
);

export const SkillAssignmentSchema = z
  .object({
    skill_id: z.string().min(1),
    required: z.boolean(),
    entry_point: SkillEntryPointSchema.optional(),
  })
  .strict();
export type SkillAssignment = z.infer<typeof SkillAssignmentSchema>;

export const CapabilityEnumSchema = z.enum(KNOWN_CAPABILITIES as readonly [CapabilityId, ...CapabilityId[]]);

export const RoleLifecycleSchema = z
  .object({
    cardinality: z
      .object({
        min: z.number().int().min(0),
        max: z.number().int().min(1),
      })
      .strict(),
    spawn_trigger: z.enum([
      'session_start',
      'stage_activated',
      'task_assigned',
      'worker_request',
      'gate_failure',
    ]),
    recycle_eligible: z.boolean(),
    dissolve_on: z.enum(['task_completed', 'stage_completed', 'idle_timeout', 'session_end']),
    coalescable: z.boolean(),
  })
  .strict();

export const RoleArchetypeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['master', 'moderator', 'worker', 'human']),
    responsibilities: z.array(z.string().min(1)).min(1),
    skills: z.array(SkillAssignmentSchema),
    default_access_mode: z.enum(['EXCLUSIVE_WRITE', 'SHARED_READ', 'REVIEW_ONLY']),
    allowed_path_globs: z.array(z.string()),
    acg_capabilities: z.array(CapabilityEnumSchema),
    lifecycle: RoleLifecycleSchema,
  })
  .strict();
export type RoleArchetype = z.infer<typeof RoleArchetypeSchema>;

export const AntiAffinityRuleSchema = z
  .object({
    roles: z.tuple([z.string().min(1), z.string().min(1)]),
    reason: z.string().min(1),
    enforcement: z.enum(['strict_distinct_bot', 'epoch_reset_required']),
  })
  .strict();
export type AntiAffinityRule = z.infer<typeof AntiAffinityRuleSchema>;

export const SubOperationSpecSchema = z
  .object({
    id: z.string().min(1),
    operation_ref: z.string().min(1),
    version_constraint: z.string().min(1),
    delegate_moderator: z.boolean(),
    depends_on: z.array(z.string()),
    execution_mode: z.enum(['parallel', 'sequential']),
    required: z.boolean(),
    budget_share_percent: z.number().min(0).max(100),
    input_mapping: z.record(z.string(), z.string()),
    output_mapping: z.record(z.string(), z.string()),
  })
  .strict();
export type SubOperationSpec = z.infer<typeof SubOperationSpecSchema>;

export const SeedStageSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    owner_ref: z.string().min(1),
    owner_kind: z.enum(['role', 'sub_operation']),
    depends_on: z.array(z.string()),
    parallel_group: z.string().optional(),
    action: z.string().min(1),
    expected_outputs: z.array(z.string()),
    write_scope_globs: z.array(z.string()).optional(),
  })
  .strict();
export type SeedStage = z.infer<typeof SeedStageSchema>;

export const ProtocolBindingsSchema = z
  .object({
    pr_bot_limit: z.number().int().min(1),
    pr_bot_global_max: z.union([z.literal('auto'), z.number().int().min(1)]),
    pr_iterasi_limit: z.number().int().min(1),
    pr_iterasi_handover_limit: z.number().int().min(1),
    pr_de_limit: z.number().int().min(1),
    pr_de_escalation_limit: z.number().int().min(1),
    pr_no_progress_limit: z.number().int().min(1),
    pr_gate_enabled: z.boolean(),
    pr_reattach_enabled: z.boolean(),
    master_strict_orchestrator: z.boolean(),
    task_timeout_ms: z.number().int().min(100),
    global_timeout_ms: z.union([z.literal('infinite'), z.number().int().min(100)]),
    token_budget: z.number().int().min(100),
    spawn_mode_preference: z.enum(['windows', 'multiplexed', 'runtime_default']),
  })
  .strict();
export type ProtocolBindings = z.infer<typeof ProtocolBindingsSchema>;

export const FeedbackSourceSchema = z
  .object({
    kind: z.enum(['role', 'resource_evaluator']),
    ref: z.string().min(1),
  })
  .strict();

export const LoopSpecSchema = z
  .object({
    id: z.string().min(1),
    scope: z.enum(['task', 'agent', 'operation', 'nested_operation']),
    target_units: z.array(z.string().min(1)).min(1),
    max_iterations: z.number().int().min(1),
    no_progress_limit: z.number().int().min(1),
    feedback_sources: z.array(FeedbackSourceSchema),
    continuation_predicate: PredicateExprSchema,
    acceptance_predicate: PredicateExprSchema,
    rollback_predicate: PredicateExprSchema.optional(),
    on_limit_reached: z.enum([
      'escalate_hitl',
      'rollback_and_stop',
      'handover_via_pr_transfer',
      'abort',
    ]),
  })
  .strict();
export type LoopSpec = z.infer<typeof LoopSpecSchema>;

export const ResourceContractSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      'model',
      'mcp_server',
      'builtin_tool',
      'storage',
      'memory_service',
      'external_api',
    ]),
    purpose: z.string().min(1),
    access: z.enum(['read', 'execute', 'read_write']),
    authorized_roles: z.array(z.string().min(1)).min(1),
    adapter_hint: z.string().optional(),
    optional: z.boolean().optional(),
  })
  .strict();

export const DynamicRuleSpecSchema = z
  .object({
    rule_id: z.string().min(1),
    severity: z.enum(['ADVISORY', 'MANDATORY', 'HARD_STOP']),
    scope: z.enum(['ALL_BOTS', 'SPECIFIC_BOT', 'TASK']),
    statement: z.string().min(1),
  })
  .strict();

export const HitlGateSpecSchema = z
  .object({
    action: z.string().min(1),
    approval_mode: z.enum(['per_action', 'session']),
    approver_role: z.string().min(1),
  })
  .strict();

export const AgenticOperationV03Schema = z
  .object({
    apiVersion: z.literal(OPERATION_API_VERSION),
    kind: z.literal('AgenticOperation'),
    identity: z
      .object({
        id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
        name: z.string().min(1),
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        alias: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .strict(),
    mission: z
      .object({
        objective: z.string().min(1),
        scope: z.array(z.string()).min(1),
        deliverables: z.array(z.string()).min(1),
        acceptance_criteria: z.array(z.string()).min(1),
        input_schema: z.string().min(1),
        output_schema: z.string().min(1),
      })
      .strict(),
    manifold: z
      .object({
        orchestration_regime: z.enum(['emergent', 'blueprint_seeded', 'stage_gated']),
        topology_shape: z.enum(['stigmergic', 'hierarchical', 'hybrid', 'pipeline', 'sub_manifold']),
        roles: z.array(RoleArchetypeSchema).min(1),
        anti_affinity: z.array(AntiAffinityRuleSchema).optional(),
        sub_operations: z.array(SubOperationSpecSchema).optional(),
        continuity: z
          .object({
            l1_single_agent_fallback: z.boolean(),
            allow_role_coalescing: z.boolean(),
            max_coalesced_roles_per_bot: z.number().int().min(1).optional(),
          })
          .strict(),
        crystallization_policy: z
          .object({
            allow_on_the_fly_synthesis: z.boolean(),
            crystallize_on_success: z.boolean(),
            target_registry_namespace: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    communication: z
      .object({
        protocol: z.literal('almudaya.operation-message.v1'),
        state_channel: z.literal('session_blackboard'),
        artifact_passing: z.enum(['reference', 'inline_small_only']),
        correlation_required: z.boolean(),
        dead_end_routing: z.enum(['pr_me_end_and_pr_de', 'master_direct']),
        blackboard_acl: z
          .array(
            z
              .object({
                role_id: z.string().min(1),
                namespace: z.string().min(1),
                access: z.enum(['read', 'write', 'read_write']),
              })
              .strict()
          )
          .optional(),
      })
      .strict(),
    workflow: z
      .object({
        seed_stages: z.array(SeedStageSchema),
        allow_dynamic_task_mutation: z.boolean(),
      })
      .strict(),
    behavior: z
      .object({
        execution_mode: z.enum(['single_pass', 'iterative', 'composite', 'hierarchical', 'emergent']),
        protocol_bindings: ProtocolBindingsSchema,
        loops: z.array(LoopSpecSchema),
        termination: z
          .object({
            success: PredicateExprSchema,
            failure: PredicateExprSchema,
            cancellation: PredicateExprSchema,
            deadline: PredicateExprSchema,
          })
          .strict(),
        recovery: z
          .object({
            checkpoint_before: z.array(z.string()),
            restore_strategy: z.enum(['pr_transfer_checkpoint', 'last_accepted_artifact', 'abort']),
            reassignment_policy: z
              .object({
                enabled: z.boolean(),
                require_capability_match: z.boolean(),
                max_handovers_per_task: z.number().int().min(0),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    resources: z
      .object({
        contracts: z.array(ResourceContractSchema),
        write_fencing_policy: z.enum(['pr_moderator_exclusive_token', 'advisory_lock']),
        secret_policy: z.literal('env_or_runtime_secret_ref_only'),
        hardware_policy: z
          .object({
            advisor_enabled: z.boolean(),
            min_free_memory_mb: z.number().int().min(64),
          })
          .strict()
          .optional(),
      })
      .strict(),
    governance: z
      .object({
        least_privilege: z.boolean(),
        audit_required: z.boolean(),
        dynamic_rules: z.array(DynamicRuleSpecSchema),
        hitl_gates: z.array(HitlGateSpecSchema),
        prohibited_actions: z.array(z.string()),
        hierarchy_safety: z
          .object({
            max_nesting_depth: z.number().int().min(1).optional(),
            detect_operation_cycles: z.boolean().optional(),
            child_budget_isolation: z.boolean().optional(),
            cancellation_propagation: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    integrations: z
      .object({
        blackboard: z
          .object({
            enabled: z.boolean(),
            namespace: z.string(),
          })
          .strict(),
        pku: z
          .object({
            enabled: z.boolean(),
            reading_policy: z.enum(['pku_first', 'on_demand', 'disabled']),
          })
          .strict(),
        acg: z
          .object({
            enabled: z.boolean(),
            default_preset: z.enum(['restricted', 'controlled', 'extended', 'unrestricted']),
          })
          .strict(),
        goal_ledger: z
          .object({
            enabled: z.boolean(),
            auto_seed_from_workflow: z.boolean(),
          })
          .strict(),
        mcp: z
          .object({
            required_presets: z.array(z.string()),
            optional_presets: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    observability: z
      .object({
        emit_events: z.array(z.string()),
        produce_execution_trace: z.boolean(),
        retain_artifact_provenance: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AgenticOperationV03 = z.infer<typeof AgenticOperationV03Schema>;

export const OperationLifecycleStatusSchema = z.enum([
  'draft',
  'validated',
  'resolving',
  'ready',
  'running_l1',
  'running_swarm',
  'paused_hitl',
  'paused_master_unavailable',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'expired',
  'terminated_by_guard',
  'crystallized',
  'archived',
]);
export type OperationLifecycleStatus = z.infer<typeof OperationLifecycleStatusSchema>;

export const OperationInstanceStateSchema = z.object({
  instanceId: z.string().min(1),
  sessionId: z.string().min(1),
  operationId: z.string().min(1),
  operationVersion: z.string().min(1),
  operationName: z.string().min(1),
  orchestrationRegime: z.enum(['emergent', 'blueprint_seeded', 'stage_gated']),
  topologyShape: z.enum(['stigmergic', 'hierarchical', 'hybrid', 'pipeline', 'sub_manifold']),
  status: OperationLifecycleStatusSchema,
  synthesizedOnTheFly: z.boolean().default(false),
  sourceDir: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  /** Active realization map: roleId -> array of currently active botIds */
  roleRealizationMap: z.record(z.string(), z.array(z.string())).default({}),
  /** Historical binding map: botId -> all roleIds ever realized by this bot (for strict anti_affinity) */
  botRoleBindings: z.record(z.string(), z.array(z.string())).default({}),
  loopCounters: z.record(z.string(), z.number().int().min(0)).default({}),
  appliedDynamicRuleIds: z.array(z.string()).default([]),
  appliedGrantIds: z.array(z.string()).default([]),
  seededTaskIds: z.array(z.string()).default([]),
  crystallizedToPath: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  definitionSnapshot: AgenticOperationV03Schema,
});
export type OperationInstanceState = z.infer<typeof OperationInstanceStateSchema>;

export const OperationEventSchema = z.object({
  eventId: z.string(),
  timestamp: z.string(),
  sessionId: z.string(),
  instanceId: z.string(),
  operationId: z.string(),
  action: z.string(),
  actorBotId: z.string().optional(),
  reason: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type OperationEvent = z.infer<typeof OperationEventSchema>;
