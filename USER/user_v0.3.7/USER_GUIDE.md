# Almudaya Multi-Agent v0.3.7 — User & Operator Guide

> [!NOTE]
> Dokumen ini adalah panduan konseptual & arsitektur versi aktif **`v0.3.7`**. Versi terdahulu (`v0.1.0`, `v0.3.0`, `v0.3.5`) diarsipkan tanpa penghapusan pada folder `USER/` (lihat daftar indeks versi pada paket rilis). Untuk skenario pengujian langkah demi langkah berbasis `cmd.exe`, lihat [`USER_TESTING.md`](./USER_TESTING.md).

Panduan konseptual, arsitektural, dan operasional komprehensif untuk pengembang, arsitek sistem, desainer produk, dan operator yang mengelola ekosistem kolaborasi multi-agent otonom **Almudaya Multi-Agent (`almudaya-multiagent` v0.3.7)**.

---

## 1. Filosofi & Arsitektur Sistem Terpadu

Almudaya mengadopsi arsitektur **Session-Centric**, **Multi-Process**, **Persistent Blackboard**, **Dynamic Swarm Manifold (`#Operation v0.3`)**, **PKU Unified Persistent Memory (Spec v0.2)**, **Agent Capability Governance (ACG)**, **Model Context Protocol (MCP)**, serta **Almudaya Visual Design Skills (AVDS v1.0.1)**.

```text
                       ┌───────────────────────────────────────────────────────┐
                       │         Session Blackboard & PKU Memory Store         │
                       │       (sessions/<session_id>/ & pku/universes/)       │
                       │                                                       │
                       │  ┌─────────────────────────────────────────────────┐  │
                       │  │ Global Register (Blackboard)                    │  │
                       │  │ - bots.json, events.jsonl, context.json         │  │
                       │  │ - work_log.jsonl, skills.json                   │  │
                       │  ├─────────────────────────────────────────────────┤  │
                       │  │ Dynamic Swarm Manifold & Protocol Store         │  │
                       │  │ - operation_instance.json (#Operation v0.3)     │  │
                       │  │ - goal_ledger.json, moderator.json, rules.md    │  │
                       │  ├─────────────────────────────────────────────────┤  │
                       │  │ Individual Register (Inbox & ACMA 8 Domains)    │  │
                       │  │ - inbox/<bot_id>/messages.json & cursors.json   │  │
                       │  │ - working, semantic, episodic, procedural, ...  │  │
                       │  ├─────────────────────────────────────────────────┤  │
                       │  │ Project Memory Universe (PMU) & KOE (L0-L3)     │  │
                       │  │ - 8-Domain Knowledge Tree + Knowledge Graph     │  │
                       │  └─────────────────────────────────────────────────┘  │
                       └──────────────────────────▲────────────────────────────┘
                                                  │
                 ┌────────────────────────────────┼────────────────────────────────┐
                 │                                │                                │
      ┌──────────┴───────────┐       ┌────────────┴─────────────┐     ┌────────────┴─────────────┐
      │ Master Bot (BOT000)  │       │ Worker Bot Process 1     │     │ Worker Bot Process 2     │
      │ - Unified HITL REPL  │       │ - RoleArchetype mu_t(r)  │     │ - RoleArchetype mu_t(r)  │
      │ - Operation Engine   │       │ - Ephemeral On-the-Fly   │     │ - Ephemeral On-the-Fly   │
      │ - 10 IProtocol + MCP │       │ - Apocalypse on DONE     │     │ - Anti-Affinity Enforced │
      └──────────┬───────────┘       └────────────┬─────────────┘     └────────────┬─────────────┘
                 │                                │                                │
                 └────────────────────────────────┼────────────────────────────────┘
                                                  ▼
                       ┌───────────────────────────────────────────────────────┐
                       │ Target Project Roots, #Operation v0.3 & AVDS Contracts│
                       │ - File Tools (PrModerator Fence): read/write/edit     │
                       │ - ExecutionController: run_command (ACG + OS Isol.)   │
                       │ - Collaboration & Memory: send_message,               │
                       │   get_work_log, query_pku_memory, use_skill, mcp_*    │
                       └───────────────────────────────────────────────────────┘
```

