# Almudaya Multi-Agent v0.3.5 — Read First

Selamat datang di dokumentasi teknis resmi **Almudaya Multi-Agent Versi 0.3.5 (*The Master Bot Governance & Protocol-Oriented Autonomous Macro-Loop Engine*)**.

Folder dokumentasi ini menyusun seluruh kesepakatan arsitektur, hasil *red-team audit*, spesifikasi kebutuhan, rancangan kelas protokol *atomic*, *Architecture Decision Records* (`ADR-351` s/d `ADR-356`), serta rencana *refactoring* kode dari **v0.3.4** menuju **v0.3.5**.

---

## 1. Latar Belakang & Motivasi Evolusi ke v0.3.5

Pada **v0.3.4**, Almudaya Multi-Agent telah memiliki fondasi kuat berupa:
- **Micro-Loop (ReAct Agent Loop)** di dalam setiap bot (`AutonomousAgentLoop`, max 10 iterasi per giliran).
- **Session Blackboard & Transactional Inbox** (`FilesystemSessionStorage`, `MessagingService`).
- **ACG Capability Governance & Execution Controller** (`src/capability/`, `src/execution/controller.ts`).
- **PKU Unified Persistent Memory & Codebase Indexer** dengan kebijakan *PKU-First Reading* dan auto-kompaksi `outbox.json`/`ledger.json`.
- **Multi-Provider AI & Hardware Advisor** (`Gemini`, Direct `NVIDIA NIM`, `Ollama` Lokal & Cloud, `OpenRouter`, dan `9router`), plus mitigasi *anti-ping-pong* statis (`APP-BUG-04`).

Namun, analisis pengembangan aplikasi nyata (`QuantumLabs`) dan audit arsitektur mengungkapkan bahwa *looping development* masih bersifat **emergen** (bergantung instruksi manusia), belum ada otoritas `MASTER` dari `t = 0`, dan dibutuhkan pendekatan **Berbasis Butir Protokol Atomic (`IProtocol`)** agar setiap aturan siklus kerja—mulai dari kuota bot, hak workspace, estafet log kerja, pengalihan lintas model, hingga gerbang verifikasi akhir—berdiri sebagai komponen kelas yang modular, dapat dipakai ulang, dan dapat diuji secara terpisah.

Versi **v0.3.5** mengubah *autonomous looping development* menjadi **siklus teknis bawaan (*Unified Natural Lifecycle*)** yang dikelola melalui **10 Butir Protokol Atomic (`IProtocol`)**.

> **Prinsip Unified Natural Lifecycle:** Almudaya v0.3.5 **tidak membedakan "mode klasik" vs "mode macro-loop"**. Sejak dihidupkan, seluruh 10 protokol selalu aktif. Karena setiap bot diwajibkan mengirim pesan di akhir gilirannya (`PrMEend` + `PrTransfer` + `CC: MASTER`), eksekusi akan **berhenti alami dalam 1 siklus ($L = 1$)** bila tujuan langsung tercapai (`TASK_0` disahkan `MASTER` + `PrGate`), atau **bergulir alami menjadi *Macro-Loop* ($L > 1$)** bila rantai pesan tugas berlanjut.

---

## 2. Sepuluh Butir Protokol Atomic (`IProtocol`) & Pilar Arsitektur v0.3.5

Seluruh mekanisme siklus kerja pada v0.3.5 diimplementasikan sebagai kelas atomik independen yang mematuhi kontrak antarmuka `IProtocol<TContext, TDecision>` (`protocolId`, `version`, `isEnabled`, `configure()`, `evaluate()`, `enforce()`, `getStateSnapshot()`):

