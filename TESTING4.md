# TESTING 4 — Pengujian Kolaborasi Multi-Agent CLI Independen (`QuantumLabs` Virtual Machine Lab)

- **Tanggal Pengujian**: 14 November 2026 (`13:13:53Z` – `16:23:00Z` / `20:13` – `23:23 WIB`)
- **Target Proyek Bot-Authored**: `D:\QuantumLabs`
- **Sesi Kolaborasi**: `S_QUANTUM_VM` (utama: `.almudaya_workspace`, pemulihan terisolasi Fase 6B: `ws_r2`)
- **Mode Keamanan**: `REQUEST_REVIEW` (Human-in-the-Loop `[REVIEW REQUIRED]` aktif)
- **Aturan Ketat Pengujian**:
  1. Seluruh kode aplikasi di `D:\QuantumLabs` ditulis dan diperbaiki **100% oleh bot CLI Almudaya Multi-Agent** (tanpa penulisan/edit manual kode web oleh operator).
  2. **Tidak ada modifikasi kode sumber** `D:\almudaya_multiagent_v0.1.0\src\**` di tengah pengujian; seluruh bug aplikasi yang ditemukan dicatat lengkap pada Bagian 7 laporan ini untuk siklus perbaikan berikutnya.
  3. Setiap bot dijalankan pada **proses CLI interaktif terpisah (`almudaya bot run`)** yang saling berkomunikasi via Blackboard (`send_message` / `/msg`).

---

## 1. Ringkasan Eksekutif & Penjelasan Keterlambatan Task (`task-186` & `task-357`)

Pengujian ini mengorkestrasi **3+1 bot CLI independen** lintas provider **9router Direct**, **NVIDIA NIM Direct** (API Key langsung tanpa router), dan **Ollama Cloud Direct** untuk membangun **QuantumLabs** — *Virtual Machine Lab untuk Sirkuit Kuantum* berisi **5 halaman web** (`index.html`, `vm-studio.html`, `circuits.html`, `tomography.html`, `docs.html`), kontrak & rencana desain **AVDS v1.0.1**, stylesheet tema **Quantum Futurism**, serta mesin simulasi JavaScript (`scripts/quantum-vm.js`).

### Mengapa 2 Task Sebelumnya (`task-186` dan `task-357`) Berjalan Lama?

1. **`task-186` (`Start Ollama local server daemon`) — Daemon Permanen (`isDaemon: true`)**:
   - `task-186` menjalankan `& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" serve` mulai `07:18:41Z` (`14:18:41 WIB`) dengan flag `isDaemon: true`.
   - Proses ini **tidak macet**, melainkan sengaja tetap hidup sebagai server lokal `ollama serve` agar endpoint `http://127.0.0.1:11434` selalu siap melayani deteksi model maupun pengujian Ollama CLI.

2. **`task-357` (`Run QuantumLabs 3-CLI Bot Collaboration`) — Berjalan ~38 Menit (`13:13:53Z` – `13:51:44Z`)**:
   - **Orchestrator Timeout tanpa Cleanup Child Process**: Pada Fase 6 (`task-357.log` baris `2533`), `CLI3` (`BOT003`) melampaui batas waktu tunggu 120 detik (`FATAL ERROR: [CLI3] Timeout (120000ms)`) saat melakukan audit QA mendalam. Skrip `run_quantumlabs_3cli.mjs` keluar lewat `main().catch()` tanpa membunuh 4 child process `node` CLI (`PID 35588`, `24372`, `28200`, `11212`) yang masih aktif.
   - **Kolaborasi Otonom + Ping-Pong Auto-Reply Antar-Bot**: Keempat proses bot terus bekerja mandiri selama ~38 menit. `BOT003` menyelesaikan audit QA (`F-01` s/d `F-05` & typo `docs.html`) dan mengirim laporan ke `BOT004`, yang kemudian bersama `BOT002` mengeksekusi perbaikan. Setelah perbaikan selesai, mekanisme auto-reply peer (`src/bot/agent-loop.ts:483-493`, lihat `APP-BUG-04`) memicu **ping-pong berulang `BOT004 <-> BOT003`**, diperparah error intermiten `9router` (`400 Upstream request failed: Model is unavailable`) dan retry inbox hingga `attempt_count: 3 / max_attempts: 3`.
   - **Pembengkakan PKU Outbox (`57.6 MB`)**: Loop puluhan menit tersebut menulis `1,454,953` baris ke `.almudaya_workspace\pku\outbox.json` (**`57,619.1 KB` / ~57.6 MB**) dan `pku\idempotency\ledger.json` (**`9,263 KB` / ~9.26 MB**) melalui `memoryRuntime.captureSessionSafely()` (`APP-BUG-06`), sehingga startup bot baru pada workspace lama (`PID 24552`) membeku sebelum mencetak REPL banner (`134.2s` CPU time, `~629 MB` RAM).
   - **Pemulihan Clean Workspace (`ws_r2`)**: Workspace `.almudaya_workspace` dipertahankan utuh sebagai bukti forensik, dan pemolesan akhir Fase 6B diselesaikan lewat bot CLI pada workspace terisolasi `ws_r2` dalam hitungan detik.

