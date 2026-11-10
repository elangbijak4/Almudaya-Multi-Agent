import { z } from 'zod';

export const SkillEntryPointSchema = z.enum([
  'design',
  'compose',
  'implement',
  'audit',
  'full-cycle',
  'change',
]);

export type SkillEntryPoint = z.infer<typeof SkillEntryPointSchema>;

export const SkillBindingConfigSchema = z.object({
  primary_style: z.string().min(1).optional(),
  secondary_styles: z.array(z.string().min(1)).max(2).optional(),
  platform: z.string().min(1).optional(),
  modalities: z.array(z.string().min(1)).optional(),
  entry_point: SkillEntryPointSchema.optional(),
  notes: z.string().optional(),
});

export type SkillBindingConfig = z.infer<typeof SkillBindingConfigSchema>;

export const SessionSkillBindingSchema = z.object({
  binding_id: z.string().min(1),
  session_id: z.string().min(1),
  skill_id: z.string().min(1),
  bot_id: z.string().min(1).optional(),
  status: z.enum(['enabled', 'disabled']),
  config: SkillBindingConfigSchema.default({}),
  updated_at: z.string().min(1),
  updated_by: z.string().min(1).default('OPERATOR'),
});

export type SessionSkillBinding = z.infer<typeof SessionSkillBindingSchema>;

export const SessionSkillRegistryFileSchema = z.object({
  session_id: z.string().min(1),
  updated_at: z.string().min(1),
  bindings: z.array(SessionSkillBindingSchema),
});

export type SessionSkillRegistryFile = z.infer<typeof SessionSkillRegistryFileSchema>;

export interface SubSkillDescriptor {
  id: string;
  name: string;
  description: string;
  relativePath: string;
}

export interface StyleSummary {
  id: string;
  name: string;
  family: string;
  philosophy?: string;
  relativePath: string;
}

export interface PlatformSummary {
  id: string;
  title: string;
  characteristics?: string;
  relativePath: string;
}

export interface ModalitySummary {
  id: string;
  name: string;
  description: string;
  relativePath: string;
}

export interface SkillMetadata {
  skill_id: string;
  name: string;
  description: string;
  version: string;
  root_path: string;
  entry_points: SkillEntryPoint[];
  sub_skills: SubSkillDescriptor[];
  styles_count: number;
  platforms_count: number;
  modalities_count: number;
  schemas: string[];
  benchmark_scenarios: string[];
}

export const AVDSDesignContractArtifactSchema = z.object({
  artifact_id: z.string().min(1),
  type: z.enum([
    'design_brief',
    'style_resolution',
    'platform_resolution',
    'composition_plan',
    'component_tree',
    'token_contract',
    'implementation_manifest',
    'qa_report',
    'other',
  ]),
  version: z.string().min(1),
  status: z.string().min(1),
  path: z.string().min(1),
  checksum: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
});

export const AVDSDesignContractSchema = z.object({
  contract_id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semver X.Y.Z'),
  status: z.enum([
    'draft',
    'in_review',
    'approved',
    'implemented',
    'verified',
    'superseded',
    'blocked',
  ]),
  project_id: z.string().min(1),
  workflow_id: z.string().optional(),
  artifacts: z.array(AVDSDesignContractArtifactSchema),
  constraints: z.array(
    z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      priority: z.enum(['must', 'should', 'could', 'wont']),
    })
  ),
  decisions: z.array(z.string()).optional(),
  open_assumptions: z.array(z.string()).optional(),
  handoff: z.object({
    current_phase: z.string().min(1),
    requested_output: z.array(z.string().min(1)),
    acceptance_criteria: z.array(z.string().min(1)),
    assigned_agent_role: z.string().optional(),
  }),
});

export const AVDSCompositionPlanSchema = z.object({
  plan_id: z.string().min(1),
  product_context: z.object({
    primary_task: z.string().min(1),
    secondary_tasks: z.array(z.string()).optional(),
    user_groups: z.array(z.string()).optional(),
    assumptions: z.array(z.string()).optional(),
  }),
  platform: z.object({
    profile: z.string().min(1),
    form_factors: z.array(z.string()).optional(),
    modalities: z.array(z.string()).optional(),
  }),
  visual_identity: z
    .object({
      primary_style: z.string().optional(),
      influences: z.array(z.string()).optional(),
    })
    .optional(),
  archetype: z.object({
    primary: z.string().min(1),
    hybrid_with: z.array(z.string()).optional(),
    rationale: z.string().min(1),
    alternatives_rejected: z.array(z.string()).optional(),
  }),
  regions: z
    .array(
      z.object({
        id: z.string().min(1),
        responsibility: z.string().min(1),
        priority: z.enum(['critical', 'high', 'medium', 'low']),
        composition_operator: z
          .enum([
            'sequence',
            'parallel',
            'contain',
            'overlay',
            'switch',
            'repeat',
            'anchor',
            'flow',
          ])
          .optional(),
        notes: z.string().optional(),
      })
    )
    .min(1),
  navigation_model: z
    .object({
      global: z.string().optional(),
      local: z.string().optional(),
      contextual: z.string().optional(),
    })
    .optional(),
  adaptive_variants: z.array(
    z.object({
      size_class: z.string().min(1),
      structural_changes: z.array(z.string()),
      preserved_priorities: z.array(z.string()).optional(),
    })
  ),
  interaction_map: z.array(
    z.object({
      action: z.string().min(1),
      modality: z.string().min(1),
      alternative: z.string().optional(),
      feedback: z.string().min(1),
    })
  ),
  decisions: z.array(z.string()).optional(),
  validation: z.object({
    task_clarity: z.string().min(1),
    platform_fit: z.string().min(1),
    accessibility_review: z.string().min(1),
    unresolved_risks: z.array(z.string()).optional(),
  }),
});

export const AVDSHandoffEnvelopeSchema = z.object({
  handoff_id: z.string().min(1),
  workflow_id: z.string().min(1),
  from_role: z.string().min(1),
  to_role: z.string().min(1),
  phase: z.string().min(1),
  input_artifacts: z.array(
    z.object({
      artifact_id: z.string().min(1),
      version: z.string().min(1),
      path: z.string().min(1),
      checksum: z.string().optional(),
    })
  ),
  approved_constraints: z.array(z.string()).optional(),
  open_assumptions: z.array(z.string()).optional(),
  requested_output: z.array(z.string().min(1)),
  acceptance_criteria: z.array(z.string().min(1)),
  status: z.enum([
    'queued',
    'accepted',
    'in_progress',
    'returned',
    'reviewed',
    'blocked',
    'rejected',
    'cancelled',
  ]),
  return_artifacts: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export interface SkillContractValidationResult {
  valid: boolean;
  artifactType: 'design-contract' | 'composition-plan' | 'handoff-envelope';
  errors: string[];
  warnings: string[];
}