### Delapan Pilar Arsitektur Almudaya v0.3.7:
1. **Dynamic Swarm Manifold & `#Operation` (`almudaya.operation/v0.3`):** Menggeneralisasi `#Skill` (kemampuan agen tunggal) menjadi `#Operation` (kontrak organisasi multi-agent dinamis). Topologi swarm agent tidak dikodekan kaku pada aplikasi, melainkan terbentuk secara dinamis mengikuti `#Operation` yang dipilih atau disintesis *on-the-fly* saat runtime (`emergent`, `blueprint_seeded`, maupun `stage_gated`).
2. **Master Bot (`BOT000`), Unified Natural Lifecycle & 10 Kelas Protokol Atomic (`IProtocol`):** Tidak memisahkan *classic mode* vs *macro-loop mode*. Tugas sederhana ($L=1$) selesai alami via `TASK_0` dan `PrGate`, sedangkan tugas kompleks ($L>1$) berjalan di bawah tata kelola **10 protokol independen**: `PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrMasterFailover`, `PrGate`, serta `PrReattach`.
3. **Hardening Keamanan & Isolasi Eksekusi `v0.3.6`–`v0.3.7`:**
   - **Master Strict Orchestrator (`masterStrictOrchestrator: true`):** Secara default `BOT000` dilarang menerbitkan token tulis untuk dirinya sendiri maupun memanggil `write_file`/`edit_file` saat worker aktif, sehingga orkestrator tetap murni mengawal koordinasi dan tidak membajak berkas worker.
   - **Non-Wildcard `PrModerator` Write-Fencing (`APP-BUG-12`/`16`/`21`):** Worker yang tidak memegang `CapabilityToken` valid untuk path tertentu tertolak saat menulis; `PrTransfer` mewarisi `targetFiles` konkret tugas serta melarang wildcard `['**/*']` implisit.
   - **Worker Failover & 180s Lease Renewal:** Worker mendukung `--failover` lintas-provider serta perpanjangan *message lease* ke `180 detik` untuk mencegah duplikasi pengiriman selama turn LLM berdurasi panjang.
4. **Session Boundary & Multi-Root Orchestration:** Setiap sesi mengisolasi state dan dapat mengelola banyak direktori proyek (*project roots*) secara bersamaan dengan pelacakan lokasi di `work_log.jsonl`.
5. **Process Isolation & Interactive Bot Console REPL:** Setiap bot berjalan di proses OS terpisah (jendela terminal tersendiri via `--spawn-mode windows` atau `multiplexed`) dengan konsol interaktif *non-blocking*.
6. **Blackboard Durability & Transactional Inbox Delivery:** Operasi baca/tulis dilindungi *atomic write*, *cooperative lock* + *fencing token* monotonik, serta state machine inbox (`RECEIVED` $\rightarrow$ `PROCESSING` $\rightarrow$ `COMPLETED` / `RETRY_PENDING` / `DEAD_LETTER`).
7. **Agent Capability Governance (ACG) & Model Context Protocol (MCP):** Kebijakan *fail-closed*, 4 preset ACG resmi (`restricted`, `controlled`, `extended`, `unrestricted`), sanitasi *environment variables*, *secret redaction*, serta konsumsi/penyajian tool MCP (`almudaya mcp`).
8. **PKU Unified Persistent Memory (Spec v0.2) & AVDS v1.0.1:** Memori pengetahuan deterministik (`query_pku_memory`, KOE L0–L3, PMU 8 domain) dan sistem rekayasa UI/UX lintas platform (40 gaya visual, 13 platform, 10 modalitas).

---

## 2. Pemisahan Wilayah Direktori

