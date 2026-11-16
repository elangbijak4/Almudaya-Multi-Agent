# Use Cases Specification — Almudaya Multi-Agent v0.3.5

Dokumen ini menjabarkan skenario interaksi utama antara aktor manusia (**HITL**), **Master Bot (`BOT000`)**, **Bot Moderator Delegasi (`PrModerator`)**, **ProtocolRegistry (`10 Atomic IProtocol`)**, dan **Worker Bots (`BOT001..N`)**.

---

## Daftar Aktor
- **HITL (Human-in-the-Loop / Programmer):** Memberi Peta Pekerjaan, mengonfigurasi parameter protokol via CLI, memantau konsol utama, serta memutuskan eskalasi saat batas protokol terlewati.
- **`MASTER` (`BOT000`):** Bot pemimpin bawaan yang aktif sejak `t = 0` di terminal utama, memegang *Goal Ledger*, mengelola bot anak & aturan dinamis, serta menjadi wasit utama protokol.
- **Moderator Penengah (`PrModerator` — `MASTER` atau Bot Delegasi `BOT_MOD`):** Penengah yang mengelola antrean prioritas intervensi serta menerbitkan, memvalidasi, dan mencabut **Token Hak Kerja (`CapabilityToken`)** atas workspace dan komponen.
- **Worker Bots (`BOT001`, `BOT002`, ...):** Bot spesialis (Arsitek, Implementer, Consistency Inspector, QA/Improvement, dll.) yang berkolaborasi dalam *Macro-Loop* menggunakan `PrTransfer` dan `PrMEend`.
- **ProtocolRegistry (`10 Atomic IProtocol`):** Lapisan deterministik TypeScript yang menegakkan batas seluruh 10 butir protokol.

---

### UC-351: Startup Terpadu Master-HITL & Input Peta Pekerjaan
- **Aktor:** HITL, `MASTER` (`BOT000`), `SpawnManager`
- **Prasyarat:** Minimal satu provider AI aktif (atau mode offline/mock untuk uji).
- **Alur Utama:**
  1. HITL menjalankan `almudaya up -s S_PROJ -w D:\MyProject --provider nvidia --pr-bot 5 --pr-iterasi 8 --pr-de 6`.
  2. Sistem membuat/memuat sesi `S_PROJ`, mendaftarkan root `D:\MyProject`, menyimpan konfigurasi seluruh 10 protokol, dan mengaktifkan `MASTER` (`BOT000`) di konsol utama dengan prompt `HITL [MASTER]> `.
  3. HITL memasukkan Peta Pekerjaan beserta daftar file target utama.
  4. `MASTER` mengurai Peta Pekerjaan menjadi `goal_ledger.json`, menetapkan aturan kerja sesi di `dynamic_rules.json`, menerbitkan **`CapabilityToken`** awal via `PrModerator`, lalu melahirkan `BOT001` (Builder), `BOT002` (Consistency Inspector), dan `BOT003` (QA/Improvement).
  5. Karena `--spawn-mode` bernilai default `windows`, sistem membukakan 3 jendela CLI terpisah; bila `--spawn-mode multiplexed`, seluruh log dialirkan berlabel `[BOT00X]` ke konsol utama.

---

### UC-352: Pembuatan Bot Baru Secara Dinamis di Bawah Protokol `PrBot`
- **Aktor:** `BOT001` (Worker), `MASTER`, `PrBot` & `PrBotGlobal`, HITL
- **Alur Utama (Di Bawah Batas `PrBot` & `PrBotGlobal`):**
  1. Saat mengerjakan modul backend, `BOT001` membutuhkan spesialis basis data baru.
  2. `BOT001` memanggil `request_spawn_bot(name: "DBEngineer", role: "PostgreSQL Schema Specialist", justification: "...")`.
  3. Kernel mengevaluasi `PrBot` (`<= 10`) dan `PrBotGlobal` (RAM, token budget, waktu global).
  4. `MASTER` menyetujui usulan, memilihkan model dari pool, menerbitkan `CapabilityToken` awal, dan `SpawnManager` meluncurkan `BOT004`. Counter `PrBot` naik menjadi `4`.
- **Alur Eksepsi (`PrBot` Terlewati > 10):**
  1. Permintaan bot ke-11 diterima kernel; `PrBot` membekukan kelahiran dan menampilkan dialog eskalasi di konsol HITL.

---

