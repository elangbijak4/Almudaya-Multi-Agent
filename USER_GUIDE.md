# Almudaya Multi-Agent v0.3.3 — User & Operator Guide

Panduan konseptual, arsitektural, dan operasional komprehensif untuk pengembang, arsitek sistem, desainer produk, dan operator yang mengelola ekosistem kolaborasi multi-agent otonom **Almudaya Multi-Agent (`almudaya-multiagent` v0.3.3)**.

---

## 1. Filosofi & Arsitektur Sistem Terpadu

Almudaya mengadopsi arsitektur **Session-Centric**, **Multi-Process**, **Persistent Blackboard**, **PKU Unified Persistent Memory (Spec v0.2)**, **Agent Capability Governance (ACG)**, dan **Almudaya Visual Design Skills (AVDS v1.0.1)**.

```text
                       ┌───────────────────────────────────────────────────────┐
                       │         Session Blackboard & PKU Memory Store         │
                       │       (sessions/<session_id>/ & pku/universes/)       │
                       │                                                       │
                       │  ┌─────────────────────────────────────────────────┐  │
                       │  │ Global Register (Blackboard)                    │  │
                       │  │ - bots.json, events.jsonl, context.json         │  │
                       │  │ - work_log.jsonl, skills.json                   │  │
                       │  ├─────────────────────────────────────────────────┤  │
                       │  │ Individual Register (Inbox & ACMA 8 Domains)    │  │
                       │  │ - inbox/<bot_id>/messages.json & cursors.json   │  │
                       │  │ - working, semantic, episodic, procedural, ...  │  │
                       │  ├─────────────────────────────────────────────────┤  │
                       │  │ Project Memory Universe (PMU) & KOE (L0-L3)     │  │
                       │  │ - 8-Domain Knowledge Tree + Knowledge Graph     │  │
                       │  └─────────────────────────────────────────────────┘  │
                       └──────────────────────────▲────────────────────────────┘
                                                  │
                        ┌─────────────────────────┴─────────────────────────┐
                        │                                                   │
           ┌────────────┴─────────────┐                        ┌────────────┴─────────────┐
           │  Bot Process 1 (Node.js) │                        │  Bot Process 2 (Node.js) │
           │  - Bot ID: BOT001        │                        │  - Bot ID: BOT002        │
           │  - Display: "Architect"  │                        │  - Display: "Coder"      │
           │  - Console REPL Active   │                        │  - Console REPL Active   │
           │  - Skill: AVDS v1.0.1    │                        │  - Skill: AVDS v1.0.1    │
           └────────────┬─────────────┘                        └────────────┬─────────────┘
                        │                                                   │
                        └─────────────────────────┬─────────────────────────┘
                                                  │
                                                  ▼
                       ┌───────────────────────────────────────────────────────┐
                       │    Target Project Roots & AVDS Design Contracts       │
                       │  - File Tools: read_file, write_file, edit_file       │
                       │  - ExecutionController: run_command (ACG + OS JobObj) │
                       │  - Collaboration & Memory: send_message,              │
                       │    get_work_log, query_pku_memory                     │
                       │  - Skill Engine Tool: use_skill (AVDS v1.0.1)         │
                       └───────────────────────────────────────────────────────┘
```

