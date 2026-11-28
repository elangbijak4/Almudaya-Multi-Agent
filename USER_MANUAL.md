# Almudaya Multi-Agent v0.3.7 — Technical & Command Manual

> [!NOTE]
> Dokumen ini adalah manual teknis versi aktif **`v0.3.7`**. Versi terdahulu (`user_v0.1.0/`, `user_v0.3.0/`, `user_v0.3.5/`) tetap diarsipkan utuh pada folder `USER/` (lihat `USER/README.md`). Untuk skenario pengujian siap-eksekusi berbasis Windows `cmd.exe`, lihat [**`USER_TESTING.md`**](./USER_TESTING.md).

Dokumentasi manual teknis resmi untuk executable CLI `almudaya` dan runtime multi-agent **Almudaya Multi-Agent v0.3.7**, mencakup:
- Sintaks perintah CLI lengkap (`up`/`start`/`master`, `operation`, `mcp`, `session`, `bot`, `broadcast`, `message`, `context`, `capability`, dan `skill`),
- **Engine `#Operation` (`almudaya.operation/v0.3`) & Dynamic Swarm Manifold** (`apply_operation`, `synthesize_operation`, `crystallize_operation`, Role Archetype realization $\mu_t$, `strict_distinct_bot` anti-affinity, dan worker apoptosis pada `DONE` / `TASK_0`),
- **Master Bot (`BOT000`) & 10 Protokol Atomic `IProtocol`** (*Unified Natural Lifecycle*: `PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrMasterFailover`, `PrGate`, `PrReattach`),
- **Interactive Bot & Master Console REPL** (`/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`, `/model`, `/skill`, `/mcp`, `/operation`, `/protocol`, `/blueprint`, `/rules`, `/bots`, `/spawn-mode`, `/moderator`, `/status`, `/clear`, `/help`, `/exit`),
- **Multi-Provider AI, Model Catalog, Worker Failover & Local Hardware Advisor** (`gemini`, `nvidia`, `openrouter`, `9router`, `ollama`, `mock`, `almudaya bot models`, `almudaya bot advisor`, `almudaya bot pull`, `--failover`),
- **Model Context Protocol (MCP Client & Server)** (`almudaya mcp list|add|preset|remove|test|serve` & `/mcp`),
- **Agent Capability Governance (ACG)** (`restricted`, `controlled`, `extended`, `unrestricted`) & isolasi eksekusi OS (`windows` Job Objects / `linux` namespaces),
- **PKU Unified Persistent Memory Architecture (Spec v0.2)** (Project Memory Universe, Global & Individual Registers, Incremental Codebase Indexer, `query_pku_memory`, KOE L0–L3 Retrieval, Memory Lifecycle, serta UMI & External Adapter Gateway),
- **Almudaya Visual Design Skills (AVDS v1.0.1)** (40 profil gaya visual, 13 profil platform, 10 modalitas interaksi, UI Composition Engine, Cross-Platform QA Engine, Design-to-Code Contract, dan perkakas otonom `use_skill`).

---

## 1. Konsep Perintah Global & Opsi Umum

Format umum eksekusi CLI:
```bash
almudaya <command> <subcommand> [arguments...] [options...]
```

Semua perintah dirancang fleksibel: dapat menerima **argumen posisi** (*positional arguments*) maupun **opsi berbendera** (*flags/options*). Bila tidak memakai `npm link`, ganti `almudaya` dengan `node D:\almudaya_multiagent_v0.1.0\dist\cli\bin.js`.

### Opsi Global
| Opsi | Tipe | Default | Keterangan |
|---|---|---|---|
| `-v, --version` | Flag | - | Menampilkan versi terpasang dari `almudaya-multiagent` (`0.3.7`). |
| `-h, --help` | Flag | - | Menampilkan bantuan manual perintah dan sub-perintah yang tersedia. |
| `-w, --workspace <path>` | String | Platform default | Menimpa (*override*) direktori root penyimpanan session untuk eksekusi saat ini. |
| `--json` | Flag | `false` | Menghasilkan keluaran dalam format JSON murni terstruktur (ideal untuk scripting & piping). |

