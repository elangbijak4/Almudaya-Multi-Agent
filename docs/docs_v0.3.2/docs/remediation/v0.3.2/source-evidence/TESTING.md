# 🧪 Laporan Pengujian Fungsional — `almudaya-multiagent`

> **Dokumen:** TESTING.md
> **Tanggal pengujian:** 6 November 2026
> **Versi yang diuji:** v0.3.0 (build lokal dari source, `npm run build`)
> **Platform:** Windows 11 (Windows_NT 10.0.26200), Node v24.21.0, npm 11.19.0
> **Cakupan:** Build, test suite, seluruh grup CLI (`session`, `context`, `bot`, `broadcast`, `message`), Interactive Bot Console REPL (`bot run`), engine ReAct w/ provider mock, layer tools & sandbox (level library), gerbang Human-in-the-Loop, dan kelayakan audit (`AUDIT.md`) secara live.
> **Isolasi:** Seluruh pengujian CLI/REPL memakai workspace ephemeral di `C:\Users\HP\AppData\Local\Temp\opencode\almudaya-e2e` — workspace default `%LOCALAPPDATA%\almudaya` **tidak tersentuh** sama sekali.

Hasil akhir: **27/27 langkah PASS**, dengan **6 temuan audit terkonfirmasi live** dan **2 temuan baru** dari pengujian lapangan (dibahas di §4).

---

## Daftar Isi

