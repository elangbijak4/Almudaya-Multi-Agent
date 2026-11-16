# Data Model & Schema Specifications — Almudaya Multi-Agent v0.3.5

**Versi Dokumen:** 0.3.5  
**Lokasi Penyimpanan Sesi:** `<workspaceRoot>/sessions/<sessionId>/`  

Dokumen ini mendefinisikan struktur data persisten baru dan perluasan skema Zod untuk seluruh 10 protokol atomic, termasuk `moderator_state.json`, `checkpoints/`, `CapabilityToken`, dan `PrTransferEnvelope` pada `v0.3.5`.

---

## 1. Struktur Berkas Blackboard Tambahan (`sessions/<sessionId>/`)

```text
sessions/<sessionId>/
├── session.json
├── bots.json                        <-- [DIPERLUAS] role, isModerator, modelRef, spawnPid, spawnMode
├── shared_context.json
├── work_log.jsonl
├── broadcasts/
├── inbox/                           <-- [DIPERLUAS] threadId, exchangeCount, taskId, transferEnvelope
└── protocol/                        <-- [DIREKTORI BARU v0.3.5]
    ├── config.json                  <-- Konfigurasi batas ke-10 protokol atomic
    ├── state.json                   <-- Penghitung runtime, fenceEpoch, & status Macro-Loop
    ├── goal_ledger.json             <-- Peta Pekerjaan (Tasks, targetFiles[], taskFenceToken, triedModels)
    ├── dynamic_rules.json           <-- Rule on-the-fly yang dibuat MASTER atau HITL
    ├── moderator_state.json         <-- [BARU] State PrModerator: activeModeratorId & CapabilityToken leases
    ├── checkpoints/                 <-- [BARU] Pre-task file snapshots per <taskId>/ untuk rollback PrIterasi
    └── events.jsonl                 <-- Log audit abadi seluruh pemicuan 10 protokol & putusan HITL
```

---

## 2. Skema Data Utama (TypeScript / Zod)

### 2.1 `ProtocolConfigSchema` (`protocol/config.json`)

```typescript
export const SpawnModeSchema = z.enum(['windows', 'multiplexed']);

export const ModelSpecSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string().optional(),
});

export const ProtocolConfigSchema = z.object({
  prBotLimit: z.number().int().min(1).default(10),
  prBotGlobalMax: z.union([z.literal('auto'), z.number().int().min(1)]).default('auto'),
  prIterasiLimit: z.number().int().min(1).default(10),
  prIterasiHandoverLimit: z.number().int().min(1).default(3),
  prDeLimit: z.number().int().min(1).default(10),
  prDeEscalationLimit: z.number().int().min(1).default(10),
  prNoProgressLimit: z.number().int().min(1).default(5),
  prMeEndEnabled: z.boolean().default(true),
  prGateEnabled: z.boolean().default(true),
  prReattachEnabled: z.boolean().default(true),
  moderatorBotId: z.string().default('BOT000'), // 'BOT000' (MASTER), 'auto', atau '<botId>'
  taskTimeoutMs: z.number().int().min(1000).default(180000),
  threadTimeoutMs: z.number().int().min(1000).default(300000),
  globalTimeoutMs: z.union([z.number().int().min(1000), z.literal('infinite')]).default('infinite'),
  tokenBudget: z.number().int().min(1000).default(1000000),
  minFreeMemoryMb: z.number().int().min(64).default(256),
  spawnMode: SpawnModeSchema.default('windows'),
  maxWindows: z.number().int().min(0).default(0),
  masterModel: ModelSpecSchema,
  masterFailoverChain: z.array(ModelSpecSchema).default([]),
  modelPool: z.array(ModelSpecSchema).default([]),
});
```

### 2.2 `ProtocolRuntimeStateSchema` (`protocol/state.json`)