---

## 2. Referensi Lengkap Sub-Perintah CLI

### 2.0 Unified HITL + Master Bot & `#Operation` (`almudaya up` / `start` / `master`)

Meluncurkan konsol interaktif Human-in-the-Loop dan **Master Bot (`BOT000`)** dalam arsitektur **Unified Natural Lifecycle** (tanpa pemisahan mode klasik vs *macro-loop*; siklus $L=1$ maupun $L>1$ serta topologi swarm agent dibentuk secara dinamis oleh **`#Operation` (`almudaya.operation/v0.3`)** dan evaluasi `GoalLedger`):

```bash
almudaya up [options...]
almudaya start [options...]
almudaya master [options...]
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
  - `--pr-bot <limit>` (default `"10"`), `--pr-bot-global <limit>` (`auto` atau angka), `--pr-iterasi <limit>` (default `"25"`), `--pr-de <limit>` (default `"10"`).
  - `--token-budget <tokens>` (default `"10000000"`), `--time-limit <ms>` (`ms` atau `"infinite"`, default `"infinite"`).
  - `--moderator <botId>`: Pemegang awal kursi arbitrase `PrModerator` (default `"BOT000"`).
  - `--no-pr-me-end`, `--no-pr-gate`, `--no-reattach`: Menonaktifkan pengaman protokol tertentu bila diperlukan.
  - `--allow-master-write`: Mengizinkan `BOT000` menulis/mengedit kode langsung meskipun ada worker aktif (default `false` — `masterStrictOrchestrator` aktif untuk mencegah `BOT000` mengintervensi file milik worker).
  - `--mcp-config <path>` / `--no-mcp`: Menentukan berkas `mcp.json` eksternal atau menonaktifkan koneksi MCP otomatis saat startup.
  - **`--operation <idOrAlias>`**: ID kanonik, alias (`#Operation-...`), atau slug `#Operation v0.3` untuk langsung dimaterialisasi saat startup.
  - **`--operation-params <jsonOrFile>`**: String JSON atau path ke berkas parameter JSON bagi `--operation`.
  - `--turbo` / `--mode <review|turbo>` / `--non-interactive`: Mengatur mode eksekusi atau menginisialisasi sesi tanpa masuk ke REPL.

---

### 2.1 Manajemen `#Operation` & Dynamic Swarm Manifold (`almudaya operation`)

Mengelola definisi **`almudaya.operation/v0.3`**, memvalidasi topologi swarm multi-agent secara statis 9 lapis, mematerialisasi `#Operation` pada sebuah sesi, mengevaluasi ekspresi predikat **OBS** (*Operation Behavioral Semantics*), dan mengkristalkan swarm ad-hoc menjadi paket `#Operation` permanen.

#### A. Daftar `#Operation` Tersedia (`list`)
```bash
almudaya operation list [-w <workspace>] [--dir <path...>] [--json]
```
Memindai katalog bawaan (`operations/`), direktori kerja sesi/workspace, serta folder `--dir` tambahan.

