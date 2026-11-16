# System Analysis — Almudaya Multi-Agent v0.3.5

**Versi:** 0.3.5  
**Tanggal:** 2026-11-15  

Dokumen analisis sistem ini merekam evaluasi teknis dari diskusi perancangan, perbandingan antar pendekatan arsitektur, analisis *red-team* atas 8 celah operasional beserta evolusi menuju **Arsitektur 10 Butir Protokol Atomic (`IProtocol`)**, dan pemetaan titik-titik *refactoring* pada basis kode `v0.3.4`.

---

## 1. Diagnosis Arsitektur `v0.3.4`: Micro-Loop Tanpa Macro-Loop

Berdasarkan inspeksi langsung terhadap `src/bot/agent-loop.ts`, `src/bot/runtime.ts`, `src/capability/`, dan `src/execution/controller.ts` pada `v0.3.4`:

1. **Micro-Loop Internal Sudah Ada:** `AutonomousAgentLoop.handleMessage()` menjalankan `while (iteration < this.maxIterations)` (default 10) untuk satu pesan masuk.
2. **Eksekusi Lintas-Bot Masih Reaktif & Emergen:** `BotRuntime` hanya memicu kerja bot ketika muncul pesan baru di inbox (`inbox/<botId>/inbox.json`). Tidak ada konsep *Goal Ledger*, tidak ada pengawas iterasi lintas-bot, dan tidak ada mekanisme pengalihan model saat buntu.
3. **Keterbatasan Guard `APP-BUG-04` di `v0.3.4`:** Pemblokiran `!isIncomingAutoReply` menghentikan *infinite ping-pong*, tetapi ikut menutup peluang diskusi multi-tahap (misal 3–5 iterasi klarifikasi kontrak API) yang sah antar-spesialis.
4. **Fondasi ACG & Execution Controller Sudah Ada (`src/capability/`, `src/execution/`):** `v0.3.4` sudah memiliki *Agent Capability Governance* (presets READ_ONLY/DEVELOPER) dan `ExecutionModeController`, tetapi belum memiliki **Token Hak Dinamis Berbasis Epoch (`CapabilityToken` + `fenceEpoch`)** untuk mengunci ruang kerja saat terjadi handover antar-bot.

---

## 2. Evaluasi Perbandingan Dua Pendekatan *Looping Development*

Selama perancangan `v0.3.5`, dua alternatif mekanisme *Macro-Loop* dibandingkan:

### Pendekatan A: *Declarative Pipeline State Machine* (Kaku)
Setiap perubahan kode wajib melewati mesin status linier di kernel: `Builder -> Consistency Inspector -> Continuous Improvement Critic -> Done`.

### Pendekatan B: *Master Bot + Built-in Atomic Protocols (`IProtocol`)* (Dinamis & Modular)
Mengaktifkan **Master Bot (`BOT000`)** yang menyatu dengan konsol HITL sejak `t = 0`, membiarkan bot pekerja berkolaborasi melalui rantai pesan otonom yang fleksibel, sementara kernel menegakkan **10 Butir Protokol Atomic (`PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrMasterFailover`, `PrGate`, `PrReattach`)**, batas waktu, dan kuota token.

| Dimensi Analisis | Pendekatan A (*Rigid Pipeline*) | Pendekatan B (*Master Bot + 10 Atomic Protocols*) | Kesimpulan |
|---|---|---|---|
| **Fleksibilitas Kolaborasi** | Rendah (jalur dipaksa linier meski tugas sederhana). | Tinggi (bot berkoordinasi atau meminta spesialis via `PrBot`). | **B jauh lebih unggul** |
| **Keluar dari Jalan Buntu Teknis** | Terbatas pada *retry* di model yang sama. | **`PrIterasi` + `PrTransfer`:** Pengalihan ke **model AI berbeda** hingga 3x + *checkpoint revert*. | **B jauh lebih unggul** |
| **Keamanan Hak Workspace & Estafet** | Tidak ada transfer hak & posisi kerja formal. | **`PrModerator` + `PrTransfer`:** `CapabilityToken` ber-*epoch* + `LastWorkPositionLog`. | **B jauh lebih aman** |
| **Penanganan Diskusi Multi-Putaran** | Dibatasi skema review kaku. | **`PrDE`:** Bebas berdiskusi hingga batas `N` (10), lalu dimediasi `MASTER`. | **B jauh lebih unggul** |
| **Kelebihan Pendekatan A** | Memiliki **Daftar Tujuan (*Goal Checklist*)** yang jelas di akhir. | Perlu mekanisme objektif agar proyek tidak dianggap selesai prematur. | **Diambil via `GoalLedger` + `PrGate`** |

---

## 3. Keputusan Integrasi: Mana yang Diambil & Mana yang Dibuang

