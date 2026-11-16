# System Design & Architecture — Almudaya Multi-Agent v0.3.5

**Versi Dokumen:** 0.3.5  
**Baseline:** `v0.3.4` (`src/` & `tests/`)  
**Tanggal:** 2026-11-15  

Dokumen ini menjabarkan struktur direktori kode target, kontrak antarmuka **10 Butir Protokol Atomic (`IProtocol`)**, desain kelas `ProtocolRegistry`, `PrModerator`, `PrTransfer`, `PrGate`, `PrReattach`, perintah CLI, slash commands, dan mekanisme peluncuran proses anak untuk **v0.3.5**.

---

## 1. Struktur Modul Target (`src/`)

Seluruh logika tata kelola v0.3.5 dikelompokkan modular dalam `src/protocol/` (dengan kelas protokol atomic di `src/protocol/protocols/`) dan diintegrasikan ke lapisan yang ada (`src/execution/`, `src/capability/`, `src/bot/`, `src/ai/`, `src/messaging/`, `src/tools/`, `src/cli/`):

```text
src/
├── cli/
│   ├── index.ts                     <-- Daftarkan perintah `almudaya up` (dan alias `start`, `master`)
│   └── commands/
│       ├── up.ts                    <-- [BARU] Entrypoint Master-HITL + seluruh flag 10 protokol
│       └── bot.ts                   <-- Dipertahankan & kompatibel penuh dengan Session v0.3.5
├── protocol/                        <-- [MODUL BARU v0.3.5] Mesin 10 Protokol Atomic
│   ├── contracts.ts                 <-- Interface IProtocol<TContext, TDecision>, ProtocolId, Evaluation
│   ├── registry.ts                  <-- ProtocolRegistry + MasterInterventionQueue (Prioritas P0..P5)
│   ├── protocols/                   <-- [10 KELAS PROTOKOL ATOMIC]
│   │   ├── pr-bot.protocol.ts             <-- PrBotSpawnQuotaProtocol
│   │   ├── pr-bot-global.protocol.ts      <-- PrBotGlobalCeilingProtocol (+ Bot Recycling)
│   │   ├── pr-iterasi.protocol.ts         <-- PrIterasiHandoverProtocol (+ Single-Model Fallback)
│   │   ├── pr-de.protocol.ts              <-- PrDeadEndMediationProtocol (+ Circular Relay)
│   │   ├── pr-me-end.protocol.ts          <-- PrMessageEndRoutingProtocol
│   │   ├── pr-moderator.protocol.ts       <-- PrModeratorArbitrationProtocol (CapabilityToken & Delegasi)
│   │   ├── pr-transfer.protocol.ts        <-- PrTaskTokenTransferProtocol (LastWorkPositionLog + Token)
│   │   ├── pr-master-failover.protocol.ts <-- PrMasterFailoverProtocol
│   │   ├── pr-gate.protocol.ts            <-- PrObjectiveGateProtocol (Verifikasi Fisik Tugas 0)
│   │   └── pr-reattach.protocol.ts        <-- PrSessionReattachProtocol (Rekonsiliasi PID Startup)
│   ├── schema.ts                    <-- Skema Zod seluruh berkas protocol/*.json & PrTransferEnvelope
│   ├── store.ts                     <-- Persistensi atomik di Session Blackboard (protocol/*.json)
│   ├── checkpoint.ts                <-- Manajemen Pre-Task File Snapshot (protocol/checkpoints/<taskId>/)
│   ├── goal-ledger.ts               <-- GoalLedgerService (Peta Pekerjaan, targetFiles & Acceptance Criteria)
│   ├── dynamic-rules.ts             <-- DynamicRulesService (Rule on-the-fly yang diinjeksi ke Prompt)
│   ├── budget-tracker.ts            <-- Budget & Timeout Circuit Breaker (token, waktu, HardwareAdvisor)
│   ├── spawn-manager.ts             <-- SpawnManager (Mode 'windows' vs 'multiplexed' + Reattach)
│   ├── supervisor.ts                <-- ProtocolSupervisor (Façade orkestrasi ProtocolRegistry)
│   ├── master-agent.ts              <-- Logika evaluasi Master Bot + Dialog Eskalasi HITL
│   └── index.ts
├── execution/
│   └── controller.ts                <-- [DIPERBARUI] Validasi CapabilityToken + fenceEpoch sebelum mutasi
├── capability/
│   └── policy-engine.ts             <-- [DIPERBARUI] Evaluasi hak workspace/komponen berbasis CapabilityToken
├── ai/
│   ├── failover-provider.ts         <-- [BARU] FailoverAIProvider untuk PrMasterFailover
│   ├── prompts.ts                   <-- [DIPERBARUI] Injeksi DynamicRules, GoalLedger, Hak Token, & Macro-Loop
│   └── ...
├── bot/
│   ├── agent-loop.ts                <-- [REFACTOR] Terhubung ke PrIterasi, PrDE, PrMEend, PrTransfer
│   ├── console.ts                   <-- [REFACTOR] Multiplexed Child Logs, Prompt HITL, Slash Commands v0.3.5
│   ├── runtime.ts                   <-- [DIPERBARUI] Role MASTER/MODERATOR/WORKER, checkpoint, hot-swap model
│   └── service.ts                   <-- [DIPERBARUI] Field role, isModerator, modelRef, spawnPid, paused
├── messaging/
│   └── schema.ts                    <-- [DIPERBARUI] Tambah threadId, exchangeCount, taskId, transferEnvelope
└── tools/
    ├── master-tools.ts              <-- [BARU] manage_dynamic_rule, delegate_moderator_role, issue_capability_token, resolve_deadend, migrate_stalled_message, mark_goal_achieved
    ├── goal-tools.ts                <-- [BARU] request_spawn_bot, update_goal_task, submit_task_handoff (PrTransfer)
    └── index.ts                     <-- Filter visibilitas tool berdasar role (MASTER / MODERATOR / WORKER)
```

