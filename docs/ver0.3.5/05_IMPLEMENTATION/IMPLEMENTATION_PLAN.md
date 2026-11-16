# Implementation & Refactoring Plan — Almudaya Multi-Agent v0.3.5

**Baseline:** `v0.3.4` (`D:\almudaya_multiagent_v0.1.0`)  
**Target:** `v0.3.5`  
**Tanggal:** 2026-11-15  

Dokumen ini menjadi panduan eksekusi bertahap bagi engineer maupun AI agent dalam melakukan revisi dan *refactoring* basis kode `v0.3.4` menuju **Arsitektur Berbasis 10 Protokol Atomic (`IProtocol`) v0.3.5**.

---

## Ringkasan Fase Implementasi (Phase A–F)

| Fase | Judul | Fokus Berkas (`src/`) | Status |
|---|---|---|---|
| **Phase A** | Skema Data, Kontrak `IProtocol` & Persistensi | `src/protocol/contracts.ts`, `src/protocol/schema.ts`, `src/protocol/store.ts`, `src/protocol/checkpoint.ts`, `src/bot/schema.ts`, `src/messaging/schema.ts` | Planned |
| **Phase B** | 10 Kelas Protokol Atomic, Registry, Goal Ledger & Budget | `src/protocol/protocols/*.ts` (`10` kelas `IProtocol`), `src/protocol/registry.ts`, `src/protocol/goal-ledger.ts`, `src/protocol/dynamic-rules.ts`, `src/protocol/budget-tracker.ts`, `src/protocol/supervisor.ts` | Planned |
| **Phase C** | AI Failover, Spawn Manager, & Integrasi Write Fencing | `src/ai/failover-provider.ts`, `src/protocol/spawn-manager.ts`, `src/execution/controller.ts`, `src/capability/policy-engine.ts` | Planned |
| **Phase D** | Refactoring AgentLoop, Tools, Prompt & Console | `src/bot/agent-loop.ts`, `src/bot/runtime.ts`, `src/bot/console.ts`, `src/ai/prompts.ts`, `src/tools/master-tools.ts`, `src/tools/goal-tools.ts` | Planned |
| **Phase E** | Master/Moderator Logic & Entrypoint CLI `almudaya up` | `src/protocol/master-agent.ts`, `src/cli/commands/up.ts`, `src/cli/index.ts` | Planned |
| **Phase F** | Verification (`TC-350-01..20`), Build, Regresi & Release | `tests/protocol/*.test.ts`, `tests/e2e/macro-loop-lifecycle.test.ts`, `package.json`, `src/core/version.ts` | Planned |

---

## Rincian Langkah per Fase

### Phase A: Fondasi Kontrak Atomic, Skema & Persistensi Protokol
1. Buat `src/protocol/contracts.ts` mendefinisikan `IProtocol<TContext, TDecision>`, `ProtocolId` (10 butir protokol), `InterventionPriority` (`0..5`), dan `ProtocolEvaluation`.
2. Buat `src/protocol/schema.ts` sesuai `04_DESIGN/DATA_MODEL.md` (`ProtocolConfigSchema`, `ProtocolRuntimeStateSchema`, `CapabilityTokenSchema`, `ModeratorStateSchema`, `LastWorkPositionLogSchema`, `PrTransferEnvelopeSchema`, `GoalLedgerSchema`, `DynamicRuleSchema`, `ProtocolEventSchema`).
3. Buat `src/protocol/store.ts` menggunakan utilitas atomic write & file locking di `src/core/lock.ts` / `src/core/fs-utils.ts` termasuk persistensi `protocol/moderator_state.json`.
4. Buat `src/protocol/checkpoint.ts` untuk membuat snapshot ringan berkas sebelum modifikasi (`protocol/checkpoints/<taskId>/`), memulihkan snapshot pada `NEEDS_REVERT`, dan melakukan *auto-prune* setelah tugas berstatus `DONE`.
5. Perluas `src/bot/schema.ts` (`role?`, `isModerator?`, `spawnedBy?`, `spawnMode?`, `spawnPid?`, `modelRef?`, `activeCapabilityTokenId?`, status `'paused'` & `'recycled'`) dan `src/messaging/schema.ts` (`threadId?`, `taskId?`, `exchangeCount?`, `ccMaster?`, `isTaskZero?`, `recipientStatus?`, `messageKind?`, `transferEnvelope?`) secara *backward-compatible*.

### Phase B: 10 Kelas Protokol Atomic & `ProtocolRegistry`
1. Buat `src/protocol/goal-ledger.ts` (`GoalLedgerService` termasuk `targetFiles[]`, `taskFenceToken`, dan `latestCheckpointId`) dan `src/protocol/dynamic-rules.ts` (`DynamicRulesService`).
2. Buat `src/protocol/budget-tracker.ts` (token usage, `taskTimeoutMs`, `threadTimeoutMs`, `globalTimeoutMs` `ms | 'infinite'`, dan integrasi `inspectHardware()` dari `src/ai/hardware-advisor.ts`).
3. Implementasikan seluruh **10 Kelas Protokol Atomic (`IProtocol`)** di `src/protocol/protocols/`:
   - `pr-bot.protocol.ts` (`PrBotSpawnQuotaProtocol`)
   - `pr-bot-global.protocol.ts` (`PrBotGlobalCeilingProtocol` + *Bot Recycling / Auto-Reaping*)
   - `pr-iterasi.protocol.ts` (`PrIterasiHandoverProtocol` + *Single-Model Pool Fallback* bertingkat)
   - `pr-de.protocol.ts` (`PrDeadEndMediationProtocol` + deteksi *Zero-Progress Circular Relay* bersama `PrTransfer`)
   - `pr-me-end.protocol.ts` (`PrMessageEndRoutingProtocol`, inspeksi 2-lapis, migrasi pesan & `TASK_0`)
   - `pr-moderator.protocol.ts` (`PrModeratorArbitrationProtocol`, manajemen `CapabilityToken` & `fenceEpoch`, delegasi peran Moderator)
   - `pr-transfer.protocol.ts` (`PrTaskTokenTransferProtocol`, validasi `PrTransferEnvelope`, pemindahan `CapabilityToken`, `LastWorkPositionLog`)
   - `pr-master-failover.protocol.ts` (`PrMasterFailoverProtocol`)
   - `pr-gate.protocol.ts` (`PrObjectiveGateProtocol`, verifikasi fisik disk & `GoalLedger` sebelum `Tugas 0` disahkan)
   - `pr-reattach.protocol.ts` (`PrSessionReattachProtocol`, rekonsiliasi PID & *heartbeat* saat sesi di-resume)