1. **DITOLAK (Membuat Sistem Lebih Buruk):**
   - Memasang mesin *pipeline* kaku (Pendekatan A) secara paralel di atas Master Bot (Pendekatan B) karena menciptakan otoritas ganda (*dual-brain conflict*).
   - Memisahkan aplikasi menjadi "mode klasik" vs "mode macro-loop" yang membutuhkan flag atau cabang eksekusi terpisah. Sebaliknya, ditetapkan **Unified Natural Lifecycle**: hanya ada satu mekanisme di mana setiap bot wajib mengirim pesan tugas (atau `TASK_0`) di akhir kerjanya (`PrMEend` + `PrTransfer`), sehingga berhenti di 1 siklus ($L=1$) atau berputar menjadi *Macro-Loop* ($L>1$) bergantung sepenuhnya secara natural pada rantai pesan yang terbentuk dan putusan `MASTER`.
2. **DIADOPSI (Sinergi Bersih):** Menjadikan **Master Bot + 10 Atomic Protocols (`IProtocol`)** sebagai kendali utama dengan mengintegrasikan **`GoalLedger`** dan peran **Consistency Inspector / Improvement Specialist** langsung ke dalam pool di bawah komando `MASTER`.

---

## 4. Analisis Penentuan Posisi Master Bot, Mode Terminal, & Protokol Tata Kelola

### 4.1 Kapan Master Bot Dimulai?
Diputuskan **aktif otomatis sejak `t = 0`** (*Unified Master-HITL Console*) karena seluruh protokol membutuhkan pemegang otoritas sejak bot pekerja pertama (`BOT001`) lahir, sekaligus menyediakan satu titik eskalasi HITL yang pasti.

### 4.2 Mode Kelahiran Terminal Anak (`windows` vs `multiplexed`)
- **`windows` (Default):** Setiap bot anak diluncurkan `SpawnManager` pada **jendela terminal OS terpisah**.
- **`multiplexed` (Alternatif / `--max-windows`):** Log seluruh bot anak berlabel `[BOT00X]` dikonsolidasikan di layar utama Master ketika jumlah bot banyak.

### 4.3 Analisis Awal `PrMEend` dan `PrBotGlobal`
- **`PrMEend`:** Menutup celah pesan buntu (`UNKNOWN recipient`) dan *silent death* akibat `TASK_0` prematur melalui inspeksi dua lapis (*Lapis-1 nol token*, *Lapis-2 AI Master*).
- **`PrBotGlobal`:** Membatasi jumlah bot global **termasuk `MASTER`** berdasar spek laptop (`HardwareAdvisor`), token, & waktu (`ms | infinite`).

### 4.4 Analisis Red-Team (8 Celah Teknis) & Evolusi Menuju 10 Butir Protokol Atomic (`IProtocol`)

Audit mendalam menemukan 8 celah operasional bila banyak bot bekerja paralel. Sesuai prinsip **Protocol-Oriented Architecture**, seluruh solusi dikemas sebagai **butir protokol atomic** berantarmuka `IProtocol` dan diintegrasikan dengan **`PrModerator`** serta **`PrTransfer`**:

| Celah yang Ditemukan Saat Audit | Dampak Jika Dibiarkan | Solusi Butir Protokol Atomic (`IProtocol`) |
|---|---|---|
| **Celah 1 — *Zombie Worker Overwrite*** | Pada `windows` mode, bot lama `PrIterasi` yang terlambat menyelesaikan tool menimpa kode baru bot pengganti. | **`PrModerator` (`CapabilityToken` + `fenceEpoch`) + `PrTransfer`:** Hak tulis diikat `fenceEpoch`. Begitu `PrIterasi`/`PrTransfer` menaikkan `fenceEpoch`, mutasi file oleh bot ber-token usang ditolak kernel (`ExecutionModeController`). |
| **Celah 2 — *Corrupted Partial File*** | Model pengganti di `PrIterasi` menerima file setengah rusak dari model sebelumnya dan menghabiskan kuota memperbaikinya. | **`PrTransfer` (`LastWorkPositionLog` + `checkpoints/<taskId>/`):** Snapshot bersih diambil sebelum tugas menyentuh file; status `NEEDS_REVERT` mengembalikan *checkpoint* bersih bagi model pengganti. |
| **Celah 3 — *Circular Relay Loop (`A->B->C->A`)* Tanpa Progres** | Bot saling melempar tugas dengan mengganti `threadId` tanpa ada perubahan kode, lolos dari `PrDE` & Lapis-1 `PrMEend`. | **`PrTransfer` (`progressDeltaScore`) + `PrDE`:** Jika terjadi `N` handoff beruntun (`--pr-no-progress 5`) dengan `progressDeltaScore === 0`, langsung ditangani sebagai *Indirect DeadEnd*. |
| **Celah 4 — Pemborosan Kuota `PrBot` & *Zombie Windows*** | Handover 3x pada `PrIterasi` men-*spawn* 3 jendela baru tanpa mendaur ulang bot yang gagal. | **`PrBotGlobal` (Bot Recycling / Auto-Reaping):** `PrIterasi` mengutamakan *Hot-Swap Model in-place* atau me-*reap* jendela lama sebelum membuka pengganti. |
| **Celah 5 — *Single-Model Pool Exhaustion*** | Jika pengguna hanya mengaktifkan 1 model (misal Ollama lokal tunggal), `selectNextDistinctModel()` langsung gagal di handover ke-1. | **`PrIterasi` Fallback Bertingkat:** `modelPool` berbeda $\rightarrow$ model lain di `ModelCatalog` $\rightarrow$ *Clean-Context & Master-Hint Handover* + peringatan HITL. |
| **Celah 6 — *Master Bot Event Storm*** | Banyak jendela memicu `PrIterasi`, `PrDE`, `PrMEend` di detik yang sama $\rightarrow$ *bottleneck* & balapan tulis `goal_ledger.json`. | **`PrModerator` (`MasterInterventionQueue` + Delegasi):** Antrean serial prioritas `P0..P5`, plus opsi mendelegasikan peran Moderator ke bot anak khusus (`--moderator-bot`) untuk meringankan `MASTER`. |
| **Celah 7 — *Hallucinated Completion* Saat `Tugas 0`** | LLM `MASTER` percaya klaim teks pekerja bahwa tugas selesai walau berkas di disk belum ada/kosong. | **`PrGate` (`PrObjectiveGateProtocol`):** Verifikasi fisik deterministik atas status `GoalLedger` & keberadaan/ukuran `targetFiles[]` di disk sebelum `TASK_0` boleh menjadi `GOAL_ACHIEVED`. |
| **Celah 8 — *Orphaned Windows* Saat Konsol Master Restart** | Konsol Master crash/restart lalu dijalankan lagi, sehingga membuka jendela ganda bagi bot yang masih hidup. | **`PrReattach` (`PrSessionReattachProtocol`):** Mencocokkan PID & *heartbeat* di `bots.json`; proses hidup langsung di-*reattach*, proses mati pada tugas `IN_PROGRESS` di-*respawn* bersih. |