### UC-353: Pengalihan Lintas Model Saat Mentok Iterasi / Timeout / Kuota (`PrIterasi`)
- **Aktor:** `BOT001`, `PrIterasi`, `PrModerator`, `PrTransfer`, `MASTER`, Bot Pengganti (`BOT005`), HITL
- **Alur Utama:**
  1. `BOT001` (`ollama/qwen2.5-coder:7b`) terjebak pada `TASK-02` dan menyentuh **iterasi ke-10** (atau `taskTimeoutMs` / HTTP `402`/`429`).
  2. `PrIterasi` menghentikan `BOT001` pada `TASK-02`; **`PrModerator`** segera mencabut `CapabilityToken` milik `BOT001` dengan menaikkan `fenceEpoch` (mencegah *zombie late write*).
  3. **`PrBotGlobal`** menerapkan **Bot Recycling** (men-*hot-swap* model di tempat atau me-*reap* proses lama yang gagal agar slot aktif tidak membengkak).
  4. `MASTER` mengecek `triedModels` serta **`LastWorkPositionLog` & `checkpointPath`** dari `PrTransfer`: jika berkas terakhir berstatus `NEEDS_REVERT`, kernel memulihkan snapshot bersih `.almudaya/checkpoints/TASK-02/` terlebih dahulu.
  5. Bila `modelPool` memiliki model berbeda yang belum dicoba, `MASTER` menyerahkan `TASK-02` ke `BOT005` (`nvidia/nemotron-3-super-120b-a12b`) lewat `PrTransferEnvelope`. Bila `modelPool` hanya memiliki **1 model tunggal**, `PrIterasi` memakai fallback `ModelCatalog` atau *Clean-Context & Master-Hint Handover* + peringatan ke HITL.
- **Alur Eksepsi (`3x` Handover Tetap Gagal):**
  1. Saat `handoverCount === 3` (`prIterasiHandoverLimit`), cabang tugas ditandai `BLOCKED_HITL` dan konsol memanggil HITL dengan riwayat 3 model gagal.

---

### UC-354: Siklus Macro-Loop, Pemeriksaan Konsistensi & Penutupan Goal Ledger
- **Aktor:** `BOT001` (Builder), `BOT002` (Consistency Inspector), `BOT003` (Improvement/Critic), `PrTransfer`, `PrGate`, `MASTER`
- **Alur Utama:**
  1. `BOT001` menyelesaikan API pada `TASK-01` lalu mengirim estafet via **`PrTransfer`** ke `BOT002` dengan melampirkan `LastWorkPositionLog`, `progressDeltaScore > 0`, `CC: MASTER`, dan pemindahan `CapabilityToken`.
  2. `BOT002` mengaudit konsistensi lintas-file via `query_pku_memory`, meneruskannya ke `BOT003`, hingga selesai dan melapor ke `MASTER`.
  3. `MASTER` menandai item `GoalLedger` terkait sebagai `DONE` dan meneruskan tugas berikutnya hingga seluruh tujuan tuntas dan disahkan oleh **`PrGate`**.

---

### UC-355: Mediasi Jalan Buntu Diskusi Ping-Pong (`PrDE`)
- **Aktor:** `BOT001`, `BOT002`, `PrDE`, `MASTER`, HITL
- **Alur Utama:**
  1. `BOT001` dan `BOT002` berdebat pada `threadId: THR-09`. Kernel mengizinkan pertukaran `1..10` (`<= prDeLimit`).
  2. Saat pesan ke-11 dikirim, `PrDE` mencegat pesan, masuk ke `MasterInterventionQueue` prioritas `P2`, dan menyerahkan transkrip ke `MASTER`.
  3. `MASTER` memilih putusan: `STOP_THREAD` (+ buat rule di `dynamic_rules.json`), `REASSIGN_TASK` (via `PrTransfer`), atau `SPAWN_SPECIALIST`.
- **Alur Eksepsi (`PrDE` Terpicu > 10 Kali):**
  1. Ketika `prDeTriggerCount > prDeEscalationLimit`, `MASTER` menangguhkan mediasi otonom dan melaporkan konflik aturan ke HITL.

---