### Enam Pilar Arsitektur Almudaya v0.3.3:
1. **Session Boundary & Multi-Root Orchestration:** Setiap sesi kolaborasi mengisolasi state dan dapat mengelola banyak direktori proyek (*project roots* seperti `backend`, `frontend`, `mobile`, `docs`) secara simultan dengan pelacakan lokasi presisi di `work_log.jsonl`.
2. **Process Isolation & Interactive Bot Console REPL:** Setiap bot berjalan di proses OS independen dengan konsol interaktif *non-blocking* (`<BotName>> `) yang mendukung perintah slash (`/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`, `/model`, `/skill`, `/status`) dan instruksi bahasa alami.
3. **Blackboard Durability & Lease/Fencing Delivery:** Pengiriman pesan dilindungi oleh *atomic write*, *cooperative lock* dengan *fencing token* monotonik, serta *inbox delivery state machine* (`PENDING` $\rightarrow$ `PROCESSING` $\rightarrow$ `ACKED` / `FAILED` / `DEAD_LETTER`).
4. **Agent Capability Governance (ACG) & Defense-in-Depth:** Eksekusi perintah eksternal dikendalikan oleh kebijakan *fail-closed*, *prompt-injection boundary delimiters* (`<<<UNTRUSTED_*>>>`), sanitasi *environment variables*, serta *automatic secret redaction*.
5. **PKU Unified Persistent Memory & PKU-First Policy (Spec v0.2):** Menyatukan memori operasional Blackboard, memori kognitif individual bot (ACMA), dan **Incremental Codebase Indexer** ke dalam penyimpanan pengetahuan jangka panjang yang deterministik, terisolasi per proyek (*PMU*), hemat token via *Knowledge Optimization Engine* (`KOE` L0–L3), penangkapan memori otomatis *fail-open*, serta kewajiban **PKU-First Reading** (`query_pku_memory`) sebelum membaca berkas penuh (`PKU-001` s/d `PKU-020`).
6. **Almudaya Visual Design Skills (AVDS v1.0.1):** Kerangka kerja desain dan rekayasa UI/UX adaptif lintas-platform yang memisahkan **Identitas Visual (40 gaya)**, **Konvensi Platform (13 platform)**, dan **Modalitas Interaksi (10 modalitas)** agar agen AI menghasilkan antarmuka yang khas, kontekstual, dan bebas dari jebakan desain generik.

---

## 2. Pemisahan Empat Wilayah Direktori

```text
┌─────────────────────────────────────────────┐
│ 1. Engine Almudaya (Source Code)            │ -> D:\almudaya_multiagent_v0.1.0\src\
├─────────────────────────────────────────────┤
│ 2. Modul Skill & AVDS v1.0.1                │ -> D:\almudaya_multiagent_v0.1.0\skill\almudaya-visual-design\
├─────────────────────────────────────────────┤
│ 3. Session Blackboard & PKU Store (Runtime) │ -> %LOCALAPPDATA%\almudaya\ (atau --workspace)
├─────────────────────────────────────────────┤
│ 4. Target Proyek yang Digarap Agen          │ -> D:\Projects\AplikasiAnda\ (via context root add)
└─────────────────────────────────────────────┘
```

---

## 3. Arsitektur Memori Persisten Terpadu (PKU Spec v0.2)

### 3.1 Dua Register Memori yang Saling Terhubung
1. **Global Register (Blackboard Integration):**
   - Menangkap fakta tingkat sesi/proyek: metadata sesi, registri bot, project roots, dokumen SDLC, *broadcast events*, dan *work log*.
   - Menyaring *heartbeat churn* (perubahan `last_seen_at` murni tidak membanjiri log pengetahuan PKU).
   - Dapat direkonstruksi secara deterministik dari PKU melalui `reconstructGlobalRegister(sessionId)` (`PKU-010`).
2. **Individual Register (ACMA 8 Cognitive Domains):**
   - Mengelola memori privat per-bot dalam 8 domain kognitif:
     - `working`: konteks aktif tugas yang sedang berjalan.
     - `semantic`: aturan domain dan fakta yang dipelajari bot.
     - `episodic`: riwayat pengalaman dan eksekusi masa lalu.
     - `procedural`: pola langkah kerja dan *skill* teknis.
     - `retrieval`: indeks referensi cepat.
     - `prospective`: rencana tindakan atau pengingat masa depan.
     - `checkpoint`: titik pemulihan iterasi ReAct (`CheckpointDescriptor`).
     - `handoff`: serah-terima tugas terstruktur antar-bot (`HandoffContext`).
   - Dilindungi oleh **`ScopedMemoryClient`**: Bot B dilarang keras membaca memori privat (`scope: 'agent'`) milik Bot A kecuali Bot A membagikannya secara eksplisit di dalam `sharedKnowledgeIds` pada saat *handoff* (`PKU-009`, `PKU-011`).

