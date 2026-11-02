# Project Charter — Almudaya Multi-Agent v0.2.0

**Project:** Almudaya Multi-Agent  
**Target Version:** 0.2.0  
**Package:** `almudaya-multiagent`  
**Status:** DRAFT (Approved for Requirements Baseline)  
**Date:** 2026-11-02  

---

## 1. Visi (Vision)

Mentransformasikan fondasi kolaborasi bot Almudaya Multi-Agent menjadi **lingkungan rekayasa perangkat lunak multi-agent otonom (Autonomous AI Coding Agent Engine)**. Setiap bot dapat ditenagai oleh model AI pilihan pengembang (dimulai dengan Google Gemini), mampu memahami konteks kode di target project roots, melakukan manipulasi file, menjalankan perintah verifikasi, serta berkoordinasi secara cerdas di bawah kendali keamanan yang dapat disesuaikan (*Request Review* vs *Turbo*).

---

## 2. Sasaran (Objectives)

1. Menyediakan lapisan abstraksi **AI Multi-Provider** yang agnostik terhadap vendor LLM, memungkinkan setiap bot di dalam session yang sama ditenagai model berbeda.
2. Mengintegrasikan adapter **Google Gemini** sebagai penyedia model utama awal dengan dukungan multimodal, penalaran mendalam, dan *function calling / tool use*.
3. Menyediakan perkakas manipulasi file (*file manipulation tools*) yang aman dan terisolasi pada direktori `context root` yang sah.
4. Menyediakan mesin eksekusi perintah sistem (*command execution engine*) dengan batas waktu (*timeout*), penghentian proses menggantung, dan pemisahan stdout/stderr.
5. Mengimplementasikan dua mode eksekusi:
   - **`REQUEST_REVIEW`:** Meminta konfirmasi eksplisit dari operator sebelum aksi berkas atau perintah shell dieksekusi.
   - **`TURBO`:** Mengeksekusi aksi koding dan pengujian secara mandiri tanpa jeda konfirmasi, dengan audit logging lengkap.
6. Mempertahankan seluruh jaminan v0.1.0 (isolasi proses, non-leakage API key ke Blackboard publik, ketahanan crash).

---

## 3. Ukuran Keberhasilan (Success Measures)

1. Bot `BOT001` dapat diinisialisasi dengan provider Google Gemini menggunakan API Key lokal.
2. Bot dapat membaca struktur direktori target proyek dan menganalisa isi file sumber.
3. Bot dapat menghasilkan rencana perubahan file, meminta konfirmasi (pada mode `REQUEST_REVIEW`), dan menulis kode ke disk setelah disetujui.
4. Bot dapat beralih ke mode `TURBO` dan menjalankan perintah kompilasi/testing (`npm test`, `pytest`, dll) secara mandiri.
5. Dua bot dengan peran berbeda (misal: "Architect" dan "Coder") dapat saling bertukar instruksi di Blackboard, di mana bot "Coder" melakukan perubahan kode nyata di project root berdasarkan arahan bot "Architect".

---

## 4. Prinsip-Prinsip Desain (Design Principles)

- **Provider Agnostic:** Arsitektur antarmuka provider terpisah dari logika inti bot.
- **Credential Isolation:** API Key dan token LLM tidak boleh disimpan mentah di Blackboard publik atau di-commit ke Git.
- **Safe Sandboxing:** Bot dilarang keras memodifikasi berkas di luar `project roots` yang telah didaftarkan.
- **Human Sovereignty:** Operator manusia memegang kendali penuh melalui mode `REQUEST_REVIEW` kapan pun diperlukan.
- **Auditability:** Setiap panggilan tool, prompt input, diff perubahan file, dan output perintah dicatat secara persisten pada event log session.

---

## 5. Batasan Cakupan v0.2.0 (Scope Boundaries)

### Dalam Cakupan (In Scope):
- AI Model Provider Interface (`IAIModelProvider`).
- Google Gemini Provider Adapter (`gemini-2.5-pro`, `gemini-2.5-flash`).
- Konfigurasi model per bot (provider, model name, temperature, system instruction).
- File Tools: `read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`.
- Command Tool: `run_command` dengan timeout dan capture output.
- Execution Modes: `REQUEST_REVIEW` dan `TURBO`.
- Logging jejak penalaran (*thought traces*) dan histori aksi ke Blackboard.
- CLI flags dan interaktivitas prompt konfirmasi.

### Di Luar Cakupan (Out of Scope):
- Native GUI / Web Dashboard visual (tetap direncanakan untuk v0.3.0).
- Vector Database / Semantic RAG mandiri.
- Eksekusi terdistribusi jarak jauh (*remote distributed cloud agent*).