---

## 2. Arsitektur 3+1 CLI Bot & Konfigurasi Provider

| CLI Pane | Bot ID | Nama Tampilan | Provider & Base URL | Model Utama | Model Failover / Keterangan | Peran |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CLI #1** | `BOT001` | `QuantumArchitect` | `9router` (`http://localhost:20128/v1`) | `mycombo` | `gemini/gemini-3-flash-preview` (Fase 6B saat `mycombo` error 400) | UI/UX & Arsitek AVDS v1.0.1, CSS, `index.html`, injeksi `<script>` |
| **CLI #2** | `BOT002` | `CircuitVMEngineer` | `nvidia` (`https://integrate.api.nvidia.com/v1`) | `nvidia/nemotron-3-ultra-550b-a55b` | — | Simulator VM 4-qubit JS, `vm-studio.html`, `circuits.html` |
| **CLI #3** | `BOT003` | `OllamaCloudQA` | `ollama` (Cloud `/v1`) | `glm-5.3-flash:cloud` | `deepseek-v4.1-flash:cloud` -> `9router:mycombo` (pasca HTTP `402`) | Quantum Tomography, Docs & QA Auditor |
| **CLI #4** | `BOT004` | `NemotronRecoveryQA` | `nvidia` (`https://integrate.api.nvidia.com/v1`) | `nvidia/nemotron-3.5-lightning-30b-a3b` | Spawned pada Fase 5 untuk mengambil alih beban CLI #3 & QA Recovery | Recovery Tomography, Docs, AVDS Audit & Fix `Math.conj` |

---

## 3. Dokumentasi Step-by-Step Kronologis (Fase 0 – Fase 7)

Total telemetri terekam: **3.100 event** (`2026-11-14T13:13:53.622Z` s/d `16:20:19.139Z`), dengan rincian log CLI per pane: `CLI1: 857 baris`, `CLI2: 921 baris`, `CLI3: 1.905 baris`, `CLI4: 1.519 baris`.

### Fase 0 — Setup Session, Project Root, Capabilities & Discovery Model (`13:13:53Z` – `13:14:00Z`)
1. Membuat sesi `S_QUANTUM_VM` dan mendaftarkan target eksternal `D:\QuantumLabs` (`--id quantum-vm --type primary`).
2. Menerapkan capability preset `extended` dengan `--paths D:\QuantumLabs` (menghasilkan 3 active capability grants: `filesystem.read_external`, `filesystem.write_external`, `process.execute_external`).
3. Menjalankan `almudaya bot models --provider all` (72 model katalog) & `almudaya bot advisor` -> mendeteksi `Hardware Tier MEDIUM (15.5 GB RAM, 2 GB VRAM, 18 core CPU)`, rekomendasi lokal `qwen2.5-coder:7b` dan cloud model `ollama` / `nvidia` / `9router`.
4. Mengaktifkan skill AVDS untuk `BOT001` (`--entry-point full-cycle`), `BOT002` (`--entry-point implement`), dan `BOT003` (`--entry-point audit`; dipilih sebagai workaround karena `--entry-point qa` ditolak skema — lihat `APP-BUG-02`).

### Fase 1 — Menghidupkan 3 Proses CLI Independen (`13:14:00Z` – `13:14:02Z`)
- **CLI #1 (`BOT001`)**: `almudaya bot run -s S_QUANTUM_VM -b BOT001 -n QuantumArchitect --provider 9router --model mycombo --mode review --max-iterations 20` (`PID 35588`)
- **CLI #2 (`BOT002`)**: `almudaya bot run -s S_QUANTUM_VM -b BOT002 -n CircuitVMEngineer --provider nvidia --model nvidia/nemotron-3-ultra-550b-a55b --mode review --max-iterations 20` (`PID 24372`)
- **CLI #3 (`BOT003`)**: `almudaya bot run -s S_QUANTUM_VM -b BOT003 -n OllamaCloudQA --provider ollama --model glm-5.3-flash:cloud --mode review --max-iterations 20` (`PID 28200`)

