# Software Requirements Specification (SRS) — Almudaya Multi-Agent v0.3.5

**Versi Target:** 0.3.5  
**Paket:** `almudaya-multiagent`  
**Status:** APPROVED FOR DESIGN & REFACTORING  
**Tanggal:** 2026-11-15  

Dokumen ini mendefinisikan seluruh kebutuhan fungsional (*Functional Requirements* `FR-350..FR-395`) dan non-fungsional (*Non-Functional Requirements* `NFR-350..NFR-355`) untuk **Almudaya Multi-Agent v0.3.5 (*The Master Bot Governance & Protocol-Oriented Autonomous Macro-Loop Engine*)**.

---

## 1. Pendahuluan

### 1.1 Tujuan
Menanamkan mekanisme pengembangan otonom siklus tertutup (*Autonomous Macro-Loop*) langsung ke dalam runtime Almudaya Multi-Agent melalui **10 Butir Protokol Atomic (`IProtocol`)**: **`PrBot`**, **`PrBotGlobal`**, **`PrIterasi`**, **`PrDE`**, **`PrMEend`**, **`PrModerator`**, **`PrTransfer`**, **`PrMasterFailover`**, **`PrGate`**, dan **`PrReattach`**, di bawah kepemimpinan **Master Bot (`BOT000`)** serta pengawasan pemutus sirkuit waktu dan kuota token.

### 1.2 Ruang Lingkup
Meliputi penambahan/perombakan pada subsistem CLI (`src/cli/`), Console REPL (`src/bot/console.ts`), Runtime & Agent Loop (`src/bot/runtime.ts`, `src/bot/agent-loop.ts`), kerangka protokol modular (`src/protocol/`, `src/protocol/contracts.ts`, `src/protocol/registry.ts`, `src/protocol/protocols/*`), peluncur & rekonsiliasi terminal anak (`SpawnManager`, `PrReattach`), lapisan ACG & kontrol eksekusi (`src/capability/`, `src/execution/controller.ts`), penyimpanan Blackboard (`protocol/config.json`, `state.json`, `goal_ledger.json`, `dynamic_rules.json`, `moderator_state.json`, `checkpoints/`, `events.jsonl`), serta perkakas AI (`src/tools/`).

---

## 2. Kebutuhan Fungsional (Functional Requirements)

### 2.1 Master Bot Startup & Unified Master-HITL Console

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-350** | **Automatic Master Initialization at `t = 0`:** Ketika Almudaya Multi-Agent dijalankan melalui perintah masuk utama (`almudaya up`, `start`, atau `master`), sistem otomatis menginisialisasi kursi **`MASTER` (`BOT000`)** sebelum bot pekerja mana pun dihidupkan, menyatu dengan antarmuka konsol **Human-in-the-Loop (HITL)** pada terminal yang sama. | Must |
| **FR-351** | **Default Master AI Brain & Environment Resolution:** `MASTER` (`BOT000`) otomatis memulai dengan model AI default berdasarkan flag CLI (`--master-provider`, `--master-model`) atau deteksi otomatis kredensial lingkungan (`NVIDIA_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`, `NINEROUTER_BASE_URL`). | Must |
| **FR-352** | **Unified Dual-Seat Interactive Console:** Terminal utama menampilkan identitas ganda (`HITL [MASTER]> `), memungkinkan programmer memasukkan **Peta Pekerjaan (*Blueprint / Goal*)**, mengatur protokol, menjawab dialog eskalasi HITL, sekaligus memantau aktivitas Master Bot, status Moderator, dan pesan Blackboard. | Must |
| **FR-353** | **Master Authority Over Worker Lifecycle:** `MASTER` memiliki kewenangan penuh untuk membuat (*spawn*), menyalakan, menjeda (*pause*), memindahkan tugas, mendaur ulang, dan mematikan (*terminate*) seluruh bot anak. | Must |
| **FR-354** | **On-the-Fly Dynamic Rules Creation:** `MASTER` dapat membuat, memperbarui, dan mencabut aturan kerja (*dynamic rules*) secara *on-the-fly* ke dalam berkas sesi `dynamic_rules.json`. Seluruh aturan aktif otomatis disuntikkan ke dalam System Prompt setiap bot pada giliran berikutnya. | Must |
| **FR-355** | **Single-Master Role Exclusivity & Worker Registration:** Jika proses terpisah bergabung pada sesi yang sudah memiliki `MASTER` aktif, proses tersebut otomatis terdaftar sebagai bot pekerja (`role: 'WORKER'`) dan tunduk pada persetujuan **`PrBot`** oleh `MASTER`. | Must |