```text
┌──────────────────────────────────────────────────────────┐
│ 1. Engine Almudaya (Source Code)                         │ -> D:\almudaya_multiagent_v0.1.0\src\
├──────────────────────────────────────────────────────────┤
│ 2. Katalog #Operation v0.3 & Modul Skill AVDS v1.0.1     │ -> D:\almudaya_multiagent_v0.1.0\operations\ & skill\
├──────────────────────────────────────────────────────────┤
│ 3. Arsip Dokumentasi Penggunaan Lintas-Versi             │ -> D:\almudaya_multiagent_v0.1.0\USER\
├──────────────────────────────────────────────────────────┤
│ 4. Session Blackboard & PKU Store (Runtime / --workspace)│ -> %LOCALAPPDATA%\almudaya\ (atau -w <path>)
├──────────────────────────────────────────────────────────┤
│ 5. Target Proyek yang Digarap Agen                       │ -> D:\testingbot\ (via --root / context root add)
└──────────────────────────────────────────────────────────┘
```

---

## 3. Arsitektur `#Operation` (`almudaya.operation/v0.3`) & Dynamic Swarm Manifold

### 3.1 Dari `#Skill` (Agen Tunggal) ke `#Operation` (Manifold Swarm Multi-Agent)
- **`#Skill`** menanamkan pengetahuan domain atau prosedur ke **satu** agen (misal: gaya desain visual `quantum-futurism` lewat `use_skill`).
- **`#Operation`** mendefinisikan **topologi swarm, pembagian peran, aturan transfer, mekanisme koordinasi, dan kriteria penghentian** bagi **banyak agen** yang lahir dan mati secara dinamis.

### 3.2 Pemisahan `RoleArchetype` dari Proses Bot Ephemeral ($\mu_t$)
Di dalam `#Operation v0.3`, entitas organisasi bersifat **arketipal** (misalnya `developer`, `reviewer`, `triage_lead`, `reproducer`, `patch_crafter`, `regression_verifier`). Pada waktu jalan ($t$), `OperationManifoldService` memetakan arketipe tersebut secara dinamis melalui fungsi realisasi:
$$\mu_t : R_{\text{archetype}} \longrightarrow \mathcal{P}(\text{BotId})$$
1. **Dynamic Spawning (`SpawnManager`):** Saat `BOT000` memanggil `spawn_worker_bot(..., role_archetype: "test_engineer")`, sistem mengikat bot `BOT001`..`BOTxxx` yang baru dibuat (atau dihidupkan kembali) ke arketipe tersebut dalam `roleRealizationMap`.
2. **Penegakan Kardinalitas (`cardinality.max`):** Bila kapasitas arketipe sudah penuh, spawn baru ditolak otomatis untuk mencegah inflasi bot tak terkendali.
3. **Anti-Affinity (`strict_distinct_bot`):** Saat `#Operation` melarang peran pembuat dan penguji dipegang oleh entitas yang sama (misal `developer != reviewer` atau `patch_crafter != regression_verifier`), `PrBotGlobal` dilarang mendaur ulang bot idle pemegang peran terlarang—memaksa lahirnya proses bot independen lain.
4. **Worker Apoptosis on `DONE` & `TASK_0`:** Ketika tugas di `GoalLedger` selesai (`DONE`) atau worker menyerahkan `submit_task_handoff(recipient="TASK_0")`, `handleTaskCompletionLifecycle` mengakhiri/mendaur ulang proses worker yang memang memiliki kebijakan `dissolve_on` dan melepaskan realisasi $\mu_t$ secara bersih (*real-time creation and destruction*).
5. **`L=1` Single-Agent Continuity (`l1_single_agent_fallback`):** Jika tugas cukup ringan sehingga satu agen memadai dan aturan *anti-affinity* tidak dilanggar, sistem dapat menurunkan swarm ke satu pekerja tanpa overhead birokrasi berlebih.

### 3.3 Tiga Rezim Orkestrasi (`orchestration_regime`)
| Rezim | Karakteristik | Contoh Katalog Bawaan |
|---|---|---|
| **`emergent`** | Tidak memakai blueprint statis di awal; agen berkoordinasi lewat papan pesan bersama & kontrak artefak (*stigmergic*). | `#Operation-emergentBugHunt` |
| **`blueprint_seeded`** | Menaburkan kerangka tugas awal (`GoalLedger`) dan aturan transfer peran secara deterministik sambil tetap membuka spawn dinamis. | `#Operation-looping`, `#Operation-multiHierarchyOperation` |
| **`stage_gated`** | Orkestrasi berfase dengan gerbang transisi antar-tahap yang dikawal predikat **OBS** (`PredicateExpr`). | `#Operation-researchPipeline` |