### Fase 2 — `BOT001` (`9router`) Menyusun Arsitektur AVDS & Fondasi Web (`13:14:02Z` – `13:16:18Z`)
- `BOT001` memanggil `use_skill` (`get_style` Quantum Futurism, skema `design-contract` & `composition-plan`), `query_pku_memory`, lalu membuat **9 berkas awal** di `D:\QuantumLabs` (masing-masing lewat persetujuan HITL `y`):
  - `docs/AVDS_DESIGN_BRIEF.md`
  - `docs/design-contract.json`
  - `docs/composition-plan.json`
  - `styles/quantum-vm.css`
  - `index.html`, `vm-studio.html`, `circuits.html`, `tomography.html`, `docs.html` (kerangka awal konsisten).
- `BOT001` mengirim pesan `send_message` handoff ke `BOT002` (`CircuitVMEngineer`).

### Fase 3 — `BOT002` (`NVIDIA NIM Direct`) Analisis Sirkuit VM (`13:16:18Z` – `13:20:13Z`)
- `BOT002` menerima handoff dari `BOT001`, menjalankan `query_pku_memory`, `list_dir`, `read_file` pada berkas AVDS, serta mencoba `run_command` (`mkdir -p scripts`) yang ditolak policy dengan `exitCode: 126` (`APP-BUG-07`).
- `BOT002` sempat mengalami `This operation was aborted` pada pemanggilan LLM panjang akibat timeout HTTP 60 detik (`APP-BUG-08`), lalu mengeksekusi handoff `/msg OllamaCloudQA` untuk meneruskan pekerjaan ke `BOT003`.

### Fase 4 — `BOT003` (`Ollama Cloud Direct`) Insiden HTTP `402 Payment Required` (`13:20:13Z` – `13:20:14Z`)
- Ketika `BOT003` (`glm-5.3-flash:cloud`) memproses handoff `BOT002`, Ollama Cloud mengembalikan error resmi:
  ```text
  ollama request failed (402): {"error":{"message":"Add usage credits or subscribe and save up to 66%: https://ollama.com/plans","type":"api_error","param":null,"code":null}}
  ```
- Sesuai aturan pengujian ("usahakan pemecahan masalah tetap menggunakan bot, kalau perlu menambah bot untuk perbaikan"):
  1. Diuji pergantian model Ollama Cloud lewat REPL CLI #3: `/model deepseek-v4.1-flash:cloud ollama` -> tetap `402 Payment Required`.
  2. Keputusan pemulihan tetap berbasis bot CLI: mengaktifkan skill AVDS untuk bot baru (`--bot BOT004 --entry-point audit`), menghidupkan **CLI #4 (`BOT004 NemotronRecoveryQA`)** pada NVIDIA NIM Direct (`nvidia/nemotron-3.5-lightning-30b-a3b`, `PID 11212`), mengirim eskalasi `/msg NemotronRecoveryQA` dari CLI #3, dan memindahkan `BOT003` ke jalur failover `/model mycombo 9router`.

### Fase 5 — Eksekusi Pemulihan `BOT004` (`NVIDIA NIM Direct`) (`13:20:15Z` – `13:22:51Z`)
- `BOT004` membaca `work_log`, `index.html`, `vm-studio.html`, `circuits.html` via PKU + `read_file`.
- Karena `mkdir -p scripts` ditolak `exitCode: 126`, `BOT004` langsung memakai `write_file` untuk membuat `scripts/quantum-vm.js`, memperbarui `tomography.html` (memperbaiki tag penutup `</A>` -> `</a>`), dan memperbarui `docs.html` dengan dokumentasi lengkap termasuk catatan insiden Ollama Cloud HTTP `402` dan protokol 4 bot.