---

### 2.2 Dual Child-Bot Spawn Mode (`windows` Default vs `multiplexed`)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-356** | **CLI Selection of Spawn Mode:** Operator dapat memilih mode kelahiran bot anak melalui flag CLI `--spawn-mode <windows \| multiplexed>` (alias `--separate-windows` / `--multiplexed`). **Nilai bawaan (*default*) adalah `windows`.** | Must |
| **FR-357** | **Separate OS CLI Window Mode (`windows` — Default):** Pada mode `windows`, setiap kali bot anak baru (`BOT001`, `BOT002`, dst.) dilahirkan, `SpawnManager` membuka **jendela terminal CLI OS baru** (Windows: `wt.exe` / `powershell.exe` / `cmd.exe`; macOS: `osascript` Terminal; Linux: `x-terminal-emulator` / `gnome-terminal` / `xterm`) terhubung ke sesi tersebut. | Must |
| **FR-358** | **Multiplexed Single-Window Mode (`multiplexed`):** Pada mode `multiplexed`, bot anak dilahirkan sebagai proses anak latar belakang (`child_process.spawn` dengan stdio terarah) yang log-nya dikonsolidasikan rapi berlabel `[BOT001]` di layar konsol utama `MASTER`. | Must |
| **FR-359** | **Runtime Spawn Mode Toggle & Auto-Multiplex Threshold:** Konsol mendukung perintah `/spawn-mode <windows|multiplexed>` secara *live*. Tersedia opsi `--max-windows <n>` agar bot tambahan melampaui `<n>` jendela otomatis dialihkan ke `multiplexed`. | Should |

---

### 2.3 Protokol 1 — `PrBot` (Governance Pembuatan Bot Baru)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-360** | **Worker Bot Spawn Proposal (`request_spawn_bot`):** Bot pekerja memiliki perkakas `request_spawn_bot(name, role, justification, suggestedProvider?, suggestedModel?)`. Bot pekerja **dilarang** memunculkan proses bot baru secara langsung melewati kernel; setiap usulan wajib melewati antrean persetujuan `MASTER`. | Must |
| **FR-361** | **Master Evaluation & Autonomous Approval Cap (`PrBot`):** `MASTER` mengevaluasi alasan permintaan bot baru. Selama jumlah pembuatan bot otonom dalam sesi masih **$\le$ `prBotLimit` (default: `10`)**, `MASTER` berwenang menyetujui atau menolak secara mandiri tanpa mengganggu manusia. | Must |
| **FR-362** | **HITL Escalation on `PrBot` Exceeded:** Ketika total pembuatan bot melewati `prBotLimit` (misal ke-11 pada default `10`, atau ke-4 pada `--pr-bot 3`), `MASTER` **wajib menunda kelahiran bot**, mencatat `PENDING_HITL_APPROVAL`, dan memunculkan dialog evaluasi di konsol HITL. | Must |
| **FR-363** | **Resource & Memory Guard on `PrBot`:** Sebelum menyetujui bot baru, `MASTER` juga tunduk pada pemeriksaan **`PrBotGlobal`** (RAM bebas `os.freemem()`, kapasitas hardware, dan sisa `tokenBudget`). Jika kritis, kelahiran ditahan dan dilaporkan ke HITL. | Should |

---