**7 Katalog Kanonikal Terbundel (`almudaya.operation/v0.3`):**
| Registry ID | Alias | Regime / Topologi | Role Archetypes Utama |
|---|---|---|---|
| `almudaya.operation.emergent-bug-hunt` | `#Operation-emergentBugHunt` | `emergent` / `stigmergic` | `triage_lead`, `reproducer`, `patch_crafter`, `regression_verifier`, `operator` |
| `almudaya.operation.looping` | `#Operation-looping` | `blueprint_seeded` / `hybrid` | `delivery_lead`, `developer`, `test_engineer`, `reviewer`, `operator` |
| `almudaya.operation.multi-hierarchy` | `#Operation-multiHierarchyOperation` | `blueprint_seeded` / `sub_manifold` | `operation_director`, `quality_controller`, `operator` + 3 *child sub-operations* |
| `almudaya.operation.research-branch` | - | `blueprint_seeded` / `hierarchical` | `research_lead`, `researcher`, `evidence_auditor` *(child sub-operation)* |
| `almudaya.operation.technical-assessment` | - | `blueprint_seeded` / `hierarchical` | `technical_lead`, `systems_architect`, `risk_assessor` *(child sub-operation)* |
| `almudaya.operation.integration-quality-gate` | - | `blueprint_seeded` / `pipeline` | `integration_lead`, `synthesizer`, `gate_auditor` *(child sub-operation)* |
| `almudaya.operation.research-pipeline` | `#Operation-researchPipeline` | `stage_gated` / `hybrid` | `operation_coordinator`, `research_planner`, `visualization_specialist`, `literature_specialist`, `citation_verifier`, `manuscript_writer`, `quality_refiner`, `human_researcher` |

#### B. Inspeksi Rincian `#Operation` (`inspect`)
```bash
almudaya operation inspect <idOrAlias> [-w <workspace>] [--dir <path...>] [--json]
```
Menampilkan misi objektif, `orchestration_regime`, `topology_shape`, flag `l1_single_agent_fallback`, kardinalitas tiap `RoleArchetype`, aturan `anti_affinity`, serta daftar loop OBS.

#### C. Validasi Semantik 9 Lapis (`validate`)
```bash
almudaya operation validate [idOrAlias] [-w <workspace>] [--dir <path...>] [--json]
```
Menjalankan validator statis 9 lapis terhadap seluruh katalog (atau 1 `#Operation` tertentu): integritas `operation.yaml` & `schemas/*.schema.json`, acyclic workflow DAG, `anti_affinity` pada $L=1$, pemisahan izin tulis `REVIEW_ONLY`, konsistensi `RoleArchetype` vs sumber daya bot, dan pemenuhan deliverable.

#### D. Materialisasi `#Operation` ke Sesi (`apply`)
```bash
almudaya operation apply <idOrAlias> --session <sessionId> [-p <jsonOrFile>] [-w <workspace>] [--dir <path...>] [--json]
```
Menerapkan `protocol_bindings` ke `ProtocolConfig`, men-seed `DynamicRule`, mengikat logical skills pada `SkillService`, menaburkan `GoalLedger` blueprint awal (bila `blueprint_seeded`/`stage_gated`), dan membuka instance manifold pada Blackboard.

#### E. Pemeriksaan Status Manifold Sesi (`status`)
```bash
almudaya operation status --session <sessionId> [-w <workspace>] [--json]
```
Menampilkan `#Operation` aktif, `status`, `orchestrationRegime`, `topologyShape`, peta realisasi aktif (`roleRealizationMap`: pemetaan Role Archetype $\rightarrow$ `BOTxxx`), dan riwayat binding (`botRoleBindings`).

#### F. Evaluasi Predikat OBS (`evaluate`)
```bash
almudaya operation evaluate --session <sessionId> [--metrics <jsonOrFile>] [-w <workspace>] [--json]
```
Mengevaluasi `PredicateExpr` (*Operation Behavioral Semantics*) untuk menentukan kondisi `termination`, `continuation`, `acceptance`, dan `rollback` setiap loop aktif.

#### G. Kristalisasi Swarm Ad-Hoc (`crystallize`)
```bash
almudaya operation crystallize --session <sessionId> [--id <operationId>] [--ver <version>] [--force] [-w <workspace>] [--json]
```
Membekukan instansi swarm yang aktif (misalnya hasil `synthesize_operation` *on-the-fly*) menjadi paket direktori `#Operation v0.3` lengkap (`operation.yaml`, `Operation.md`, `schemas/input.schema.json`, `schemas/output.schema.json`) di direktori `<workspace>/operations/<slug>`, otomatis tervalidasi 9 lapis.