### Fase 6 — Audit QA Mandiri (`F-01` s/d `F-05`) & Loop Ping-Pong (`13:22:51Z` – `13:51:44Z`)
- `BOT003` (pada failover `9router`) mengaudit `D:\QuantumLabs` dan menemukan 5 temuan teknis (`F-01` eksposur `window.runTomography`, `F-02` event listener `#run-tomography-btn` yang terhalang filter atribut `onclick`, `F-03` sinkronisasi ID kontrol `#qv-basis`/`#qv-qubits`, `F-04` state awal superposisi untuk entanglement entropy non-trivial, `F-05` konsistensi tombol navigasi + penghapusan typo `"Palled get_work_log"` di `docs.html`).
- `BOT004` dan `BOT002` mengeksekusi remediasi temuan tersebut ke `scripts/quantum-vm.js`, `tomography.html`, dan `docs.html`.
- Pada `task-357.log:2533`, orchestrator menyentuh batas 120 detik pada CLI3 (`FATAL ERROR: [CLI3] Timeout (120000ms)`), namun proses-proses CLI tetap hidup dan berinteraksi hingga dihentikan di Fase Pemulihan PKU.

### Fase 6B — Pemolesan Akhir Interaktif via Micro-Turns di `ws_r2` (`16:13:53Z` – `16:20:11Z`)
- Pemeriksaan awal Playwright menunjukkan 2 error runtime sisa di `tomography.html` (`Math.conj is not a function` karena JS tidak memiliki `Math.conj`) dan belum terhubungnya kontroler interaktif `vm-studio.html` & `circuits.html` ke `scripts/quantum-vm.js`.
- Percobaan 1 putaran tunggal pada `task-496` menggugurkan `BOT004` & `BOT002` dengan `This operation was aborted` (`APP-BUG-08`, HTTP request > 60 detik) serta `BOT001` dengan `9router:mycombo` `400 Model is unavailable`; sedangkan larangan memanggil PKU pada `task-576` memicu penolakan `KBKI Policy Violation` (`APP-BUG-09`).
- Solusi akhir yang dijalankan lewat **3 micro-turn patuh PKU-First** (`query_pku_memory` -> `read_file` rentang baris -> `edit_file`) pada `ws_r2`:
  1. **Micro-turn 1 (`BOT004`, `nvidia/nemotron-3.5-lightning-30b-a3b`)**: Menghapus `Math.conj` pada `scripts/quantum-vm.js` (baris 25–34) dan menggantinya dengan perkalian bilangan kompleks standar `{ real, imag }`.
  2. **Micro-turn 2 (`BOT002`, `nvidia/nemotron-3-ultra-550b-a55b`)**: Menambahkan controller interaktif `vm-studio.html` (`.qv-gate`, `.qv-cbit`, `Run Simulation`, `Reset Circuit`, `#qv-status`, histogram `.qv-hist-bar`, `?preset=bell`, `?preset=phase`), controller `circuits.html` (`Open in Studio`), dan `window.currentDensityMatrix = []` ke `scripts/quantum-vm.js`, lalu `BOT002` memverifikasi sendiri sintaks dengan `node --check scripts/quantum-vm.js`.
  3. **Micro-turn 3 (`BOT001`, `9router` `gemini/gemini-3-flash-preview`)**: Menyisipkan `<script src="scripts/quantum-vm.js"></script>` sebelum `</body>` pada `vm-studio.html` dan `circuits.html`.

### Fase 7 — Verifikasi Sintaks, Kontrak AVDS & Playwright E2E (`16:20:12Z` – `16:20:19Z` & Verifikasi Final `23:23 WIB`)
1. `node --check D:\QuantumLabs\scripts\quantum-vm.js` -> **PASS** (0 syntax error).
2. Validasi kontrak AVDS v1.0.1:
   - `node dist/cli/bin.js skill validate D:\QuantumLabs\docs\design-contract.json -w .almudaya_workspace` -> **`AVDS Artifact Validation (design-contract): VALID ✅`**
   - `node dist/cli/bin.js skill validate D:\QuantumLabs\docs\composition-plan.json -w .almudaya_workspace` -> **`AVDS Artifact Validation (composition-plan): VALID ✅`**