### 2.4 Protokol 2 — `PrIterasi` (Cross-Model Handover pada Kebuntuan Tugas)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-364** | **Deterministic Iteration, Timeout, & Quota Trigger Tracking:** Kernel melacak pada setiap tugas aktif (`TaskExecutionState`): (a) `iterationCount`, (b) `elapsedMs`, dan (c) kegagalan fatal akibat **habis kuota token / HTTP `402` / `429` berkepanjangan** atau **timeout**. | Must |
| **FR-365** | **Takeover by Master on `PrIterasi` Trigger:** Apabila bot menyentuh `prIterasiLimit` (default `10`), `taskTimeoutMs`, atau kehabisan kuota token/API, bot pekerja dihentikan pada tugas tersebut (*frozen/aborted*), hak tulisnya langsung dicabut melalui kenaikan `fenceEpoch` pada `PrModerator` (mencegah *zombie overwrite*), dan kendali tugas ditarik kembali ke **`MASTER`**. | Must |
| **FR-366** | **Cross-Model Handover Enforcement:** Saat mengambil alih karena `PrIterasi`, `MASTER` membaca ringkasan kegagalan, `WorkLog`, `LastWorkPositionLog` + *checkpoint* dari `PrTransfer`, serta `PKU`, lalu menugaskan tugas melalui **`PrTransfer`** ke bot dengan **model AI berbeda** dari `modelPool` yang belum ada di `triedModels`. | Must |
| **FR-367** | **Bounded Handover Chain & HITL Escalation (`PrIterasiHandover`):** Jika pengalihan telah terjadi **`prIterasiHandoverLimit` kali (default: `3`)** dan model ke-3 masih mentok, cabang tugas dihentikan, ditandai `BLOCKED_HITL`, dan dilaporkan ke **HITL**. | Must |

---

### 2.5 Macro-Loop Bawaan, Goal Ledger & Protokol 3 — `PrDE` (DeadEnd Mediation)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-368** | **Project Blueprint & Goal Ledger Persistence:** Programmer dapat menyerahkan **Peta Pekerjaan** (lewat teks langsung atau `--blueprint <path>`). `MASTER` menyusunnya menjadi `goal_ledger.json` berisi daftar tugas, `targetFiles[]` objektif, ketergantungan, peran spesialis (termasuk **Consistency Inspector** & **Continuous Improvement/Critic**), serta *acceptance criteria*. | Must |
| **FR-369** | **Unified Natural Lifecycle & Loop Chaining (`submit_task_handoff` / `send_message`):** Sistem tidak memisahkan "mode klasik" dan "mode macro-loop"; seluruh sesi berjalan dalam **satu siklus natural bawaan**. Di akhir tugas/gilirannya, bot mengirim pesan tugas lanjutan (`PrTransfer` + `PrMEend`) atau penutup `TASK_0`. Eksekusi berhenti alami dalam **1 siklus ($L = 1$)** bila `MASTER` (bersama `PrGate`) menilai tujuan langsung tuntas, atau terus bergulir menjadi *Macro-Loop* ($L > 1$) selama rantai pesan berlanjut atau masih ada item terbuka pada `GoalLedger`—kecuali dihentikan oleh pelanggaran berat `dynamic_rules.json` atau eskalasi error. | Must |
| **FR-370** | **Continuous Consistency & Improvement Assignment:** `MASTER` secara bawaan memelihara peran pemeriksa konsistensi dan perbaikan berkelanjutan dalam pool sesi untuk mengaudit keselarasan lintas-file via `PKU` & `WorkLog`. | Should |
| **FR-371** | **Thread-Based Ping-Pong Tracking (`PrDE`):** Menggantikan blokir satu kali balas pada `v0.3.4` (`APP-BUG-04`), setiap pesan antar-bot membawa `threadId` dan `exchangeCount`. Percakapan bolak-balik diizinkan bebas selama **`exchangeCount <= prDeLimit` (default: `10`)** dan tidak melewati `threadTimeoutMs`/token budget. | Must |
| **FR-372** | **Master Mediation on `PrDE` Trigger:** Apabila `exchangeCount > prDeLimit`, waktu/kuota utas habis, atau terdeteksi **Circular Relay Loop tanpa progres** (`FR-392`), kernel **mencegat pesan** dan menyerahkan transkrip ke **`MASTER`** untuk mengeksekusi `STOP_THREAD`, `REASSIGN_TASK`, atau `SPAWN_SPECIALIST`. | Must |
| **FR-373** | **Global `PrDE` Escalation Cap & HITL Reporting:** Apabila `PrDE` telah terpicu melebihi **`prDeEscalationLimit` kali (default: `10`)** dalam satu sesi, `MASTER` menangguhkan mediasi otonom dan melapor ke **HITL**. | Must |