### UC-356: Failover Otomatis Otak Master Bot (`PrMasterFailover`)
- **Aktor:** `MASTER` (atau Bot Moderator Delegasi), `FailoverAIProvider`, HITL
- **Alur Utama:**
  1. Permintaan AI milik `MASTER` ke `nvidia/...` mengalami HTTP `402` atau *timeout*.
  2. `PrMasterFailover` langsung mengganti otak ke model berikutnya di `masterFailoverChain` sambil menjaga Blackboard, `moderator_state.json`, dan `goal_ledger.json` tetap utuh.
  3. Jika seluruh rantai gagal, status sesi masuk `PAUSED_MASTER_UNAVAILABLE` untuk keputusan HITL.

---

### UC-357: Kustomisasi Seluruh Ambang Batas 10 Protokol oleh Programmer via CLI
- **Aktor:** HITL
- **Alur Utama:**
  1. Programmer menjalankan:
     `almudaya up -s S_TEST -w D:\Demo --pr-bot 3 --pr-iterasi 4 --pr-iterasi-handover 2 --pr-de 4 --pr-de-escalation 3 --pr-no-progress 4 --moderator-bot auto --task-timeout 90000 --token-budget 150000 --global-timeout infinite --spawn-mode multiplexed`
  2. `protocol/config.json` menyimpan seluruh batas baru dan mengonfigurasi masing-masing dari ke-10 kelas `IProtocol` secara seragam lewat `protocol.configure()`.

---

### UC-358: Penanganan Pesan Buntu & `Tugas 0` melalui `PrMEend`
- **Aktor:** `BOT002`, `PrMEend`, `PrTransfer`, `PrGate`, `MASTER`
- **Alur Utama A (Kebuntuan Penerima Pesan):**
  1. `BOT002` mengirim pesan akhir tugas dengan `CC: MASTER`, tetapi lupa menentukan penerima atau penerima `UNKNOWN`/`OFFLINE`.
  2. Lapis-1 `PrMEend` (0 token) mendeteksi anomali penerima dan membangunkan `MASTER` (Lapis-2).
  3. `MASTER` memigrasikan pesan (beserta `PrTransferEnvelope` dari pengirim) ke bot aktif yang tepat atau melahirkan spesialis baru (lewat `PrBot` + `PrBotGlobal`).
- **Alur Utama B (Pencegahan "Silent Death" saat `Tugas 0`):**
  1. `BOT001` mengirim pesan bertanda `TASK_0`. Lapis-1 `PrMEend` meneruskan pemeriksaan ke `MASTER` lalu **`PrGate`**.
  2. Bila `GoalLedger` masih punya item terbuka atau verifikasi fisik **`PrGate`** gagal, `MASTER` menolak `TASK_0` dan menyuntikkan tugas lanjutan.

---

### UC-359: Pencegahan Kelahiran Bot Berlebih & Recycling oleh `PrBotGlobal`
- **Aktor:** `MASTER`, `PrBotGlobal`, `HardwareAdvisor`, HITL
- **Alur Utama:**
  1. `MASTER` hendak spawn `BOT005` untuk `PrIterasi`/`PrMEend`, padahal RAM tersisa kritis (`220 MB < 256 MB`) atau `tokenBudget` / `globalTimeoutMs` habis.
  2. Sebelum spawn, **`PrBotGlobal`** mencoba mekanisme **Bot Recycling** atas bot idle terlebih dahulu jika relevan untuk handover; jika benar-benar melebihi plafon kapasitas fisik/token/waktu global, **`PrBotGlobal` mencegat `MASTER`** dan langsung melapor ke **HITL**.

---

### UC-360: Arbitrase Token Hak Kerja, Proteksi Zombie Overwrite, & Delegasi Penengah (`PrModerator`)
- **Aktor:** `MASTER` (`BOT000`), `BOT_MOD` (Moderator Delegasi), `BOT001`, `BOT005`, `ExecutionModeController`, HITL
- **Alur Utama A (Pencegahan *Zombie Overwrite* via `CapabilityToken`):**
  1. `BOT001` memegang `CapabilityToken` `CAP-001` (`fenceEpoch: 1`, `accessMode: 'EXCLUSIVE_WRITE'`, `allowedPaths: ['src/api/**']`).
  2. Terjadi handover `PrIterasi` dari `BOT001` ke `BOT005`. **`PrModerator`** menaikkan `fenceEpoch` menjadi `2` dan menerbitkan `CAP-002` untuk `BOT005`.
  3. Proses terminal `BOT001` yang terlambat menjalankan tool `write_file('src/api/auth.ts')` dengan token `fenceEpoch: 1` **ditolak secara deterministik oleh `ExecutionModeController`** (`ERR_STALE_CAPABILITY_FENCE`), menyelamatkan kode `BOT005`.
