# Software Requirements Specification (SRS) — Almudaya Multi-Agent v0.3.7

## 1. Functional Requirements (`FR-370`..`FR-382`)

| ID | Deskripsi Kebutuhan | Modul Target |
|---|---|---|
| **FR-370** | Sistem mampu mem-parsing berkas definisi `#Operation` berformat JSON maupun YAML 1.2 terindentasi (komentar `#`, block scalar `>`/`\|`, array/map bersarang, inline array/map) tanpa dependensi eksternal. | `src/operation/yaml-lite.ts` |
| **FR-371** | Sistem memvalidasi struktur `almudaya.operation/v0.3` menggunakan skema Zod ketat (`AgenticOperationV03Schema`) termasuk AST rekursif `PredicateExprSchema` dan skema *runtime state* `OperationInstanceStateSchema`. | `src/operation/schema.ts` |
| **FR-372** | Sistem mengevaluasi AST `PredicateExpr` (`all`, `any`, `not`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`) di atas *namespace* state sesi (`ledger.*`, `protocol.*`, `budget.*`, `gate.*`, `artifact.*`, `candidate.*`, `accepted.*`, `error.*`, `child.*`). | `src/operation/predicates.ts` |
| **FR-373** | Validator semantik statis menegakkan seluruh 9 lapis pemeriksaan (skema `v0.3`, validitas `input_schema`/`output_schema`/`sample-input.json`, paritas `deliverables`, least-privilege `REVIEW_ONLY`, konsistensi `l1_single_agent_fallback` vs `strict_distinct_bot`, resolusi referensi peran & evaluator, keasiklikan DAG `seed_stages` dan `sub_operations`, batas jumlah `budget_share_percent <= 100`, serta kontrak input/output *parent–child*). | `src/operation/validator.ts` |
| **FR-374** | `OperationRegistry` menemukan definisi dari `<workspaceRoot>/operations`, direktori ekstra, dan katalog terpasang `operations/`, serta menyelesaikan alias (`#Operation-*`), ID penuh, maupun slug ekor. | `src/operation/registry.ts` |
| **FR-375** | `OperationManifoldService.applyOperation` menerapkan `#Operation` ke sesi: mengonfigurasi 10 batas `ProtocolConfig`, menonaktifkan aturan dinamis dari Operation sebelumnya lalu menyuntikkan `dynamic_rules`, menyemai `GoalLedger` dari `seed_stages` jika `auto_seed_from_workflow = true`, mengikat peran master `BOT000` dan skill-nya, serta mencatat status awal `running_l1`. | `src/operation/manifold-engine.ts` |
| **FR-376** | `SpawnManager` menegakkan `cardinality.max` per Role Archetype, menolak daur ulang *idle worker* yang melanggar `strict_distinct_bot` `anti_affinity` (memilih bot *idle* lain atau menumbuhkan worker baru), mewariskan `allowed_path_globs` dan `default_access_mode` ke `CapabilityToken`, serta mengikat `skills` & `acg_capabilities` peran melalui `commitWorkerRealization` dan memperbarui status menjadi `running_swarm`. | `src/protocol/spawn-manager.ts`, `src/operation/manifold-engine.ts` |
| **FR-377** | Penyelesaian tugas (`update_goal_task` ke `DONE` atau `submit_task_handoff` ke `TASK_0`) memicu siklus *apoptosis* pekerja dengan `dissolve_on = 'task_completed'` (menjadi `idle` bila `recycle_eligible` atau `stopped` bila tidak), melepaskan `roleRealizationMap` sambil mempertahankan riwayat `botRoleBindings` untuk penegakan `anti_affinity` berikutnya, dan menyusutkan `running_swarm` kembali ke `running_l1` bila tersisa $\le 1$ entitas aktif. | `src/tools/goal-tools.ts`, `src/operation/manifold-engine.ts` |
| **FR-378** | Sistem mendukung sintesis definisi `#Operation` sementara secara *on-the-fly* (`synthesizeAdHocOperation`) dan kristalisasi menjadi paket `almudaya.operation/v0.3` valid di disk (`crystallizeActiveOperation`). | `src/operation/manifold-engine.ts` |
| **FR-379** | `BOT000` menerima perkakas protokol `apply_operation`, `synthesize_operation`, dan `crystallize_operation` yang dijaga oleh `assertMasterActor`. | `src/tools/master-tools.ts` |
| **FR-380** | `AutonomousAgentLoop` dan `buildDynamicSystemPrompt` menyuntikkan konteks `#Operation` aktif, peran terikat, aturan *anti-affinity*, dan Blackboard ACL ke *system prompt*. | `src/ai/prompts.ts`, `src/bot/agent-loop.ts` |
| **FR-381** | CLI menyediakan subperintah `almudaya operation list|inspect|validate|apply|status|evaluate|crystallize` serta opsi `almudaya up --operation <idOrAlias> [--operation-params <jsonOrFile>]`. | `src/cli/commands/operation.ts`, `src/cli/commands/up.ts` |
| **FR-382** | REPL `BotConsole` menyediakan perintah `/operation [list|status|inspect|validate|apply|evaluate|crystallize]` serta dokumentasi pada `/help`. | `src/bot/console.ts` |

---

## 2. Non-Functional Requirements (`NFR-370`..`NFR-373`)
- **NFR-370 (Zero New Runtime Dependencies):** Seluruh parser YAML, validator, dan evaluator predikat dijalankan murni tanpa menambah paket npm baru.
- **NFR-371 (Atomic Persistence & Locking):** Seluruh pembacaan/penulisan `operation/active_instance.json` dan `operation/events.jsonl` berjalan di dalam `storage.withSessionLock` dengan `atomicWriteJson` dan `appendJsonlRecord`.
- **NFR-372 (Fail-Closed Validation):** Operation yang gagal validasi skema, validasi semantik, atau kontrak parameter input wajib ditolak sebelum memodifikasi `ProtocolConfig` maupun `GoalLedger`.
- **NFR-373 (Backward Compatibility):** Seluruh 80 berkas pengujian baseline `v0.3.6` wajib tetap lulus 100% tanpa regresi pada sesi yang tidak memakai `#Operation`.
