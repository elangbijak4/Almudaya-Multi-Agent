# 🔍 Laporan Audit — `almudaya-multiagent`

> **Dokumen:** AUDIT.md
> **Tanggal audit:** 3 November 2026
> **Sifat audit:** Read-only (tidak ada file, direktori, atau state yang diubah/dibuat selain dokumen ini)
> **Versi kode yang diaudit:** v0.3.0 (sesuai `package.json` & `src/core/version.ts` — catatan: nama folder repositori `v0.1.0` menyesatkan; `MASTER_PROMPT.md` masih kosmetik era v0.1.0)
> **Metadata teknis:** TypeScript ESM (`type: module`), Node ≥22.12.0, dependensi `commander`, `zod`, `@google/genai`, test runner `vitest`.

---

## Daftar Isi

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Identifikasi Proyek](#2-identifikasi-proyek)
3. [Arsitektur Makro: Pemisahan 3 Direktori](#3-arsitektur-makro-pemisahan-3-direktori)
4. [Anatomi Blackboard (Layout On-Disk)](#4-anatomi-blackboard-layout-on-disk)
5. [Modul-modul & Tanggung Jawabnya](#5-modul-modul--tanggung-jawabnya)
6. [Flow CLI](#6-flow-cli)
7. [Flow GUI: `bot run` & Interactive REPL](#7-flow-gui-bot-run--interactive-repl)
8. [Agent Loop ReAct](#8-agent-loop-react)
9. [Layer Tools & Sandbox](#9-layer-tools--sandbox)
10. [Layer AI (Gemini)](#10-layer-ai-gemini)
11. [Kondisi GUI Asli (Web/Desktop)](#11-kondisi-gui-asli-webdesktop)
12. [Kondisi Testing](#12-kondisi-testing)
13. [Temuan Kritis (🔴 High)](#13-temuan-kritis--high)
14. [Temuan Sedang (🟡 Medium)](#14-temuan-sedang--medium)
15. [Temuan Rendah (🔵 Low)](#15-temuan-rendah--low)
16. [Inkonsistensi Dokumen ↔ Kode](#16-inkonsistensi-dokumen--kode)
17. [Kekuatan Desain (Yang Layak Dipertahankan)](#17-kekuatan-desain-yang-layak-dipertahankan)
18. [Rekomendasi Prioritas](#18-rekomendasi-prioritas)
19. [Kesimpulan](#19-kesimpulan)

---

## 1. Ringkasan Eksekutif

`almudaya-multiagent` adalah *foundation* kolaborasi multi-agen AI coding: beberapa bot AI (proses OS terpisah) bekerja bersama manusia melalui **"Session Blackboard"** — papan tulis bersama di filesystem, tanpa IPC dan tanpa jaringan antar bot. Setiap bot berperan sebagai agen ReAct (Reason + Act) yang dapat membaca/mengubah file proyek target dan menjalankan shell, dengan AI engine Google Gemini. Antarmuta utamanya adalah CLI dan interactive terminal REPL — **tidak ada GUI web/desktop yang sebenarnya** (hanya direncanakan dalam dokumentasi).

Audit ini menilai proyek secara keseluruhan sebagai **fondasi infrastruktur-first yang solid dan terdokumentasi rapi** (disiplin Waterfall + phase gates), dengan flow CLI → REPL → ReAct yang koheren. Namun kelemahan kritis terkonsentrasi pada tiga area:

1. **Keamanan boundary** — `run_command` mewarisi seluruh `process.env` (termasuk `GEMINI_API_KEY`) ke shell anak, sehingga kunci API bisa tereksfiltrasi ke stdout dan bahkan **tertulis permanen ke `work_log.jsonl` di blackboard** — melanggar Invariant 7 proyek sendiri.
2. **Atomisitas lintas proses** — pemecahan lock stale memiliki jendela TOCTOU yang bisa menghasilkan dua pemegang mutex bersamaan; cursor broadcast disimpan tanpa lock sehingga bisa regrediasi; JSONL bisa torn-read dan menganggu seluruh konsumen.
3. **Akuntabilitas pesan** — inbox di-mark-as-read *sebelum* diproses; password/crash mid-processing berarti pesan hilang tanpa redelivery.

Selain itu terdapat permukaan prompt injection lintas bot, tanpa verifikasi identitas pengirim, serta ketidakkonsistenan signifikan antara dokumentasi pengguna dan implementasi kode (flag CLI, enum, nilai default).

---

## 2. Identifikasi Proyek

| Aspek | Nilai |
|---|---|
| Nama paket | `almudaya-multiagent` |
| Versi | **0.3.0** (folder bernama `v0.1.0` — menyesatkan) |
| Deskripsi | "Session-centric multi-process autonomous AI coding agent collaboration foundation" |
| Bahasa | TypeScript 7.x, strict, ESM |
| Node | ≥22.12.0 |
| CLI bin | `almudaya` → `dist/cli/bin.js` |
| Repository | `github.com/elangbijak4/Almudaya-Multi-Agent` |
| Lisensi | MIT |

### Struktur direktori sumber (`src/`)

```
src/                    → paket utama
├── index.ts            → passthrough re-export seluruh suite (surface publik penuh)
├── cli/                → bin.ts, index.ts, commands (session, messaging, context, bot)
├── core/               → konfigurasi workspace, lock, fs-utils atomik, hirarki error, versi
├── session/            → schema + service (lifecycle metadata sesi)
├── bot/                → schema, service (registry), runtime, agent-loop, execution-mode, console (REPL)
├── messaging/          → direct message + broadcast, cursor per-bot
├── shared/             → shared context (roots/env/docs) + work-log
├── ai/                 → IAIModelProvider, GeminiProvider, MockAIProvider, prompt builder, kredensial
├── tools/              → file tools, command tool, work-log tool, sandbox validator
└── blackboard/         → interface storage + FilesystemSessionStorage (implementasi filesystem utama)
```

Semua ekspor modul dipasangkan lewat `src/index.ts` sebagai fasilitas library — konsumen dapat membangun bot kustom tanpa CLI (meng-inject `BotRuntime`, `AutonomousAgentLoop`, dan `IAIModelProvider` sendiri).

---

## 3. Arsitektur Makro: Pemisahan 3 Direktori

Filosofi inti (dokumen `USER_GUIDE.md`) — pemisahan tiga kinditas direktori:

```
D:\almudaya_multiagent_v0.1.0        → 1. Engine      (kode framework ini)
%LOCALAPPDATA%\almudaya              → 2. Blackboard  (state kolaborasi sesi)
D:\testingbot (contoh)               → 3. Target Root (kode proyek yang dikerjakan bot)
```

- **Engine** tidak pernah menyentuh blackboard secara langsung selain melalui service layer.
- **Blackboard** berisikan hanya file JSON/JSONL — bot "berbicara" satu sama lain hanya dengan menulis/membaca file di sini.
- **Target root** adalah direktori kerja yang didaftarkan eksplisit via `almudaya context root add` dan menjadi batas sandbox file/shell bagi bot.

Atau ketergantungan (dari bawah → atas `src/`):

```
core/config.ts ──→ blackboard/filesystem.ts ──→ {session, bot, messaging, shared} services ──→ cli/*, bot/{runtime,console,agent-loop}, tools/*
core/fs-utils.ts ─┘          (mengimplementasikan 5 interface dari blackboard/interface.ts)
core/lock.ts    ─┘
core/errors.ts ←── semua modul (hirarki error bertipe)
```

`blackboard/filesystem.ts` (`FilesystemSessionStorage`) adalah **satu-satunya implementasi storage** — seluruh persistensi (session metadata, bot registry, broadcast, inbox, shared context, work log) lewat satu titik ini.

---

## 4. Anatomi Blackboard (Layout On-Disk)

Workspace root diresolusi dengan urutan (ADR-001):

1. Opsi eksplisit `--workspace <path>`
2. Env `ALMUDAYA_WORKSPACE` (atau alias legacy `ALMUDAYA_WORKSPACE_ROOT`)
3. Default platform: Windows `%LOCALAPPDATA%\almudaya`; macOS `~/Library/Application Support/almudaya`; POSIX `$XDG_DATA_HOME/almudaya` atau `~/.local/share/almudaya`

Layout per sesi:

```
<workspaceRoot>/sessions/<sessionId>/
├── session.json                 ← SessionMetadata (zod-validated)
├── .lock                        ← lock file mutex kooperatif (core/lock.ts)
├── work_log.jsonl               ← memori kerja lintas root (append-only)
├── registry/
│   ├── bots.json                ← BotRegistry (BOT001, BOT002, ... + pid + last_seen_at)
│   ├── project_roots.json       ← daftar project root tersandaftaran (batas sandbox)
│   ├── environment.json         ← env metadata (dimeks redactSecrets())
│   └── documents.json           ← katalog dokumen SDLC
├── broadcast/
│   └── events.jsonl             ← log broadcast append-only
└── inbox/<botId>/
    ├── messages.json            ← inbox DM per-bot (rewrite penuh tiap append)
    └── broadcast_cursor.json    ← cursor baca broadcast per-bot
```

- Semua tulisan **atomik** (tmp file dengan akhiran `.pid.timestamp.random.tmp` + `fs.rename`,脑海里 retry `EPERM/EBUSY` 5x untuk Windows).
- Semua mutasi berada di bawah **lock file `.lock` per sesi** (acquire `wx` + poll + pemulihan stale lock berdasarkan PID + usia).
- `sessionId` dan `botId` divalidasi regex `^[a-zA-Z0-9_-]{1,64}$` **sebelum** interpolasi path — ini penjagaan utama anti path-traversal.

---

## 5. Modul-modul & Tanggung Jawabnya

### 5.1 `src/core/*`

| File | Tanggung jawab | API penting |
|---|---|---|
| `version.ts` | Konstanta identitas build | `PACKAGE_NAME`, `VERSION = '0.3.0'`, `CLI_NAME` |
| `config.ts` | Resolusi workspace root + derivasi path sesi | `getDefaultWorkspaceRoot()`, `resolveWorkspaceRoot()`, `getSessionDir()`, `getSessionsBaseDir()` |
| `errors.ts` | Hirarki error bertipe | `AlmudayaError` base + `ValidationError`, `SessionNotFoundError`, `SessionAlreadyExistsError`, `BotAlreadyRegisteredError`, `BotNotFoundError`, `DisplayNameConflictError`, `MessageNotFoundError`, `ProjectRootAlreadyExistsError`, `DocumentAlreadyExistsError`, `CorruptedDataError`, `LockTimeoutError`, ... |
| `fs-utils.ts` | Primitif atomik | `ensureDir()`, `pathExists()`, `atomicWriteJson()`, `readJsonValidated()` |
| `lock.ts` | Mutex kooperatif lintas proses | `acquireLock()`, `withLock()`, `isProcessRunning()`; lock record `{ pid, locked_at, holder }` |

### 5.2 `src/blackboard/*`

- `interface.ts` — 5 interface storage (`ISessionStorage`, `IBotRegistryStorage`, `IMessagingStorage`, `ISharedContextStorage`, `IWorkLogStorage`) digabung menjadi `IBlackboardStorage`. `withSessionLock` ada pada interface, sehingga service domain bisa membungkus read-modify-write dengan lock yang sama yang digunakan storage (inilah cara `MessagingService.readInbox` mencapai atomisitas).
- `filesystem.ts` — `FilesystemSessionStorage`, realisasi tunggal. Poin penting:
  - `createSession` melakukan *double-check* (cek duplikat di luar lock, re-check di dalam lock — pola benar).
  - `updateSession` mempertahankan field immutable (`schema_version`, `session_id`, `created_at`) dan mem-perbarui `updated_at`.
  - Pembacaan sesi (`listSessions`, `readBroadcasts`, `readWorkLogs`) adalah **lock-free** — aman dari torn read JSON, tapi tidak aman dari torn read JSON **line** (lihat temuan #13-3).

### 5.3 `src/session/*`

`SessionService`: create (auto-ID slug dari nama + random 3 byte jika tidak dispesifikkan), get, list, exists, update. ID divalidasi `SESSION_ID_REGEX` — penjagaan utama anti traversal path.

### 5.4 `src/bot/*`

- `schema.ts` — `BotStatus`: `starting|active|idle|stopped|failed|stale`; `BotRecord`: `{ bot_id, session_id, display_name, status, pid?, joined_at, last_seen_at, metadata }`.
- `service.ts` — `BotService`: register (auto-ID `BOT001...`, display-name unik case-insensitive), rename (ID stabil dipertahankan), updateStatus, touchHeartbeat, reconcileBotLiveness (dead-PID + stale heartbeat 10s → `stale`).
- `runtime.ts` — `BotRuntime`: `start()` → attivasi bot / register, heartbeat interval (2s), poll interval (1s) membaca broadcast + inbox → callback. Signal handler SIGINT/SIGTERM → graceful `stop().
- `agent-loop.ts` — `AutonomousAgentLoop` (inti ReAct, detail di §8).
- `execution-mode.ts` — `ExecutionModeController` (`REQUEST_REVIEW` vs `TURBO`, detail di §9).
- `console.ts` — `BotConsole` REPL (detail di §7).

### 5.5 `src/messaging/*`

Schemas: `BroadcastEvent` (`event_id, session_id, sender_bot_id, timestamp, category[8 enum], content, metadata`), `DirectMessage` (`message_id, ..., message_type[DIRECT|REQUEST|RESPONSE|NOTIFICATION], status[unread|read|acknowledged], read_at?, acknowledged_at?`), `InboxStore`, `BroadcastCursor`.

`MessagingService`: publishBroadcast, readBroadcasts (mode cursor `autoAdvanceCursor` vs stateless `afterEventId`/`since`), sendDirectMessage (resolusi recipient display-name → bot ID kanonik), readInbox (mark-as-read + lock), acknowledgeMessage (idempoten, backfill `read_at`).

### 5.6 `src/shared/*`

- `schema.ts` + `service.ts` — `SharedContextService`: project roots (path di-resolve tapi **tidak diverifikasi eksistensinya di disk**), environment (auto-detect OS/arch/node; var kustom di-redaksi), SDLC documents.
- `work-log.ts` — `WorkLogEntry` schema `{entry_id, timestamp, bot_id, bot_name, action_type[WRITE|EDIT|READ|COMMAND|DECISION], target_root_id/name/path, relative_path?, full_path?, summary, details}` + `WorkLogService.recordWork()` (append-only di bawah lock) + `getRecentSummaryMarkdown()` (ringkasan Markdown yang di-injeksi ke prompt).

### 5.7 `src/ai/*`

- `provider.ts` — interface `IAIModelProvider` pure: `{ providerId, modelName, generateResponse(request) }` dengan tipe `ToolDefinition`, `ToolCallRequest/Result`, `AIMessage`, `AIResponse`.
- `prompts.ts` — `buildDynamicSystemPrompt()` membangun system prompt dinamis berbahasa Indonesia dari identitas bot + sesi + roots + peers + work-log (detail risiko injection di §13-5).
- `gemini.ts` — `GeminiProvider`: `gemini-2.5-flash` default, 3x retry dengan deteksi error substring (`429|503|RESOURCE_EXHAUSTED|quota|ETIMEDOUT`), backoff eksponensial, pemetaan `functionCalling` → `ToolCallRequest`. Konstruksi melempar `MissingApiKeyError` dengan antusias (eager, fail-fast **bagus**).
- `credentials.ts` — `resolveApiKey()` (explicit > env var > throw), `maskApiKey()` (dipanggil di mana-mana tapi **tidak pernah digunakan di manapun** — mati).
- `mock-provider.ts` — deterministic; dipakai untuk seluruh test suite.

### 5.8 `src/tools/*` — lihat §9.

---

## 6. Flow CLI

Entry chain: `bin.ts` (shebang, `run().catch` → exit 1) → `cli/index.ts` (commander). Setiap invokasi membangun service on-the-fly dari `resolveWorkspaceRoot()`, tanpa stateful daemon. Semua error ter-catch dan dicetak ke stderr dengan `process.exitCode = 1` (tanpa stack trace — output bersih).

| Perintah | Opsi (tebal = wajib) | Behavior |
|---|---|---|
| `session create <name>` | **name**; `-s/--session <id>`, `--description`, `-w` | Buat sesi baru via `SessionService.createSession()`; ID di-slug-kan; tulis `session.json` atomik dengan double-checking di bawah lock |
| `session list` | `-w`, `--json` | Daftar sesi terbaru-lebih-dulu |
| `session inspect [id]` | `-s`, `-w`, `--json` | Metadata detail sesi |
| `bot join` (alias `start`) | **-s**; `-b/--bot`, `-n/--display-name`, `-d/--description`, `-r/--role` | Registrasi identitas bot via `BotService.registerBot()` |
| `bot list` | **-s**; `-w`, `--json` | Jalankan dulu `reconcileBotLiveness()` → status `stale` bila PID mati / heartbeat >10s |
| `bot inspect [id]` | **-s**; `-b` | Detail record bot |
| `bot rename [id] [name]` | **-s**; `-b`, `-n/--new-name` | Ubah display name, ID stabil tetap |
| `bot run` | **-s**; `-b`, `-n`, `-d`, `-r`, `--interval <ms>`, `--auto-ack/--no-auto-ack`, `--provider gemini\|mock`, `--model`, `--api-key`, `-m/--mode review\|turbo`, `--max-iterations` | Memulai bot process lengkap: runtime + REPL + agent loop (lihat §7) |
| `broadcast publish [content]` | **-s**; `-b/--sender`, `-c/--category` (def `ACTIVITY`) | Append ke `events.jsonl` |
| `broadcast read` | **-s**; `-b` (cursor), `-c`, `-l/--limit` | Baca broadcast dengan cursor auto-advance jika `-b` disuplai |
| `message send [rcpt] [body]` | **-s**; `-b/--sender`, `-r`, `-t/--type DIRECT\|REQUEST\|RESPONSE\|NOTIFICATION` | Append DM ke inbox target |
| `message read [bot]` | **-s**; `-b`, `--mark-read` (def true), `-l/--limit` | Baca inbox; mark-as-read di bawah lock sesi |
| `message ack [bot] [id]` | **-s**; `-b`, `--message-id` | Ack idempoten |
| `context root add [name] [path]` | **-s**, name+path; `--id`, `-t/--type` | Daftarkan root (batas sandbox) |
| `context root list` | **-s** | Daftar root |
| `context env set` | **-s**; `-k/-v` pair atau `--var KEY=VAL` beberapa | Rekam env metadata + redaksi secret |
| `context env show` | **-s** | Tampilkan env ter-rekam |
| `context doc add [title] [path]` | **-s**; `--id`, `-t/--type` (SDLC enum), `--doc-version`, `--status` | Rekam referensi dokumen SDLC |
| `context doc list` | **-s** | Daftar dokumen |

Tidak ada flag `--json` global; `--workspace` adalah per-subcommand (bukan program-level).

---

## 7. Flow GUI: `bot run` & Interactive REPL

**Catatan penting:** proyek ini **tidak memiliki GUI web atau desktop**. Yang disebut "GUI" dalam proyek hanyalah **terminal REPL** (`BotConsole` dalam `src/bot/console.ts`). Tidak ada Electron, Express, HTTP server, ataupun aset web di kode (grep menyeluruh: nol klik). Web Dashboard/TUI/webhook hanya disebut dalam ROADMAP di `USER_GUIDE.md` §8 dan tidak pernah diekus (belum dibangun).

Flow `almudaya bot run --session S001 --bot BOT002 --provider gemini --mode turbo`:

1. **Provisi provider AI** (`cli/commands/bot.ts:113-127`):
   - `--provider gemini` → `GeminiProvider` (kunci = `--api-key` atau env `GEMINI_API_KEY`)
   - `--provider mock` → `MockAIProvider` (untuk develop/test)
   - **Tanpa flag** tetapi env `GEMINI_API_KEY` tersedia → otomatis memilih Gemini
   - **Tanpa flag dan tanpa key** → provider **disabled** (bukan mock) — bot berlari sebagai pesan-messaging murni tanpa penalaran AI

2. **`BotRuntime.start()`**:
   - Jika `--bot <id>` meng-enam-kan bot yang sudah ada → `updateStatus('active', { pid: process.pid })`; jika TIDAK → `registerBot` (auto-ID sequential).
   - `setInterval` heartbeat (default 2s) → `touchHeartbeat`. **Error heartbeat di-swallow senyap** — bot bisa terus berdenyut padahal sesi sudah dihapus.
   - `setInterval` poll (default 1s): membaca broadcast dengan cursor per-bot + unread inbox (mark-as-read langsung) → callback.
   - Signal handler SIGINT/SIGTERM → `runtime.stop()` (status `stopped`).

3. **`BotConsole` REPL:**
   - Prompt `<DisplayNama>> `, non-destructive TTY rendering (`\r\x1b[K`) — pesan broadcast/pesan masuk yang muncul bersamaan dengan operator men-typing tidak akan merusak buffor input aktif.
   - Slash command: `/msg`, `/broadcast`, `/peers` (sekaligus `reconcileBotLiveness`), `/roots`, `/log [limit] [root]`, `/mode [review|turbo]`, `/status`, `/clear`, `/help`, `/exit|/quit`.
   - **Input bebas (bukan slash)** → diproduksi DM sintetis `sender_bot_id: 'OPERATOR'` → fez. `agentLoop.handleMessage()`.
   - `setPromptHandler(this.askQuestion)` → request persetujuan Human-in-the-Loop dipertanya-kan lewat REPL yang sama.

4. **Perilaku pesan masuk → `AutonomousAgentLoop.handleMessage()`** (lihat §8).

---

## 8. Agent Loop ReAct

Inti `src/bot/agent-loop.ts`, `AutonomousAgentLoop.handleMessage(message)`:

```
1. Kumpulkan konteks:
   - identitas bot sendiri + daftar bot peers
   - daftar project roots terdaftar (absolute paths)
   - getRecentSummaryMarkdown(10) — ringkasan work-log 10 entri terakhir

2. buildDynamicSystemPrompt({ ... , executionMode, recentWorkLogsMarkdown })
   (prompt berbahasa Indonesia dengan panduan operasional advisory — penegakan sebenarnya imperatif per tool call)

3. Tersedia tools: [FILE_TOOLS(5), RUN_COMMAND_TOOL, GET_WORK_LOG_TOOL]
   → dikonversi oleh provider ke function_declarations Gemini

4. Loop terbatas (while iteration < maxIterations, default 10):
   a. provider.generateResponse({systemPrompt, messages, tools})
   b. Bila toolCalls.length > 0:
      - push {role: model, content: thought, toolCalls}
      - untuk setiap call:
        * broadcast ACTIVITY audit event berisikan argument RAW (termasuk isi file penuh write_file)
        * executionModeController.requestApproval() → jika ditolak operator,
          push error 'Aksi dibatalkan oleh operator.' dan skip eksekusi
        * dispatch: get_work_log → executeGetWorkLog;
          run_command → executeRunCommand(projectRootPaths, cmd) + auto work-log 'COMMAND';
          else → executeFileTool(roots, name, args) + auto work-log untuk write/edit
        * push {role: tool, toolResult} — LLM melihat hasil, lalu beralasan lagi
        * continue (iterasi berikutnya)
   c. Bila TANPA toolCalls → tambahkan jawaban final text, break loop
   d. Bila loop habis maxIterations → jawaban '[Peringatan: Mencapai batas maksimal N iterasi tool.]'

5. Auto-reply:
   - Jika sender ≠ self dan ≠ 'OPERATOR' → sendDirectMessage(sender → message.sender, finalResponse)
   - publish broadcast DECISION
```

**Terminasi:** teks-only atau habis iterasi; error thrown oleh provider di-retry di layer Gemini (3x), lalu kocor sebagai `GeminiProviderError` — di-catch sempit oleh agent-loop (bukan di-swallow).

**Risiko arsitektural yang di-identifikasi di sini:**

- **Prompt injection via peer DM:** konten pesan peer di-embed mentah ke user-turn:
  ```ts
  content: `[Pesan Masuk dari rekan bot "${senderName}"]: ${message.content}`
  ```
  Siapapun yang bisa menulis ke `inbox/<bot>/messages.json` (tanpa autentikasi — kredensial = akses tulis) bisa meng-command `run_command`, menulis file, atau mengirim DM ke bot lain.
- **Prompt injection via work-log:** `recentWorkLogsMarkdown` di-linuh ke system prompt — channel injection tingkat dua.
- **Root matching heuristik `isPathInsideRoot(r.path, target) || target.startsWith(r.root_id)`** pada `recordToolExecutionWorkLog` — cek `startsWith(root_id)` meragukan (root_id seperti `root_1` tidak seharusnya dicocokkan dengan prefix path, kecuali suatu path JS menganggap root_id "primary" sebagai substring — hard untuk uint). Otomatis-akurasi work-log terbaik "(best-effort)" dibungkus try/catch senyap.
- **Auto-reply dengan loop:** reply bot↔bot bisa ping-pong tanpa rate limit (setiap penerima memulai loop sendiri; `maxIterations` hanya membatasi per-message).
- **Kasus edge:** LLM men-balas kosong (bukan teks, bukan toolCalls) → break dengan `finalResponseText` kosong, reply pipeline recomendasi fallback `'(Tugas telah diselesaikan.)'`.

---

## 9. Layer Tools & Sandbox

Semua tool dipanggil di agent-loop dengan pipeline: **broadcast audit → requestApproval → eksekusi → auto work-log**.

| Tool | Parameter | Kapabilitas | Enforcement |
|---|---|---|---|
| `read_file` | `path`, `start_line`, `end_line` | Baca file teks UTF-8 | `validateSandboxedPath`, tolak dir, **cap 10 MB** |
| `write_file` | `path`, `content`, `overwrite` | Tulis atomik (tmp + rename; fallback copyFile+unlink di Windows) | Sandbox; tolak overwrite tanpa `overwrite: true` |
| `edit_file` | `path`, `target`, `replacement` | Replace string exact (semua kemunculan), atomik | Sandbox; `TargetNotFoundError` bila target tak adai |
| `list_dir` | `path` (def `.`), `recursive`, (`max_depth` **tipe ada tapi dibuang dispatcher**) | Rekursif listing + ukuran | Sandbox; skip `.git`, `node_modules`, `.almudaya` |
| `search_files` | `pattern`, `path` | Substring case-insensitive, file **dan konten** (≤2 MB untuk konten) | Sandbox; skip dir; depth cap 10 |
| `run_command` | `command`, `timeout_ms` (def 30s), `working_dir` (def `.`) | Spawn shell (`cmd.exe /d /s /c` di Windows, `/bin/sh -c` di POSIX) + capture stdout/stderr (1MB) + exit + durasi | Sandbox hanya pada `working_dir`; `taskkill /T /F` (Windows) / `SIGKILL` (POSIX) untuk timeout; `FORCE_COLOR=0`, `CI=true` |
| `get_work_log` | `limit`, `root_id`, `bot_id` | Baca `work_log.jsonl` + digest markdown | Session-scoped, no-FS |

**Sandbox (`src/tools/sandbox.ts`):**

- `validateSandboxedPath(projectRoots, requestedPath, rootHint?)`:
  - Zero roots atau path kosong → ditolak.
  - `path.resolve` + normalisasi huruf drive uppercase di Windows.
  - Absolute path di-STUJU jika bertama-tempat-kan di dalam root.
  - Relative direspect terhadap primary root atau rootHint.
- `isPathInsideRoot()` memakai `path.relative`, tolak `..` dan absolute; **case-insensitive di Windows**; aman dari prefix-collision (`/app/project` vs `/app/project-sibling`); lempar `PathTraversalSecurityError`.
- **Tidak ada realpath/lstat-resolve** — symlink/junction di dalam root yang menunjuk ke luar root akan *melarikan diri* dari sandbox (berlaku untuk file tools dan `working_dir` `run_command`).
- **`run_command` TANPA blocklist** — `rm -rf`, `del /s /q`, `format`, `curl`, `npm install -g`, semua lolos; konfinemen hanya pada CWD. "Sandbox" berhenti di path.

**Model eksekusi (`src/bot/execution-mode.ts`):**

- `MUTATING_TOOLS = { write_file, edit_file, run_command }` — read tools (`read_file`, `list_dir`, `search_files`, `get_work_log`) selalu auto-approved.
- `REQUEST_REVIEW` (default): tool mutasi wajib persetujuan `y/n/d` (d = dump JSON argumen, **bukan diff**).
- `TURBO`: semua tool auto-approved. State mode **in-memory per proses** — tidak ada observabilitas lintas proses (bot lain tidak tahu satu rekan berada di TURBO).
- `promptHandler` injectable (REPL / test harness); default readline interaktif; **tutup console → hasil default `'n'`** (fail-safe bagus).

---

## 10. Layer AI (Gemini)

- `GeminiProvider` default model `gemini-2.5-flash`. Constructor eager-throw kredensial **bagus** (fail-fast).
- Mekanisme deteksi transient: substring `429|503|RESOURCE_EXHAUSTED|quota|ETIMEDOUT` + jittered exp. backoff (2^attempt × 500ms).
- Parsing response: manual traversal `candidates[0].content.parts[*].text` (meng- InternalWarning SDK); `functionCalls` → `id ?? \`call_<ts>_<i>\``.
- **Risiko paralel tool-calls dalam satu turn**: ID fallback berbasis `Date.now()` bisa ber-tabrakan; mapping tool-result di syntax-based (bukan ID-based) — dua call dengan nama sama diper-satukan saat走去oleh wire.

---

## 11. Kondisi GUI Asli (Web/Desktop)

Tidak ada GUI dalam bentuk apa pun:

- Deps: hanya `commander`, `zod`, `@google/genai` — tanpa electron/express/react/vue.
- Grep sumber: nol hits untuk `http.createServer\|localhost\|express\|electron\|react\|browser` (hanya fixture strings test).
- `dist/` hanya mirror JS hasil kompilasi `src/` — tak ada aset web/server entrypoint.
- Dokumen menyebut GUI hanya sebagai ROADMAP (`USER_GUIDE.md` §8) / out-of-scope (`README.md`, `MASTER_PROMPT.md`, `PROJECT_CHARTER v0.3.0` menunda Web UI ke release visual yang terpisah).

---

## 12. Kondisi Testing

~120–130 buah `it()` dalam ~18 test file/suite; sek-ret badge README menyebut "179 Tests" (badge statis; grep aktual menunjukkan ~182 kata kunci `it(` , sebagian non-test):

| Area | File | Ter-cover |
|---|---|---|
| core | config, lock | workspace precedence, session paths; lock acquire/release/timeout/stale-PID recovery |
| blackboard | persistence | create + direktori hierarki, dup-ID, durability restart, locked metadata update, invalid ID, **korupt JSONL**, schema violation |
| bot registry | bot-registry | sequential ID, default name, dup-ID/name rejection, peer discovery, rename stability |
| liveness/runtime | liveness, runtime, process-isolation, concurrent-registration | PID liveness, heartbeat, inbox consumption + auto-ack, isolation crash, concurrent register tanpa tabrakan |
| agent/safety | agent-loop, execution-mode | autonomous TURBO exec, REQUEST_REVIEW penolakan tidak menyentuh disk, maxIterations, auto work-log, get_work_log, review per-tool-type, mode togol |
| console | console | banner/prompt non-blocking, semua slash command, NL instruction, TTY ANSI non-destructive render |
| messaging | messaging/* | broadcast publish/read/filter/cursor, DM send/resolve/mark-read/ack idempoten, concurrent append no-loss |
| shared/worklog | shared/* | secret redaksi (key+JWT), roots, env redaksi, dokumen dup, work-log filter/summary/concurrency/**korump line recovery** |
| tools | tools/* | slicing, out-of-root, mkdir/overwrite, target-not-found, ignore dirs, dispatcher, command-tools stdout/exit/sandbox/timeout, sandbox traversal (`..`, foreign abs, prefix collision) |
| CLI | cli/* | help/metadata, session CRUD, bot join/inspect/rename, broadcast & DM roundtrip, env redaksi |
| e2e | two-terminal-poc, autonomous-coding, multi-root-orchestration | full 12-step PoC MASTER_PROMPT §10; autonomous write_file + verifikasi node; multi-root collab + shared work memory |
| AI | ai/* | mock scripted, prompt builder injection, Gemini format/parsing/retry/fatal, kredensial resolusi + mask |

**Gap test yang ter-identifikasi:**
- Tidak ada test untuk `run_command` environment leakage (env anak-shell).
- Tidak ada test symlink/junction escape.
- Tidak ada test streaming/timeout edge Gemini.
- Tidak ada test CLI negative-path validating `--category`/`--type` enum valid.
- Tidak ada test `--api-key` handling / masking.
- Tidak ada test TURBO gating + prompt injection end-to-end.

---

## 13. Temuan Kritis (🔴 High)

| # | ID | Temuan | Lokasi | Dampak |
|---|---|---|---|---|
| 1 | SEC-01 | **Kebocoran `GEMINI_API_KEY` via `run_command`** — child shell mewarisi `process.env` penuh; `echo %GEMINI_API_KEY%` (Windows) atau `echo $GEMINI_API_KEY` (POSIX) menampilkan kunci; **stdout yang terekam ditulis ke `stdout_snippet` di `work_log.jsonl` di blackboard** — melanggar Invariant 7 ("kredensial di memori, tidak persist"). | `tools/command-tools.ts:58` | Exfiltrasi kredensial; secret di-persist ke disk |
| 2 | CONC-01 | **Lock TOCTOU dua-pemegang** — pemecahan lock stale berbasis `unlink → continue` dan force-unlink record tak-parseable saat release membuat jendela doble-holder; tidak ada fencing token / fingerprint kepemilikan sebelum unlink; record tak-parseable sama sekali dianggap tidak stale. | `core/lock.ts` | Double-write ke registry/inbox; korupt data |
| 3 | CONC-02 | **Race cursor broadcast** — `MessagingService.readBroadcasts` menyimpan cursor (`saveBroadcastCursor`) **tanpa** `withSessionLock`; reader yang sama berjalan paralel bisa membuat cursor regresi; `category`/`limit` filter diterapkan *setelah* cursor maju → event ter-filter **hilang permanen**; `afterEventId` tanpa hasil → *silently return seluruh history*. | `messaging/service.ts:63-81` | Redelivery / kehilangan event |
| 4 | RELIA-01 | **Pesan hilang saat processing crash** — inbox di-mark-as-read *sebelum* diproses; tidak ada retry/dead-letter/redelivery. | `bot/runtime.ts`, `messaging/service.ts:readInbox` | Kehilangan pesan |
| 5 | SEC-02 | **Prompt injection + blackboard tanpa autentikasi** — konten peer DM, deskripsi bot, dan work-log summary di-inject mentah ke prompt; blackboard hanya dilindungi akses-tulis-filesystem — siapapun proses lokal bisa menyamar jadi bot / `OPERATOR`; pengirim tidak ter-verifikasi; `metadata` unvalidated (`z.unknown()`); tanpa length cap untuk konten. | `agent-loop.ts:120`, `prompts.ts`, `messaging/schema.ts` | RCE-equivalent via bot; LLM-cost DoS |
| 6 | SEC-03 | **`run_command` tanpa allowlist/blocklist** — sandbox hanya di CWD; shell penuh; di TURBO, "sandbox" efektif dekoratif; opsi `-d` review dump JSON argumen, bukan diff — keputusan operator tanpa konteks berbeda perubahan. | `tools/command-tools.ts` | Eksekusi kode arbitrer |
| 7 | PERF-01 | **Loop re-entrancy** — `setInterval(pollCycle)` tanpa await; `rl.on('line')` tanpa latch — beberapa `handleMessage` paralel dalam satu bot; **Gemini call tanpa timeout/cancel** — hang stream = banyak loop stale. | `bot/runtime.ts`, `bot/console.ts`, `ai/gemini.ts` | Interleaving perintah; dup-entry work-log |
| 8 | RELIA-02 | **JSONL torn-read fatal** — `readBroadcasts`/`readWorkLogs` lock-free; satu baris korump → `CorruptedDataError "Invalid JSONL record at line N"` untuk SEMUA konsumen hingga dipulihkan manual; `agent-loop.handleMessage` **tidak meng-catch** panggilan `getRecentSummaryMarkdown` (line ~91) → pesan tanpa diproses, unhandled rejection. | `blackboard/filesystem.ts`, `agent-loop.ts:91` | Pipeline berhenti total |

---

## 14. Temuan Sedang (🟡 Medium)

| # | Temuan | Lokasi |
|---|---|---|
| 1 | **Bot status `stale` terminal** — `touchHeartbeat` tidak mem-oular status; hanya `bot run` (restart) yang bisa mengangkat kembali; status `starting/idle/failed` dideklarasikan tapi **tidak pernah dipakai**. | `bot/service.ts:reconcileBotLiveness`, `touchHeartbeat` |
| 2 | **`registerBot` default PID = registrar CLI** — `bot join` mencatat PID proses CLI jangka-pendek, menyebabkan liveness check bot tak-valid. | `bot/service.ts` |
| 3 | **Storage validation asymmetry** — beberapa setter (`saveProjectRootsRegistry`, `saveDocumentsRegistry`, `saveEnvironmentMetadata`, `saveInbox`, `saveBroadcastCursor`) TIDAK melakukan cek `sessionExists`; cursor untuk sesi yatim bisa membangun folder via `ensureDir` secara diam-diam; `createSession` meninggalkan folder kosong bila schema validation gagal; `withSessionLock` membuat folder sebelum cek keberadaan. | `blackboard/filesystem.ts` |
| 4 | **O(n²) inbox & unbounded JSONL** — `messages.json` di-rewrite penuh tiap append; tak ada rotasi/pruning untuk `events.jsonl`/`messages.json`/`work_log.jsonl`; broadcast diparse penuh di setiap poll; audit broadcast berisi argumen tool mentah (bisa MB per call) untuk diparse ulang oleh semua bot. | seluruh storage layer |
| 5 | **Lock tidak re-entrant** — nested `acquireLock` pada dir yang sama, di proses yang sama, busy-poll 5s → `LockTimeoutError`; option `holderName` **dideklarasikan tapi tidak pernah digunakan** di seluruh codebase (holder selalu `pid:N`). | `core/lock.ts` |
| 6 | **Sandbox symlink escape** — `validateSandboxedPath` memakai `path.resolve` saja; TIDAK ada realpath/lstat resolve; junction/symlink di dalam root yang menunjuk ke luar root akan lolos. | `tools/sandbox.ts` |
| 7 | **Gemini tool-ambiguity** — pemetaan tool-result/by-name bukan by-id; ID fallback `Date.now()` bisa tabrakan di paralel calls; result `null` vs error konversi membingungkan. | `ai/gemini.ts` |
| 8 | **`--api-key` di command line** — kunci visible di shell history dan OS process listing; hanya aliran env yang benar-benar "memory-only". | `cli/commands/bot.ts:83` |
| 9 | **`redactSecrets` terlalu naif** — hanya mencocokkan nama key (regex `token\|secret\|password\|private\|credential\|api[_-]?key\|bearer\|auth`) dan nilai berbentuk JWT; `GITHUB_PAT`, `sk_live_...`, base64 AWS key bernama `srp` **lolos** ke `environment.json`. | `shared/schema.ts` |
| 10 | **Root path tidak dicek keberadaannya** — `registerProjectRoot` hanya `path.resolve`; bot menerima path yang mungkin tidak eksis. | `shared/service.ts` |
| 11 | **`registerEnvironment` `npm_version` hardcode `'11.19.0'`** — nilai konstanta, bukan hasil deteksi; ditulis ke disk untuk dipercaya semua agent. | `shared/service.ts:107` |
| 12 | **CLI enum cast tanpa validasi awal** — `.toUpperCase() as BroadcastCategory` di `broadcast publish`, `message send -t`, `--status doc add` → error hanya muncul dari zod pada layer storage. | `cli/commands/messaging.ts`, `context.ts` |
| 13 | **`list_dir` `max_depth` dibuing dispatcher** — parameter di-iklankan tapi tidak diteruskan (depth fixed 5). | `tools/file-tools.ts` |
| 14 | **`readInbox` limit + mark-as-read yang salah urut** — mark-as-read diaplikasikan *sebelum* slicing limit; CLI `message read -l 5` pada inbox dengan 10 unread **menandai 10 sebagai read** tapi hanya menampilkan 5 — data-hilang-ish bagi konsumen polling. | `messaging/service.ts:readInbox` |
| 15 | **`--interval` tanpa validasi** — `parseInt` tanpa NaN check; `--interval abc` → `setInterval(NaN)` misbehaves. | `cli/commands/bot.ts` |
| 16 | **Broadcast `publication` tanpa verifikasi sender** — `sender_bot_id` percaya string; tidak di-cek sebagai bot terdaftar. | `messaging/service.ts:publishBroadcast` |

---

## 15. Temuan Rendah (🔵 Low)

| # | Temuan | Lokasi |
|---|---|---|
| 1 | JSDoc `readJsonValidated` bilang `CorruptedDataError` — kenyataannya schema violation menglempar `ValidationError`. | `core/fs-utils.ts` |
| 2 | ID generasi 3-byte random (24-bit) + `Date.now()` — tabrakan mungkin (meski langka) untuk `evt_`/`msg_`/`work_` dengan traffic tinggi. | `messaging/schema.ts`, `shared/work-log.ts`, `session/service.ts` |
| 3 | Float error-path: kasus edge LLM balas kosong → `finalResponseText` kosong; tool hallucinated name → `executeFileTool` throws → error di-echo ke LLM → iterasi ter-amiarkan. | `agent-loop.ts` |
| 4 | `pathExists()` meng-swallow SEMUA error (termasuk EPERM di file ter-lock Windows) → false-negative "tidak ada". | `core/fs-utils.ts` |
| 5 | Tidak ada `Error.cause` chaining di `errors.ts`. | `core/errors.ts` |
| 6 | `maskApiKey()` dipanggil di mana-mana tapi tidak pernah digunakan selain di-definiasi. | `ai/credentials.ts` |
| 7 | `listSessions` silent-skip direktori ber-Korupt — operator tidak diberitahu. | `blackboard/filesystem.ts` |
| 8 | Duplicated/confused version markers: folder `v0.1.0`, `dist/` stale, `MASTER_PROMPT.md` era v0.1.0, talon `USER_TUTORIAL.md` v0.2.0 banner text. | root |
| 9 | Timeout process-tree kill di Windows diimplementasi via `taskkill /T /F` yang tidak portable untuk non-COMSPEC shell; off-by-byte di stdout cap (chars vs bytes). | `tools/command-tools.ts` |

---

## 16. Inkonsistensi Dokumen ↔ Kode

Dokumen pengguna tidak selaras dengan implementasi:

1. **README:** contoh `--doc-id SRS-01` — flag yang benar adalah `--id` ; contoh `--category SPEC_READY` — bukan enum valid (ACTIVITY/OBSERVATION/DECISION/TASK/ARTIFACT/QUESTION/STATUS/ALERT).
2. **`USER_MANUAL.md` root (v0.2.0):** kategori broadcast `ANNOUNCEMENT, DECISION, TASK, ALERT` — salah; meng-klaim `message read --status <filter>` — tidak diekspos CLI (service ya); default limit baca (50/20) — kenyataannya *unlimited*; default provider "mock" — kenyataannya **provider disabled** (messaging-only).
3. **`docs_v0.3.0/06_USER_MANUAL`:** `-p, --provider` dan `-m, --model` salah — kenyataannya `--provider`/`--model` long-only dan **`-m` = `--mode`**; opsi `d` review meng-klaim diff — kenyataannya dump JSON argumen; default workspace "Direktori aktif" — kenyataannya `%LOCALAPPDATA%\almudaya` dsb.
4. **`USER_GUIDE.md`/`USER_TUTORIAL.md`:** meng-klaim "ghp_* GitHub tokens, AWS keys, high-entropy tokens di-redaksi otomatis" — `redactSecrets()` hanya match key-name + JWT-shaped values.
5. **`USER_GUIDE.md` §8 GUI Roadmap** disebut sebagai rilis v0.3.0 mendatang — v0.3.0 tidak meng-kirim apa pun GUI.
6. **`MASTER_PROMPT.md`** masih v0.1.0 (LLM out-of-scope, release v0.1.0) — sebagai histori OK, tapi menyebabkan konfusi versi.
7. `bot run` dengan `--provider foo` (tidak valid) **tidak error** — provider silently undefined, bot jadi messaging-only.

---

## 17. Kekuatan Desain (Yang Layak Dipertahankan)

1. **Validasi ID ketat sebelum interpolasi path** (`SESSION_ID_REGEX`, `BOT_ID_REGEX`, `SLUG_ID_REGEX`) — traversal-safe end-to-end.
2. **Double-checked create di bawah lock** + unlock dengan verifikasi kepemilikan PID.
3. **Retry rename Windows-aware** `EPERM/EBUSY` (5x backoff) di `atomicWriteJson`.
4. **updateSession mempertahankan field immutable** (`schema_version`, `session_id`, `created_at`) — mencegah mutasi tak sah.
5. **ID-first canonical bot resolution** — display names tidak pernah disimpan di message (nama bisa berubah, ID stabil).
6. **Hirarki error bertipe konsisten** dengan pesan pre-formatted di satu tempat.
7. **Audit trail komprehensif** — setiap tool call di-broadcast + Auto-work-log; `work_log.jsonl` memberi koordinat multi-root (root_id/name/path) di setiap mutasi.
8. **Fail-safe review prompt** — console tertutup → jawaban `'n'` (tidak approve).
9. **Cap input size di sisi read** (`read_file` 10 MB, `search_files` konten 2 MB) — melindungi prompt bloat di sisi helper (meski tak di sisi reply/conversation).
10. **Test suite besar (>18 file, ~180 assertion)** berbasis Mock provider — deterministik, cross-boundary (multi-process, crash recovery, concurrency).

---

## 18. Rekomendasi Prioritas

Direkomendasikan urutan perbaikan (tak satu pun dari ini low-hanging-fruit mudah di-dumping — semuanya merυmukan desain-level decisions):

**P0 (Sebelum release berikutnya):**
1. **Sanitasi env child process** di `executeRunCommand`: whitelist variabel env (`PATH`, `HOME`, `USERPROFILE`, `ComSpec`, ...) — exclude kredensial (`GEMINI_API_KEY`, dst). Ditambah: **redaktasi stdout/stderr sebelum masuk `work_log.jsonl`** (reuse `redactSecrets`).
2. **Fencing token di `core/lock.ts`:** tambah random `lock_token` saat acquire; release hanya bila token cocok; break stale hanya bila fingerprint cocok.
3. **Pindahkan cursor save ke dalam `withSessionLock`** (atau jadikan atomic CAS).
4. **mark-as-read SEBELUM limit slicing**, dan di agent-loop buat "process, lalu mark-read" (atau status `processing` + redelivery timeout).

**P1:**
5. Sender verification minimal: bot must ri-register (channel-side HMAC/token atau minimal cross-check `bots.json` + PID heartbeat), atau, minimal, lengkap dengan **length cap** konten + sanitasi prompt.
6. `realpath`-check di sandbox (`fs.realpath` native di Node ≥22) — closing symlink/junction escape.
7. Frame `run_command` dengan allowlist/bash --privilege-drop terbatas (at minimal men-limit ke proyek-scoped command wrappers).
8. Fix loop re-entrancy: guard `pollCycle` dengan flag; latch REPL `isProcessing`; timeout pada call Gemini (AbortSignal).

**P2:**
9. JSONL resilient read: skip corrupt line dan warn, atau segmentasi log + snapshot.
10. Bot status state machine: heartbeat auto-revive dari `stale` ke `active`; hapus status `starting/idle/failed` yang mati.
11. Storage setter: konsisten `sessionExists` check.
12. Perbarui dokumentasi v0.3.0 agar sinkron dengan flag/enum/default yang benar-benar ada (Bab 16).
13. Redaksi secretеру, root path existence check, PostgreSQL/document validation warnings di CLI.

---

## 19. Kesimpulan

Proyek ini adalah **fondasi infrastruktur-first yang solid, terdokumentasi ideal** (disiplin Waterfall + phase gates), dengan flow CLI/REPL yang koheren: *create session → register roots/context → register bot → `bot run` per terminal → ReAct engine ter-panggil oleh pesan/broadcast → setiap aksi ter-audit ke blackboard*. Kode dan test-nya bersih, nilai-pep dengan TypeScript strict, dan struktur modul dirancang untuk diskel.

Namun audit menyoroti bahwa keamanan dan konsistensi berada di tiga zona rawan yang kini bersifat *kritis tapi terkandung* karena masih berfase infrastruktur:

1. **Boundary keamanan proses** (`run_command`) yang bertumpu kepercayaan lingkungan.
2. **Atomisitas lintas proses** di lock file + race cursor.
3. **Kebenaran delajer pesan** mark-before-process.

Semua temuan di atas dipetakan menjadi tindak-lanjut di Bab 18. Proyek tetap dalam kondisi freeze sepanjang audit ini — tidak ada file, direktori, maupun state yang diubah (dokumen `AUDIT.md` ini adalah satu-satunya output).

---

*Audit dilakukan derechos-lesen murni: glob, read, grep, dan listing direktori. Tidak ada file/direktori yang dibuat, diubah, atau dihapus selama proses audit berjalan.*