- **Alur Utama B (Delegasi Peran Moderator & Antrean Prioritas):**
  1. Sesi menjalankan 6 bot anak paralel. Untuk mencegah *bottleneck*, `MASTER` memanggil `delegate_moderator_role(targetBotId: 'BOT_MOD')` (atau `--moderator-bot BOT_MOD`). `BOT_MOD` kini menjadi arbiter distribusi `CapabilityToken` dan pengawas `MasterInterventionQueue`, sementara putusan strategis akhir & `GoalLedger` tetap milik `MASTER`.
  2. Saat di detik bersamaan masuk intervensi `PrBotGlobal` (`P0`), `PrIterasi` (`P1`), dan `PrBot` (`P5`), `PrModerator` mengeksekusi urut dari `P0 -> P1 -> P5` secara berseri tanpa *race condition*.

---

### UC-361: Estafet Tugas Berkelanjutan dengan `LastWorkPositionLog` & Deteksi Estafet Melingkar (`PrTransfer`)
- **Aktor:** `BOT001`, `BOT002`, `BOT003`, `PrTransfer`, `PrDE`, `MASTER`
- **Alur Utama A (Transfer Normal & Pemindahan Hak Atomik):**
  1. `BOT001` memanggil `submit_task_handoff` / `send_message` ke `BOT002` pada `TASK-04`.
  2. `PrTransfer` memvalidasi kelengkapan `PrTransferEnvelope`: wajib memuat `LastWorkPositionLog` (*langkah terakhir selesai*, *langkah berikutnya*, `touchedFiles` + `checkpointPath`, `progressDeltaScore: 15`) dan `CapabilityToken` milik `BOT001`.
  3. Kernel memindahkan `CapabilityToken` ke `BOT002` dengan `fenceEpoch + 1` dan mengirim amplop lengkapnya ke inbox `BOT002`.
- **Alur Utama B (Deteksi Circular Relay Loop `A -> B -> C -> A` Tanpa Progres):**
  1. `BOT001 -> BOT002 -> BOT003 -> BOT001` terus mengoper tugas dengan mengganti-ganti `threadId`, tetapi `progressDeltaScore === 0` dan `GoalLedger` tidak berubah selama 5 transfer berturut-turut (`--pr-no-progress 5`).
  2. `PrTransfer` + Lapis-1 `PrMEend` menandai pesan ke-5 sebagai anomali **Circular Zero-Progress Relay** dan meneruskannya ke mediasi **`PrDE`** oleh `MASTER`.

---

### UC-362: Gerbang Verifikasi Objektif (`PrGate`) & Pemulihan Jendela Anak (`PrReattach`)
- **Aktor:** HITL, `BOT001`, `PrGate`, `PrReattach`, `MASTER`, `SpawnManager`
- **Alur A (`PrGate` Menahan Halusinasi Selesai `Tugas 0`):**
  1. `BOT001` mengklaim seluruh pekerjaan selesai (`TASK_0`), padahal berkas `src/auth/jwt.ts` yang terdaftar pada `targetFiles[]` di `GoalLedger` belum ada atau berukuran `0` byte.
  2. Sebelum `MASTER` mengesahkan `GOAL_ACHIEVED`, **`PrGate`** melakukan pengecekan fisik di disk dan langsung memblokir pengesahan (`GATE_FAILED: Missing target file src/auth/jwt.ts`).
  3. `MASTER` otomatis menolak `TASK_0` dan menugaskan penyelesaian berkas yang kurang tersebut ke bot pekerja.
- **Alur B (`PrReattach` Saat Terminal Master Di-restart):**
  1. Terminal konsol utama `MASTER` mengalami *crash* atau ditutup paksa ketika `BOT001` (PID 14210) dan `BOT002` (PID 14288) sedang bekerja pada mode `windows`, sementara `BOT003` (PID 14305) ikut mati.
  2. Programmer menjalankan kembali `almudaya up -s S_PROJ -w D:\MyProject`.
  3. **`PrReattach`** memeriksa `bots.json`: menemukan PID 14210 dan 14288 masih hidup beserta *heartbeat* aktif sehingga **mengaitkannya kembali (*reattach*) tanpa membuka jendela ganda**, sedangkan `BOT003` yang mati pada tugas `IN_PROGRESS` di-*respawn* bersih dengan `LastWorkPositionLog` & `CapabilityToken` terkini.