---

## 5. Peta Titik Refactoring Terhadap Codebase `v0.3.4`

| Komponen `v0.3.4` | Kondisi Saat Ini (`v0.3.4`) | Rencana Refactoring ke `v0.3.5` |
|---|---|---|
| *(Baru)* `src/protocol/contracts.ts`, `registry.ts`, `protocols/*.ts` | Belum ada lapisan kontrak protokol modular. | Bangun antarmuka `IProtocol`, `ProtocolRegistry`, `MasterInterventionQueue`, dan **10 kelas protokol atomic** (`PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrMasterFailover`, `PrGate`, `PrReattach`). |
| `src/execution/controller.ts` & `src/capability/policy-engine.ts` | Memeriksa preset statis `READ_ONLY` / `DEVELOPER`. | Integrasikan pemeriksaan **`CapabilityToken` & `fenceEpoch`** dari `PrModerator` sebelum eksekusi `write_file`/`edit_file`/`run_command` (menutup Celah 1). |
| `src/bot/agent-loop.ts` | Loop berhenti di `this.maxIterations`; guard `APP-BUG-04` memblokir semua *auto-reply* ke-2. | Hubungkan iterasi/timeout/`402` ke `PrIterasi`; ganti `APP-BUG-04` dengan `PrDE` (`threadId` + *no-progress relay*); wajibkan `PrTransferEnvelope` & kait `PrMEend` (`CC: MASTER`) di akhir giliran. |
| `src/messaging/schema.ts` | `DirectMessage` hanya membawa pengirim, penerima, isi, dan timestamp. | Tambahkan `threadId`, `taskId`, `exchangeCount`, `ccMaster`, `isTaskZero`, `recipientStatus`, `messageKind`, serta `transferEnvelope` (`LastWorkPositionLog` + `CapabilityToken`). |
| `src/bot/console.ts` | Menampilkan banner untuk 1 bot tunggal dengan `/msg`, `/broadcast`, `/model`. | Perluas menjadi `MasterHITLConsole` dengan status bar protokol/moderator, dialog interaktif eskalasi HITL, multiplexer output child bots, serta slash `/protocol`, `/blueprint`, `/rules`, `/bots`, `/spawn-mode`, `/moderator`. |
| `src/bot/runtime.ts` | Polling `DirectMessage` dan *heartbeat* per bot. | Tambahkan laporan detak tugas, manajemen snapshot pre-task (`checkpoints/`), status *paused/frozen*, *hot-swap* model in-place, serta injeksi `dynamic_rules.json` & `goal_ledger.json`. |
| `src/ai/openai-compatible.ts` & `src/ai/gemini.ts` | 1 provider + 1 model statis. | Bungkus lewat `FailoverAIProvider` (`PrMasterFailover`) + pelaporan `AIResponse.usage` ke `BudgetTracker`. |
| `src/cli/commands/bot.ts` | Subcommand `join`, `run`, `list`, `models`, `advisor`, `pull`. | Tambahkan `almudaya up` / `start` (`src/cli/commands/up.ts`) lengkap dengan flag seluruh 10 protokol, `--moderator-bot`, `--pr-no-progress`, `--pr-gate`, `--pr-reattach`. |
