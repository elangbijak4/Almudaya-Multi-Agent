# Almudaya Multi-Agent v0.3.0 — Read First

Selamat datang di siklus pengembangan **Almudaya Multi-Agent Versi 0.3.0 (The Interactive Bot Console & Cross-Root Orchestration Engine)**.

Dokumen ini adalah titik masuk utama untuk seluruh spesifikasi kebutuhan, rancangan arsitektur, perencanaan implementasi, dan pengujian versi 0.3.0.

---

## 1. Latar Belakang & Motivasi Rilis v0.3.0

Pada versi **v0.2.0**, Almudaya telah berhasil mewujudkan mesin koding AI otonom (*Autonomous AI Coding Agent Engine*) dengan pilot Google Gemini, sandboxing ketat, perkakas berkas atomik, eksekusi shell, serta mode keamanan *Request Review* vs *Turbo*.

Namun, hasil pengujian operasional nyata mengungkap dua kebutuhan fundamental:
1. **Pengalaman Pengguna (UX) Terminal Mandiri (*Single Terminal All-in-One Console*):**
   Saat menjalankan bot di satu terminal (`almudaya bot run`), terminal tersebut membeku dalam loop polling pasif. Operator yang ingin menyapa bot atau mengirim instruksi terpaksa membuka jendela terminal ke-3 atau ke-4. Dibutuhkan antarmuka konsol interaktif (REPL) di mana terminal bot itu sendiri menjadi panel kendali lengkap yang dapat menerima perintah operator, mengirim pesan ke bot lain, dan menyapa bot lokal secara langsung tanpa terminal tambahan.
2. **Memori Kerja Bersama Antar-Root (*Cross-Root Session Work Log*):**
   Dalam proyek perangkat lunak modern yang memiliki lebih dari satu folder kerja (misal: folder `frontend`, folder `backend`, folder `docs`), para bot memerlukan catatan kerja terpadu (*shared working memory*) yang mencatat: *siapa yang bekerja, di root mana, file apa yang diubah, perintah apa yang dijalankan, dan pada timestamp berapa*. Memori ini dapat dibaca oleh seluruh bot untuk mewujudkan orkestrasi koding lintas-folder tanpa tabrakan kerja (*redundancy*).

---

## 2. Sasaran Utama v0.3.0

1. **Konsol Interaktif Bot All-in-One (Interactive REPL Shell):**
   - Terminal bot tidak lagi beku; menyediakan prompt interaktif langsung (misal: `Architect> ` atau `Coder> `).
   - Mendukung perintah instan: `/msg <bot> <pesan>`, `/broadcast <pesan>`, `/peers`, `/roots`, `/log`, `/mode <review|turbo>`, `/help`, `/exit`.
   - Menerima teks bahasa alami langsung untuk memerintahkan bot lokal menjalankan ReAct loop secara interaktif.
   - Penataan rendering non-destruktif: notifikasi pesan masuk dicetak rapi di atas prompt tanpa merusak ketikan operator.
2. **Memori Kerja Bersama Berbasis Lokasi (*Location-Aware Session Work Log*):**
   - Berkas persisten `sessions/<sessionId>/work_log.jsonl` di Blackboard Session.
   - Setiap mutasi berkas (`write_file`, `edit_file`) dan eksekusi perintah shell (`run_command`) otomatis mencatat detail lokasi presisi (`root_id`, `root_name`, `relative_path`, `action`, `summary`, `timestamp`).
   - Injeksi otomatis riwayat kerja sesi terkini ke dalam System Prompt AI.
   - Perkakas baru untuk AI (`get_work_log`) agar bot dapat menelaah riwayat pekerjaan rekan-rekannya sebelum bertindak.

---

## 3. Disiplin Waterfall Lifecycle v0.3.0

Pengembangan versi 0.3.0 mengikuti disiplin Waterfall SDLC yang ketat:
- **Phase 1: Requirements Specification & Project Charter** (`02_REQUIREMENTS/`, `01_PROJECT_CHARTER.md`)
- **Phase 2: System Analysis & Architecture Design (ADRs)** (`03_ANALYSIS/`, `04_DESIGN/`)
- **Phase 3: Shared Session Work Memory Engine** (`src/shared/work-log.ts`)
- **Phase 4: Interactive Bot Console REPL** (`src/bot/console.ts`)
- **Phase 5: ReAct Loop Integration & Context Prompt Injection** (`src/ai/prompts.ts`, `src/bot/agent-loop.ts`)
- **Phase 6: End-to-End Verification Benchmark** (`tests/e2e/`)
- **Phase 7: Release Preparation & Closure** (`07_RELEASE/`, manual, guide, tutorial, version bump)
