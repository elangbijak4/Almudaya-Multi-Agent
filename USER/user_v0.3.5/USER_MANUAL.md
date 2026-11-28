# Almudaya Multi-Agent v0.3.5 — Technical & Command Manual

Dokumentasi manual teknis resmi untuk executable CLI `almudaya` dan runtime multi-agent **Almudaya Multi-Agent v0.3.5**, mencakup:
- Sintaks perintah CLI lengkap (`up`/`start`, `session`, `bot`, `broadcast`, `message`, `context`, `capability`, dan `skill`),
- **Master Bot (`BOT000`) & 10 Protokol Atomic `IProtocol`** (*Unified Natural Lifecycle*: `PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrMasterFailover`, `PrGate`, `PrReattach`),
- **Interactive Bot & Master Console REPL** (`/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`, `/model`, `/skill`, `/protocol`, `/blueprint`, `/rules`, `/bots`, `/spawn-mode`, `/moderator`, `/status`, `/clear`, `/help`, `/exit`),
- **Multi-Provider AI, Model Catalog & Local Hardware Advisor** (`gemini`, `nvidia`, `openrouter`, `9router`, `ollama`, `mock`, `almudaya bot models`, `almudaya bot advisor`, `almudaya bot pull`),
- **Agent Capability Governance (ACG)** & isolasi eksekusi OS (`windows` Job Objects / `linux` bwrap),
- **PKU Unified Persistent Memory Architecture (Spec v0.2)** (Project Memory Universe, Global & Individual Registers, Incremental Codebase Indexer, `query_pku_memory`, KOE L0–L3 Retrieval, Memory Lifecycle, serta UMI & External Adapter Gateway),
- **Almudaya Visual Design Skills (AVDS v1.0.1)** (40 profil gaya visual, 13 profil platform, 10 modalitas interaksi, UI Composition Engine, Cross-Platform QA Engine, Design-to-Code Contract, dan perkakas otonom `use_skill`).

---

## 1. Konsep Perintah Global & Opsi Umum

Format umum eksekusi CLI:
```bash
almudaya <command> <subcommand> [arguments...] [options...]
```

Semua perintah dirancang fleksibel: dapat menerima **argumen posisi** (*positional arguments*) maupun **opsi berbendera** (*flags/options*).

### Opsi Global
| Opsi | Tipe | Default | Keterangan |
|---|---|---|---|
| `-v, --version` | Flag | - | Menampilkan versi terpasang dari `almudaya-multiagent` (`0.3.5`). |
| `-h, --help` | Flag | - | Menampilkan bantuan manual perintah dan sub-perintah yang tersedia. |
| `-w, --workspace <path>` | String | Platform default | Menimpa (*override*) direktori root penyimpanan session untuk eksekusi saat ini. |
| `--json` | Flag | `false` | Menghasilkan keluaran dalam format JSON murni terstruktur (ideal untuk scripting & piping). |

---

## 2. Referensi Lengkap Sub-Perintah CLI

### 2.0 Unified HITL + Master Bot & 10 Protokol (`almudaya up` / `start`)

Meluncurkan konsol interaktif Human-in-the-Loop dan **Master Bot (`BOT000`)** dalam arsitektur **Unified Natural Lifecycle** (tanpa pemisahan mode klasik vs *macro-loop*; siklus $L=1$ maupun $L>1$ terbentuk secara alami dari rantai pesan tugas dan evaluasi `GoalLedger`):

