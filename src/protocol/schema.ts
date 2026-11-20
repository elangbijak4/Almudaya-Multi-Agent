import { z } from 'zod';
import crypto from 'node:crypto';

export const PROTOCOL_SCHEMA_VERSION = '0.3.6';

export const ProtocolIdSchema = z.enum([
  'PrBot',
  'PrBotGlobal',
  'PrIterasi',
  'PrDE',
  'PrMEend',
  'PrModerator',
  'PrTransfer',
  'PrMasterFailover',
  'PrGate',
  'PrReattach',
]);
export type ProtocolIdValue = z.infer<typeof ProtocolIdSchema>;

export const SpawnModeSchema = z.enum(['windows', 'multiplexed']);
export type SpawnMode = z.infer<typeof SpawnModeSchema>;

export const ModelSpecSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string().optional(),
});
export type ModelSpec = z.infer<typeof ModelSpecSchema>;

export const ProtocolConfigSchema = z.object({
  prBotLimit: z.number().int().min(1).default(10),
  prBotGlobalMax: z.union([z.literal('auto'), z.number().int().min(1)]).default('auto'),
  prIterasiLimit: z.number().int().min(1).default(25),
  prIterasiHandoverLimit: z.number().int().min(1).default(3),
  prDeLimit: z.number().int().min(1).default(10),
  prDeEscalationLimit: z.number().int().min(1).default(10),
  prNoProgressLimit: z.number().int().min(1).default(5),
  prMeEndEnabled: z.boolean().default(true),
  prGateEnabled: z.boolean().default(true),
  prReattachEnabled: z.boolean().default(true),
  masterStrictOrchestrator: z.boolean().default(true),
  moderatorBotId: z.string().default('BOT000'),
  taskTimeoutMs: z.number().int().min(100).default(180000),
  threadTimeoutMs: z.number().int().min(100).default(300000),
  globalTimeoutMs: z.union([z.number().int().min(100), z.literal('infinite')]).default('infinite'),
  tokenBudget: z.number().int().min(100).default(10000000),
  minFreeMemoryMb: z.number().int().min(64).default(256),
  spawnMode: SpawnModeSchema.default('windows'),
  maxWindows: z.number().int().min(0).default(0),
  masterModel: ModelSpecSchema.default({ provider: 'mock', model: 'mock-master' }),
  masterFailoverChain: z.array(ModelSpecSchema).default([]),
  modelPool: z.array(ModelSpecSchema).default([]),
});
export type ProtocolConfig = z.infer<typeof ProtocolConfigSchema>;

export const ThreadTrackerSchema = z.object({
  threadId: z.string(),
  participants: z.array(z.string()).default([]),
  exchangeCount: z.number().int().min(0).default(0),
  startedAt: z.string(),
  lastMessageAt: z.string(),
  status: z.enum(['ACTIVE', 'MEDIATING', 'RESOLVED', 'ESCALATED_HITL']).default('ACTIVE'),
  resolution: z.string().optional(),
});
export type ThreadTracker = z.infer<typeof ThreadTrackerSchema>;

export const ProtocolRuntimeStateSchema = z.object({
  totalSpawnedWorkers: z.number().int().min(0).default(0),
  activeGlobalBotCount: z.number().int().min(1).default(1),
  resolvedHardwareBotCap: z.number().int().min(1).default(10),
  activeModeratorBotId: z.string().default('BOT000'),
  currentFenceEpoch: z.number().int().min(1).default(1),
  totalPrDeTriggers: z.number().int().min(0).default(0),
  totalPrMeEndTriggers: z.number().int().min(0).default(0),
  noProgressHandoffCount: z.number().int().min(0).default(0),
  totalTokensUsed: z.number().int().min(0).default(0),
  sessionStartedAt: z.string().default(() => new Date().toISOString()),
  macroLoopStatus: z
    .enum([
      'IDLE',
      'RUNNING',
      'PAUSED_HITL',
      'PAUSED_MASTER_UNAVAILABLE',
      'GOAL_ACHIEVED',
      'STOPPED',
    ])
    .default('IDLE'),
  threads: z.record(z.string(), ThreadTrackerSchema).default({}),
});
export type ProtocolRuntimeState = z.infer<typeof ProtocolRuntimeStateSchema>;