---

## 2. Desain Kontrak Atomic & Kelas Protokol Utama

### 2.1 Kontrak Atomic `IProtocol<TContext, TDecision>` (`src/protocol/contracts.ts`)

```typescript
export type ProtocolId =
  | 'PrBot'
  | 'PrBotGlobal'
  | 'PrIterasi'
  | 'PrDE'
  | 'PrMEend'
  | 'PrModerator'
  | 'PrTransfer'
  | 'PrMasterFailover'
  | 'PrGate'
  | 'PrReattach';

export type InterventionPriority = 0 | 1 | 2 | 3 | 4 | 5;
// P0: PrMasterFailover, PrBotGlobal
// P1: PrIterasi
// P2: PrDE
// P3: PrMEend, PrGate
// P4: PrModerator, PrTransfer
// P5: PrBot

export interface ProtocolEvaluation<TDecision = ProtocolDecision> {
  protocolId: ProtocolId;
  triggered: boolean;
  priority: InterventionPriority;
  decision: TDecision;
  auditMetadata?: Record<string, unknown>;
}

export interface IProtocol<TContext = unknown, TDecision = ProtocolDecision> {
  readonly protocolId: ProtocolId;
  readonly version: string; // '0.3.5'
  readonly isEnabled: boolean;
  configure(limits: Partial<ProtocolConfig>): void;
  evaluate(ctx: TContext): Promise<ProtocolEvaluation<TDecision>>;
  enforce(decision: TDecision, ctx: TContext): Promise<void>;
  getStateSnapshot(): Record<string, unknown>;
}
```

### 2.2 `ProtocolRegistry` & `MasterInterventionQueue` (`src/protocol/registry.ts`)