```bash
almudaya up [options...]
almudaya start [options...]
```
- **Options Utama:**
  - `-s, --session <sessionId>`: Membuat atau melanjutkan session ID yang ada (memicu `PrReattach` saat resume).
  - `-r, --root <paths...>`: Mendaftarkan satu atau beberapa *workspace directory root paths*.
  - `-w, --workspace <path>`: Direktori root penyimpanan Blackboard.
  - `--provider <provider>` & `--model <model>` & `--base-url <url>`: Provider & model utama Master Bot (`gemini`, `nvidia`, `openrouter`, `9router`, `ollama`, `mock`).
  - `--master-failover <specs>`: Rantai model cadangan (`provider:model,...`) untuk `FailoverAIProvider` (`PrMasterFailover`).
  - `--pool <specs>`: Pool model spesialis untuk worker (`provider:model,...`).
  - `--spawn-mode <windows|multiplexed>`: Mode jendela worker (`windows` membuka jendela terminal OS terpisah per worker sebagai default; `multiplexed` menampilkan log worker berawalan ID ke konsol Master).
  - `--max-windows <count>`: Batas maksimum jendela terminal OS serentak sebelum diturunkan ke `multiplexed` (`0` = tanpa batas khusus; default `"0"`).
  - `--lazy-master`: Menunggu di mode standby HITL sampai ada objektif yang mengaktifkan Master Bot.
  - `--pr-bot <limit>` (default `"10"`), `--pr-bot-global <limit>` (`auto` atau angka), `--pr-iterasi <limit>` (default `"10"`), `--pr-de <limit>` (default `"10"`).
  - `--token-budget <tokens>` (default `"1000000"`), `--time-limit <ms>` (`ms` atau `"infinite"`, default `"infinite"`).
  - `--moderator <botId>`: Pemegang awal kursi arbitrase `PrModerator` (default `"BOT000"`).
  - `--no-pr-me-end`, `--no-pr-gate`, `--no-reattach`: Menonaktifkan pengaman protokol tertentu bila diperlukan.
  - `--turbo` / `--mode <review|turbo>` / `--non-interactive`: Mengatur mode eksekusi atau menginisialisasi sesi tanpa masuk ke REPL.

---

### 2.1 Manajemen Session (`almudaya session`)

Mengelola siklus hidup ruang kolaborasi (*Session*).

#### A. Membuat Session Baru (`create`)
```bash
almudaya session create <name> [options...]
```
- **Arguments:**
  - `<name>` *(Wajib)*: Nama deskriptif session (misal `proyek-baru`).
- **Options:**
  - `-s, --session <id>` *(Opsional)*: Slug ID session kustom (misal `S002`). Hanya huruf, angka, `-`, dan `_`.
  - `--id <id>` *(Opsional)*: Alias untuk `--session <id>`.
  - `--description <text>` *(Opsional)*: Penjelasan tujuan session.
  - `-w, --workspace <path>` *(Opsional)*: Tentukan folder root workspace.
- **Contoh Penggunaan:**
  ```bash
  almudaya session create proyek-baru --session S002
  almudaya session create "E-Commerce App" --session S001 --description "Refactoring UI & API"
  ```

#### B. Menampilkan Daftar Session (`list`)
```bash
almudaya session list [options...]
```
- **Contoh:**
  ```bash
  almudaya session list
  almudaya session list --json
  ```

#### C. Memeriksa Rincian Session (`inspect`)
```bash
almudaya session inspect [sessionId] [options...]
```
- **Contoh:**
  ```bash
  almudaya session inspect S002
  almudaya session inspect --session S002 --json
  ```

---

### 2.2 Manajemen Bot & Konsol Interaktif (`almudaya bot`)

Mengelola registrasi bot, penamaan, inspeksi status, dan siklus hidup proses *runtime* + konsol REPL.