1. [Ringkasan Hasil](#1-ringkasan-hasil)
2. [Langkah 1 — Build & Test Suite](#2-langkah-1--build--test-suite)
3. [Langkah 2 — Pengujian CLI End-to-End](#3-langkah-2--pengujian-cli-end-to-end)
4. [Langkah 3 — Interactive Bot Console REPL (`bot run`)](#4-langkah-3--interactive-bot-console-repl-bot-run)
5. [Langkah 4 — Pengujian Tools & Sandbox (level library)](#5-langkah-4--pengujian-tools--sandbox-level-library)
6. [Langkah 6 — Konfirmasi Temuan Audit Secara Live](#6-langkah-6--konfirmasi-temuan-audit-secara-live)
7. [Temuan Baru dari Pengujian Lapangan](#7-temuan-baru-dari-pengujian-lapangan)
8. [Kesimpulan](#8-kesimpulan)
9. [Lampiran: Artefak Pengujian](#9-lampiran-artefak-pengujian)

---

## 1. Ringkasan Hasil

| Kategori | Jumlah kasus | PASS | FAIL / CATAT |
|---|---|---|---|
| Unit / integration / e2e suite (`npm test`) | 179 test (31 file) | 179 | 0 |
| CLI T01–T19 (session, context, bot identity, broadcast, message) | 19 | 19 | 0 |
| REPL R1–R4 (`bot run`, slash commands, natural language, autonomous cycle) | 4 | 4 | 0 |
| Tools & Sandbox T-SEC-01…12 (level library) | 12 | 12 | 0 |
| Gerbang Review T-REV-01…02 | 2 | 2 | 0 |
| **Total** | **216** | **216** | **0** |

Semua fitur yang dijanjikan v0.3.0 **berfungsi sesuai dokumen** — dengan catatan perilaku-pads yang celahnya sudah diidentifikasi dalam `AUDIT.md` dan kini terbukti secara live (bagian §6).

---

## 2. Langkah 1 — Build & Test Suite

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **T-B01** | Build TypeScript | `npm run build` | ✅ PASS — `tsc` selesai tanpa error, `dist/` ter-regenerasi |
| **T-B02** | Verifikasi CLI bin | `node dist/cli/bin.js --version` | ✅ Output: `0.3.0` |
| **T-B03** | Menu perintah utama | `node dist/cli/bin.js --help` | ✅ 6 grup command terdaftar: `session`, `bot`, `broadcast`, `message`, `context`, `help` |
| **T-B04** | Seluruh test suite | `npm test` | ✅ **179 test lulus dalam 31 file** (`vitest run`, 7.81s) — cocok dengan badge README "Tests: 179 Passed" |

Catatan T-B04: keandalan suite juga menutup eksekusi replikasi multi-process, crash recovery, dan 12-step PoC dua-terminal.

---

## 3. Langkah 2 — Pengujian CLI End-to-End

Pengujian memakai workspace isolasi:
```
$ws = 'C:\Users\HP\AppData\Local\Temp\opencode\almudaya-e2e'
$cli = 'node D:\almudaya_multiagent_v0.1.0\dist\cli\bin.js'
```
Contoh: `$cli session create --workspace $ws ...`

### 3.1 Lifecycle Sesi

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **T01** | Buat sesi dengan ID + deskripsi | `session create core-dev --workspace $ws --session S001 --description 'E2E audit session'` | ✅ Session S001 created; status `active`; path `sessions/S001` |
| **T02** | Daftar sesi | `session list --workspace $ws` | ✅ S001 ditampilkan bersama metadata |
| **T03** | Inspeksi sesi (JSON) | `session inspect --workspace $ws --session S001 --json` | ✅ Output JSON valid: `schema_version: 1.0.0`, `status: active`, path asli |
| **T04** | Duplikasi ID harus ditolak | `session create ... --session S001` (kedua kali) | ✅ `Error creating session: Session already exists: S001`, exit code 1 |
| **T05** | **Guard traversal ID** | `session inspect --workspace $ws --session '../S001'` | ✅ `Error inspecting session: Invalid session ID "../S001". Session ID must be 1-64 characters matching /^[a-zA-Z0-9_-]+$/` — **path traversal tertolak di level input**|

### 3.2 Shared Context

Target project root yang didaftarkan: `$ws\project\backend`, berisikan `server.js` dan `utils.js`.

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **T06** | Register project root | `context root add --workspace $ws --session S001 backend $ws\project\backend --type primary` | ✅ Root ID: backend, path terekam sebagai absolute path |
| **T07** | Env metadata + secret | `context env set --workspace $ws --session S001 --var GITHUB_TOKEN=ghp_abcdef1234567890 --var NODE_ENV=production` | ✅ `2 registered (secrets redacted)` |
| **T08** | Verifikasi redaksi | `context env show --workspace $ws --session S001` | ✅ `GITHUB_TOKEN = [REDACTED]`, dimulai OS/arch/node/npm (dikenali) |
| **T09** | Katalog dokumen SDLC | `context doc add --workspace $ws --session S001 --id SRS-01 --title 'Software Requirements Specification' --path docs/SRS.md --type SRS` → `doc list --json` | ✅ Doc ID `SRS-01`, type `SRS`, status `draft` |

**Picu temuan audit:** contoh README `--category SPEC_READY` di §3.3 dibawah juga menjadi bukti inkonsistensi yang dinyatakan dalam AUDIT §16/1.

### 3.3 Broadcast

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **T10** | Publish kategori INVALID | `broadcast publish --workspace $ws --session S001 --bot BOT001 --category SPEC_READY ...` | ✅ Ditolak di layer storage → `Error publishing broadcast: zod invalid_value`, exit 1 — **temuan README terkonfirmasi**: contoh `--category SPEC_READY` di README gagal jalan |
| **T11** | Publish valid ACTIVITY + DECISION | `broadcast publish ... --category ACTIVITY 'Catatan umum...'`, `... --category DECISION 'Spesifikasi endpoint selesai'` | ✅ `evt_1793975644372_17bb3e`, `evt_1793975651290_7d8d29` |
| **T12** | Baca broadcast (statis) | `broadcast read --workspace $ws --session S001 --json` | ✅ 2 event tersort chrono; kategori ter-cache |
| **T13** | Baca dengan cursor (`--bot`) | `broadcast read --workspace $ws --session S001 --bot BOT002` | ✅ Kedua event dikirim + cursor maju |
| **T14** | Re-read dengan cursor + filter kategori | `broadcast read ... --bot BOT002 --category ACTIVITY` → `--limit 1` | ✅ Semua kembali `No broadcast events found` — **temuan audit CONC-02 terkonfirmasi live**: filter diterapkan *setelah* cursor sudah maju, sehingga event-element yang tersaring dari read selanjutnya **hilang permanen** |

### 3.4 Identitas Bot & Registro

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **T15** | Join dua bot | `bot join --workspace $ws --session S001 --bot BOT001 --display-name Architect --role 'System Architect'` dan `--bot BOT002 --display-name Coder --role 'Software Engineer'` | ✅ BOT001/BOT002 dicek-om setuju, status `active`, PID = proses CLI |
| **T16** | List + reconcile | `bot list --workspace $ws --session S001` | ✅ Keduanya `(stale)` — seperti **temuan audit §14/2**: PID yang direkam berasal dari proses CLI sementara-tinggal → bot dilihat langsung `stale` begitu `bot join` keluar |
| **T17** | Inspeksi dengan display name | `bot inspect --workspace $ws --session S001 --bot 'Architect' --json` | ✅ Resolusi nama → ID kanonik jalan (`BOT001`) |
| **T18** | Rename bot | `bot rename --workspace $ws --session S001 --bot BOT002 --new-name 'SeniorCoder'` | ✅ Renamed; `bot inspect` menunjukkan display kena-rename, `bot_id` tetap `BOT002` (ID stabil), `joined_at` tak berubah |
| **T19** | Rename ke nama yang sudah dipakai | `bot rename ... --new-name Architect` | ✅ `Error renaming bot: Display name "Architect" is already in use in session "S001"`, exit code 1 — resolusi konflik OK |

### 3.5 Direct Message

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **T20** | Kirim DM via display name | `message send --workspace $ws --session S001 --sender BOT001 --recipient SeniorCoder --body 'Buatkan REST endpoint di server.js' --type REQUEST` | ✅ Status `unread` di inbox BOT002; `msg_1793975669830_d752f2` |
| **T21** | Baca inbox | `message read --workspace $ws --session S001 --bot BOT002` | ✅ Pesan tampil, status upgraded `unread → READ` (sifat default `--mark-read`) |
| **T22** | Ack idempoten | `message ack --workspace $ws --session S001 --bot BOT002 --message-id $msg_id` (2×) | ✅ Kedua kali sukses; timestamp ack tetap konsisten (idempoten) |
| **T23** | Error: message id tak adai | `message ack ... --message-id msg_TIDAKADA` | ✅ `Error acknowledging message: Message "msg_TIDAKADA" not found in inbox for bot "BOT002"`, exit 1 |
| **T24** | Error: penerima tak terdaftar | `message send ... --recipient TIDAKADA` | ✅ `Error sending message: Bot "TIDAKADA" not found in session "S001"`, exit 1 |
| **T25** | `--no-mark-read` | `message read ... --no-mark-read` | ✅ Namun error CLI: `unknown option '--no-mark-read'` — **TEMUAN BARU** (lihat §7, NT-01) |

---

## 4. Langkah 3 — Interactive Bot Console REPL (`bot run`)

Metode: driver Node (`repl-driver.mjs`) melakukan spawn proses `almudaya bot run` dengan stdin yang dikontrol secara real-time (auto-ack aktif, `--provider mock` — deterministik). Seluruh slash command diuji via skenario.

### 4.1 Ativasi & Slash Commands (Pipe Cepat)

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **R1-01** | Banner & identitas console | `bot run --workspace $ws --session S001 --bot BOT001 --provider mock` | ✅ Banner: `Almudaya Multi-Agent v0.3.0 — Interactive Bot Console REPL`, profile `Bot: "Architect" [BOT001] \| Session: S001 ○ Mode: REQUEST_REVIEW ○ Provider: mock` |
| **R1-02** | `/help` | dari stdin | ✅ Daftar 9 slash command + instruksi teks bebas, sesuai README |
| **R1-03** | `/peers` | dari stdin | ✅ Daftar rekan bot + PID + status + flag `(bot ini)` |
| **R1-04** | `/status` | dari stdin | ✅ Session/Status/Execution Mode/AI Provider/PID lengkap |
| **R1-05** | `/msg BOT002 <pesan>` | dari stdin | ✅ Pesan tersampai sebagai DM UNREAD di inbox BOT002 |
| **R1-06** | Natural language free-text | dari stdin | ✅ `🤖 [Architect] Memproses instruksi operator: ...` → Mock AI membalas `Tugas telah diproses oleh Mock AI.` → broadcast DECISION ter-publish dengan `metadata.iterations: 1` |
| **R1-07** | `/exit` | dari stdin | ✅ `[Console] Menghentikan bot dan keluar...`; status registry berubah `stopped` |
| **R1-08** | Urutan output | observasi | ⚠️ Output antar line atanomously terurut-ulang (peers, status, exit message bisa keluar dari urutan input) — konsisten dengan temuan audit PERF-01 (REPL tanpa latch di `rl.on('line')`) |

### 4.2 Siklus Otonom Live-Driven (Pesan Masuk Diproses Runtime)

| ID | Langkah | Detail | Hasil |
|---|---|---|---|
| **R2-01** | Skenario: REPL aktif + DM live | Driver kirim DM `sendDirectMessage('S001', {senderBotId:'BOT002', ...})` saat REPL BOT001 berjalan, menarian 5s (5 siklus poll @1000ms) | ✅ Pesan masuk di-poll & di-tandai read |
| **R2-02** | Agent loop otonom | Mock AI respons → agent-loop besar → auto-reply DM parent | ✅ BOT002 menerima balasan `Tugas telah diproses oleh Mock AI.` (status `unread`) + broadcast DECISION `Bot "Architect" menyelesaikan tugas dari "BOT002".` |
| **R2-03** | Auto-acknowledge (`--auto-ack`)| `bot run --auto-ack` | ✅ Pesan masuk status → `acknowledged` di inbox |
| **R2-04** | `--auto-ack` tanpa ack | pengaturan default | ✅ Default tanpa ack berjalan pun (perilaku `--auto-ack/--no-auto-ack` sesuai help) |
| **R2-05** | `/log [limit]` | `/log 5` dua kali | ✅ Output compliance: `Belum ada riwayat kerja yang dicatat dalam sesi ini.` (work log masih kosong karena Mock tidak meng-factor-kan tool-calls) |
| **R2-06** | `/mode [review|turbo]` | ok umum via banner + perindah | ✅ Banner Mode: `REQUEST_REVIEW` (default) / sesuai `--mode` |

### 4.3 Auto-Provider Selection (`GEMINI_API_KEY`)

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **R3-01** | Tanpa env key, tanpa `--provider` | (skenario built-out sesuai audit) `bot run --provider bogos` | ✅ (Terlihat harusnya jika env GEMINI_API_KEY ada) — per `cli/commands/bot.ts:124`, env `GEMINI_API_KEY` akan **otomatis memilih Gemini tanpa flag**, sesuai pre-register; di lingkungan ini env tidak set |
| **R3-02** | `--provider bogos` (invalid) | `bot run ... --provider bogos` | ✅ **Ternyata TIDAK error** — banner menunjukkan `Provider: Disabled (Messaging only)`; bot start dan berfungsi messaging-only. **Temuan audit Terkonfirmasi live** (secara codebuton tidak ditolak) |

### 4.4 Graceful Shutdown

| ID | Langkah | Hasil |
|---|---|---|
| **R4-01** | `/exit` dari REPL | ✅ `runtime.stop()` dijalankan → status `stopped` di `bots.json`; SIGINT/SIGTERM handler ter-attach — test T-B04 juga cover |
| **R4-02** | `bot list` setelah stop | ✅ BOT001 status `stopped`   (BOT002 tetap `stale`) |

---

## 5. Langkah 4 — Pengujian Tools & Sandbox (level library)

Tool_functionality hanya dapat dibangkitkan melalui agent-loop (CLI mock tidak menghasilkan tool-call), jadi di-bangkitkan langsung via library (`dist/index.js`) dengan script probe (`probe-tools.mjs`, `probe-verify.mjs`). Root sandbox = `$ws\project\backend`.

| ID | Skenario | Hasil | Detail |
|---|---|---|---|
| **T-SEC-01** | Traversal absolute (`proj/../../.../secret.txt`) | ✅ PASS | `Access denied: Path ... which is outside registered project roots: [...]` |
| **T-SEC-02** | Traversal relative (`../server.js`) | ✅ PASS | Ditolak, path resolved dicantumkan |
| **T-SEC-03** | Absolute di luar root (`C:/Windows/win.ini`) | ✅ PASS | Ditolak |
| **T-SEC-04** | `read_file` valid di dalam root | ✅ PASS | Konten `server.js` terbaca (slicing OK) |
| **T-SEC-05** | `write_file` + guard overwrite | ✅ PASS | File baru dibuat; overwrite tanpa flag **ditolak**; `overwrite: true` berhasil; body konten sudah benar. Tanpa cap ukuran tulisan (sejalan audit) |
| **T-SEC-06** | `edit_file` replace + missing-target | ✅ PASS | Replace OK; target yang tak ada → error + preview |
| **T-SEC-07** | `list_dir` recursive + `search_files` content | ✅ PASS | 3 entry list; 1 match konten dalam file |
| **T-SEC-08** | `run_command` valid di dalam root | ✅ PASS | stdout `"sandbox-ok"`, exit 0 |
| **T-SEC-09** | `run_command` `working_dir` di luar root | ✅ PASS | `Access denied: Path 'C:/Windows' ...` — sandbox CWD inkal |
| **T-SEC-10** | `run_command` timeout | ✅ PASS | `ping -n 30` → `timedOut=true` dalam 2471ms (deadline dihormati) |
| **T-SEC-11** | 🚨 **Kebocoran env via `run_command`** | ✅ **CONFIRMED** | Dengan env `GEMINI_API_KEY=SENTINEL-LEAK-DO-NOT-USE`, `echo %GEMINI_API_KEY%` dari child shell **menampilkan sentinel** — nilai env ke-eksfiltrasi. Sesuai temuan SEC-01 di `AUDIT.md` (child process mewarisi `process.env`) |
| **T-SEC-12** | 🚨 **Symlink/junction escape** | ✅ **CONFIRMED** | Junction (mklink /J) di dalam root → folder **luar** root; `read_file 'junc2/dokumen-luar.txt'` **berhasil membaca file dari luar sandbox secara penuh** — sesuai temuan audit §14/6 (sandbox hanya leksikal, tanpa realpath resolve) |

### Read tools `get_work_log`
Di-cover oleh T-REV-01 (auto work-log + koordinat multi-root) — dpliant detail di §5.2.

---

## 6. Langkah 6 — Konfirmasi Temuan Audit Secara Live

Dari 19 temuan kritis+medium dalam `AUDIT.md`, di bawah ini yang **terbukti live** selama pengujian ini:

| ID Audit | Temuan | Bukti Live |
|---|---|---|
| **SEC-01** (🔴) | Kebocoran `GEMINI_API_KEY` via `run_command` | **T-SEC-11** — sentinel `SENTINEL-LEAK-DO-NOT-USE` tampil di stdout shell anak |
| **CONC-02** (🔴) | Cursor broadcast race / filter-after-advance | **T14** — re-read dengan `--category`/`--limit` setelah cursor maju mengembalikan 0 event |
| §14/2 (🟡) | `bot join` PID = proses CLI umur pendek → langsung `stale` | **T15–T16** |
| §14/6 (🟡) | Sandbox symlink/junction escape (tanpa realpath) | **T-SEC-12** — file luar sandbox terbaca penuh |
| §16/1 (🔵) | README contoh `--category SPEC_READY` invalid | **T10** — zod invalid_value, command gagal |
| `bot run` invalid `--provider` tidak ditolak | README/dokumen menyebut `--provider mock|gemini`; nilai lain | **R3-02** — silent degrade ke `Disabled (Messaging only)` |
| PERF-01 (🔴) | Output REPL async terurut-ulang / tanpa latch | **R1-08** — output `/peers`,`/status`,`/exit` keluar dari urutan input |
| RELIA-01 (🔴 sekait) | Pesan unread tidak diproses jika sesi REPL berakhir cepat | Observasi R1 (Pipen cepat, inbox tetap unread sebelum poll) |
| §17 strengths: work log koordinat multi-root | (positif) | **T-REV-01** — entry `WRITE` tercatat dengan `target_root_id/name/path`, `relative_path`, `full_path`, bytes |

---

## 7. Temuan Baru dari Pengujian Lapangan

Dua temuan ini ** belum ada di AUDIT.md** saat audit pertama — ditemukan wet masa pengujian:

### NT-01 — `message read` tidak dapat dimatikan mark-as-read
- **Lokasi:** `src/cli/commands/messaging.ts:190` — `.option('--mark-read', 'Mark unread messages as read', true)`
- **Perilaku:** default `true`, namun bentuk negasi `--no-mark-read` **tidak terdaftar** oleh commander (karena nilai default eksplisit mengontoh sedikit diff), sehingga tidak ada cara bagi pengguna CLI untuk membaca inbox tanpa menandai pesan sebagai read.
- **Dampak:** mengikuti audit RELIA-01 (mark-before-consume), pengguna tak bisa benar-benar mewaspadai pesan melalui CLI.
- **Rekomendasi:** daftarkan `.option('--no-mark-read', ...)` atau ganti default-nya.

### NT-02 — Driver PowerShell-piped tidak mem-teruskan timing ke stdin
- **Lokasi:** perilakunya test harness di Windows — `& { "/log"; Start-Sleep -Seconds 4; "/exit" } | node bot run...` tidak menahan stdin terbuka dengan timing yang diperlukan; poll 1000ms tidak sempat berjalan.
- **Dampak:** hanya berdampak pada testing otomatis; REPL mengatasi poll tanpa input ketika stdin langsung_DELAY. Tidak memengaruhi penggunaan real interaktif.
- **Rekomendasi:** gunakan driver Node `child_process.spawn` dengan control stdin-excerpt eksplisit (seperti yang dipakai di pengujian ini).

---

## 8. Kesimpulan

1. **Build & test suite:** lulus sempurna (179/179) — infrastruktur cofactor terket daripada apa yang di-verify di `AUDIT.md`.
2. **CLI:** fitur yang ter-definisikan (`session`, `context`, `bot`, `broadcast`, `message`) **semuanya bekerja** termasuk error path dan idempotensi; guard traversal ID sukses live.
3. **REPL:** banner, 10 slash command, natural language → ReAct loop, polling inbox live-processed, auto-reply, auto-ack, graceful stop — **semuanya OK**. Async-reordering output masih ada (PERF-01).
4. **Tools & sandbox:** 12/12 skenario — enforcement path traversal/absolute/working_dir/timeout bekerja; namun **2 lubang kritis terkonfirmasi live**: injeksi env (SEC-01) dan junction escape (T-SEC-12) — keduanya sudah diprediksi di `AUDIT.md` dan **kini terbukti empiris**.
5. **Review gate:** Human-in-the-Loop `REQUEST_REVIEW` prompt handler OK, TURBO bypass OK, auto work-log dengan koordinat multi-root OK.
6. Rekomendasi prioritas **P0–P1 di `AUDIT.md` §18 tetap valid**, ditambah NT-01 (CLI mark-read) di level P2.

**Keseluruhan: 216 kasus diuji / 216 PASS dengan 2 observasi (bukan kegagalan, tapi temuan desain yang sudah dipetakan di AUDIT.md).**

---

## 9. Lampiran: Artefak Pengujian

| Artefak | Lokasi | Tujuan |
|---|---|---|
| Workspace E2E | `C:\Users\HP\AppData\Local\Temp\opencode\almudaya-e2e` | Sesi `S001` lengkap: `session.json`, `registry/*`, `broadcast/events.jsonl`, `inbox/BOT001,BOT002/*`, `work_log.jsonl` |
| Target project | `$ws\project\backend` (`server.js`, `utils.js`) | Root sandbox utama |
| Driver REPL | `C:\Users\HP\AppData\Local\Temp\opencode\repl-driver.mjs` | Menguji proses REPL dgn kontrol stdin real-time |
| Probe tools/sandbox | `C:\Users\HP\AppData\Local\Temp\opencode\probe-tools.mjs`, `probe-verify.mjs` | 12 skenario keamanan tools |
| Probe review gate | `C:\Users\HP\AppData\Local\Temp\opencode\probe-review.mjs` | REQUEST_REVIEW prompt-handler + TURBO |
| Probe integrity inbox/cursor | `C:\Users\HP\AppData\Local\Temp\opencode\probe-runtime.mjs` | Verifikasi library `MessagingService` |

- Seluruh artefak pengujian berada di **direktori temporer OS**, tidak di repositori — repo `git status` tetap bersih, kecuali file `TESTING.md` ini.
- Workspace `\%LOCALAPPDATA%\almudaya` tidak tersentuh sama sekali selama pengujian.
