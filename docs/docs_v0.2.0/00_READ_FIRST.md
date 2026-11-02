# Almudaya Multi-Agent v0.2.0 — Read First

Selamat datang di siklus pengembangan **Almudaya Multi-Agent Versi 0.2.0 (The AI Agent & Autonomous Coding Layer)**.

Dokumen ini adalah titik masuk utama untuk seluruh spesifikasi, rancangan arsitektur, rencana implementasi, dan pengujian versi 0.2.0.

---

## 1. Latar Belakang & Kelanjutan dari v0.1.0

Pada versi **v0.1.0**, Almudaya Multi-Agent telah berhasil menuntaskan fondasi infrastruktur:
- Session Blackboard persisten dengan penulisan atomik dan penguncian *kernel-atomic*.
- Proses bot mandiri yang terisolasi (*true OS process isolation*).
- Komunikasi broadcast dan pesan langsung antar-bot dengan *idempotent acknowledgement*.
- Registri konteks proyek bersama (*project roots*, *environment metadata* dengan *secret redaction*, dan *SDLC documents*).

Pada versi **v0.2.0**, bot-bot ini akan diberikan **otak kecerdasan buatan (AI Models)** dan **alat eksekusi coding mandiri (Coding Tools & System Execution Engine)** sehingga mereka dapat membaca, menganalisa, mengubah kode program di direktori proyek target, serta menjalankan perintah sistem di bawah mode kendali keamanan yang dapat dipilih oleh operator (*Request Review* vs *Turbo*).

---

## 2. Sasaran Utama v0.2.0

1. **Arsitektur AI Multi-Provider:**
   - Setiap bot dapat memilih provider AI yang berbeda secara independen (`gemini`, `openai`, `anthropic`, `ollama`).
   - Pilot implementasi pertama menggunakan **Google Gemini** (Gemini 2.5 Pro / Flash).
2. **Koding Langsung pada Project Root:**
   - Bot memiliki sekumpulan perkakas (*tools*): `read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`.
   - Seluruh operasi dibatasi secara ketat (*sandboxed*) hanya pada path direktori yang telah didaftarkan di `almudaya context root`.
3. **Eksekusi Perintah Sistem (System Command Execution):**
   - Bot dapat menjalankan perintah pengujian, kompilasi, atau utilitas proyek (misal: `npm test`, `git status`, `python main.py`).
4. **Mode Keamanan Fleksibel:**
   - **Mode `REQUEST_REVIEW` (Default / Human-in-the-Loop):** Setiap perubahan file atau perintah sistem harus mendapatkan persetujuan operator manusia terlebih dahulu sebelum dieksekusi.
   - **Mode `TURBO` (Autonomous Mode):** Bot mengeksekusi aksi koding dan perintah yang diizinkan secara mandiri dan cepat, sambil tetap mencatat jejak audit lengkap ke Session Blackboard.

---

## 3. Disiplin Waterfall Lifecycle

Sama seperti v0.1.0, versi 0.2.0 wajib mengikuti fase terstruktur:
1. **Requirements Analysis** (`02_REQUIREMENTS/`)
2. **System Analysis & Data Flows** (`03_ANALYSIS/`)
3. **System Design & ADRs** (`04_DESIGN/`)
4. **Implementation Planning** (`05_IMPLEMENTATION/`)
5. **Implementation** (`src/`)
6. **Verification & Testing** (`06_TESTING/`)
7. **Release Preparation** (`07_RELEASE/`)
8. **Project Closure** (`10_PHASE_GATES/`)

Seluruh fase harus diverifikasi melalui dokumen Phase Gate dan disetujui sebelum beralih ke fase berikutnya.