```typescript
export const ThreadTrackerSchema = z.object({
  threadId: z.string(),
  participants: z.array(z.string()),
  exchangeCount: z.number().int().min(0),
  startedAt: z.string(),
  lastMessageAt: z.string(),
  status: z.enum(['ACTIVE', 'MEDIATING', 'RESOLVED', 'ESCALATED_HITL']),
  resolution: z.string().optional(),
});

export const ProtocolRuntimeStateSchema = z.object({
  totalSpawnedWorkers: z.number().int().min(0).default(0),
  activeGlobalBotCount: z.number().int().min(1).default(1), // termasuk BOT000 MASTER
  resolvedHardwareBotCap: z.number().int().min(1).default(10),
  activeModeratorBotId: z.string().default('BOT000'),
  currentFenceEpoch: z.number().int().min(1).default(1),
  totalPrDeTriggers: z.number().int().min(0).default(0),
  totalPrMeEndTriggers: z.number().int().min(0).default(0),
  noProgressHandoffCount: z.number().int().min(0).default(0),
  totalTokensUsed: z.number().int().min(0).default(0),
  sessionStartedAt: z.string(),
  macroLoopStatus: z.enum([
    'IDLE',
    'RUNNING',
    'PAUSED_HITL',
    'PAUSED_MASTER_UNAVAILABLE',
    'GOAL_ACHIEVED',
    'STOPPED',
  ]),
  threads: z.record(z.string(), ThreadTrackerSchema).default({}),
});
```

### 2.3 Skema `PrModerator` & `CapabilityToken` (`protocol/moderator_state.json`)

```typescript
export const AccessModeSchema = z.enum(['EXCLUSIVE_WRITE', 'SHARED_READ', 'REVIEW_ONLY']);

export const CapabilityTokenSchema = z.object({
  tokenId: z.string(),               // mis. "CAP-20261115-0042"
  taskId: z.string(),
  issuedByModeratorId: z.string(),   // 'BOT000' atau ID bot delegasi Moderator
  holderBotId: z.string(),
  fenceEpoch: z.number().int().min(1),
  allowedPaths: z.array(z.string()), // glob/path workspace yang sah disentuh
  allowedComponents: z.array(z.string()), // daftar tool / komponen yang diizinkan
  accessMode: AccessModeSchema,
  status: z.enum(['ACTIVE', 'TRANSFERRED', 'REVOKED', 'EXPIRED']),
  issuedAt: z.string(),
  revokedAt: z.string().optional(),
});

export const ModeratorStateSchema = z.object({
  activeModeratorBotId: z.string().default('BOT000'),
  delegatedByMasterAt: z.string().optional(),
  globalFenceEpoch: z.number().int().min(1).default(1),
  tokens: z.record(z.string(), CapabilityTokenSchema).default({}),
  pendingInterventionCount: z.number().int().min(0).default(0),
  updatedAt: z.string(),
});
```

### 2.4 Skema `PrTransfer` (`PrTransferEnvelope` & `LastWorkPositionLog`)

```typescript
export const TouchedFileStatusSchema = z.object({
  path: z.string(),
  status: z.enum(['CLEAN', 'PARTIAL_WIP', 'NEEDS_REVERT']),
  checkpointPath: z.string().optional(), // path snapshot di protocol/checkpoints/<taskId>/
});

export const LastWorkPositionLogSchema = z.object({
  taskId: z.string(),
  lastCompletedStep: z.string(),
  pendingNextStep: z.string(),
  touchedFiles: z.array(TouchedFileStatusSchema).default([]),
  progressDeltaScore: z.number().min(0).default(0), // 0 = tanpa perubahan kode/progres
  recordedAt: z.string(),
});

export const PrTransferEnvelopeSchema = z.object({
  transferId: z.string(),
  fromBotId: z.string(),
  toBotId: z.string(),
  transferKind: z.enum(['NORMAL_HANDOFF', 'PR_ITERASI_TAKEOVER', 'PR_ME_END_MIGRATION', 'PR_DE_REASSIGN']),
  capabilityToken: CapabilityTokenSchema, // Token yang berpindah tangan dengan fenceEpoch baru
  lastWorkPositionLog: LastWorkPositionLogSchema,
  checkpointRestored: z.boolean().default(false),
});
```

### 2.5 `GoalLedgerSchema` (`protocol/goal_ledger.json`)