### 3.2 Project Memory Universe (PMU) & Pemisahan Pohon vs. Graf
- Setiap proyek memiliki **PMU** terisolasi (`PKU-014`) dengan 8 domain pohon hierarkis standar (`Identity`, `Requirements`, `Architecture`, `Development`, `Experiments`, `Decisions`, `Tests`, `Roadmap`).
- **Invarian Pemisahan Pohon dari Graf (`PKU-015`)**: Struktur pohon hanya mengatur penempatan navigasi hierarkis, sedangkan objek pengetahuan (`KnowledgeObject`) dan relasi semantik (`KnowledgeRelation`) disimpan secara independen. Memangkas (*prune*) cabang pohon **tidak pernah** merusak atau menghapus objek pengetahuan bersama yang masih dirujuk oleh cabang lain.

### 3.3 Knowledge Optimization Engine (KOE — Retrieval L0 s/d L3)
Agar jendela konteks (*context window*) LLM tetap efisien dan hemat biaya token:
- **Level `L0` (Index)**: Hanya memuat ID, judul, tipe, dan path domain (~15–25 token per item).
- **Level `L1` (Digest)**: Memuat ringkasan padat dan metadata validasi (~40–80 token per item).
- **Level `L2` (Full Object)**: Memuat isi objek pengetahuan terstruktur beserta relasinya.
- **Level `L3` (Raw Evidence)**: Memuat jejak bukti mentah dan *provenance* lengkap (`PKU-012`, `PKU-013`).

### 3.4 Kebijakan PKU-First Reading & Incremental Codebase Indexing
Untuk menjaga efisiensi token dan akurasi audit lintas-bot:
1. **Standardized PKU-First Reading Policy**: Setiap bot yang berjalan melalui `AutonomousAgentLoop` diinstruksikan secara default untuk memanggil perkakas **`query_pku_memory`** (RAG/Knowledge Graph PKU) terlebih dahulu saat mengaudit atau menelusuri kode, kecuali jika user secara eksplisit meminta pembacaan berkas penuh.
2. **Incremental Single-File Re-Indexing**: `ProjectCodebaseIndexer` mengindeks *project root* ke dalam objek L0/L1/L2 dan relasi graf. Setiap kali `write_file` atau `edit_file` mengubah suatu berkas, sistem hanya memperbarui indeks milik berkas yang berubah tersebut—tanpa mengindeks ulang seluruh repositori.
3. **Automatic Fail-Open PKU Capture**: `SessionService`, `BotRuntime`, dan `AutonomousAgentLoop` secara otomatis menangkap konteks sesi, pesan, dan hasil giliran (*turn*) ke PKU Store secara *fail-open* (jika store tidak tersedia, eksekusi bot tidak terhenti).

---

## 4. Almudaya Visual Design Skills (AVDS v1.0.1)

### 4.1 Mengapa AVDS Dibutuhkan oleh Agen Koding?
Tanpa panduan desain terstruktur, model AI cenderung menghasilkan tampilan web generik yang seragam (sidebar kiri + kartu bulat + gradien biru-ungu) atau memaksakan tata letak web ke aplikasi mobile, desktop, maupun perangkat *embedded*.

**AVDS v1.0.1** mengatasi masalah ini melalui **Pemisahan 3 Dimensi Independen**:
1. **Visual Identity (`styles/` — 40 Profil Gaya Visual)**:
   - *Minimalist*: `swiss-international`, `scandinavian`, `japanese-zen`, `monochromatic`, `functionalist`.
   - *Futuristic*: `cyberpunk`, `sci-fi-holographic`, `terminal-hacker`, `quantum-futurism`, `space-exploration`.
   - *Premium*: `glassmorphism`, `neumorphism`, `luxury-minimal`, `gradient-mesh`, `architectural`.
   - *Editorial*: `editorial-magazine`, `neo-brutalist`, `experimental-typography`, `asymmetric-art`, `retro-editorial`.
   - *Organic*: `organic-nature`, `earthy-minimal`, `biophilic`, `botanical`, `eco-tech`.
   - *Corporate*: `corporate-modern`, `academic-institutional`, `fintech-professional`, `civic-digital`, `data-intelligence`.
   - *Playful*: `playful-contemporary`, `pastel-soft`, `memphis-design`, `retro-digital`, `three-dimensional-contemporary`.
   - *Specialized*: `scientific-visualization`, `geospatial-cartographic`, `cybersecurity-operations`, `generative-art`, `digital-laboratory`.