### 3.4 Siklus *On-the-Fly Synthesis* $\rightarrow$ *Crystallization*
Untuk misi yang belum memiliki template di katalog `operations/`:
1. **Synthesize (`synthesize_operation`):** `BOT000` menyintesis definisi `almudaya.operation/v0.3` ad-hoc secara real-time di memori sesi, lengkap dengan arketipe peran dan binding protokol.
2. **Execute:** Worker diciptakan dan dibubarkan mengikuti manifold dinamis tersebut.
3. **Crystallize (`crystallize_operation` / `almudaya operation crystallize` / `/operation crystallize`):** Bila pola kolaborasi tersebut berhasil dan ingin dipakai ulang di proyek lain, operator atau `BOT000` membekukannya menjadi paket `#Operation v0.3` valid (`operation.yaml`, `Operation.md`, `schemas/input.schema.json`, `schemas/output.schema.json`) di `<workspace>/operations/<slug>` yang langsung lulus validator statis 9 lapis.

---

## 4. Arsitektur Memori Persisten Terpadu PKU (Spec v0.2)

### 4.1 Dua Register Memori yang Saling Terhubung
1. **Global Register (Blackboard Integration):**
   - Menangkap fakta tingkat sesi/proyek: metadata sesi, registri bot, project roots, dokumen SDLC, *broadcast events*, dan *work log*.
   - Menyaring *heartbeat churn* (perubahan `last_seen_at` murni tidak membanjiri log pengetahuan PKU).
   - Dapat direkonstruksi secara deterministik dari PKU melalui `reconstructGlobalRegister(sessionId)` (`PKU-010`).
2. **Individual Register (ACMA 8 Cognitive Domains):**
   - Mengelola memori privat per-bot dalam 8 domain kognitif (`working`, `semantic`, `episodic`, `procedural`, `retrieval`, `prospective`, `checkpoint`, `handoff`).
   - Dilindungi oleh **`ScopedMemoryClient`**: Bot B dilarang membaca memori privat (`scope: 'agent'`) milik Bot A kecuali dibagikan eksplisit melalui `sharedKnowledgeIds` saat *handoff* (`PKU-009`, `PKU-011`).

### 4.2 Project Memory Universe (PMU) & Knowledge Optimization Engine (KOE L0–L3)
- Setiap proyek memiliki **PMU** terisolasi dengan 8 domain pohon hierarkis standar (`Identity`, `Requirements`, `Architecture`, `Development`, `Experiments`, `Decisions`, `Tests`, `Roadmap`).
- **Invarian Pemisahan Pohon dari Graf (`PKU-015`):** Memangkas cabang pohon navigasi **tidak pernah** merusak objek pengetahuan bersama.
- **KOE Retrieval L0–L3:**
  - `L0` (Index ~15–25 token), `L1` (Digest ~40–80 token), `L2` (Full Object), `L3` (Raw Evidence + `provenanceRefs`).
- **Standardized PKU-First Reading Policy & Incremental Indexing:** Agen dipandu memanggil **`query_pku_memory`** terlebih dahulu sebelum membaca berkas penuh, dan `write_file`/`edit_file` memperbarui indeks PKU hanya pada berkas yang berubah.

---

## 5. Almudaya Visual Design Skills (AVDS v1.0.1)