export const AccessModeSchema = z.enum(['EXCLUSIVE_WRITE', 'SHARED_READ', 'REVIEW_ONLY']);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const CapabilityTokenSchema = z.object({
  tokenId: z.string(),
  taskId: z.string(),
  issuedByModeratorId: z.string(),
  holderBotId: z.string(),
  fenceEpoch: z.number().int().min(1),
  allowedPaths: z.array(z.string()).default([]),
  allowedComponents: z.array(z.string()).default([]),
  accessMode: AccessModeSchema.default('EXCLUSIVE_WRITE'),
  status: z.enum(['ACTIVE', 'TRANSFERRED', 'REVOKED', 'EXPIRED']).default('ACTIVE'),
  issuedAt: z.string(),
  revokedAt: z.string().optional(),
});
export type CapabilityToken = z.infer<typeof CapabilityTokenSchema>;

export const ModeratorStateSchema = z.object({
  activeModeratorBotId: z.string().default('BOT000'),
  delegatedByMasterAt: z.string().optional(),
  globalFenceEpoch: z.number().int().min(1).default(1),
  tokens: z.record(z.string(), CapabilityTokenSchema).default({}),
  pendingInterventionCount: z.number().int().min(0).default(0),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type ModeratorState = z.infer<typeof ModeratorStateSchema>;

export const TouchedFileStatusSchema = z.object({
  path: z.string(),
  status: z.enum(['CLEAN', 'PARTIAL_WIP', 'NEEDS_REVERT']).default('CLEAN'),
  checkpointPath: z.string().optional(),
});
export type TouchedFileStatus = z.infer<typeof TouchedFileStatusSchema>;

export const LastWorkPositionLogSchema = z.object({
  taskId: z.string(),
  lastCompletedStep: z.string(),
  pendingNextStep: z.string(),
  touchedFiles: z.array(TouchedFileStatusSchema).default([]),
  progressDeltaScore: z.number().min(0).default(0),
  recordedAt: z.string(),
});
export type LastWorkPositionLog = z.infer<typeof LastWorkPositionLogSchema>;

export const PrTransferEnvelopeSchema = z.object({
  transferId: z.string(),
  fromBotId: z.string(),
  toBotId: z.string(),
  transferKind: z
    .enum(['NORMAL_HANDOFF', 'PR_ITERASI_TAKEOVER', 'PR_ME_END_MIGRATION', 'PR_DE_REASSIGN'])
    .default('NORMAL_HANDOFF'),
  capabilityToken: CapabilityTokenSchema,
  lastWorkPositionLog: LastWorkPositionLogSchema,
  checkpointRestored: z.boolean().default(false),
});
export type PrTransferEnvelope = z.infer<typeof PrTransferEnvelopeSchema>;

export const GoalTaskStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'HANDOVER_WAIT',
  'PEER_REVIEW',
  'REVISION',
  'DONE',
  'BLOCKED_HITL',
  'CANCELLED',
]);
export type GoalTaskStatus = z.infer<typeof GoalTaskStatusSchema>;

export const HandoverRecordSchema = z.object({
  attempt: z.number().int().min(1),
  fromBotId: z.string(),
  toBotId: z.string(),
  fromModel: z.string(),
  toModel: z.string(),
  reason: z.enum([
    'ITERATION_LIMIT',
    'TASK_TIMEOUT',
    'QUOTA_EXHAUSTED',
    'ERROR',
    'PR_ITERASI',
    'PR_DE',
    'WORKER_CRASH',
    'HITL_REASSIGN',
    'MODEL_UPGRADE',
    'NORMAL_HANDOFF',
    'ME_END_MIGRATION',
  ]),
  summary: z.string(),
  checkpointRestored: z.boolean().default(false),
  newFenceEpoch: z.number().int().positive().optional(),
  timestamp: z.string(),
});
export type HandoverRecord = z.infer<typeof HandoverRecordSchema>;