---

### 2.2 Manajemen Session (`almudaya session`)

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
  - `-w, --workspace <path>` *(Opsional)*: Tentukan folder root workspace Blackboard.
- **Contoh Penggunaan:**
  ```bash
  almudaya session create proyek-baru --session S002
  almudaya session create "E-Commerce App" --session S001 --description "Refactoring UI & API"
  ```

#### B. Menampilkan Daftar Session (`list`)
```bash
almudaya session list [-w <workspace>] [--json]
```

#### C. Memeriksa Rincian Session (`inspect`)
```bash
almudaya session inspect [sessionId] [-s <id>] [-w <workspace>] [--json]
```

---

### 2.3 Manajemen Bot & Konsol Interaktif (`almudaya bot`)

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
  - `-w, --workspace <path>` *(Opsional)*: Lokasi workspace Blackboard.
- **Contoh:**
  ```bash
  almudaya bot join --session S002 --bot BOT001 --display-name "Architect" --role "System & UI Architect"
  almudaya bot join --session S002 --bot BOT002 --display-name "Coder" --role "Fullstack Engineer"
  ```

#### B. Menampilkan Daftar Bot dalam Session (`list`)
```bash
almudaya bot list --session <id> [-w <workspace>] [--json]
```
> [!NOTE]
> Perintah `list` secara otomatis merekonsiliasi *liveness* PID setiap bot di sistem operasi (`active` vs `stale`).

#### C. Memeriksa Detail Bot Tertentu (`inspect`) & Mengubah Nama (`rename`)
```bash
almudaya bot inspect [botIdOrName] --session <id> [-w <workspace>] [--json]
almudaya bot rename [botId] [newDisplayName] --session <id> [-w <workspace>]
```