```typescript
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

export const HandoverRecordSchema = z.object({
  attempt: z.number().int().min(1),
  fromBotId: z.string(),
  toBotId: z.string(),
  fromModel: z.string(),
  toModel: z.string(),
  reason: z.enum(['ITERATION_LIMIT', 'TASK_TIMEOUT', 'QUOTA_EXHAUSTED', 'ERROR']),
  summary: z.string(),
  checkpointRestored: z.boolean().default(false),
  timestamp: z.string(),
});

export const GoalTaskSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  description: z.string(),
  assignedBotId: z.string().optional(),
  roleHint: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  targetFiles: z.array(z.string()).default([]), // Diverifikasi fisik oleh PrGate sebelum GOAL_ACHIEVED
  acceptanceCriteria: z.array(z.string()).default([]),
  status: GoalTaskStatusSchema.default('PENDING'),
  taskFenceToken: z.number().int().min(1).default(1),
  latestCheckpointId: z.string().optional(),
  lastWorkPositionLog: LastWorkPositionLogSchema.optional(),
  triedModels: z.array(z.string()).default([]),
  handoverCount: z.number().int().min(0).default(0),
  handoverHistory: z.array(HandoverRecordSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const GoalLedgerSchema = z.object({
  sessionId: z.string(),
  blueprintSummary: z.string(),
  tasks: z.array(GoalTaskSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

### 2.6 `DynamicRuleSchema` (`protocol/dynamic_rules.json`)

```typescript
export const DynamicRuleSchema = z.object({
  ruleId: z.string(),
  createdBy: z.string(), // 'MASTER' | 'HITL'
  severity: z.enum(['ADVISORY', 'MANDATORY', 'HARD_STOP']),
  scope: z.enum(['ALL_BOTS', 'SPECIFIC_BOT', 'TASK']).default('ALL_BOTS'),
  targetId: z.string().optional(),
  statement: z.string(),
  active: z.boolean().default(true),
  createdAt: z.string(),
});
```

---

## 3. Perluasan Skema Eksisting (`BotRecord` & `DirectMessage`)

### 3.1 Perluasan `BotRecord` (`src/bot/schema.ts`)
Menambahkan field opsional *backward-compatible*:
- `role?: 'MASTER' | 'WORKER'` (default `'WORKER'`, kecuali `BOT000` `'MASTER'`)
- `isModerator?: boolean` (`true` jika memegang peran aktif `PrModerator`)
- `spawnedBy?: string` (`'HITL' | 'MASTER' | <botId>`)
- `spawnMode?: 'windows' | 'multiplexed' | 'manual'`
- `spawnPid?: number` (PID OS untuk rekonsiliasi `PrReattach` & *auto-reaping* `PrBotGlobal`)
- `modelRef?: string`
- `activeCapabilityTokenId?: string`
- `status`: tambahkan `'paused'` dan `'recycled'` di samping `'starting' | 'running' | 'idle' | 'stopped'`.

### 3.2 Perluasan `DirectMessage` (`src/messaging/schema.ts`)
Menambahkan metadata pelacakan ke-10 protokol:
- `threadId?: string` — ID utas percakapan `PrDE`.
- `taskId?: string` — ID tugas pada `GoalLedger`.
- `exchangeCount?: number` — Nomor urut pertukaran pesan pada `threadId`.
- `ccMaster?: boolean` — Salinan wajib inspeksi `PrMEend` (tanpa menambah counter `PrDE`).
- `isTaskZero?: boolean` — Penanda sinyal selesai (`TASK_0`), memicu **`PrGate`** lalu evaluasi Lapis-2 `MASTER`.
- `recipientStatus?: 'VALID' | 'UNKNOWN' | 'OFFLINE'` — Hasil resolusi penerima oleh Lapis-1 `PrMEend`.
- `messageKind?: 'OPERATOR_INSTRUCTION' | 'TASK_HANDOFF' | 'PEER_DISCUSSION' | 'PROTOCOL_SIGNAL' | 'TASK_ZERO_REPORT' | 'SYSTEM_REPLY'`.
- `transferEnvelope?: PrTransferEnvelope` — Payload wajib protokol **`PrTransfer`** berisi `LastWorkPositionLog` dan transfer `CapabilityToken` untuk pesan tugas.
