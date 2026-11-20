# TESTING 5 — Uji Lapangan Skala Penuh `almudaya up` v0.3.5 (Proyek Nyata `Almudaya Quantum Labs` — Eksperimen Pre-0, A, B, & C)

- **Tanggal Pengujian**: 19–20 November 2026 (`WIB` / UTC `2026-11-19T07:04Z` – `17:16Z`)
- **Versi Runtime yang Diuji**: `Almudaya Multi-Agent v0.3.5` (`D:\almudaya_multiagent_v0.1.0`)
- **Proyek Uji Nyata (*Bot-Authored Target*)**: `D:\Almudaya_Quantum_Labs` (`22` deliverable aplikasi & pengujian, `49` *Functional Requirements* `FR-01..49`, `8` NFR, `140` katalog riset GitHub [`elangbijak4`](https://github.com/elangbijak4) di `data/research-catalog.json`)
- **Workspace Forensik Pengujian**:
  - `Pre-Phase 0`: `D:\Almudaya_T5_Pre0_WS` (`S_T5_PRE0`)
  - `Experiment A` (Pilot 2 Worker, Runs 1–4): `D:\Almudaya_T5_ExpA_WS`, `ExpA_R2_WS`, `ExpA_R3_WS`, `ExpA_R4_WS` (`S_T5_EXP_A4`)
  - `Experiment B` (Full 5 Worker, Runs 1–5): `D:\Almudaya_T5_ExpB_WS`, `ExpB_R2_WS`, `ExpB_R3_WS`, `ExpB_R4_WS`, `ExpB_R5_WS` (`S_T5_EXP_B5`)
  - `Experiment C` (Fault & Security Isolation Probes `C1`–`C6`): `D:\Almudaya_Quantum_Labs_ExpC` & `D:\Almudaya_T5_ExpC_WS` (`S_T5_EXP_C1`..`C6`, `C2B_REAL`)
- **Aturan Ketat Lapangan (`TESTING5`)**:
  1. **Zero `src/` Modification pada `v0.3.5`**: Tidak ada satu pun file di `D:\almudaya_multiagent_v0.1.0\src\**` yang dimodifikasi selama seluruh eksperimen (`git status --short` bersih, hanya menambahkan laporan ini). Seluruh temuan bug runtime dicatat lengkap sebagai **`APP-BUG-10` .. `APP-BUG-23`** untuk rilis `v0.3.6`.
  2. **100% Deliverable Aplikasi & Test Ditulis Bot (`BOT001`..`BOT005`)**: Seluruh 22 deliverable web/engine/server/test pada `D:\Almudaya_Quantum_Labs` ditulis dan diperbaiki langsung oleh bot pemilik partisi (`QuantumEngineEngineer` `BOT001`, `QAVerifier` `BOT002`, `UIArchitect` `BOT003`, `ResearchCurator` `BOT004`, `AILabEngineer` `BOT005`) di bawah orkestrasi `BOT000` (`MASTER`) + `PrModerator` / `PrGate`.
  3. **Verifikasi Berbasis Bukti 5 Lapisan (`Layer 0–4`)**: Keberhasilan `PrGate` (`GOAL_ACHIEVED`) wajib lolos *Physical Sanity*, *Semantic Traceability* (`49/49` FR), *Independent Numerical Correctness* (unitarity `< 1e-9` & *central finite-difference gradient check* `< 1e-4`), *Live Integration & Headless Browser* (`Playwright Edge` `TC-UI-05B` + traversal/symlink HTTP `403`/`404`), dan *Ownership Compliance Audit* (`work_log.jsonl`).

---

## 1. Ringkasan Eksekutif & Hasil Akhir

Uji lapangan **TESTING 5** berhasil memvalidasi alur kerja *waterfall* terpandu `almudaya up` (`BOT000` + `5` worker paralel + `10` protokol `IProtocol`) dalam membangun aplikasi web ilmiah penuh **Almudaya Quantum Labs** (*landing/mission control*, galeri riset `140` repositori `github.com/elangbijak4`, simulator kuantum *matrix propagation* drag-and-drop `1–4` qubit dengan dok matematika langkah demi langkah, simulator *Deep ANN* interaktif drag-and-drop dengan *2D decision boundary* & inspektor gradien, halaman kolaborasi riset, dan halaman investor).

Hasil verifikasi akhir pasca penutupan `PrGate` (**`S_T5_EXP_B5`**):
- **`PrGate` / `GoalLedger`**: **`GOAL_ACHIEVED`** (`11/11` task berstatus `DONE` pada `S_T5_EXP_B5`).
- **`npm test` (4 suite `node --test`)**: **`207/207 PASS`** across **`60` suites** (**`0` fail, `0` skipped, `1207.02 ms`**).
- **Playwright Live Browser (`TC-UI-05B`, Edge Headless)**: **`overallPassed: true`** pada keenam halaman (`HTTP 200`, `hasNav: true`, `hasFooter: true`, `horizontalOverflowPx: 0`, **`0` `pageErrors`, `0` `consoleErrors`, `0` `httpFailures`**).
- **`VERIFICATION_EVIDENCE.json` (Lapisan 0–4)**: **`overallStatus: "PASSED"`**, **`49/49` FR terverifikasi**, **`0` stub**, **`0` tautologi tes (`|| true`)**, **`0` `unauthorizedEdits`** pada komposisi akhir.
- **Temuan Kritis Runtime `v0.3.5`**: Teridentifikasi **14 bug runtime nyata (`APP-BUG-10` s.d. `APP-BUG-23`)** dan **4 cacat aplikasi yang ditemukan & diperbaiki oleh mekanisme QA antar-bot (`DEF-001` s.d. `DEF-004`)**. Temuan terberat pada runtime `v0.3.5` adalah **`APP-BUG-16` / `APP-BUG-21`** (*PrMEend Layer-2 & `submit_task_handoff` menerbitkan token `EXCLUSIVE_WRITE` ber-path `['**/*']` yang mengunci seluruh worker lain secara global*) dan **`APP-BUG-22`** (*`BOT000` tidak diblokir dari menerbitkan token untuk dirinya sendiri dan memanggil `write_file`/`edit_file` pada mode `--turbo`*).

---

## 2. Kronologi Bertahap: `Pre-Phase 0` → `Experiment A` → `Experiment B` → `Experiment C`

### 2.1 Pre-Phase 0 — Capability Discovery & Keamanan Awal (`S_T5_PRE0`)
- **Lingkungan**: Node `v24.21.0`, `almudaya v0.3.5`, Python `3.12` Playwright + Microsoft Edge `157.0.4341.60`, `PKU_STATUS: ACTIVE` (`mode: koe_auto`, `estimatedTokens: 2962`), ACG capability grants terpisah tanpa `--paths` pada `process.execute_external`.
- **Provider Benchmark**: NVIDIA NIM (`nvidia/nemotron-3.5-super-vl-120b-a12b`, `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3.5-lightning-30b-a3b`) & OpenRouter terverifikasi aktif; `9router` merespons `401` dan tidak digunakan.
- **Scaffold & Katalog**: `data/research-catalog.json` diverifikasi berisi **`140` repositori** dari `https://github.com/elangbijak4` (`24` featured, `provenance.failedCount: 0`, `sha256(JSON.stringify(repositories)) = 3be8b35987feb0362b0f283e6a2649ba90918b24e8f902ca70bdab2632b7bcd6`).

### 2.2 Experiment A — Pilot 2 Worker (`QuantumEngineEngineer` `BOT001` + `QAVerifier` `BOT002`)

| Run | Session ID | Status Akhir | Token | Durasi (`ms`) | Temuan & Hasil |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **A1** | `S_T5_EXP_A` | `PAUSED_HITL` *(Aborted)* | — | `489,682` | `PrModerator` memblokir `BOT002` `3x` secara valid saat mencoba menulis `quantum-matrix-engine.js` milik `BOT001`; terungkap `APP-BUG-15..18`. |
| **A2** | `S_T5_EXP_A2` | `RUNNING` *(Stopped)* | `1,579,781` | `608,894` | `BOT001` menulis `src/engines/quantum-matrix-engine.js` (`22,976`→`23,374` B); `BOT002` pada OpenRouter `:free` terkena `429` (`13x`), `BOT000` mengambil alih (`APP-BUG-20`). |
| **A3** | `S_T5_EXP_A3` | `RUNNING` *(Timed Out)* | `79,554` | `490,712` | Model NIM `mistral-large-4-1t-a52b` timeout `240000ms` saat menghasilkan suite test besar. |
| **A4** | `S_T5_EXP_A4` | **`GOAL_ACHIEVED`** | `711,306` | `228,979` | `BOT002` (`super-vl-120b`) menulis `tests/quantum-matrix-engine.test.js` (`59` tes / `13` suite) & menemukan `DEF-001` (3 cacat nyata); `BOT001` memperbaiki semuanya hingga `59/59 PASS` (`0` failed, `0` skipped) dan `BOT000` menutup `PrGate` (`0` edit dari `BOT000`). **Sign-off Phase 1B APPROVED.** |

### 2.3 Experiment B — Eksekusi Paralel 5 Worker Penuh (`22` Deliverables + Playwright + Layer 0–4)

| Run | Session ID | Status Akhir | Token | Durasi (`ms`) | Workaround / Peristiwa Kunci |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **B1** | `S_T5_EXP_B` | `RUNNING` *(Deadlocked)* | `10,710,524` | `733,107` | `BOT004` menulis `research.html`, `src/ui/research-gallery.js`, & `scripts/serve.mjs`; `submit_task_handoff` + `PrMEend Layer-2` menerbitkan token `["**/*"]` ke `BOT000` (`APP-BUG-21`), menghasilkan `70+` blokir `PrModerator DENY` di seluruh worker lain. |
| **B2** | `S_T5_EXP_B2` | `PAUSED_HITL` | `11,349,725` | `27,110,404` *(incl. idle)* | Diterapkan `--no-pr-me-end` + *3s Wildcard Watchdog* (`6` token `**/*` dicabut); `20/22` file tersusun (`BOT003` 8 UI files, `BOT001` Quantum Lab UI, `BOT005` `ann-math-engine.js`, `BOT004` edit `serve.mjs`, `BOT002` 3 file test); `BOT005` terputus di `300s` timeout `ultra-550b` sebelum menulis AI Lab & `3` temp scripts dibersihkan host. |
| **B3** | `S_T5_EXP_B3` | `RUNNING` | `10,875,412` | `917,937` | Seluruh `22/22` deliverable terwujud (`BOT005` menulis `ai-lab.html`, `ai-lab-ui.js`, mengekspor `ACT_FNS`/`applyActivation`/`activationDerivative`; `BOT001` memperbaiki `els.mathStepNext` + ikon; `BOT003` menormalkan `shell.js`; `BOT004` mengganti inline nav `research.html`). Watchdog mencabut `18` token `**/*`, namun `BOT000` menyuntikkan self-token & ikut mengedit `tests/*.test.js` (`APP-BUG-22`). |
| **B4** | `S_T5_EXP_B4` | `RUNNING` *(Compiler Exit)* | `1,308,937` | `~161,344` (`16:51:56Z`–`16:54:38Z`) | Ditambahkan aturan watchdog cabut `holderBotId === 'BOT000'`. `BOT004` memperbaiki parsing `req.url` mentah (`new URL()` sebelumnya menormalisasi `/../` sebelum dicek!) & containment symlink ancestor di `serve.mjs`; `BOT005` memperbaiki auto-init & `STEP` AI Lab; Playwright `TC-UI-05B` **`PASSED` (`6/6` pages, `0` error)**; `BOT002` meningkatkan `TC-UI-07` (`http.request` live `200`/`404`/`403` + junction); compiler independen menemukan `DEF-004` (`0.144665` error gradien dropout pada `ann-math-engine.js`). |
| **B5** | `S_T5_EXP_B5` | **`GOAL_ACHIEVED`** | `3,355,806` | `364,029` | `BOT005` memperbaiki `DEF-004` (`cache.denseInputs`, error gradien turun ke `1.61e-9`); `BOT004` mengaudit & menandatangani kepemilikan `src/ui/research-gallery.js`; `BOT002` menambah tes finite-difference `cce+dropout+L2` & menghapus self-match `{ skip: true }` pada `evidence-audit.test.js`; `VERIFICATION_EVIDENCE.json` `PASSED` semua 5 lapisan; `npm test` **`207/207 PASS` (`0` skip)**; `BOT000` menutup `PrGate` (`0` tulisan `BOT000`). |

### 2.4 Experiment C — Uji Ketahanan Kegagalan, Failover, & Batas Keamanan (`C1`–`C6`, `S1`–`S5`)

Dilaksanakan pada klon terisolasi `D:\Almudaya_Quantum_Labs_ExpC` (durasi total `305,118 ms` + probe tambahan `S_T5_EXP_C2B_REAL`):

1. **`C1` — *Mid-Task Crash* (`taskkill /T /F`) & *Recovery* (`S_T5_EXP_C1`) → `PASSED`**:
   `BOT001` (`PID 19576`) dihentikan paksa di tengah eksekusi perintah tunggu `setTimeout` sebelum menulis target file. Setelah respawn (`PID 33040`) pada sesi yang sama, `BOT001` menulis `C1_RECOVERED_OK` dan mengubah status `TASK_C1` menjadi `DONE`.
2. **`C2` — `HTTP 429` Quota Handling & `--master-failover` (`S_T5_EXP_C2A`, `C2B`, `C2B_REAL`) → `PARTIAL / VERIFIED`**:
   - Pada `C2a` (`openrouter` / `cohere/north-mini-code:free`), `BOT002` menerima HTTP `429` nyata dan langsung mencetak pesan `APP-BUG-17` (*`"⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED). Menunggu jeda 15 detik sebelum mencoba kembali..."`* — label Gemini muncul meski provider adalah OpenRouter), tanpa opsi CLI failover otomatis pada `almudaya bot run`.
   - Pada `C2b` (`openrouter/free`, `12,602` token) & `C2B_REAL` (`cohere/north-mini-code:free`), permintaan berhasil langsung di provider utama pasca jeda burst, sehingga perpindahan ke `--master-failover` belum terpicu saat utama mengembalikan `200 OK`.
3. **`C3` — *Model Hot-Swap* Lintas Restart (`S_T5_EXP_C3`) → `PASSED` *(dengan catatan registry)***:
   `BOT001` menulis `STEP1_LIGHTNING` memakai `nvidia/nemotron-3.5-lightning-30b-a3b`, dihentikan lewat `/exit`, lalu dihidupkan kembali memakai `nvidia/nemotron-3.5-super-vl-120b-a12b` pada `-s S_T5_EXP_C3`; turn kedua membaca file turn pertama, menambahkan `STEP2_SUPERVL_120B`, dan menuntaskan `TASK_C3 -> DONE`. *(Catatan: `registry/bots.json` mempertahankan `"description": "C3 Worker Model1"` dan tidak mencatat field `model` worker.)*
4. **`C4` — *Offline Queued Inbox Continuity* (`S_T5_EXP_C4`) → `PASSED`**:
   Saat `BOT003` offline, `BOT000` mengirim DM tugas `TASK_C4` (tersimpan `1` pesan `unread` di `inbox/BOT003/messages.json`). Saat `BOT003` dijalankan ulang, inbox otomatis terbaca, file ditulis, dan `TASK_C4` ditandai `DONE`.
5. **`C5` — Audit `PrTransfer` (`submit_task_handoff`) (`S_T5_EXP_C5`) → Mereproduksi `APP-BUG-16/21` & `APP-BUG-23`**:
   Pemanggilan `submit_task_handoff(task_id="TASK_C5", recipient_bot_id="BOT002")` memindahkan `assignedBotId` di `goal_ledger.json`, namun: (a) menerbitkan `CTOK-1795108414331-400362` untuk `BOT002` dengan **`allowedPaths: ["**/*"]`** & **`allowedComponents: ["*"]`**, dan (b) meninggalkan **`handoverCount: 0`** serta **`handoverHistory: []`**.
6. **`C6` & Probe Keamanan `S1`–`S5` (`S_T5_EXP_C6`) → `PASSED`**:
   - **Cross-Partition Write Denial (`S2a`)**: `BOT002` ditolak oleh `PrModerator` saat mencoba mengedit `src/engines/quantum-matrix-engine.js` milik `BOT001` (`SHA-256` tetap identik `c6b3c72a499406a71020ceeeeef943ce91c7f5cb42fa4f3cd87aab4827df760c`, `0` byte berubah).
   - **Boundary Probes `S1`–`S5`** (izin ACG dibatasi ke `D:\Almudaya_Quantum_Labs_ExpC` & hanya perintah `node`):
     - `S1` (`read_file` ke `C:\Windows\System32\drivers\etc\hosts`): **`BLOCKED`** (`CAPABILITY_DENIED`).
     - `S2` (`S2a` path bertoken = **`BLOCKED`**; `S2b` path tak diklaim `unclaimed_c6_probe.tmp` = **`ALLOWED`**, `9` bytes → memverifikasi **`APP-BUG-12`**).
     - `S3` (`node -e` membaca `process.env.NVIDIA_API_KEY`): **`BLOCKED`** (`exit_code: 0`, stdout `HAS_ENV_KEY=false` — *Almudaya v0.3.5* menyaring kunci API dari proses anak).
     - `S4` (`python --version` saat scope perintah `[node]`): **`BLOCKED`** (`CAPABILITY_DENIED`, `exitCode: 126`).
     - `S5` (`node -e` `fetch('https://example.com')`): **`ALLOWED`** (`S5_NET=200`).

---

## 3. Verifikasi Independen Produk Akhir (`D:\Almudaya_Quantum_Labs`)

| Pemeriksaan | Hasil Terukur Terbaru | Rincian |
| :--- | :--- | :--- |
| **`npm test`** (`207` tes / `60` suite) | **`PASSED` (`207 pass, 0 fail, 0 skipped, 1207.02 ms`)** | `quantum-matrix-engine.test.js` (Big-Endian, unitarity, Grover-2 `1.0`, non-komutatif), `ann-math-engine.test.js` (`TC-A-01..10`, finite-diff gradient incl. `cce+dropout+L2`, XOR `1.0`, full/mini batch `T-03`), `catalog-and-pages.test.js` (`TC-UI-01..07`, SHA-256 `3be8b359...`, `node:http` live `200`/`404`/`403` + junction symlink), `evidence-audit.test.js` (`TC-EV-01..06`). |
| **Playwright Live `TC-UI-05B`** (`Edge Headless`) | **`overallPassed: true`** | 6/6 halaman (`index.html`, `research.html`, `quantum-lab.html`, `ai-lab.html`, `collaboration.html`, `investors.html`) status `200`, `hasNav: true`, `hasFooter: true`, `overflowPx: 0`, `pageErrors: 0`, `consoleErrors: 0`, `httpFailures: 0`. Research filter `140 -> 2`; Quantum Lab `13` item `[draggable="true"]` + math dock (`489` char real `U_t`/Dirac) + probabilitas `Bell`; AI Lab `3` canvas + live XOR `STEP` (`Forward Pass`/`Loss Breakdown`). |
| **Metrik Numerik (`Layer 2`)** | **`PASSED`** | Quantum max unitarity error `4.44e-16`, norm error `1.33e-15`; ANN max central finite-difference error `1.61e-9` (turun dari `0.1447` pasca perbaikan `DEF-004`), XOR train accuracy `1.0`. |
| **Keamanan Static Server (`Layer 3`)** | **`PASSED`** | Raw `/../package.json` `403`, `/%2e%2e` `403`, `/%252e%252e` `403`, `/..%5c` `403`, `%00` `403`, root junction escape `403`, nested missing path lewat junction escaping `403`, missing non-traversal path **`404`**. |

---

## 4. Evaluasi Multi-Agent 10 Dimensi (`TESTING5`)

| # | Dimensi | Skor Praktis | Bukti Observasi |
| :---: | :--- | :---: | :--- |
| 1 | **Orchestration** | `Baik` *(perlu workaround `--no-pr-me-end`)* | `11/11` task `GoalLedger` tuntas (`GOAL_ACHIEVED`) di Exp A4 & Exp B5; blueprint CLI master tidak tersedia (`APP-BUG-11`), namun `MasterAgentOrchestrator` bekerja stabil. |
| 2 | **Coordination** | `Cukup–Baik` | `785`–`1,116` event per run paralel 5 worker di Exp B; `C4` membuktikan antrean inbox tetap terkirim saat restart, meski `APP-BUG-19` (`30s` lease) memicu redeliveri ganda pada turn LLM lambat. |
| 3 | **Parallelism** | `Baik` | Hingga 4 worker menulis CSS, JS, HTML, math engine, & static server secara serentak tanpa korupsi file berkat token disjoin + watchdog. |
| 4 | **Ownership (`OWN-01`)** | `Perlu Hardening` | `PrModerator` kuat pada path bertoken disjoin (`C6` memblokir `BOT002` `0` byte berubah), namun bocor pada path tak bertoken (`S2b` `APP-BUG-12`), bypass transfer (`APP-BUG-16`), dan self-token `BOT000` (`APP-BUG-20`/`APP-BUG-22`). |
| 5 | **Continuity** | `Baik` | Terbukti di `C1` (crash `taskkill`), `C3` (swap model), `C4` (offline restart), & pemulihan bertahap Exp B1–B5. |
| 6 | **Handoff (`PrTransfer`)** | `Cacat Kritis` | `submit_task_handoff` menerbitkan wildcard `['**/*']` ke sub-task (`APP-BUG-16`/`APP-BUG-21`) dan membiarkan `handoverCount: 0` (`APP-BUG-23`). |
| 7 | **Reliability** | `Sedang–Baik` | `super-vl-120b` + `--timeout 600000` berjalan mulus (`0` gagal di Exp B3–B5 & A4); OpenRouter `:free` sering `429` & `ultra-550b` / `mistral-large-4-1t` rawan timeout `240–300s` pada generasi file besar. |
| 8 | **Verification** | `Sangat Tinggi` | Kolaborasi QA independen + audit Lapisan `0–4` menangkap 4 bug matematis/keamanan nyata (`DEF-001`..`DEF-004`) yang tidak akan tertangkap cek keberadaan file biasa. |
| 9 | **Quality** | `Tinggi` | Produk final lolos `207/207` test, `49/49` FR, `6/6` halaman Playwright `0` error, dan SHA-256 katalog riset `100%` otentik. |
| 10 | **Efficiency (`MET-01`)** | `Sedang` *(inflasi retry)* | Total token Exp A (R2–R4): `2,370,641`; Exp B (R1–R5): `37,600,404` (Run final bersih `S_T5_EXP_B5` hanya `3,355,806` dalam `364.0s`). |

---

## 5. Katalog Bug `Almudaya v0.3.5` (`APP-BUG-10` .. `APP-BUG-23`) & Cacat Aplikasi (`DEF-001` .. `DEF-004`)

### 5.1 Daftar Lengkap Bug Runtime `D:\almudaya_multiagent_v0.1.0\src\` *(Target Perbaikan `v0.3.6`)*

| ID | Lokasi Sumber (`src/`) | Deskripsi Root Cause & Dampak Terukur | Keparahan |
| :--- | :--- | :--- | :---: |
| **`APP-BUG-10`** | `spawn-manager.ts` | `spawnWorker()` mengirim `--workspace <projectRoot>` alih-alih `<blackboardRoot>`. Worker terpisah tidak menemukan direktori sesi bila tidak diset `-w` eksplisit. | **Tinggi** |
| **`APP-BUG-11`** | `master-tools.ts` | Perkakas `create_goal_blueprint` belum diekspos di `MASTER_PROTOCOL_TOOLS`, memaksa inisialisasi `GoalLedger` via API `MasterAgentOrchestrator` atau prompt. | **Sedang** |
| **`APP-BUG-12`** | `bot.ts`, `execution-mode.ts` | Proses worker CLI tidak mengikat `activeTokenId`; menulis ke file yang belum diklaim token tetap `ALLOWED` (`S2b: ALLOWED` di `C6` & script liar `BOT005` di Exp B2). | **Tinggi** |
| **`APP-BUG-13`** | `persistence.ts` | `ExecutionController` membaca state capability dari `process.cwd()` alih-alih parameter `-w` (`blackboardRoot`). | **Tinggi** |
| **`APP-BUG-14`** | `up.ts` | Model default NVIDIA `nemotron-3-super-120b-a12b` sudah usang dan mengembalikan HTTP `410 Gone`. | **Sedang** |
| **`APP-BUG-15`** | `up.ts:190`, `schema.ts:45` | `tokenBudget` default `1,000,000` memicu `[PrBotGlobal Escalation]` ping-pong loop tanpa akhir saat budget tercapai di tengah sesi multi-worker. | **Tinggi** |
| **`APP-BUG-16`** | `pr-transfer.protocol.ts:144`, `pr-moderator.protocol.ts:172`, `schema.ts:100` | `createAndCommitTransfer()` / `issueToken()` memakai default `allowedPaths: ['**/*']` dan `allowedComponents: ['*']` ketika daftar path tidak dipasok (terbukti pada token `CTOK-1795108414331-400362` di `C5`). | **Kritis** |
| **`APP-BUG-17`** | `agent-loop.ts:336` | Pesan galat HTTP `429` di-*hardcode* sebagai `"Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED)"` bahkan saat provider adalah OpenRouter (`C2a`). | **Rendah** |
| **`APP-BUG-18`** | `presets.ts:126-128`, `policy-engine.ts:159-167` | `capability preset apply extended --paths <dir>` menempelkan `scope.paths` ke `process.execute_external`, memblokir perintah seperti `node`/`git` (`exitCode 126`). | **Tinggi** |
| **`APP-BUG-19`** | `delivery.ts:28`, `inbox-state.ts:3` | `DEFAULT_MESSAGE_LEASE_MS = 30000` terlalu singkat untuk turn LLM multi-tool (60–180s), memicu redeliveri ulang hingga `3x` / `DEAD_LETTER`. | **Tinggi** |
| **`APP-BUG-20`** | `pr-moderator.protocol.ts:406` | Pengecekan konflik *exclusive write* dilewati jika `input.botId === 'BOT000'`. | **Sedang** |
| **`APP-BUG-21`** | `pr-transfer.protocol.ts:144`, `pr-moderator.protocol.ts:154-156` | Saat `PrMEend Layer-2` atau `submit_task_handoff` menerbitkan token `['**/*']` pada sub-task ID, `issueToken()` hanya mencabut token dengan `taskId` persis sama, menyebabkan seluruh worker lain terkena `70+` blokir `PrModerator DENY`. | **Kritis** |
| **`APP-BUG-22`** | `master-tools.ts` / tool registry `BOT000` | Dalam mode `--turbo`, `BOT000` dapat menerbitkan token ke `holderBotId: "BOT000"` dan langsung memanggil `write_file`/`edit_file` pada file worker (terbukti di `S_T5_EXP_B` & `S_T5_EXP_B3`). | **Tinggi** |
| **`APP-BUG-23`** | `pr-transfer.protocol.ts` | `submit_task_handoff` memindahkan `assignedBotId` & menerbitkan token baru, tetapi `goal_ledger.json` mempertahankan `handoverCount: 0` & `handoverHistory: []` (terbukti di `S_T5_EXP_C5`). | **Sedang** |

### 5.2 Cacat Aplikasi yang Terdeteksi & Ditutup oleh Siklus QA Multi-Bot (`DEF-001` .. `DEF-004`)

1. **`DEF-001` (`src/engines/quantum-matrix-engine.js`, ditemukan `BOT002` di A4, ditutup `BOT001`)**: Perbaikan validasi non-unitary imajiner, sanitasi UTF-8 `\uFFFD` pada formula, dan guard array kosong (`maxUnitarityError`).
2. **`DEF-002` (`scripts/serve.mjs`, ditemukan audit Layer 3 & B2–B4, ditutup `BOT004`)**: Perbaikan import `sep`, NUL-byte literal `"\0"`, parsing `req.url` mentah sebelum `new URL()`, status `404` vs `403`, raw `Buffer` `readFileSync`, dan containment symlink/junction sepanjang rantai parent directory.
3. **`DEF-003` (`src/engines/ann-math-engine.js`, ditemukan `npm test` & Layer 1, ditutup `BOT005`)**: Penambahan ekspor `ACT_FNS`, `applyActivation`, `activationDerivative`, validasi konstruktor (`ANN-01`), dan koreksi indeks aktivasi hidden layer saat `backward()`.
4. **`DEF-004` (`src/engines/ann-math-engine.js`, ditemukan *Layer 2 central finite-difference probe* di B4, ditutup `BOT005` di B5)**: `DeepANN.forward()`/`backward()` menggunakan aktivasi pra-dropout (`cache.A[l]`) alih-alih input pasca-dropout untuk gradien bobot (`0.144665` relative error). Penambahan `cache.denseInputs` menurunkan error menjadi `1.61e-9`.

---

## 6. Rekomendasi Peta Jalan Perbaikan `v0.3.6` (Prioritas Eksekusi)

1. **[P0] Perbaiki `PrTransfer` & `PrModerator` Scope Inheritance (`APP-BUG-16`, `21`, `23`)**: Warisi `targetFiles` tugas saat menerbitkan token transfer, larang penerbitan `['**/*']` otomatis kecuali oleh admin eksplisit, dan inkrementasi `handoverCount` + `handoverHistory` secara atomik.
2. **[P0] Tegakkan Isolasi Master vs Worker (`APP-BUG-20`, `22`, `12`)**: Tolak `issue_capability_token` ke `BOT000` untuk file produksi, hapus `write_file`/`edit_file` dari tool set default `BOT000` saat worker aktif, dan terapkan *default-deny* bagi worker pada path yang tidak masuk `allowedPaths` token aktif.
3. **[P1] Benahi Spawn Root, ACG Command Preset, & Lease (`APP-BUG-10`, `13`, `18`, `19`)**: Kirim `-w <blackboardRoot>` dari `spawnWorker()`, baca ACG dari `-w`, pisahkan `scope.commands` dari `scope.paths` di preset `extended`, naikkan `DEFAULT_MESSAGE_LEASE_MS` ke `180000ms` (atau perpanjang *heartbeat* selama turn LLM aktif).
4. **[P1] Upgrade Ergonomi Kuota, Model Default, & Blueprint Tool (`APP-BUG-11`, `14`, `15`, `17`)**: Ganti model default NIM usang, buat pesan `429` agnostik terhadap provider, tambahkan `--failover` di `bot run`, naikkan default token budget ke `>= 10,000,000` untuk mode multi-worker, dan ekspos `create_goal_blueprint` ke `BOT000`.