2. **Platform Profile (`platform-design/` — 13 Platform Target)**:
   - `web`, `windows-desktop`, `macos-desktop`, `linux-desktop`, `android`, `ios`, `tablet`, `tv`, `wearable`, `automotive`, `industrial-hmi`, `spatial-xr`, `voice-conversational`.
3. **Interaction Modality (`interaction-design/` — 10 Modalitas Interaksi)**:
   - `mouse-pointer`, `keyboard`, `touch`, `stylus`, `voice`, `gesture`, `gaze-spatial`, `remote-dpad`, `haptic`, `multimodal`.

### 4.2 Siklus Hidup Penuh AVDS (`Unified Orchestrator v1.0.0`)
```text
Intake ➔ Design Brief ➔ Style & Platform Resolution ➔ Composition Plan & Component Tree
       ➔ Design Contract Validation ➔ Implementation Handoff ➔ Evidence-Based QA ➔ Delivery
```
Setiap perpindahan fase antar-bot (misal dari bot *UI Architect* ke bot *Frontend Engineer* lalu ke bot *QA Auditor*) diikat oleh **Design-to-Code Contract (`design-contract.schema.json`)** dan **Agent Handoff Envelope (`handoff-envelope.schema.json`)** yang dapat divalidasi langsung menggunakan perintah:
```bash
almudaya skill validate <path-ke-kontrak.json>
```

### 4.3 Cara Bot Menggunakan AVDS secara Otonom
1. Operator dapat mengaktifkan konfigurasi AVDS untuk sesi atau bot tertentu melalui CLI:
   ```bash
   almudaya skill enable avds --session S001 --bot BOT001 --style quantum-futurism --platform windows-desktop --modalities keyboard mouse-pointer --entry-point full-cycle
   ```
   atau langsung dari dalam konsol REPL bot:
   ```text
   Architect> /skill enable avds quantum-futurism windows-desktop
   ```
2. Ketika bot memproses pesan tugas, `AutonomousAgentLoop` secara otomatis menyuntikkan konfigurasi skill aktif ke dalam System Prompt bot dan menyediakan perkakas otonom **`use_skill`**.
3. Bot dapat memanggil `use_skill` kapan saja untuk mengambil spesifikasi YAML gaya visual, aturan adaptasi platform, tata bahasa komposisi (`LAYOUT_GRAMMAR.md`), maupun protokol audit QA (`ACCESSIBILITY_AUDIT_PROTOCOL.md`).

---

## 5. Dukungan Multi-Provider AI (Gemini, OpenRouter, 9router) & `/model`

Almudaya v0.3.3 mendukung pemilihan model AI secara fleksibel tanpa bergantung pada satu penyedia atau model lokal berukuran besar:

1. **9router (`--provider 9router`, default `http://localhost:20128/v1`):**
   - Menghubungkan bot ke router lokal/pribadi yang menampung beragam model (termasuk model gratis atau *combo routing* seperti `mycombo`).
   - Dapat mendeteksi model aktif secara dinamis dari endpoint `/v1/models` melalui `almudaya bot models --provider 9router`.
   - Jika 9router Anda memerlukan autentikasi, set `$env:NINEROUTER_API_KEY` di memori proses lokal sebelum menjalankan bot.
2. **OpenRouter (`--provider openrouter`, default `https://openrouter.ai/api/v1`):**
   - Menyediakan katalog model gratis dan berbayar (seperti `deepseek/deepseek-chat-v3-0324:free`, `qwen/qwen3-coder:free`, dan lainnya) menggunakan `$env:OPENROUTER_API_KEY`.
3. **Google Gemini (`--provider gemini`) & Mock (`--provider mock`):**
   - Menggunakan `$env:GEMINI_API_KEY` (default `gemini-2.5-flash`) dengan adaptive 429 retry latch.
4. **Pergantian Model Saat Runtime (`/model`):**
   - Di dalam konsol REPL bot, operator dapat mengetik `/model` untuk melihat daftar model gabungan (live 9router + preset OpenRouter + Gemini), lalu berpindah model secara langsung tanpa me-restart proses bot:
     ```text
     Architect> /model mycombo 9router
     Architect> /model qwen/qwen3-coder:free openrouter
     ```