**AVDS v1.0.1** mencegah agen menghasilkan antarmuka generik melalui **Pemisahan 3 Dimensi Independen**:
1. **Visual Identity (`styles/` — 40 Profil Gaya Visual):** *Minimalist* (`swiss-international`, `scandinavian`, `japanese-zen`, `monochromatic`, `functionalist`), *Futuristic* (`cyberpunk`, `sci-fi-holographic`, `terminal-hacker`, `quantum-futurism`, `space-exploration`), *Premium* (`glassmorphism`, `neumorphism`, `luxury-minimal`, `gradient-mesh`, `architectural`), *Editorial* (`editorial-magazine`, `neo-brutalist`, `experimental-typography`, `asymmetric-art`, `retro-editorial`), *Organic* (`organic-nature`, `earthy-minimal`, `biophilic`, `botanical`, `eco-tech`), *Corporate* (`corporate-modern`, `academic-institutional`, `fintech-professional`, `civic-digital`, `data-intelligence`), *Playful* (`playful-contemporary`, `pastel-soft`, `memphis-design`, `retro-digital`, `three-dimensional-contemporary`), dan *Specialized* (`scientific-visualization`, `geospatial-cartographic`, `cybersecurity-operations`, `generative-art`, `digital-laboratory`).
2. **Platform Profile (`platform-design/` — 13 Platform):** `web`, `windows-desktop`, `macos-desktop`, `linux-desktop`, `android`, `ios`, `tablet`, `tv`, `wearable`, `automotive`, `industrial-hmi`, `spatial-xr`, `voice-conversational`.
3. **Interaction Modality (`interaction-design/` — 10 Modalitas):** `mouse-pointer`, `keyboard`, `touch`, `stylus`, `voice`, `gesture`, `gaze-spatial`, `remote-dpad`, `haptic`, `multimodal`.

Validasi kontrak desain dapat dijalankan via CLI:
```bash
almudaya skill validate <path-ke-kontrak.json>
```

---

## 6. Model Context Protocol (`almudaya mcp`)

Almudaya mendukung dua arah integrasi **MCP**:
1. **Sebagai MCP Client (`mcp add`, `mcp preset`, `/mcp`):** Menghubungkan `BOT000` dan worker ke server MCP eksternal (`stdio`, `http`, `sse`) yang lolos gerbang ACG `mcp.invoke` (tercakup di preset `extended`).
2. **Sebagai MCP Server (`almudaya mcp serve`):** Mengekspos perkakas Blackboard Almudaya melalui protokol JSON-RPC 2.0 `stdio` agar alat atau IDE eksternal dapat membaca/berkolaborasi dengan sesi Almudaya.

---

## 7. Dukungan Multi-Provider AI (Gemini, NVIDIA NIM, Ollama Lokal, OpenRouter, 9router) & `/model`

1. **Ollama Lokal (`--provider ollama`, default `http://localhost:11434/v1`):**
   - Menjalankan bot dengan model lokal tanpa API key melalui `/v1/models` atau `/api/tags`.
   - **Hardware Spec Advisor (`almudaya bot advisor` / `almudaya bot models --recommend` / `/model recommend`):** Menganalisis CPU, RAM, GPU/VRAM, menandai kecocokan model (`optimal`, `compatible`, `too_heavy`), dan merekomendasikan model cloud gratis.
2. **NVIDIA NIM Langsung (`--provider nvidia`, default `https://integrate.api.nvidia.com/v1`):**
   - Model default resmi **`nvidia/nemotron-3.5-super-vl-120b-a12b`** dengan `NVIDIA_API_KEY` langsung dan *live discovery* `/v1/models`.
3. **9router (`--provider 9router`, default `http://localhost:20128/v1`):**
   - Mendukung router lokal serta *combo routing* (`mycombo`) dengan `NINEROUTER_API_KEY` opsional.
4. **OpenRouter (`--provider openrouter`, default `https://openrouter.ai/api/v1`):**
   - Akses model gratis (seperti `deepseek/deepseek-chat-v3-0324:free`) dan berbayar via `OPENROUTER_API_KEY`.
5. **Google Gemini (`--provider gemini`, default `gemini-2.5-flash`) & Mock (`--provider mock`):**
   - Mendukung adaptive rate-limit retry latch dan failover rantai (`--master-failover` untuk `BOT000`, `--failover` untuk worker).
6. **Pergantian Model Saat Runtime (`/model`):**
   ```text
   Architect> /model recommend
   Architect> /model pull qwen2.5-coder:7b
   Architect> /model qwen2.5-coder:7b ollama
   Architect> /model meta/llama-3.3-70b-instruct nvidia
   ```