#### D. Menjalankan Runtime Daemon Bot & Konsol REPL (`run`)
```bash
almudaya bot run --session <id> --bot <id> [options...]
```
Menjalankan proses bot dengan **Autonomous ReAct Agent Loop** dan **Interactive Bot Console REPL (`<BotName>> `)**:
- **Options:**
  - `--provider <gemini|nvidia|openrouter|9router|ollama|mock>`: Provider AI untuk bot ini (jika dikosongkan, otomatis memilih berurutan dari `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, atau `OLLAMA_BASE_URL`).
  - `--model <modelName>`: Nama model LLM spesifik (misal `gemini-2.5-flash`, `nvidia/nemotron-3.5-super-vl-120b-a12b`, `qwen2.5-coder:7b`, `deepseek/deepseek-chat-v3-0324:free`, `mycombo`).
  - `--failover <specs>`: Daftar model cadangan worker dipisahkan koma (`provider:model,...`).
  - `--base-url <url>`: Base URL OpenAI-compatible kustom (misal `http://localhost:11434/v1` untuk Ollama, `https://integrate.api.nvidia.com/v1` untuk NVIDIA NIM, atau `http://localhost:20128/v1` untuk 9router).
  - `--api-key <key>`: *(Deprecated / Tidak disarankan)* API key eksplisit via CLI; gunakan environment variable (`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `NINEROUTER_API_KEY`, `OLLAMA_API_KEY`).
  - `-m, --mode <review|turbo>`: Mode keamanan eksekusi (`review` untuk Human-in-the-Loop, `turbo` untuk otonom; default `review`).
  - `--max-iterations <count>`: Batas maksimal iterasi ReAct loop per pesan (default: `25`).
  - `--timeout <ms>`: Batas timeout permintaan AI dalam milidetik (default: `180000`).
  - `--interval <ms>`: Interval detak heartbeat dalam milidetik (default: `2000`).
  - `--mcp-config <path>` / `--no-mcp`: Memuat berkas konfigurasi `mcp.json` eksternal atau menonaktifkan koneksi MCP pada worker.
  - `--no-auto-ack`: Matikan auto-acknowledgement pesan masuk.
  - `-w, --workspace <path>`: Direktori root penyimpanan Blackboard.

- **Daftar Perintah Slash di Dalam Konsol REPL (`<BotName>> ` dan `HITL [MASTER]> `):**
  | Perintah Slash | Keterangan |
  |---|---|
  | `/msg <targetBot> <pesan>` | Mengirim pesan langsung (*direct message*) ke rekan bot lain. |
  | `/broadcast <pesan>` | Menyiarkan pengumuman broadcast ke seluruh bot di session. |
  | `/peers` | Menampilkan daftar rekan bot aktif/stale beserta PID dan perannya. |
  | `/roots` | Menampilkan daftar *project roots* terdaftar di session. |
  | `/log [limit] [root]` | Menampilkan linimasa riwayat kerja lintas-root (`work_log.jsonl`). |
  | `/mode [review\|turbo]` | Menampilkan atau mengubah mode eksekusi keamanan secara *on-the-fly*. |
  | `/model [id] [provider]` | Melihat daftar model (`ollama`, `nvidia`, `9router`, `openrouter`, `gemini`), `/model list [provider]`, cek spek hardware (`/model recommend`), unduh model Ollama (`/model pull <id>`), atau ganti model langsung saat runtime. |
  | `/skill [subcommand]` | Mengelola skill & AVDS (`list`, `styles [family]`, `platforms`, `modalities`, `enable [skillId] [style] [platform]`, `disable [skillId]`). |
  | `/mcp [subcommand]` | Mengelola server & tool MCP aktif (`list`, `tools`, `connect <nama>`, `disconnect <nama>`, `reload`). |
  | `/operation [subcommand]` | Mengelola `#Operation v0.3` & Dynamic Swarm Manifold (`list`, `status`, `inspect <id>`, `validate [id]`, `apply <id>`, `evaluate`, `crystallize [id]`). |
  | `/protocol` | Menampilkan status **10 protokol v0.3.7**, kuota `PrBot`/`PrBotGlobal`/token, dan ringkasan `GoalLedger`. |
  | `/blueprint` | Menampilkan daftar tugas `GoalLedger` blueprint yang sedang berjalan. |
  | `/rules [add\|rm] [...]` | Menambah (`[HARD_STOP\|MANDATORY\|ADVISORY]`), menonaktifkan, atau melihat **Dynamic Rules** (`rules.md`) sesi aktif. |
  | `/bots` | Menampilkan status dan model seluruh worker serta Master Bot (`BOT000`). |
  | `/spawn-mode [windows\|multiplexed]` | Mengubah mode jendela terminal worker secara langsung pada runtime. |
  | `/moderator [delegate\|reclaim]` | Melihat, mendelegasikan, atau menarik kembali kursi arbitrase `PrModerator`. |
  | `/status` | Menampilkan ringkasan status bot lokal, PID, mode, dan AI provider. |
  | `/clear` | Membersihkan layar terminal. |
  | `/help` | Menampilkan daftar perintah interaktif. |
  | `/exit`, `/quit` | Menghentikan bot dengan aman (*graceful shutdown*) dan keluar. |
  | `<instruksi teks biasa>` | Mengirim instruksi bahasa alami langsung ke penalaran ReAct AI bot lokal / Master Bot (`BOT000`). |

#### E. Menjelajahi Katalog Model AI (`models`), Hardware Advisor (`advisor`), dan Unduh Model (`pull`)
```bash
almudaya bot models [--provider <ollama|nvidia|9router|openrouter|gemini|all>] [--base-url <url>] [--no-live] [--recommend] [--json]
almudaya bot advisor [--base-url <url>] [--no-online] [--json]   # alias: almudaya bot hardware
almudaya bot pull <modelId> [--base-url <url>]
```

---

### 2.4 Komunikasi Broadcast (`almudaya broadcast`)

Publikasi dan konsumsi log event broadcast session yang bersifat *append-only* (`events.jsonl`) dengan verifikasi identitas pengirim (`AUD-10`).

```bash
almudaya broadcast publish [content] --session <id> [--bot <botId>] [--category <ACTIVITY|OBSERVATION|DECISION|TASK|ARTIFACT|QUESTION|STATUS|ALERT>] [-w <workspace>]
almudaya broadcast read --session <id> [--bot <botId>] [--category <cat>] [--limit <n>] [-w <workspace>] [--json]
```

---

### 2.5 Pesan Langsung / Direct Messaging (`almudaya message`)

Pertukaran pesan point-to-point antar-bot melalui Individual Blackboard (`inbox/<bot_id>/`) dengan state pengiriman tahan-gagal (`RECEIVED` $\rightarrow$ `PROCESSING` $\rightarrow$ `COMPLETED` / `RETRY_PENDING` / `DEAD_LETTER`), *lease expiry* (`180s`), dan *fencing token*.

```bash
almudaya message send [recipient] [content] --session <id> [--sender <botId>] [--type <DIRECT|REQUEST|RESPONSE|NOTIFICATION>] [-w <workspace>]
almudaya message read [botId] --session <id> [--mark-read | --no-mark-read] [--limit <n>] [-w <workspace>] [--json]
almudaya message ack [botId] [messageId] --session <id> [-w <workspace>]
```

---

### 2.6 Registri Konteks Bersama (`almudaya context`)

Menyimpan direktori project roots, variabel lingkungan dengan *automatic secret redaction*, dan katalog dokumen SDLC.

- **Project Roots (`root add` / `root list`):**
  ```bash
  almudaya context root add <name> <path> --session <id> [--id <rootId>] [--type <primary|dependency|reference|docs>] [-d <desc>] [-w <workspace>]
  almudaya context root list --session <id> [-w <workspace>] [--json]
  ```
- **Environment Metadata (`env set` / `env show`):**
  ```bash
  almudaya context env set --session <id> --var NODE_ENV=development API_URL=http://localhost:3000 [-w <workspace>]
  almudaya context env show --session <id> [-w <workspace>]
  ```
- **Katalog Dokumen SDLC (`doc add` / `doc list`):**
  ```bash
  almudaya context doc add --session <id> --title "AVDS Design Brief" --doc-path docs/AVDS_DESIGN_BRIEF.md --type DESIGN --status approved [-w <workspace>]
  almudaya context doc list --session <id> [-w <workspace>]
  ```

---

### 2.7 Tata Kelola Kapabilitas & Keamanan (`almudaya capability`)

Mengelola izin kapabilitas eksplisit (*Agent Capability Governance / ACG*), kebijakan *fail-closed*, 4 preset keamanan resmi, dan jejak audit keamanan (`security_audit.jsonl`).

**Empat Preset ACG Resmi (`src/capability/presets.ts`):**
- `restricted` *(default)*: zero external host access; seluruh operasi terbatas di project root terdaftar.
- `controlled`: baca berkas eksternal ter-scope; tulis berkas eksternal memerlukan persetujuan `per_action`.
- `extended`: baca/tulis workspace eksternal ber-scope `--paths`, eksekusi toolchain standar (`git`, `npm`, `tsc`, `node`), serta pemanggilan tool MCP (`mcp.invoke`).
- `unrestricted`: otoritas luas termasuk `command.arbitrary` *(hanya untuk VM/container terisolasi)*.

```bash
almudaya capability list [--session <id>] [-w <workspace>] [--json]
almudaya capability inspect <capabilityIdOrGrantId> [--session <id>] [-w <workspace>]
almudaya capability grant <capability> --session <id> [--bot <botId>] [--paths <paths...>] [--commands <cmds...>] [--mode <session|per_action|persistent>] [--duration <hours>] [-w <workspace>]
almudaya capability revoke <grantId> --session <id> [--reason <text>] [-w <workspace>]
almudaya capability reset --session <id> [-w <workspace>]
almudaya capability preset list
almudaya capability preset show <restricted|controlled|extended|unrestricted>
almudaya capability preset apply <restricted|controlled|extended|unrestricted> --session <id> [--paths <paths...>] [-w <workspace>]
almudaya capability history --session <id> [--limit <n>] [-w <workspace>]
```

---

### 2.8 Manajemen Modul Skill & AVDS v1.0.1 (`almudaya skill`)

Mengelola paket skill agen, mengeksplorasi **Almudaya Visual Design Skills (AVDS v1.0.1)** (40 gaya visual, 13 platform, 10 modalitas interaksi), mengaktifkan konfigurasi skill untuk sesi atau bot spesifik (maupun *logical skill binding* dari `#Operation`), serta memvalidasi artefak kontrak desain.

```bash
almudaya skill list [--session <sessionId>] [--bot <botId>] [-w <workspace>] [--json]
almudaya skill inspect [skillId] [--json]
almudaya skill styles [styleId] [--family <family>] [--json]
almudaya skill platforms [platformId] [--json]
almudaya skill modalities [modalityId] [--json]
almudaya skill resource <pathOrAlias> [--skill <skillId>] [--json]
almudaya skill enable [skillId] --session <sessionId> [--bot <botId>] [--style <styleId>] [--secondary-styles <styles...>] [--platform <platformId>] [--modalities <modalities...>] [--entry-point <design|compose|implement|audit|full-cycle|change>] [--notes <text>] [-w <workspace>]
almudaya skill disable [skillId] --session <sessionId> [--bot <botId>] [-w <workspace>]
almudaya skill validate <filePath> [--type <design-contract|composition-plan|handoff-envelope>] [--json]
```

---

### 2.9 Manajemen Model Context Protocol (`almudaya mcp`)

Menghubungkan bot Almudaya ke server **MCP** eksternal (`stdio`, `http`, `sse`) serta mengekspos perkakas Blackboard Almudaya sebagai **MCP Server** (`stdio` JSON-RPC 2.0):

```bash
almudaya mcp list [--session <sessionId>] [--all] [-w <workspace>] [--json]
almudaya mcp add <name> [--transport <stdio|http|sse>] [--command <cmd>] [--args <items...>] [--env <KEY=VALUE...>] [--cwd <dir>] [--url <url>] [--header <Key:Val...>] [--allowed-tools <tools...>] [--denied-tools <tools...>] [--session <sessionId>] [-w <workspace>]
almudaya mcp preset <presetId> [--name <name>] [--root <dir>] [--session <sessionId>] [-w <workspace>]
almudaya mcp remove <name> [--session <sessionId>] [-w <workspace>]
almudaya mcp test <name> [--session <sessionId>] [-w <workspace>] [--json]
almudaya mcp serve [--session <sessionId>] [-w <workspace>]
```

---

## 3. Mesin Perkakas Otonom Bot (Autonomous Agent Tools)

Setiap bot dengan AI provider aktif (`gemini`, `nvidia`, `openrouter`, `9router`, `ollama`, `mock`) memiliki akses ke **10 perkakas inti**, perkakas server MCP eksternal (bila aktif), **3 Worker Protocol Tools**, serta **13 Master Protocol Tools** khusus `BOT000`:

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

### 3.1 Perkakas Protokol v0.3.7 (Worker & Master Bot `BOT000`)
- **Worker Protocol Tools (`3` tool — seluruh bot saat protokol aktif):**
  - `request_spawn_bot`: Mengajukan permintaan ke `BOT000` untuk men-spawn worker spesialis baru (dievaluasi terhadap `PrBot` dan `PrBotGlobal`).
  - `update_goal_task`: Memperbarui status (`PENDING`, `IN_PROGRESS`, `HANDOVER_WAIT`, `PEER_REVIEW`, `REVISION`, `DONE`, `BLOCKED_HITL`, `CANCELLED`), langkah progres, dan `verification_evidence` di `GoalLedger`; status `DONE` memicu pengaitan siklus apoptosis `#Operation` bila terpenuhi.
  - `submit_task_handoff`: Mengirim pesan handover akhir siklus (`PrTransfer` envelope + `CC: MASTER`) ke rekan bot, `"UNKNOWN"`, atau `"TASK_0"` (memicu *worker apoptosis* dan pelepasan binding `roleRealizationMap`).
- **Master Protocol Tools (`13` tool — khusus `BOT000` / `MASTER`):**
  1. `create_goal_blueprint`: Menginisialisasi/memperbarui tugas `GoalLedger` beserta `assigned_bot_id`, `role_hint`, `target_files`, dan `acceptance_criteria`.
  2. `manage_dynamic_rule`: Menambah (`ADVISORY`/`MANDATORY`/`HARD_STOP`), menonaktifkan, atau membaca **Dynamic Rules** sesi aktif.
  3. `delegate_moderator_role`: Mendelegasikan atau menarik kembali kursi arbitrase `PrModerator`.
  4. `issue_capability_token`: Menerbitkan (`EXCLUSIVE_WRITE`, `SHARED_READ`, `REVIEW_ONLY`) atau mencabut `CapabilityToken` ber-fencing `PrModerator` dengan penjagaan non-wildcard default (`allow_wildcard_scope`) dan larangan `allow_master_write` saat worker aktif.
  5. `spawn_worker_bot`: Men-spawn worker baru (dengan parameter `role_archetype` opsional untuk mengikat ke `RoleArchetype` `#Operation` aktif, penegakan `cardinality.max`, `anti_affinity: strict_distinct_bot`, dan pewarisan path token).
  6. `pause_or_kill_bot`: Menjeda (`pause`), mengaktifkan (`resume`), menghentikan (`stop`), atau mendaur ulang (`recycle`) bot worker.
  7. `resolve_deadend_thread`: Memberi putusan Master pada eskalasi `PrDE`.
  8. `reassign_handover_task`: Mengalihkan tugas macet/melewati batas `PrIterasi` lewat `PrTransfer` + pemulihan checkpoint.
  9. `migrate_stalled_message`: Mengarahkan ulang pesan buntu `PrMEend` ke bot yang kompeten.
  10. `mark_goal_achieved`: Menjalankan gerbang verifikasi objektif `PrGate` terhadap seluruh `GoalLedger` tasks dan berkas fisik di disk sebelum menutup *macro-loop*.
  11. `apply_operation`: Memilih & mematerialisasi `#Operation v0.3` terdaftar secara *on-the-fly*.
  12. `synthesize_operation`: Menyintesis `#Operation v0.3` ad-hoc baru secara *on-the-fly* saat belum ada `#Operation` terbundel yang cocok.
  13. `crystallize_operation`: Membekukan manifold `#Operation` aktif menjadi paket tervalidasi permanen di workspace.

---

## 4. Arsitektur Memori Persisten Terpadu PKU (Spec v0.2)

Modul memori kanonis di [`src/memory_modules/`](./src/memory_modules/index.ts) menyediakan **Unified Memory Interface (`IUnifiedMemoryInterface`)** yang mengintegrasikan 7 port arsitektur:
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

> [!TIP]
> Pada **Windows Command Prompt (`cmd.exe`)**, set variabel lingkungan tanpa tanda kutip di dalam nilai dengan format:
> `set "GEMINI_API_KEY=AIza..."` atau `set "NVIDIA_API_KEY=nvapi-..."` (jangan tulis `set KEY="val"`, karena `cmd.exe` akan menyertakan karakter `"` ke dalam isi kunci API).