- Menyimpan instance ke-10 kelas `IProtocol`, mengoordinasikan `configure()` saat startup maupun `/protocol set`, dan menyediakan `getStateSnapshot()` gabungan untuk konsol `/protocol`.
- Mengelola **`MasterInterventionQueue`**: setiap event yang memerlukan campur tangan `MASTER` (atau `Moderator`) masuk ke antrean serial terurut berdasarkan `InterventionPriority` (`P0` $\rightarrow$ `P5`), menjamin tidak ada tabrakan penulisan `goal_ledger.json` maupun `moderator_state.json` ketika 5–8 bot anak memicu protokol pada detik yang bersamaan (menutup Celah 6).

### 2.3 Protokol `PrModerator` (`src/protocol/protocols/pr-moderator.protocol.ts`)

- **Pemegang Peran:** Default dipegang oleh **`BOT000` (`MASTER`)**, tetapi `MASTER` dapat mendelegasikan kewenangan ini ke bot pekerja (misal `--moderator-bot BOT_MOD` atau via tool `delegate_moderator_role`), dan mengambilnya kembali (`/moderator reclaim`).
- **Token Hak Kerja (`CapabilityToken`):**
  - Menerbitkan token dengan `tokenId`, `holderBotId`, `fenceEpoch`, `allowedPaths`, `allowedComponents`, dan `accessMode` (`'EXCLUSIVE_WRITE' | 'SHARED_READ' | 'REVIEW_ONLY'`).
  - Memvalidasi token sebelum tool mutasi dijalankan di `ExecutionModeController` & `CapabilityPolicyEngine` (`src/execution/controller.ts`, `src/capability/policy-engine.ts`).
  - Saat `PrIterasi` atau `PrTransfer` memindahkan hak tugas, `fenceEpoch` dinaikkan (`+1`), otomatis membatalkan hak bot sebelumnya sehingga percobaan tulis terlambat (*zombie overwrite*) gagal secara deterministik (menutup Celah 1).

### 2.4 Protokol `PrTransfer` (`src/protocol/protocols/pr-transfer.protocol.ts`) & Checkpointing

- Setiap pesan estafet/delegasi tugas di `send_message` maupun handover `PrIterasi`/`PrMEend` wajib lolos validasi `PrTransferEnvelope`:
  1. **`lastWorkPositionLog`:** memuat `taskId`, `lastCompletedStep`, `pendingNextStep`, `touchedFiles[]` (`CLEAN | PARTIAL_WIP | NEEDS_REVERT` + pointer `checkpointPath`), dan `progressDeltaScore`.
  2. **`capabilityTokenTransfer`:** memindahkan kepemilikan `CapabilityToken` dari pengirim ke penerima dan menaikkan `fenceEpoch + 1` secara atomik dalam satu transaksi lock Blackboard.
- **Pre-Task Checkpoint (`src/protocol/checkpoint.ts`):** Sebelum bot mulai memodifikasi berkas target tugas, kernel menyalin versi bersih ke `sessions/<id>/protocol/checkpoints/<taskId>/`. Jika terjadi `PrIterasi` handover dan berkas berstatus `NEEDS_REVERT`, model pengganti menerima berkas yang telah dipulihkan ke titik bersih (menutup Celah 2).
- **Zero-Progress Circular Relay Check (menutup Celah 3):** Setiap kali `progressDeltaScore === 0` dan `GoalLedger` tidak berubah selama transfer tugas, penghitung `noProgressHandoffCount` naik; jika menyentuh `prNoProgressLimit` (default `5`), `PrTransfer` & Lapis-1 `PrMEend` melempar kasus ke **`PrDE`** untuk mediasi `MASTER`.

### 2.5 Penguatan `PrIterasi`, `PrBotGlobal`, `PrGate`, & `PrReattach`

1. **`PrIterasiHandoverProtocol` (`pr-iterasi.protocol.ts`):**
   - `selectNextDistinctModel(triedModels, modelPool, catalogProviders)`: memilih secara bertingkat: (1) model berbeda di `modelPool`, (2) jika `modelPool` hanya berisi 1 model, cari model lain yang terautentikasi di `ModelCatalog`, (3) jika hanya ada 1 model tunggal aktif, jalankan *Clean-Context & Master-Hint Handover* disertai notifikasi HITL (menutup Celah 5).