---

### 2.6 Failover Otak Master Bot (`PrMasterFailover`) & Pengaturan CLI / Konsol

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-374** | **Master AI Failover Chain (`PrMasterFailover`):** `MASTER` (serta bot Moderator yang menerima delegasi `PrModerator`) wajib dilengkapi daftar model cadangan (`masterFailoverChain`) yang otomatis berpindah pada kegagalan *timeout*, HTTP `429` berlebih, atau HTTP `402`/`401`/`403` tanpa mereset Blackboard/Goal Ledger. Jika seluruh rantai gagal, status masuk `PAUSED_MASTER_UNAVAILABLE` untuk tindakan HITL. | Must |
| **FR-375** | **Complete CLI Protocol Configuration Flags:** Seluruh ambang batas 10 protokol dapat disetel via CLI: `--pr-bot <n>`, `--pr-bot-global <auto|n>`, `--pr-iterasi <n>`, `--pr-iterasi-handover <n>`, `--pr-de <n>`, `--pr-de-escalation <n>`, `--pr-me-end <on|off>`, `--pr-no-progress <n>`, `--pr-gate <on|off>`, `--pr-reattach <on|off>`, `--moderator-bot <botId|auto>`, `--task-timeout <ms>`, `--thread-timeout <ms>`, `--global-timeout <ms|infinite>`, `--token-budget <tokens>`, `--spawn-mode <windows|multiplexed>`, `--max-windows <n>`, `--master-provider <p>`, `--master-model <m>`, `--master-failover <list...>`, dan `--model-pool <list...>`. | Must |
| **FR-376** | **Global Timeout & Token Quota Circuit Breakers:** Setiap protokol dibatasi tidak hanya oleh hitungan diskret, tetapi juga oleh sisa waktu (`taskTimeoutMs` / `threadTimeoutMs` / `globalTimeoutMs` dengan opsi `'infinite'`) dan kuota token (`tokenBudget` + HTTP 402/429). | Must |
| **FR-377** | **Live Protocol & Governance Slash Commands:** Konsol interaktif menyediakan perintah slash: `/protocol [show | set <key> <val>]`, `/blueprint [show | check | add <task>]`, `/rules [list | add <rule> | remove <id>]`, `/bots [list | pause <id> | resume <id> | kill <id>]`, `/spawn-mode [windows | multiplexed]`, dan `/moderator [status | delegate <botId> | reclaim | tokens]`. | Must |

---

### 2.7 Protokol 4 — `PrMEend` (Message End, Migrasi Tugas Buntu & Penanganan `Tugas 0`)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-378** | **Mandatory End-of-Turn Message & `CC: MASTER` (Unified Lifecycle Trigger):** Setiap bot **wajib** mengirim pesan di akhir kerjanya (baik pesan tugas lanjutan ke bot lain saat selesai/di tengah tugas maupun sinyal `TASK_0` jika merasa seluruh tujuan selesai) disertai **salinan (`CC: MASTER`)** kepada `MASTER` (`BOT000`) untuk pengawasan `PrMEend` (tanpa menambah penghitung *ping-pong* `PrDE`). Mekanisme tunggal inilah yang secara alami menentukan apakah alur berhenti di siklus ke-1 ($L=1$) atau berputar menjadi *Macro-Loop* ($L>1$). | Must |
| **FR-379** | **Two-Stage `PrMEend` Inspection (Hemat Token):** Kernel melakukan inspeksi Lapis-1 deterministik (0 token) pada salinan pesan. Bila `recipient` valid & aktif, bukan `TASK_0`, dan tidak melanggar ambang `--pr-no-progress`, pesan diteruskan. Lapis-2 membangunkan AI `MASTER` hanya saat: (a) giliran berakhir tanpa pesan lanjutan, (b) `recipient` `UNKNOWN`/tidak aktif, (c) sinyal **`TASK_0`**, atau (d) anomali estafet tanpa progres. | Must |
| **FR-380** | **Deadlock Message Migration & On-Demand Bot Spawn (`PrMEend`):** Bila `recipient` `UNKNOWN`/buntu, `MASTER` mengeksekusi **Migrasi Tugas** (mengikuti protokol **`PrTransfer`**) ke bot yang semestinya atau membuat bot spesialis baru sesuai `PrBot` dan `PrBotGlobal`. | Must |
| **FR-381** | **`Tugas 0` Verification Before Terminating Macro-Loop (`PrMEend`):** Saat menerima `TASK_0`, `MASTER` mengevaluasi kondisi proyek terhadap `goal_ledger.json`. Pengesahan akhir `GOAL_ACHIEVED` **wajib** lebih dulu melewati pemeriksaan objektif **`PrGate`** (`FR-394`); bila belum tuntas atau gagal `PrGate`, `TASK_0` ditolak dan `MASTER` menyuntikkan tugas lanjutan. | Must |