#### A. Mendaftarkan Bot ke Session (`join` / `start`)
```bash
almudaya bot join --session <id> [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session yang dituju.
  - `-b, --bot <botId>` *(Opsional)*: ID stabil bot (misal `BOT001`). Jika dikosongkan, sistem mengalokasikan ID otomatis (`BOT001`, `BOT002`, dst).
  - `--display-name <name>` / `-n, --name <name>` *(Opsional)*: Nama tampilan manusiawi.
  - `--role <role>` / `-d, --description <desc>` *(Opsional)*: Peran atau deskripsi bot.
  - `-w, --workspace <path>` *(Opsional)*: Lokasi workspace.
- **Contoh:**
  ```bash
  almudaya bot join --session S002 --bot BOT001 --display-name "Architect" --role "System & UI Architect"
  almudaya bot join --session S002 --bot BOT002 --display-name "Coder" --role "Fullstack Engineer"
  ```

#### B. Menampilkan Daftar Bot dalam Session (`list`)
```bash
almudaya bot list --session <id> [options...]
```
> [!NOTE]
> Perintah `list` secara otomatis merekonsiliasi *liveness* PID setiap bot di sistem operasi (`active` vs `stale`).

#### C. Memeriksa Detail Bot Tertentu (`inspect`)
```bash
almudaya bot inspect [botIdOrName] --session <id> [--json]
```

#### D. Mengubah Nama Tampilan Bot (`rename`)
```bash
almudaya bot rename [botId] [newDisplayName] --session <id>
```

#### E. Menjalankan Runtime Daemon Bot & Konsol REPL (`run`)
```bash
almudaya bot run --session <id> --bot <id> [options...]
```
Menjalankan proses bot dengan **Autonomous ReAct Agent Loop** dan **Interactive Bot Console REPL (`<BotName>> `)**:
- **Options:**
  - `--provider <gemini|nvidia|openrouter|9router|ollama|mock>`: Provider AI untuk bot ini (jika dikosongkan, otomatis memilih `gemini` bila `GEMINI_API_KEY` ada, `nvidia` bila `NVIDIA_API_KEY` ada, `openrouter` bila `OPENROUTER_API_KEY` ada, `ollama` bila `OLLAMA_BASE_URL` diset, atau `9router` bila `NINEROUTER_BASE_URL` diset).
  - `--model <modelName>`: Nama model LLM spesifik (misal `gemini-2.5-flash`, `qwen2.5-coder:7b`, `meta/llama-3.3-70b-instruct`, `deepseek-ai/deepseek-r1`, `deepseek/deepseek-chat-v3-0324:free`, `mycombo`).
  - `--base-url <url>`: Base URL OpenAI-compatible kustom (misal `http://localhost:11434/v1` untuk Ollama, `https://integrate.api.nvidia.com/v1` untuk NVIDIA NIM, atau `http://localhost:20128/v1` untuk 9router).
  - `--api-key <key>`: *(Deprecated / Tidak disarankan)* API key eksplisit via CLI; gunakan environment variable (`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `NINEROUTER_API_KEY`, `OLLAMA_API_KEY`).
  - `-m, --mode <review|turbo>`: Mode keamanan eksekusi (`review` untuk Human-in-the-Loop, `turbo` untuk otonom).
  - `--max-iterations <count>`: Batas maksimal iterasi ReAct loop per pesan (default: `10`).
  - `--interval <ms>`: Interval detak heartbeat dalam milidetik (default: `2000`).
  - `--no-auto-ack`: Matikan auto-acknowledgement pesan masuk.
- **Daftar Perintah Slash di Dalam Konsol REPL (`<BotName>> `):**
  | Perintah Slash | Keterangan |
  |---|---|
  | `/msg <targetBot> <pesan>` | Mengirim pesan langsung (*direct message*) ke rekan bot lain. |
  | `/broadcast <pesan>` | Menyiarkan pengumuman broadcast ke seluruh bot di session. |
  | `/peers` | Menampilkan daftar rekan bot aktif/stale beserta PID dan perannya. |
  | `/roots` | Menampilkan daftar *project roots* terdaftar di session. |
  | `/log [limit] [root]` | Menampilkan linimasa riwayat kerja lintas-root (`work_log.jsonl`). |
  | `/mode [review\|turbo]` | Menampilkan atau mengubah mode eksekusi keamanan secara *on-the-fly*. |
  | `/model [modelId] [provider]` | Menampilkan daftar model (`ollama`, `nvidia`, `9router`, `openrouter`, `gemini`), memfilter via `/model list [provider]`, mengecek spek hardware & rekomendasi (`/model recommend`), mengunduh model Ollama (`/model pull <modelId>`), atau mengganti model saat runtime. |
  | `/skill [subcommand]` | Mengelola skill & AVDS (`list`, `styles [family]`, `platforms`, `modalities`, `enable [skillId] [style] [platform]`, `disable [skillId]`). |
  | `/protocol` | Menampilkan status **10 protokol v0.3.5**, kuota bot/token, dan ringkasan `GoalLedger`. |
  | `/blueprint` | Menampilkan daftar tugas `GoalLedger` blueprint yang sedang berjalan. |
  | `/rules [add\|rm] [...]` | Menambah, menonaktifkan, atau melihat **Dynamic Rules** (`rules.md`) sesi aktif. |
  | `/bots` | Menampilkan status dan model seluruh worker serta Master Bot (`BOT000`). |
  | `/spawn-mode [windows\|multiplexed]` | Mengubah mode jendela terminal worker secara langsung pada runtime. |
  | `/moderator [delegate\|reclaim]` | Melihat, mendelegasikan, atau menarik kembali kursi arbitrase `PrModerator`. |
  | `/status` | Menampilkan ringkasan status bot lokal, PID, mode, dan AI provider. |
  | `/clear` | Membersihkan layar terminal. |
  | `/help` | Menampilkan daftar perintah interaktif. |
  | `/exit`, `/quit` | Menghentikan bot dengan aman (*graceful shutdown*) dan keluar. |
  | `<instruksi teks biasa>` | Mengirim instruksi bahasa alami langsung ke penalaran ReAct AI bot lokal. |

#### F. Menjelajahi Katalog Model AI (`models`), Hardware Advisor (`advisor`), dan Unduh Model (`pull`)
```bash
almudaya bot models [options...]
almudaya bot advisor [options...]   # alias: almudaya bot hardware
almudaya bot pull <modelId> [--base-url <url>]
```
Menampilkan daftar model AI dari **Ollama** (model lokal terunduh), **NVIDIA NIM**, **9router**, preset gratis **OpenRouter**, dan **Google Gemini**, sekaligus memeriksa spesifikasi perangkat keras (CPU, RAM, GPU/VRAM) serta mengunduh model lokal via Ollama:
- **Options (`models`):**
  - `--provider <ollama|nvidia|9router|openrouter|gemini|all>`: Filter daftar model berdasarkan provider tertentu (default: `all`).
  - `--base-url <url>`: Base URL kustom untuk endpoint OpenAI-compatible (Ollama default `http://localhost:11434/v1`, NVIDIA NIM default `https://integrate.api.nvidia.com/v1`, 9router default `http://localhost:20128/v1`).
  - `--no-live`: Lewati query HTTP live dan tampilkan katalog bawaan saja.
  - `--recommend`: Jalankan analisis spesifikasi perangkat keras dan tampilkan rekomendasi model lokal + cloud gratis.
  - `--json`: Keluaran JSON terstruktur.
- **Options (`advisor` / `hardware`):**
  - `--base-url <url>`: Base URL Ollama kustom.
  - `--no-online`: Lewati pencarian live model cloud gratis online.
  - `--json`: Keluaran laporan analisis hardware & rekomendasi model dalam format JSON.
- **Contoh:**
  ```bash
  almudaya bot models
  almudaya bot models --provider ollama
  almudaya bot models --provider nvidia
  almudaya bot models --recommend
  almudaya bot advisor
  almudaya bot pull qwen2.5-coder:7b
  almudaya bot models --provider openrouter --json
  ```

---

### 2.3 Komunikasi Broadcast (`almudaya broadcast`)

Publikasi dan konsumsi log event broadcast session yang bersifat *append-only* (`events.jsonl`) dengan verifikasi identitas pengirim (`AUD-10`).

- **Publikasi:**
  ```bash
  almudaya broadcast publish [content] --session <id> [--bot <botId>] [--category <ACTIVITY|OBSERVATION|DECISION|TASK|ARTIFACT|QUESTION|STATUS|ALERT>]
  ```
- **Membaca:**
  ```bash
  almudaya broadcast read --session <id> [--bot <botId>] [--category <cat>] [--limit <n>] [--json]
  ```

---

### 2.4 Pesan Langsung / Direct Messaging (`almudaya message`)

Pertukaran pesan point-to-point antar-bot melalui Individual Blackboard (`inbox/<bot_id>/`) dengan state pengiriman tahan-gagal (`PENDING` $\rightarrow$ `PROCESSING` $\rightarrow$ `ACKED` / `FAILED` / `DEAD_LETTER`), *lease expiry*, dan *fencing token*.

- **Mengirim Pesan (`send`):**
  ```bash
  almudaya message send [recipient] [content] --session <id> [--sender <botId>] [--type <DIRECT|REQUEST|RESPONSE|NOTIFICATION>]
  ```
- **Membaca Inbox (`read`):**
  ```bash
  almudaya message read [botId] --session <id> [--mark-read | --no-mark-read] [--limit <n>] [--json]
  ```
- **Konfirmasi Pesan (`ack`):**
  ```bash
  almudaya message ack [botId] [messageId] --session <id>
  ```

---

### 2.5 Registri Konteks Bersama (`almudaya context`)

Menyimpan direktori project roots, variabel lingkungan dengan *automatic secret redaction*, dan katalog dokumen SDLC.

- **Project Roots (`root add` / `root list`):**
  ```bash
  almudaya context root add --session S002 --id web-app --name "Web App" --path D:\testingbot --type primary
  almudaya context root list --session S002
  ```
- **Environment Metadata (`env set` / `env show`):**
  ```bash
  almudaya context env set --session S002 --var NODE_ENV=development API_URL=http://localhost:3000
  almudaya context env show --session S002
  ```
- **Katalog Dokumen SDLC (`doc add` / `doc list`):**
  ```bash
  almudaya context doc add --session S002 --title "AVDS Design Brief" --doc-path docs/AVDS_DESIGN_BRIEF.md --type DESIGN --status approved
  almudaya context doc list --session S002
  ```

---

### 2.6 Tata Kelola Kapabilitas & Keamanan (`almudaya capability`)

Mengelola izin kapabilitas eksplisit (*Agent Capability Governance / ACG*), kebijakan *fail-closed*, preset keamanan, dan jejak audit keamanan (`security_audit.jsonl`).

- **Daftar Kapabilitas Sistem atau Grant Aktif (`list`):**
  ```bash
  almudaya capability list
  almudaya capability list --session S002 --json
  ```
- **Inspeksi Definisi Kapabilitas atau Grant (`inspect`):**
  ```bash
  almudaya capability inspect process.execute_external
  almudaya capability inspect <grantId> --session S002
  ```
- **Memberikan Izin Kapabilitas (`grant`):**
  ```bash
  almudaya capability grant process.execute_external --session S002 --bot BOT002 --commands node npm git --paths D:\testingbot --mode session --duration 24
  ```
- **Mencabut Grant (`revoke`) & Reset Sesi (`reset`):**
  ```bash
  almudaya capability revoke <grantId> --session S002 --reason "Tugas selesai"
  almudaya capability reset --session S002
  ```
- **Preset Kapabilitas (`preset list`, `preset show`, `preset apply`):**
  ```bash
  almudaya capability preset list
  almudaya capability preset show standard_coding
  almudaya capability preset apply standard_coding --session S002 --paths D:\testingbot
  ```
- **Riwayat Audit Keamanan (`history`):**
  ```bash
  almudaya capability history --session S002 --limit 20
  ```

---

### 2.7 Manajemen Modul Skill & AVDS v1.0.1 (`almudaya skill`)

Mengelola paket skill agen, mengeksplorasi **Almudaya Visual Design Skills (AVDS v1.0.1)** (40 gaya visual, 13 platform, 10 modalitas interaksi), mengaktifkan konfigurasi skill untuk sesi atau bot spesifik, serta memvalidasi artefak kontrak desain.

#### A. Menampilkan Daftar Skill & Binding Sesi (`list`)
```bash
almudaya skill list [--session <sessionId>] [--bot <botId>] [--json]
```
- **Contoh:**
  ```bash
  almudaya skill list
  almudaya skill list --session S002
  ```

#### B. Memeriksa Arsitektur & Sub-Skill (`inspect`)
```bash
almudaya skill inspect [skillId] [--json]
```
- **Contoh:**
  ```bash
  almudaya skill inspect almudaya-visual-design
  ```

#### C. Menjelajahi 40 Profil Gaya Visual AVDS (`styles`)
```bash
almudaya skill styles [styleId] [--family <family>] [--json]
```
- **Keluarga Gaya (`--family`):** `minimalist`, `futuristic`, `premium`, `editorial`, `organic`, `corporate`, `playful`, `specialized`.
- **Contoh:**
  ```bash
  # Menampilkan seluruh 40 profil gaya visual:
  almudaya skill styles

  # Filter keluarga gaya futuristic:
  almudaya skill styles --family futuristic

  # Membaca profil YAML lengkap gaya quantum-futurism:
  almudaya skill styles quantum-futurism
  ```

#### D. Menjelajahi 13 Profil Platform Target AVDS (`platforms`)
```bash
almudaya skill platforms [platformId] [--json]
```
- **Daftar Platform:** `web`, `windows-desktop`, `macos-desktop`, `linux-desktop`, `android`, `ios`, `tablet`, `tv`, `wearable`, `automotive`, `industrial-hmi`, `spatial-xr`, `voice-conversational`.
- **Contoh:**
  ```bash
  almudaya skill platforms
  almudaya skill platforms android
  ```

#### E. Menjelajahi 10 Modalitas Interaksi AVDS (`modalities`)
```bash
almudaya skill modalities [modalityId] [--json]
```
- **Daftar Modalitas:** `mouse-pointer`, `keyboard`, `touch`, `stylus`, `voice`, `gesture`, `gaze-spatial`, `remote-dpad`, `haptic`, `multimodal`.
- **Contoh:**
  ```bash
  almudaya skill modalities
  almudaya skill modalities keyboard
  ```

#### F. Membaca Panduan Workflow atau Berkas Resource Skill (`resource`)
```bash
almudaya skill resource <pathOrAlias> [--skill <skillId>] [--json]
```
- **Alias Cepat:** `orchestrator`, `full-cycle`, `routing`, `composition`, `archetypes`, `layout-grammar`, `implementation`, `token-contract`, `component-mapping`, `capability-matrix`, `stack-guides`, `qa`, `qa-workflow`, `release-gate`, `contract`, `handoff`, `governance`, `change-impact`, `benchmark`, `rubric`.
- **Contoh:**
  ```bash
  almudaya skill resource orchestrator
  almudaya skill resource archetypes
  almudaya skill resource benchmark/scenarios/02-almudaya-quantum-lab.md
  ```

#### G. Mengaktifkan & Mengonfigurasi Skill pada Sesi / Bot (`enable`)
```bash
almudaya skill enable [skillId] --session <sessionId> [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session target.
  - `-b, --bot <botId>` *(Opsional)*: Aktifkan khusus untuk bot tertentu (jika dikosongkan, berlaku untuk seluruh bot di dalam session).
  - `--style <styleId>`: Gaya visual utama AVDS (misal `quantum-futurism`, `swiss-international`, `geospatial-cartographic`).
  - `--secondary-styles <styles...>`: Maksimal 2 pengaruh gaya sekunder.
  - `--platform <platformId>`: Target platform (misal `web`, `android`, `windows-desktop`).
  - `--modalities <modalities...>`: Modalitas interaksi (misal `keyboard mouse-pointer`).
  - `--entry-point <ep>`: Titik masuk orkestrator (`design` | `compose` | `implement` | `audit` | `full-cycle` | `change`).
  - `--notes <text>`: Catatan batasan desain tambahan.
- **Contoh:**
  ```bash
  almudaya skill enable avds --session S002 --bot BOT001 --style quantum-futurism --platform windows-desktop --modalities keyboard mouse-pointer --entry-point full-cycle
  ```

#### H. Menonaktifkan Skill pada Sesi / Bot (`disable`)
```bash
almudaya skill disable [skillId] --session <sessionId> [--bot <botId>]
```

#### I. Memvalidasi Kontrak Desain AVDS (`validate`)
```bash
almudaya skill validate <filePath> [--type <design-contract|composition-plan|handoff-envelope>] [--json]
```
- **Contoh:**
  ```bash
  almudaya skill validate skill/almudaya-visual-design/design-contract/examples/design-contract-example.json
  almudaya skill validate skill/almudaya-visual-design/examples/mobile-academy-composition-plan.json
  ```

---

## 3. Mesin Perkakas Otonom Bot (Autonomous Agent Tools)

Setiap bot dengan AI provider aktif (`--provider gemini`, `--provider nvidia`, `--provider openrouter`, `--provider 9router`, `--provider ollama`, atau `--provider mock`) memiliki akses ke **10 perkakas inti**, **3 Worker Protocol Tools** (saat sesi `v0.3.5` aktif), serta **9 Master Protocol Tools** khusus `BOT000`:

| Nama Perkakas | Kategori | Perlu Review di Mode `REQUEST_REVIEW`? | Fungsi Utama |
|---|---|---|---|
| `query_pku_memory` | PKU Memory (RAG & Graph) | Tidak (Read-Only) | Membaca pengetahuan proyek terindeks (L0–L2) dan graf relasi sebelum membaca berkas penuh (*PKU-First Reading Policy*). |
| `read_file` | File Sandbox | Tidak (Read-Only) | Membaca isi berkas di dalam *project root* terdaftar (batas aman 10 MB). |
| `list_dir` | File Sandbox | Tidak (Read-Only) | Menjelajahi isi direktori di dalam *project root*. |
| `search_files` | File Sandbox | Tidak (Read-Only) | Mencari pola teks atau nama berkas di dalam *project root*. |
| `write_file` | File Sandbox | **Ya (Mutasi + Fencing)** | Menulis berkas secara atomik di dalam *project root*, wajib lolos `CapabilityToken` write-fencing (`PrModerator`), mencatat `work_log.jsonl`, dan memperbarui indeks PKU. |
| `edit_file` | File Sandbox | **Ya (Mutasi + Fencing)** | Mengganti blok teks eksak pada berkas, wajib lolos `CapabilityToken` write-fencing (`PrModerator`), mencatat `work_log.jsonl`, dan memperbarui indeks PKU. |
| `run_command` | Execution Controller | **Ya (Mutasi + Fencing)** | Mengeksekusi perintah shell melalui `ExecutionController` dengan redaksi kredensial dan isolasi OS. |
| `get_work_log` | Shared Memory | Tidak (Read-Only) | Membaca riwayat kerja lintas-root (`work_log.jsonl`) dari rekan bot lain. |
| `send_message` | Blackboard Messaging | Tidak | Mengirim pesan langsung secara native ke rekan bot lain di tengah siklus ReAct. |
| `use_skill` | Skill & AVDS Engine | Tidak (Read-Only) | Mengakses katalog skill, 40 profil gaya visual AVDS, 13 profil platform, 10 modalitas interaksi, panduan workflow, dan validator kontrak desain. |

### 3.1 Perkakas Protokol v0.3.5 (Worker & Master Bot `BOT000`)
- **Worker Protocol Tools (semua bot saat protokol aktif):**
  - `request_spawn_bot`: Mengajukan permintaan ke `BOT000` untuk men-spawn worker spesialis baru (dievaluasi terhadap `PrBot` dan `PrBotGlobal`).
  - `update_goal_task`: Memperbarui status (`PENDING`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `FAILED`) dan progres tugas di `GoalLedger`.
  - `submit_task_handoff`: Mengirim pesan handover akhir siklus (`PrTransfer` envelope + `CC: MASTER`) ke rekan bot, `"UNKNOWN"`, atau `"TASK_0"`.
- **Master Protocol Tools (khusus `BOT000`):**
  - `manage_dynamic_rule`, `delegate_moderator_role`, `issue_capability_token`, `spawn_worker_bot`, `pause_or_kill_bot`, `resolve_deadend_thread`, `reassign_handover_task`, `migrate_stalled_message`, `mark_goal_achieved`.

---

## 4. Arsitektur Memori Persisten Terpadu PKU (Spec v0.2)

Modul memori kanonis di [`src/memory_modules/`](file:///d:/almudaya_multiagent_v0.1.0/src/memory_modules/index.ts) menyediakan **Unified Memory Interface (`IUnifiedMemoryInterface`)** yang mengintegrasikan 7 port arsitektur:
1. **`IPKUStore` (`LocalFilesystemPKUStore` / `InMemoryPKUStore`)**: Penyimpanan objek pengetahuan kanonis (`KnowledgeObject`), relasi graf (`KnowledgeRelation`), pohon hierarkis (`KnowledgeTreeNode`), event *append-only* (`MemoryEvent`), dan *snapshot* register (`RegisterSnapshot`) dengan identitas deterministik SHA-256 dan redaksi rahasia otomatis (`PKU-001`, `PKU-002`, `PKU-008`).
2. **`IProjectMemoryUniverseService` (`PMU`)**: Isolasi ruang pengetahuan per proyek dengan 8 domain pohon standar (`Identity`, `Requirements`, `Architecture`, `Development`, `Experiments`, `Decisions`, `Tests`, `Roadmap`), pemisahan pohon dari graf sehingga pemangkasan cabang pohon tidak merusak node bersama (`PKU-014`, `PKU-015`), serta fitur *cross-project reuse* dan *fork*.
3. **`IGlobalRegisterBridge` & `IIndividualRegisterBridge`**: Sinkronisasi dan rekonstruksi deterministik **Blackboard Global Register** (`PKU-010`) dan **ACMA Individual Register** (8 domain kognitif: `working`, `semantic`, `episodic`, `procedural`, `retrieval`, `prospective`, `checkpoint`, `handoff`) dengan isolasi ketat antar-bot melalui `ScopedMemoryClient` (`PKU-009`, `PKU-011`).
4. **`IKnowledgeAwareMessagingBridge`**: Lampiran referensi pengetahuan opsional (`knowledgeRefs`, `handoffContext`, `checkpointRef`) pada pesan langsung maupun broadcast tanpa merusak kompatibilitas pesan legacy (`PKU-006`, `PKU-007`).
5. **`IKnowledgeOptimizationEngine` (`KOE`)**: Retrieval berlapis (`L0` indeks $\rightarrow$ `L1` ringkasan $\rightarrow$ `L2` konten penuh $\rightarrow$ `L3` bukti mentah) yang sadar anggaran token (`maxTokens`) dan selalu menyertakan `provenanceRefs` (`PKU-012`, `PKU-013`).
6. **`IMemoryLifecycleService`**: Pengelolaan siklus hidup memori (`active`, `dormant`, `archived`, `reusable`, `deleted`, `purged`) dengan proteksi referensi eksternal saat `purge` (`PKU-016`, `PKU-017`).
7. **`IMemoryIntegrationGateway` & `IExternalMemoryAdapter`**: Integrasi ke penyimpan eksternal dengan *capability discovery*, *circuit breaker*, dan *durable outbox* tanpa kehilangan data tersembunyi (`PKU-020`).

---

## 5. Variabel Lingkungan & Lokasi Workspace

| Variabel | Keterangan | Nilai Standar |
|---|---|---|
| `GEMINI_API_KEY` | Kunci API Google Gemini untuk mengaktifkan penalaran LLM pada bot. Disimpan murni dalam memori proses lokal (*Invariant 7*). | - |
| `NVIDIA_API_KEY` | Kunci API NVIDIA NIM (`nvapi-...`) untuk penggunaan langsung melalui `--provider nvidia` dan autentikasi *live discovery* `/v1/models` (otomatis diredaksi oleh `redactSecrets`). | - |
| `NVIDIA_BASE_URL` | Endpoint OpenAI-compatible untuk **NVIDIA NIM** langsung. | `https://integrate.api.nvidia.com/v1` |
| `OPENROUTER_API_KEY` | Kunci API OpenRouter untuk mengakses katalog model gratis maupun berbayar melalui `--provider openrouter`. | - |
| `NINEROUTER_API_KEY` | Kunci API opsional untuk router lokal **9router** jika server lokal Anda mengaktifkan autentikasi Bearer token. | - |
| `NINEROUTER_BASE_URL` | Endpoint OpenAI-compatible untuk **9router** lokal. | `http://localhost:20128/v1` |
| `OLLAMA_BASE_URL` | Endpoint OpenAI-compatible untuk **Ollama** lokal atau engine lokal kompatibel. | `http://localhost:11434/v1` |
| `OLLAMA_API_KEY` | Kunci API opsional jika instance Ollama / proxy lokal Anda dilindungi autentikasi Bearer token. | - |
| `OPENAI_API_KEY` | Kunci API opsional untuk endpoint OpenAI-compatible kustom via `--base-url`. | - |
| `ALMUDAYA_WORKSPACE` | Menentukan lokasi root folder penyimpanan Blackboard session & PKU store. | Direktori AppData sistem. |
| `ALMUDAYA_WORKSPACE_ROOT` | Alias untuk `ALMUDAYA_WORKSPACE`. | Sama dengan `ALMUDAYA_WORKSPACE`. |