2. **`PrBotGlobalCeilingProtocol` (`pr-bot-global.protocol.ts`):**
   - Selain mengecek spek laptop (`HardwareAdvisor`), `tokenBudget`, dan `globalTimeoutMs` (`ms | 'infinite'`), menerapkan **Bot Recycling / Auto-Reaping**: saat `PrIterasi` melakukan penggantian model, bot lama di-*hot-swap* modelnya secara in-place atau proses OS-nya di-*reap* bersih sehingga `activeGlobalBotCount` & jendela OS tidak bocor (menutup Celah 4).
3. **`PrObjectiveGateProtocol` (`pr-gate.protocol.ts`):**
   - Sebelum `MASTER` mengesahkan `TASK_0` pada `PrMEend`, `PrGate` memeriksa `goal_ledger.json` (seluruh tugas `DONE`/`CANCELLED`) dan mengecek disk (`fs.existsSync` + `stat.size > 0`) untuk seluruh `targetFiles[]` (menutup Celah 7).
4. **`PrSessionReattachProtocol` (`pr-reattach.protocol.ts`):**
   - Saat startup sesi lama (`almudaya up -s <existing>`), memeriksa PID OS (`process.kill(pid, 0)`) dan *heartbeat* di `bots.json`. Proses anak hidup langsung di-*reattach* tanpa spawn ganda; proses mati dengan tugas `IN_PROGRESS` di-*respawn* aman (menutup Celah 8).

### 2.6 `SpawnManager` (`src/protocol/spawn-manager.ts`) & `FailoverAIProvider` (`src/ai/failover-provider.ts`)
- **`SpawnManager`:** Mendukung `windows` (default: `wt.exe`/`powershell.exe`/`cmd.exe`, macOS `osascript`, Linux terminal emulators) dan `multiplexed` (`stdio` dialirkan sebagai `[BOT00X]`), menghormati `--max-windows`, serta mendukung `hotSwapBotModel()` dan `reapBotProcess()` untuk `PrBotGlobal`/`PrReattach`.
- **`FailoverAIProvider`:** Membungkus provider `MASTER` (dan bot pemegang delegasi `PrModerator`), berpindah otomatis menyusuri `masterFailoverChain` pada HTTP `402`/`401`/`403`/`429`/timeout.

---

## 3. Desain Antarmuka CLI & Perintah Konsol v0.3.5

### 3.1 Perintah Utama Baru: `almudaya up` (Alias: `almudaya start`, `almudaya master`)

```bash
almudaya up \
  -s S_QUANTUM \
  -w D:\QuantumLabs \
  --master-provider nvidia \
  --master-model nvidia/nemotron-3-super-120b-a12b \
  --master-failover gemini:gemini-2.5-flash ollama:qwen2.5-coder:7b \
  --model-pool nvidia:nvidia/nemotron-3-super-120b-a12b ollama:qwen2.5-coder:7b gemini:gemini-2.5-pro \
  --spawn-mode windows \
  --moderator-bot auto \
  --pr-bot 10 \
  --pr-bot-global auto \
  --pr-iterasi 10 \
  --pr-iterasi-handover 3 \
  --pr-de 10 \
  --pr-de-escalation 10 \
  --pr-no-progress 5 \
  --pr-me-end on \
  --pr-gate on \
  --pr-reattach on \
  --task-timeout 180000 \
  --thread-timeout 300000 \
  --global-timeout infinite \
  --token-budget 1000000 \
  --blueprint ./blueprint.md
```

**Daftar Flag Konfigurasi Protokol:**