3. Uji Interaktif Browser Headless (Playwright Chromium) pada ke-5 halaman:
   - `index.html`: **0 error** (`index.html_errs: 0`).
   - `circuits.html`: **0 error**, 2 tombol `Open in Studio`; klik tombol pertama menavigasi ke `vm-studio.html?preset=bell`, mengisi slot sirkuit otomatis, status **`completed`**, **8 batang histogram `.qv-hist-bar`**.
   - `vm-studio.html`: **0 error**, klik `H` + `CNOT` mengubah `#qv-status` ke **`ready`**, klik `Run Simulation` mengubah `#qv-status` ke **`completed`**, Register Monitor menampilkan `(|0000>+|1100>)/sqrt(2)`, **8 batang histogram**, klik `Reset Circuit` mengembalikan `#qv-status` ke **`idle`** dan **`0`** slot terisi.
   - `tomography.html`: **0 error**, pilih basis `X` + klik `#run-tomography-btn` merender elemen matriks `ρ[0][0]` pada `#density-matrix-output` dan menghitung `#entanglement-output` tanpa exception JavaScript.
   - `docs.html`: **0 error**.

---

## 4. Ringkasan Human-in-the-Loop (HITL) `[REVIEW REQUIRED]`

Sepanjang sesi `S_QUANTUM_VM` tercatat **75 persetujuan HITL** (`HITL_REVIEW -> y`) saat mode `REQUEST_REVIEW` aktif:

| Bot ID | Nama Bot | Jumlah HITL | Contoh Aksi yang Disetujui Operator (`y`) |
| :--- | :--- | :---: | :--- |
| `BOT001` | `QuantumArchitect` | 11 | `write_file` berkas AVDS, `styles/quantum-vm.css`, 5 halaman HTML awal, serta `edit_file` `<script>` pada `vm-studio.html` dan `circuits.html` |
| `BOT002` | `CircuitVMEngineer` | 12 | `run_command` (`node --check scripts/quantum-vm.js`), `edit_file` controller studio & cleanup deklarasi di `scripts/quantum-vm.js` |
| `BOT003` | `OllamaCloudQA` | 7 | `read_file` / `edit_file` audit QA pada sesi failover `9router` |
| `BOT004` | `NemotronRecoveryQA` | 45 | `write_file` `scripts/quantum-vm.js`, pembaruan `tomography.html` & `docs.html`, serta `edit_file` perbaikan `Math.conj` |
| **Total** | | **75** | **100% operasi mutasi melewati gerbang persetujuan `REQUEST_REVIEW`** |

---

## 5. Inventori Berkas Hasil Karya Bot di `D:\QuantumLabs`

Diverifikasi langsung via `Get-ChildItem D:\QuantumLabs -Recurse -File`:

| Berkas | Ukuran (Bytes) | Pembuat / Kontributor Bot | Fungsi |
| :--- | :---: | :--- | :--- |
| `D:\QuantumLabs\docs\AVDS_DESIGN_BRIEF.md` | 2.360 | `BOT001` | Spesifikasi brief arsitektur visual 5 halaman |
| `D:\QuantumLabs\docs\design-contract.json` | 2.107 | `BOT001` | Kontrak desain AVDS v1.0.1 (`VALID ✅`) |
| `D:\QuantumLabs\docs\composition-plan.json` | 4.291 | `BOT001` | Rencana komposisi layout & interaksi AVDS (`VALID ✅`) |
| `D:\QuantumLabs\styles\quantum-vm.css` | 7.479 | `BOT001` | Stylesheet Quantum Futurism (dark base + violet/cyan + a11y) |
| `D:\QuantumLabs\index.html` | 1.361 | `BOT001` | Landing Mission Control & navigasi 5 halaman |
| `D:\QuantumLabs\vm-studio.html` | 3.258 | `BOT001`, `BOT002` | Simulator Circuit 4-Qubit, Gate Palette, Register Monitor & Histogram |
| `D:\QuantumLabs\circuits.html` | 1.593 | `BOT001` | Katalog eksperimen (Superposition Bell & Phase Kickback) |
| `D:\QuantumLabs\tomography.html` | 2.220 | `BOT001`, `BOT004` | Quantum State Tomography & Entanglement Analyzer |
| `D:\QuantumLabs\docs.html` | 9.112 | `BOT001`, `BOT004`, `BOT002` | Dokumentasi VM Kuantum, insiden 402 & catatan sesi multi-bot |
| `D:\QuantumLabs\scripts\quantum-vm.js` | 8.776 | `BOT004`, `BOT002` | Engine simulasi JS, kompleks `{real, imag}`, studio controller & tomografi |

*(Catatan: salinan dokumentasi `TESTING4.md` dan `TESTING4_DOCUMENTATION.mp4` turut ditempatkan di `D:\QuantumLabs` sebagai artefak laporan, bukan kode yang diedit manual.)*

---

