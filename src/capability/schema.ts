import { z } from 'zod';

export const RiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const KNOWN_CAPABILITIES = [
  'filesystem.read_external',
  'filesystem.write_external',
  'filesystem.delete_external',
  'system.config_access',
  'process.execute_external',
  'network.outbound',
  'command.arbitrary',
  'system.environment_access',
  'system.process_control',
] as const;

export const CapabilityIdSchema = z.enum(KNOWN_CAPABILITIES);
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

export const CapabilityDefinitionSchema = z.object({
  id: z.string(),
  description: z.string(),
  risk: RiskLevelSchema,
  supportedOperations: z.array(z.string()),
  scopeRequired: z.boolean(),
  enforcement: z.string(),
  platformSupport: z.array(z.string()),
});
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;

export const ApprovalModeSchema = z.enum(['per_action', 'session', 'persistent']);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const GrantStatusSchema = z.enum(['active', 'revoked', 'expired']);
export type GrantStatus = z.infer<typeof GrantStatusSchema>;

export const CapabilityScopeSchema = z.object({
  paths: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  hosts: z.array(z.string()).optional(),
  env_vars: z.array(z.string()).optional(),
  operations: z.array(z.string()).optional(),
}).passthrough();
export type CapabilityScope = z.infer<typeof CapabilityScopeSchema>;

export const CapabilityGrantSchema = z.object({
  grant_id: z.string().uuid(),
  capability: z.string(),
  scope: CapabilityScopeSchema,
  granted_by: z.string(),
  granted_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  session_id: z.string(),
  bot_id: z.string().optional(),
  approval_mode: ApprovalModeSchema.default('session'),
  status: GrantStatusSchema.default('active'),
  reason: z.string().optional(),
  revoked_at: z.string().datetime().optional(),
  revoked_by: z.string().optional(),
  revocation_reason: z.string().optional(),
});
export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>;

export const PolicyDecisionSchema = z.enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyEvaluationResultSchema = z.object({
  decision: PolicyDecisionSchema,
  capability: z.string(),
  reason: z.string(),
  matching_grant_id: z.string().optional(),
  requires_approval: z.boolean(),
  risk: RiskLevelSchema,
});
export type PolicyEvaluationResult = z.infer<typeof PolicyEvaluationResultSchema>;

export const SecurityAuditEventTypeSchema = z.enum([
  'CAPABILITY_REQUESTED',
  'CAPABILITY_APPROVED',
  'CAPABILITY_DENIED',
  'CAPABILITY_GRANTED',
  'CAPABILITY_REVOKED',
  'CAPABILITY_EXPIRED',
  'POLICY_EVALUATED',
  'EXECUTION_STARTED',
  'EXECUTION_COMPLETED',
  'EXECUTION_FAILED',
  'EXECUTION_TERMINATED',
  'ISOLATION_FAILURE',
]);
export type SecurityAuditEventType = z.infer<typeof SecurityAuditEventTypeSchema>;

export const SecurityAuditEventSchema = z.object({
  event_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  session_id: z.string(),
  bot_id: z.string().optional(),
  type: SecurityAuditEventTypeSchema,
  capability: z.string().optional(),
  grant_id: z.string().optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type SecurityAuditEvent = z.infer<typeof SecurityAuditEventSchema>;
