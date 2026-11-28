# Kontrak Pemetaan `#Operation v0.3` → Primitif `Almudaya-Multi-Agent v0.3.6`

Dokumen ini menetapkan batas pemetaan 1-ke-1 antara definisi deklaratif `almudaya.operation/v0.3` dan layanan eksekusi nyata di `Almudaya-Multi-Agent`:

| Field di `operation.yaml` (`v0.3`) | Modul / Kontrak di `Almudaya-Multi-Agent` | Peran Saat Eksekusi |
|---|---|---|
| `mission.objective`, `deliverables`, `acceptance_criteria` | `GoalLedgerService` (`src/protocol/goal-ledger.ts`) & `create_goal_blueprint` (`src/tools/master-tools.ts`) | Menginisialisasi ringkasan misi dan kriteria penerimaan tugas di `GoalLedger`. |
| `manifold.roles[].lifecycle` | `SpawnManager` (`src/protocol/spawn-manager.ts`) & `pause_or_kill_bot` | Mengatur *just-in-time spawn*, daur ulang bot idle (`RECYCLED`), dan *apoptosis* pekerja. |
| `manifold.roles[].skills` | `SessionSkillBindingSchema` (`src/skills/schema.ts`) & `SkillService` | Menyemai *skill bindings* aktif per peran (`entry_point` dan `status: enabled`). |
| `manifold.roles[].acg_capabilities` & `integrations.acg` | `CapabilityService` & `PolicyEngine` (`src/capability/`) | Menerbitkan *capability grants* ter-scope (`paths`, `servers`, `tools`) berprinsip *default-deny*. |
| `manifold.roles[].default_access_mode` & `allowed_path_globs` | `PrModeratorArbitrationProtocol` & `CapabilityToken` (`src/protocol/schema.ts`) | Menetapkan `EXCLUSIVE_WRITE`, `SHARED_READ`, atau `REVIEW_ONLY` beserta `fenceEpoch` monotonik. |
| `manifold.anti_affinity` | `SpawnManager` & `ProtocolSupervisor` | Menolak *role coalescing* bagi pasangan `strict_distinct_bot` dan mewajibkan isolasi bot berbeda. |
| `manifold.sub_operations[]` (`delegate_moderator: true`) | `delegate_moderator_role` (`src/tools/master-tools.ts`) & partisi `tokenBudget` | Mendelegasikan arbitrase lokal sub-manifold dengan isolasi anggaran serta deteksi siklus/kedalaman. |
| `communication.dead_end_routing` | `PrMessageEndRoutingProtocol` (`PrMEend`) & `PrDeadEndMediationProtocol` (`PrDE`) | Menangani rute pesan `UNKNOWN` / `TASK_0` serta mediasi utas buntu antar pekerja. |
| `workflow.seed_stages` | `GoalTaskSchema` (`dependsOn`, `targetFiles`, `roleHint`) | Menyemai tugas awal `GoalLedger` saat rezim `blueprint_seeded` atau `stage_gated`; kosong untuk `emergent`. |
| `behavior.protocol_bindings` | `ProtocolConfigSchema` (`src/protocol/schema.ts`) | Mengisi batas `prBotLimit`, `prBotGlobalMax`, `prIterasiLimit`, `prIterasiHandoverLimit`, `prDeLimit`, `prNoProgressLimit`, `prGateEnabled`, `prReattachEnabled`, `masterStrictOrchestrator`, `taskTimeoutMs`, `globalTimeoutMs`, `tokenBudget`, `spawnMode`. |
| `behavior.loops[]` & `recovery` | `PrIterasiHandoverProtocol`, `PrTaskTokenTransferProtocol` (`PrTransfer`), `TaskCheckpointManager` | Mengeksekusi pengulangan berbatas dengan `LastWorkPositionLog`, *rollback* *checkpoint*, dan evaluasi `PredicateExpr`. |
| `governance.dynamic_rules` | `DynamicRulesService` (`src/protocol/dynamic-rules.ts`) | Menyuntikkan aturan `ADVISORY`, `MANDATORY`, atau `HARD_STOP` ke *dynamic system prompt* tiap bot. |
| `governance.hitl_gates` | `ApprovalMode` (`per_action` / `session`) & status `PAUSED_HITL` | Menghentikan sementara aksi berisiko hingga operator memberikan persetujuan eksplisit. |
| `integrations.pku` | `ProjectCodebaseIndexer` & `query_pku_memory` (`src/memory_modules/pku/`) | Menjaga kontinuitas konteks pengetahuan lintas siklus pembuatan dan pemusnahan bot *ephemeral*. |
| `integrations.mcp` | `McpClientManager` (`src/mcp/manager.ts`) & preset `playwright`, `chrome-devtools`, dll. | Membuka akses server MCP (`mcp__<server>__<tool>`) hanya bagi peran yang berhak (`mcp.invoke`). |