## 6. Dokumentasi Video Aksi Bot (`TESTING4_DOCUMENTATION.mp4`)

Video Full HD dirender dari **3.100 telemetry events** (338 keyframe representatif 4-pane split-screen) dan **7 screenshot Chromium live** menggunakan `build_testing4_video.py`:

- **Lokasi File**:
  - `D:\almudaya_multiagent_v0.1.0\TESTING4_DOCUMENTATION.mp4`
  - `D:\QuantumLabs\TESTING4_DOCUMENTATION.mp4`
- **Spesifikasi Video Terverifikasi (`cv2.VideoCapture`)**:
  - **Resolusi**: `1920 x 1080` (Full HD)
  - **Frame Rate**: `24.0 FPS`
  - **Total Frame**: `6.325` frame
  - **Durasi**: `263.5 detik` (~4 menit 23 detik)
  - **Ukuran File**: `251.214.305 bytes` (`239.58 MB`)
- **Alur Konten Video**:
  1. Slate Pembuka (`BOT001`–`BOT004`, mode `REQUEST_REVIEW`, target `D:\QuantumLabs`).
  2. Replay 4-Pane CLI Split-Screen Real-Time (`CLI #1`..`CLI #4`) dari Setup Fase 0, Pembuatan AVDS & Web, Insiden `402` Ollama Cloud + Spawn `BOT004`, Audit `F-01`..`F-05`, hingga Pemolesan Micro-Turn PKU-First Fase 6B & Verifikasi Fase 7.
  3. Live Walkthrough Chromium Browser untuk ke-5 halaman + simulasi aktif `H + CNOT` (`completed`, histogram aktif) dan tomography (`ρ[i][j]` tanpa error).

---

## 7. Laporan Catatan Perbaikan Aplikasi Almudaya Multi-Agent (`APP-BUG-01` s/d `APP-BUG-09`)

Seluruh temuan berikut diverifikasi langsung dari kode sumber di `D:\almudaya_multiagent_v0.1.0\src\**` dan log eksekusi selama pengujian (tidak diperbaiki di tengah jalan sesuai instruksi pengguna):