4. Buat `src/protocol/registry.ts` (`ProtocolRegistry` + **`MasterInterventionQueue`** prioritas `P0..P5`) serta `src/protocol/supervisor.ts` sebagai façade orkestrasi.

### Phase C: Failover, Spawn Manager & Write Fencing (`CapabilityToken`)
1. Buat `src/ai/failover-provider.ts` (`FailoverAIProvider` untuk `MASTER` dan bot Moderator delegasi).
2. Buat `src/protocol/spawn-manager.ts`: peluncur mode `windows` (Win/Mac/Linux) & `multiplexed`, dukungan `--max-windows`, deteksi *headless/CI*, metode `hotSwapBotModel()` / `reapBotProcess()`, dan integrasi **`PrReattach`**.
3. Perbarui `src/execution/controller.ts` dan `src/capability/policy-engine.ts` agar setiap tool mutasi (`write_file`, `edit_file`, `run_command`) memeriksa `CapabilityToken` + `fenceEpoch` aktif dari `PrModerator` guna memblokir *zombie worker overwrite*.

### Phase D: Refactoring `AutonomousAgentLoop`, `BotConsole` & Tools
1. **`src/ai/prompts.ts`:** Suntikkan `DynamicRules`, `GoalLedger`, hak `CapabilityToken` bot aktif, serta instruksi *Macro-Loop* wajib (`PrTransferEnvelope` + `CC: MASTER`).
2. **`src/tools/master-tools.ts` & `src/tools/goal-tools.ts`:**
   - Worker tools: `request_spawn_bot`, `update_goal_task`, `submit_task_handoff` (otomatis mengisi `PrTransferEnvelope` + `ccMaster: true`).
   - Master / Moderator tools: `manage_dynamic_rule`, `delegate_moderator_role`, `issue_capability_token`, `spawn_worker_bot`, `pause_or_kill_bot`, `resolve_deadend_thread`, `reassign_handover_task`, `migrate_stalled_message`, `mark_goal_achieved` (terkunci di balik `PrGate`).
3. **`src/bot/agent-loop.ts`:**
   - Hubungkan batas iterasi/timeout/`402` ke `PrIterasi` (termasuk kenaikan `fenceEpoch` via `PrModerator`).
   - Ganti guard `APP-BUG-04` dengan `PrDE` (`threadId`, `exchangeCount`, `noProgressHandoffCount`).
   - Wajibkan validasi `PrTransfer` & inspeksi Lapis-1 `PrMEend` sebelum pengiriman pesan tugas.
4. **`src/bot/console.ts` & `src/bot/runtime.ts`:**
   - Dukungan status `MASTER`/Moderator, dialog eskalasi HITL, multiplexer log, pre-task snapshot saat memulai tugas, *in-place model hot-swap*, serta slash commands `/protocol`, `/blueprint`, `/rules`, `/bots`, `/spawn-mode`, dan `/moderator`.

### Phase E: Master Agent & Perintah `almudaya up`
1. Buat `src/protocol/master-agent.ts` (`MasterAgentOrchestrator`) menjalankan `MasterInterventionQueue` berseri (`P0..P5`), pemetaan `goal_ledger.json`, penanganan delegasi `PrModerator`, dan dialog HITL.
2. Buat `src/cli/commands/up.ts` (`almudaya up` / `start` / `master`) dengan seluruh flag CLI ke-10 protokol (`--pr-bot`, `--pr-bot-global`, `--pr-iterasi`, `--pr-iterasi-handover`, `--pr-de`, `--pr-de-escalation`, `--pr-no-progress`, `--pr-me-end`, `--pr-gate`, `--pr-reattach`, `--moderator-bot`, `--task-timeout`, `--thread-timeout`, `--global-timeout`, `--token-budget`, `--spawn-mode`, `--max-windows`, dll.).

### Phase F: Pengujian Menyeluruh (`TC-350-01..20`) & Penyelesaian Versi
1. Tulis unit, integration, & E2E tests untuk seluruh 10 protokol atomic di `tests/protocol/`, `tests/ai/master-failover.test.ts`, `tests/cli/protocol-cli.test.ts`, `tests/master/master-startup.test.ts`, dan `tests/e2e/macro-loop-lifecycle.test.ts`.
2. Pastikan seluruh **437** test regresi `v0.3.4` tetap lulus (`0 failed`).
3. Bump versi ke `0.3.5` pada `package.json`, `src/core/version.ts`, dan sinkronkan dokumentasi pengguna (`README.md`, `USER_MANUAL.md`, `USER_GUIDE.md`, `USER_TUTORIAL.md`).