---

### 2.8 Protokol 5 — `PrBotGlobal` (Plafon Global Bot Berbasis Spek Laptop, Token & Waktu)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-382** | **Universal Global Ceiling Governing All Bots Including `MASTER`:** **`PrBotGlobal`** mengikat **seluruh bot termasuk `MASTER` (`BOT000`)** sebelum kelahiran bot baru mana pun (baik via `PrBot` maupun `PrIterasi`/`PrDE`/`PrMEend`). | Must |
| **FR-383** | **Three-Axis Dynamic Global Limit Calculation:** Plafon `PrBotGlobal` dievaluasi dari 3 sumbu: (1) **Spek Perangkat Keras Laptop/Komputer** (`HardwareAdvisor`: CPU cores, RAM bebas, GPU/VRAM + `--pr-bot-global`), (2) **Anggaran Kuota Token** (`--token-budget`), dan (3) **Batas Waktu Global** (`--global-timeout <ms \| infinite>`). | Must |
| **FR-384** | **Mandatory HITL Escalation on `PrBotGlobal` Breach:** Pelanggaran pada salah satu sumbu menahan pembuatan bot (meski oleh `MASTER`) dan melapor langsung ke **HITL**. | Must |
| **FR-385** | **Infinite Global Timeout Option:** Programmer dapat menyetel `--global-timeout infinite` agar batas waktu tidak menghentikan sesi panjang sambil tetap mempertahankan batas spek perangkat keras dan token. | Must |

---

### 2.9 Kontrak Protokol Atomic (`IProtocol`) & Protokol 6 — `PrModerator`

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-386** | **Atomic Protocol Interface (`IProtocol`) & Registry:** Seluruh 10 mekanisme protokol siklus kerja wajib diimplementasikan sebagai kelas atomik independen yang mematuhi antarmuka `IProtocol<TContext, TDecision>` (`protocolId`, `version`, `isEnabled`, `configure()`, `evaluate()`, `enforce()`, `getStateSnapshot()`) dan terdaftar pada `ProtocolRegistry` sehingga dapat dievaluasi, diaudit, serta diuji terisolasi. | Must |
| **FR-387** | **Protokol `PrModerator` — Jabatan Penengah, Delegasi & Distribusi Token Hak Kerja:** **`PrModerator`** mengendalikan distribusi **Token Hak Kerja (`CapabilityToken`)** atas workspace (`allowedPaths`), komponen/tools (`allowedComponents`), dan mode akses (`EXCLUSIVE_WRITE | SHARED_READ | REVIEW_ONLY`). Secara default jabatan Moderator dipegang **`MASTER` (`BOT000`)**, namun **`MASTER` dapat mendelegasikan peran `PrModerator` ke bot Moderator khusus** (via `--moderator-bot <botId|auto>` atau `delegate_moderator_role`) serta mencabutnya kembali (`reclaim`). | Must |
| **FR-388** | **`CapabilityToken` Write Fencing & Zombie Overwrite Prevention (Celah 1):** Setiap mutasi file atau eksekusi komando di `ExecutionModeController` / ACG wajib memvalidasi kecocokan `tokenId` dan `fenceEpoch` pemegang aktif di `moderator_state.json`. Ketika tugas dialihkan (`PrIterasi`/`PrTransfer`) atau dicabut, `PrModerator` menaikkan `fenceEpoch` sehingga setiap *late write* dari bot lama (*zombie worker*) langsung ditolak kernel. | Must |
| **FR-389** | **Serialized Priority Intervention Queue (`MasterInterventionQueue` — Celah 6):** Saat beberapa protokol terpicu bersamaan dari banyak jendela paralel, `PrModerator` menjadwalkan intervensi ke `MASTER` dalam antrean berseri berprioritas deterministik: **`P0: PrMasterFailover & PrBotGlobal`** $\rightarrow$ **`P1: PrIterasi`** $\rightarrow$ **`P2: PrDE`** $\rightarrow$ **`P3: PrMEend & PrGate`** $\rightarrow$ **`P4: PrModerator & PrTransfer`** $\rightarrow$ **`P5: PrBot`**. | Must |