export const TaskVerificationEvidenceSchema = z.object({
  tested: z.boolean().optional(),
  uiVerified: z.boolean().optional(),
  notes: z.string().optional(),
});
export type TaskVerificationEvidence = z.infer<typeof TaskVerificationEvidenceSchema>;

export const GoalTaskSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  description: z.string(),
  assignedBotId: z.string().optional(),
  roleHint: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  targetFiles: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  status: GoalTaskStatusSchema.default('PENDING'),
  taskFenceToken: z.number().int().min(1).default(1),
  latestCheckpointId: z.string().optional(),
  lastWorkPositionLog: LastWorkPositionLogSchema.optional(),
  verificationEvidence: TaskVerificationEvidenceSchema.optional(),
  triedModels: z.array(z.string()).default([]),
  handoverCount: z.number().int().min(0).default(0),
  handoverHistory: z.array(HandoverRecordSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GoalTask = z.infer<typeof GoalTaskSchema>;

export const GoalLedgerSchema = z.object({
  sessionId: z.string(),
  blueprintSummary: z.string().default(''),
  tasks: z.array(GoalTaskSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GoalLedger = z.infer<typeof GoalLedgerSchema>;

export const DynamicRuleSchema = z.object({
  ruleId: z.string(),
  createdBy: z.string().default('MASTER'),
  severity: z.enum(['ADVISORY', 'MANDATORY', 'HARD_STOP']).default('MANDATORY'),
  scope: z.enum(['ALL_BOTS', 'SPECIFIC_BOT', 'TASK']).default('ALL_BOTS'),
  targetId: z.string().optional(),
  statement: z.string(),
  active: z.boolean().default(true),
  createdAt: z.string(),
});
export type DynamicRule = z.infer<typeof DynamicRuleSchema>;

export const DynamicRulesStoreSchema = z.object({
  sessionId: z.string(),
  rules: z.array(DynamicRuleSchema).default([]),
  updatedAt: z.string(),
});
export type DynamicRulesStore = z.infer<typeof DynamicRulesStoreSchema>;

export const ProtocolEventSchema = z.object({
  eventId: z.string(),
  timestamp: z.string(),
  sessionId: z.string(),
  protocolId: z.string(),
  action: z.string(),
  actorBotId: z.string().optional(),
  taskId: z.string().optional(),
  threadId: z.string().optional(),
  tokenId: z.string().optional(),
  fenceEpoch: z.number().int().optional(),
  reason: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});
export type ProtocolEvent = z.infer<typeof ProtocolEventSchema>;

export function createDefaultProtocolConfig(
  overrides: Partial<ProtocolConfig> = {}
): ProtocolConfig {
  return ProtocolConfigSchema.parse(overrides);
}

export function createDefaultRuntimeState(
  overrides: Partial<ProtocolRuntimeState> = {}
): ProtocolRuntimeState {
  return ProtocolRuntimeStateSchema.parse({
    sessionStartedAt: new Date().toISOString(),
    ...overrides,
  });
}

export function createDefaultModeratorState(
  activeModeratorBotId = 'BOT000'
): ModeratorState {
  return ModeratorStateSchema.parse({
    activeModeratorBotId,
    globalFenceEpoch: 1,
    tokens: {},
    pendingInterventionCount: 0,
    updatedAt: new Date().toISOString(),
  });
}

export function createDefaultGoalLedger(
  sessionId: string,
  blueprintSummary = ''
): GoalLedger {
  const now = new Date().toISOString();
  return GoalLedgerSchema.parse({
    sessionId,
    blueprintSummary,
    tasks: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function generateProtocolId(prefix: string): string {
  const rand = crypto.randomBytes(3).toString('hex');
  return `${prefix}-${Date.now()}-${rand}`;
}