| ID | Lokasi Kode Sumber & Bukti Log | Deskripsi Masalah Teramati | Rekomendasi Perbaikan |
| :--- | :--- | :--- | :--- |
| **`APP-BUG-01`** | `src/cli/commands/bot.ts:330` vs `:461-468`, `:522-529` | Perintah `bot list` mendukung opsi `-w, --workspace <path>`, sedangkan `bot models` dan `bot advisor` tidak mendaftarkan opsi `--workspace`, sehingga melempar error Commander `unknown option '-w'` jika dipakai seragam. | Tambahkan `.option('-w, --workspace <path>', ...)` secara konsisten ke `bot models` dan `bot advisor` (atau baca global workspace option). |
| **`APP-BUG-02`** | `src/skills/schema.ts:3-10` vs `src/skills/service.ts:562` | `SkillEntryPointSchema` hanya mengizinkan `['design', 'compose', 'implement', 'audit', 'full-cycle', 'change']` dan tidak menyertakan `'qa'`, padahal `skill` QA memetakan entry-point `qa`. Akibatnya `almudaya skill enable avds --entry-point qa` gagal validasi Zod. | Tambahkan `'qa'` ke enum `SkillEntryPointSchema`. |
| **`APP-BUG-03`** | `src/cli/commands/bot.ts:250-251` | `const startMsg = ... ${aiProvider.providerId} ...` men-capture instance `aiProvider` awal dalam closure handler `onMessage`. Setelah operator mengganti provider via `/model <model> <provider>` di REPL (`BotConsole`), header log masih mencetak provider lama (mis. `ollama` meski berjalan di `9router`). | Ambil `providerId` / `modelName` secara dinamis dari provider aktif milik `agentLoop` atau `BotConsole` saat `onMessage` dijalankan. |
| **`APP-BUG-04`** | `src/bot/agent-loop.ts:483-493` | Setiap pesan peer (`message.sender_bot_id !== 'OPERATOR'`) selalu dibalas otomatis lewat `sendDirectMessage` tanpa batas hop / deteksi acknowledgment loop, memicu ping-pong tak terbatas (`BOT004 <-> BOT003`) hingga ~30 menit pada `task-357`. | Tambahkan batas hop kolaborasi (`hop_count` di metadata pesan), flag `no_reply` untuk balasan konfirmasi akhir, atau *circuit breaker* saat isi balasan berulang. |
| **`APP-BUG-05`** | `src/cli/commands/bot.ts:170,195`; `src/ai/catalog.ts:108,124` | Katalog/default NVIDIA NIM mencantumkan model seperti `'meta/llama-3.3-70b-instruct'` dan `'qwen/qwen2.5-coder-32b-instruct'` yang menghasilkan HTTP `404 Not Found` pada endpoint live `integrate.api.nvidia.com/v1/models` (yang menyediakan 87 model aktif termasuk seri `nvidia/nemotron-3.*`). | Sinkronkan model default bawaan NVIDIA NIM dengan daftar aktif dari `/v1/models` atau fallback otomatis ke model aktif pertama saat model default merespons `404`. |
| **`APP-BUG-06`** | `src/bot/runtime.ts:147`; `src/memory_modules/registers/memory-runtime.ts:291` | `captureSessionSafely` dan `DurableOutboxQueue` menyimpan seluruh event `"status": "completed"` dalam satu berkas JSON monolitik `pku/outbox.json` (plus `pku/idempotency/ledger.json`) tanpa pembersihan/rotasi. Saat loop peer terjadi, `outbox.json` membengkak hingga `57,619.1 KB` (`1,454,953` baris) dan `ledger.json` `9,263 KB`, menyebabkan startup bot berikutnya membeku (`134.2s` CPU, `629 MB` RAM). | Pindahkan outbox/ledger ke append-only log berotasi / SQLite, atau bersihkan otomatis entri `completed` berumur lebih lama/melebihi ambang ukuran pada saat flush. |
| **`APP-BUG-07`** | `src/tools/command-tools.ts:45`; `src/execution/controller.ts:157-159`; `src/bot/console.ts:123-133` | (a) Preset `extended` membatasi `process.execute_external` ke allowlist `["git","npm","tsc","node"]`, membuat perintah utilitas seperti `mkdir` / `powershell` ditolak `exitCode: 126` (seluruh entri `run_command` di `work_log.jsonl` berakhir `126`). (b) `BotConsole` memproses `rl.on('line')` per baris sehingga paste prompt multi-baris via stdin terpecah menjadi banyak instruksi agen terpisah (`task-357.log:2054-2055`). | (a) Tampilkan pesan penolakan policy yang lebih eksplisit ke model beserta daftar executable yang diizinkan di workspace preset. (b) Deteksi paste multi-baris (`bracketed paste` atau debouncing queue baris cepat) agar prompt multi-baris dikirim sebagai satu instruksi utuh. |
| **`APP-BUG-08`** | `src/ai/openai-compatible.ts:259,266,309-310,330` | `OpenAICompatibleAdapter` menetapkan `this.timeoutMs = options.timeoutMs ?? 60000` dengan `stream: false` dan memicu `controller.abort()`. Model reasoning/coding besar (seperti `nvidia/nemotron-3.5-lightning-30b-a3b` dan `nvidia/nemotron-3-ultra-550b-a55b`) langsung gagal dengan `This operation was aborted` saat menghasilkan satu `write_file` payload panjang (> 60 detik). | Naikkan timeout default untuk generator/coding turn (atau gunakan streaming SSE untuk mereset *idle timeout* selama token masih mengalir, serta sediakan flag CLI `--timeout-ms`). |
| **`APP-BUG-09`** | `src/bot/agent-loop.ts:201-211`; `src/ai/prompts.ts:43-60,122-125` | `handleMessage` membungkus **semua** pesan masuk — termasuk perintah manusia dari konsol (`sender_bot_id === 'OPERATOR'`) — dengan `formatUntrustedDirectMessage`, sehingga sistem menyebut operator sebagai `<<<UNTRUSTED_PEER_MESSAGE_START sender="OPERATOR" ...>>>`. Akibatnya instruksi cepat yang meminta melewati `query_pku_memory` ditolak bot sebagai `KBKI Policy Violation` (`task-576.log:23-36`), namun bot tetap mencetak marker hijau `✅`, membuat skrip/pengguna mengira tugas berhasil. | Pisahkan template pembungkus khusus operator terpercaya vs `<<<UNTRUSTED_PEER_MESSAGE_START>>>` khusus antar-bot, dan bedakan kode status/keluaran konsol ketika bot menolak eksekusi (`❌` / `POLICY_REFUSAL`) vs menyelesaikan aksi. |