---

### 2.10 Protokol 7 — `PrTransfer` (Log Posisi Kerja Terakhir + Transfer Token Hak)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-390** | **Mandatory `PrTransferEnvelope` in Task `send_message`:** Setiap pesan transfer atau pendelegasian tugas (`TASK_HANDOFF`, `PrIterasi` handover, `PrMEend` migration) wajib memenuhi protokol **`PrTransfer`** dengan melampirkan **`LastWorkPositionLog`** (posisi langkah terakhir diselesaikan, langkah lanjutan, daftar berkas tersentuh & statusnya, serta `progressDeltaScore`) **DAN** memindahkan kepemilikan **`CapabilityToken`** secara atomik ke penerima dengan menaikkan `fenceEpoch + 1` (sehingga hak tulis bot pengirim langsung berpindah ke penerima). | Must |
| **FR-391** | **Pre-Task File Checkpointing & Recovery Handover (Celah 2):** Sebelum bot memulai modifikasi berkas pada sebuah `taskId`, kernel menyimpan salinan bayangan bersih di `sessions/<id>/protocol/checkpoints/<taskId>/` dan mencatat referensinya (`checkpointPath`) di `LastWorkPositionLog`. Bila bot mengalami kegagalan `PrIterasi` dengan file rusak setengah tulis (`NEEDS_REVERT` / `PARTIAL_WIP`), `MASTER` via `PrTransfer` dapat memilih memulihkan berkas ke kondisi bersih (`REVERT_TO_CHECKPOINT`) sebelum model pengganti bekerja. | Must |
| **FR-392** | **Zero-Progress Circular Relay Detection (`PrDE` + `PrTransfer` — Celah 3):** Dengan mengaudit nilai `progressDeltaScore` pada `LastWorkPositionLog` setiap transfer tugas, kernel mendeteksi estafet melingkar tanpa kemajuan nyata (`A -> B -> C -> A` meskipun memakai `threadId` berbeda). Apabila terjadi `N` transfer tugas berturut-turut dengan `progressDeltaScore === 0` (`--pr-no-progress`, default `5`) tanpa perubahan status `GoalLedger`, `PrMEend` Lapis-1 langsung menandainya sebagai *Indirect DeadEnd* dan memicu mediasi **`PrDE`** oleh `MASTER`. | Must |

---