| No | Butir Protokol | Nama Kelas Atomic | Ringkasan Peran & Pengamanan Siklus Kerja |
|---:|---|---|---|
| **1** | **`PrBot`** | `PrBotSpawnQuotaProtocol` | Worker mengusulkan bot via `request_spawn_bot`; `MASTER` mengevaluasi dan menyetujui hingga **`10` bot** (`--pr-bot`) sebelum wajib eskalasi ke HITL. |
| **2** | **`PrBotGlobal`** | `PrBotGlobalCeilingProtocol` | Mengikat plafon global **seluruh bot termasuk `MASTER`** berdasarkan spek laptop (`HardwareAdvisor`), `--token-budget`, dan `--global-timeout <ms\|infinite>`, lengkap dengan **Bot Recycling / Auto-Reaping** agar slot dan jendela tidak bocor saat pergantian bot. |
| **3** | **`PrIterasi`** | `PrIterasiHandoverProtocol` | Mengambil alih tugas saat menyentuh `--pr-iterasi 10`, timeout, atau kuota/`402` dan mengalihkannya ke **model AI berbeda** (maks `3`x handover sebelum HITL), dengan **Single-Model Pool Fallback** & pemulihan *checkpoint* bila file rusak parsial. |
| **4** | **`PrDE`** | `PrDeadEndMediationProtocol` | Mengizinkan diskusi *ping-pong* hingga `--pr-de 10` per utas sebelum mediasi `MASTER`, membatasi total pemicuan `10`x sebelum HITL, serta mendeteksi **Circular Relay Loop (`A -> B -> C -> A` tanpa progres nyata)** bersama `PrTransfer`. |
| **5** | **`PrMEend`** | `PrMessageEndRoutingProtocol` | Mewajibkan pesan lanjutan di akhir tugas dengan **`CC: MASTER`**. Inspeksi Lapis-1 (0 token) meloloskan pesan sah; Lapis-2 membangunkan `MASTER` saat penerima `UNKNOWN`/hilang (migrasi/spawn) atau menerima sinyal `TASK_0`. |
| **6** | **`PrModerator`** | `PrModeratorArbitrationProtocol` | Jabatan penengah/arbiter (default dipegang `MASTER` `BOT000`, **dapat didelegasikan ke bot Moderator khusus** via `--moderator-bot`) yang menerbitkan & mencabut **Token Hak Kerja (`CapabilityToken` + `fenceEpoch`)** atas workspace/komponen untuk mencegah *zombie overwrite*, sekaligus mengelola **MasterInterventionQueue** prioritas `P0..P5`. |
| **7** | **`PrTransfer`** | `PrTaskTokenTransferProtocol` | Mewajibkan setiap pesan transfer tugas (`send_message`, `PrIterasi`, `PrMEend`) melampirkan **`PrTransferEnvelope`** berisi **`LastWorkPositionLog`** (posisi kerja terakhir + *checkpoint path* + `progressDeltaScore`) dan **Transfer `CapabilityToken`** (menaikkan `fenceEpoch + 1` sehingga hak pengirim otomatis gugur). |
| **8** | **`PrMasterFailover`** | `PrMasterFailoverProtocol` | Menukar otak AI `MASTER` (dan bot Moderator delegasi) otomatis menyusuri `masterFailoverChain` pada gangguan HTTP `402`/`429`/timeout tanpa kehilangan Blackboard. |
| **9** | **`PrGate`** | `PrObjectiveGateProtocol` | Gerbang verifikasi fisik deterministik sebelum `Tugas 0` pada `PrMEend` boleh disahkan `GOAL_ACHIEVED` (memastikan 100% tugas `GoalLedger` selesai dan seluruh `targetFiles[]` benar-benar ada di disk berukuran `> 0` byte). |
| **10** | **`PrReattach`** | `PrSessionReattachProtocol` | Rekonsiliasi PID OS dan *heartbeat* saat sesi dihidupkan ulang pasca-*crash/restart*: jendela anak yang masih hidup langsung di-*reattach* tanpa spawn ganda, tugas `IN_PROGRESS` yang yatim di-*respawn* aman. |

### Fondasi Penopang Lainnya:
- **Unified Master-HITL Console (`BOT000` at `t = 0`):** `almudaya up` langsung menghidupkan kursi HITL dan `MASTER` dalam satu terminal utama.
- **Dual Spawn Mode (`windows` Default vs `multiplexed`):** Bot anak secara bawaan diluncurkan di jendela terminal CLI terpisah per bot (`--spawn-mode windows`), atau terpadu dalam satu konsol (`--spawn-mode multiplexed` / `--max-windows`).

---

## 3. Disiplin Waterfall Lifecycle v0.3.5

Dokumen di dalam `docs/ver0.3.5/` disusun mengikuti tahapan Waterfall yang konsisten dengan versi sebelumnya (dicerminkan ke `docs/docs_v0.3.5/`):
1. **Charter & Overview:** `00_READ_FIRST.md`, `01_PROJECT_CHARTER.md`, `DOCUMENTATION_TREE.md`
2. **Phase 1 — Requirements (`02_REQUIREMENTS/`):** `SRS.md` (`FR-350..FR-395`, `NFR-350..NFR-355`), `USE_CASES.md` (`UC-351..UC-362`), `REQUIREMENT_TRACEABILITY.md`
3. **Phase 2 — System Analysis & Design (`03_ANALYSIS/`, `04_DESIGN/`):** Evaluasi arsitektur, alur data 10 protokol, struktur modul & kontrak `IProtocol`, skema data Blackboard, dan `ADR-351` s/d `ADR-356`
4. **Phase 3 — Implementation & Refactoring Plan (`05_IMPLEMENTATION/`):** Peta *refactoring* bertahap dari `v0.3.4` ke `v0.3.5`
5. **Phase 4 — Verification Strategy (`06_TESTING/`):** Strategi uji `TC-350-01` s/d `TC-350-20` untuk seluruh kelas protokol atomic & E2E Macro-Loop
6. **Phase 5 — Release, Change Control & Phase Gates (`07_RELEASE/`, `09_CHANGE_CONTROL/`, `10_PHASE_GATES/`)**