| Flag CLI | Tipe | Default | Protokol Terkait / Fungsi |
|---|---|---:|---|
| `--spawn-mode <mode>` | `'windows' \| 'multiplexed'` | `'windows'` | Cara melahirkan terminal bot anak |
| `--max-windows <n>` | `number` | `0` (tak dibatasi) | Batas jendela OS sebelum otomatis pakai `multiplexed` |
| `--pr-bot <n>` | `number` | `10` | **`PrBot`:** Batas pembuatan bot otonom sebelum HITL |
| `--pr-bot-global <auto\|n>` | `'auto' \| number` | `'auto'` | **`PrBotGlobal`:** Plafon global termasuk `MASTER` |
| `--pr-iterasi <n>` | `number` | `10` | **`PrIterasi`:** Batas iterasi tool sebelum diambil alih Master |
| `--pr-iterasi-handover <n>` | `number` | `3` | **`PrIterasi`:** Batas maksimal pengalihan lintas model |
| `--pr-de <n>` | `number` | `10` | **`PrDE`:** Batas pertukaran ping-pong per utas |
| `--pr-de-escalation <n>` | `number` | `10` | **`PrDE`:** Batas pemicuan `PrDE` per sesi sebelum HITL |
| `--pr-no-progress <n>` | `number` | `5` | **`PrTransfer` + `PrDE`:** Batas estafet berturut-turut dengan `progressDeltaScore === 0` |
| `--pr-me-end <on\|off>` | `boolean` | `on` | **`PrMEend`:** Pesan lanjutan + `CC: MASTER`, migrasi & `Tugas 0` |
| `--moderator-bot <id\|auto>` | `string` | `'BOT000'` (`MASTER`) | **`PrModerator`:** Menentukan pemegang peran penengah/token |
| `--pr-gate <on\|off>` | `boolean` | `on` | **`PrGate`:** Verifikasi fisik disk sebelum `GOAL_ACHIEVED` |
| `--pr-reattach <on\|off>` | `boolean` | `on` | **`PrReattach`:** Rekonsiliasi PID proses anak saat resume |
| `--task-timeout <ms>` | `number` | `180000` | Batas waktu per giliran tugas (`PrIterasi`) |
| `--thread-timeout <ms>` | `number` | `300000` | Batas waktu per utas diskusi (`PrDE`) |
| `--global-timeout <ms\|infinite>` | `number \| 'infinite'` | `'infinite'` | Batas waktu global sesi (`PrBotGlobal`) |
| `--token-budget <tokens>` | `number` | `1000000` | Anggaran total token sesi sebelum HITL |
| `--master-provider <p>` | `CatalogProviderId` | auto-detect | Provider utama `MASTER` (`BOT000`) |
| `--master-model <m>` | `string` | default provider | Model utama `MASTER` (`BOT000`) |
| `--master-failover <list...>` | `string[]` | `[]` | Rantai cadangan untuk **`PrMasterFailover`** |
| `--model-pool <list...>` | `string[]` | auto-catalog | Kolam model berbeda untuk rotasi **`PrIterasi`** |
| `--blueprint <path>` | `string` | - | Berkas Peta Pekerjaan awal |

### 3.2 Perintah Slash Konsol Tambahan di `BotConsole` (`v0.3.5`)
- `/protocol [show | set <key> <val>]` — Menampilkan snapshot seluruh 10 protokol atomic atau menyetel batas secara *live*.
- `/blueprint [show | check | add <task>]` — Menampilkan item `goal_ledger.json`, `targetFiles`, serta hasil cek `PrGate`.
- `/rules [list | add <rule> | remove <id>]` — Memeriksa/mengubah aturan dinamis `dynamic_rules.json`.
- `/bots [list | pause <id> | resume <id> | kill <id>]` — Mengendalikan proses bot anak.
- `/spawn-mode [windows | multiplexed]` — Mengubah mode peluncuran bot anak saat runtime.
- `/moderator [status | delegate <botId> | reclaim | tokens]` — Memeriksa pemegang jabatan `PrModerator`, mendelegasikan/menarik kembali peran Penengah, serta mengaudit daftar `CapabilityToken` dan `fenceEpoch` aktif.