### 2.11 Optimasi Siklus Bot & Protokol 9 & 10 — `PrGate` & `PrReattach`

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-393** | **Bot Recycling & Single-Model Pool Fallback (Celah 4 & Celah 5):** (a) Saat `PrIterasi` mengalihkan tugas ke model berbeda, `PrBotGlobal` mengutamakan **Bot Recycling** (*Hot-Swap Model in-place* pada slot pekerja idle/gagal atau mematikan/`reap` proses jendela bot lama sebelum melahirkan pengganti) sehingga slot `activeGlobalBotCount` & jendela terminal tidak membengkak oleh *zombie bots*. (b) Apabila `modelPool` hanya memiliki 1 model aktif, `PrIterasi` mengeksekusi fallback deterministik: Prioritas 1 model berbeda di `modelPool` $\rightarrow$ Prioritas 2 model terautentikasi lain dari `ModelCatalog` $\rightarrow$ Prioritas 3 *Clean-Context & Master-Hint Handover* dengan notifikasi ke HITL. | Must |
| **FR-394** | **Protokol `PrGate` — Objective Completion Gate (Celah 7):** Sebelum `MASTER` disahkan menetapkan status akhir `GOAL_ACHIEVED` akibat `TASK_0` pada `PrMEend`, kelas **`PrGate`** wajib menjalankan verifikasi deterministik independen di disk: memastikan seluruh item `GoalLedger` berstatus `DONE`/`CANCELLED`, dan seluruh `targetFiles[]` benar-benar ada di disk dengan ukuran `> 0` byte. Bila gagal, `PrGate` menolak pengesahan `Tugas 0` dan mengembalikan daftar kekurangan ke `MASTER`. | Must |
| **FR-395** | **Protokol `PrReattach` — Session Process & Window Reconciliation (Celah 8):** Ketika sesi yang sudah ada dibuka ulang (`almudaya up -s <existingSession>`) pasca-*crash/restart*, **`PrReattach`** memeriksa PID OS dan *heartbeat* seluruh `bots.json`. Proses jendela bot anak yang masih hidup langsung di-*reattach* tanpa memicu spawn duplikat; proses yang sudah mati saat masih memegang tugas `IN_PROGRESS` di-*respawn* otomatis serta token haknya diselaraskan ulang oleh `PrModerator`. | Must |

---

## 3. Kebutuhan Non-Fungsional (Non-Functional Requirements)

| ID | Kebutuhan |
|---|---|
| **NFR-350** | **Deterministic Protocol Invariants:** Evaluasi batas `PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, filter Lapis-1 `PrMEend`, validasi token & antrean prioritas `PrModerator`, integritas `PrTransferEnvelope`, pemeriksaan disk `PrGate`, serta rekonsiliasi PID `PrReattach` **harus** dijalankan di kode TypeScript teruji (*fail-closed*), bukan diserahkan pada kepatuhan teks LLM. |
| **NFR-351** | **Backward Compatibility (`v0.3.4`):** Perintah `almudaya bot join`, `almudaya bot run`, `almudaya session create`, PKU-First Policy, ACG Capability Presets, `ExecutionModeController`, serta seluruh 437 test `v0.3.4` tetap berfungsi tanpa regresi. |
| **NFR-352** | **Atomic Persistence & Crash Recovery:** Status seluruh protokol (`config.json`, `state.json`, `goal_ledger.json`, `dynamic_rules.json`, `moderator_state.json`, `checkpoints/`) wajib disimpan secara atomik dengan file lock Blackboard sehingga aman saat *resume* via `PrReattach`. |
| **NFR-353** | **Cross-Platform Terminal Launching:** `SpawnManager` mode `windows` wajib mendukung Windows (`wt` / `powershell` / `cmd`), Linux (`x-terminal-emulator` / `gnome-terminal` / `xterm`), dan macOS (`Terminal.app` via `osascript`) serta mendeteksi *headless/CI mode* secara aman. |
| **NFR-354** | **Auditability & Redaction:** Seluruh evaluasi dan penegakan ke-10 butir `IProtocol` (termasuk `protocolId`, `tokenId`, `fenceEpoch`, putusan `MASTER`/Moderator, dan eskalasi HITL) wajib tercatat di `protocol/events.jsonl` dan lolos redaksi rahasia (*Invariant 7*). |
| **NFR-355** | **Modular Offline Testability:** Setiap dari ke-10 kelas `IProtocol` wajib memiliki unit test mandiri yang 100% offline via Vitest (`MockAIProvider`), termasuk simulasi lintas-model A $\rightarrow$ B $\rightarrow$ C, fallback model tunggal, *zombie write fencing*, *circular relay*, `Tugas 0` palsu vs `PrGate`, dan `PrReattach`. |
