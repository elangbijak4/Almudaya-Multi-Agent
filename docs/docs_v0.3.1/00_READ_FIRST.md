# Latar Belakang & Panduan Awal — Almudaya Multi-Agent v0.3.1

**Paket:** `almudaya-multiagent`  
**Versi Target:** v0.3.1 (*Security, Concurrency & Reliability Patch*)  
**Tanggal:** 2026-11-06  
**Status:** In Progress (Waterfall Phase 1)  

---

## 1. Konteks & Latar Belakang

Pada rilis v0.3.0, Almudaya Multi-Agent berhasil menghadirkan dua inovasi arsitektur besar:
1. **Interactive Bot Console REPL:** Pengalaman konsol interaktif mandiri non-blocking dengan kendali slash command (`/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`, `/status`, `/exit`) dan instruksi langsung via bahasa alami.
2. **Cross-Root Shared Work Memory:** Perekaman aktivitas kerja koding otomatis ke `work_log.jsonl` dengan koordinat root presisi, injeksi linimasa ke System Prompt, dan perkakas ReAct `get_work_log`.

Keberhasilan v0.3.0 telah diuji secara nyata dan mendalam melalui dua pengujian komprehensif:
- [`TESTING.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING.md): Pengujian fungsional 216 kasus (179 test suite + CLI + REPL + Sandbox) dengan hasil 100% PASS.
- [`TESTING2.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING2.md): Orkestrasi end-to-end dua bot otonom (Architect & Coder) menggunakan model **Google Gemini asli** (`gemini-2.5-flash`), yang berhasil membangun aplikasi web portofolio *Almudaya Quantum Labs* lengkap dengan server Python stdlib, CSS responsif, validasi `py_compile`, hingga HTTP server berjalan dan melayani `200 OK` (skor konten 8/8 PASS) **tanpa manusia menulis kode**.

Namun, evaluasi mendalam pada [`AUDIT.md`](file:///d:/almudaya_multiagent_v0.1.0/AUDIT.md), [`TESTING.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING.md), dan [`TESTING2.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING2.md) menemukan beberapa kerentanan keamanan dan kesenjangan reliabilitas kritis (*Priority 0*) yang harus segera diselesaikan sebelum melangkah ke penambahan fitur besar v0.4.0.

---

## 2. Masalah Kritis yang Dituntaskan di v0.3.1

Rilis v0.3.1 didedikasikan secara khusus sebagai **Security, Concurrency & Reliability Patch** untuk menuntaskan temuan P0 berikut:

1. **SEC-01 (Eksfiltrasi Lingkungan & Kredensial via `run_command`):**
   Subprocess shell saat ini mewarisi seluruh `process.env`, sehingga token rahasia seperti `GEMINI_API_KEY` berisiko bocor melalui output perintah shell dan tercatat permanen di `work_log.jsonl`.
2. **§14/6 (Kebocoran Sandbox via Symlink & Windows Junction):**
   Pengecekan batasan root saat ini hanya berbasis path leksikal (`path.resolve`), sehingga tautan symlink atau Windows Junction (`mklink /J`) di dalam root yang mengarah ke luar root dapat membocorkan berkas sistem di luar sandbox.
3. **RELIA-01 & NT-05 / NT-06 (Reliabilitas Pesan & Penanganan Kuota 429 yang Elegan):**
   - Pesan inbox ditandai *read* sebelum pemrosesan ReAct turn selesai. Jika terjadi kegagalan/crash, pesan hilang tanpa ada mekanisme *re-queue* atau pengulangan (*at-least-once delivery*).
   - Pada Gemini Free-Tier (5 RPM), server mengembalikan HTTP 429 `RESOURCE_EXHAUSTED` disertai jeda `retryDelay` (~39 detik). Namun retry provider hanya melakukan jeda ~2 detik dan langsung menyerah dengan melempar error koneksi. Hal ini membuat operator panik karena menyangka koneksi jaringan terputus, padahal ini adalah jeda tarif kuota standar.
4. **CONC-02 (Race Condition Kursor Broadcast & Filter Loss):**
   Penyimpanan kursor broadcast tidak berada di bawah sesi lock dan pemfilteran dilakukan setelah kursor dimajukan, berisiko menghilangkan event yang terfilter secara permanen pada pemanggilan berikutnya.
5. **NT-01 & §16/1 (Penyempurnaan CLI & Dokumentasi):**
   Memperbaiki opsi CLI `--no-mark-read` yang ditolak oleh Commander dan menyinkronkan dokumentasi kategori broadcast dengan skema Zod.

---

## 3. Peta Dokumen Dokumentasi v0.3.1

Dokumentasi rilis v0.3.1 diorganisasikan ke dalam direktori `docs/docs_v0.3.1/` dengan struktur:
- `00_READ_FIRST.md`: Latar belakang dan pengantar patch keamanan & stabilitas (dokumen ini).
- `01_PROJECT_CHARTER.md`: Piagam proyek, visi, tujuan, kriteria sukses, dan batasan rilis v0.3.1.
- `02_REQUIREMENTS/`:
  - `SRS.md`: Spesifikasi kebutuhan perangkat lunak (FR-319 s/d FR-326, NFR-306 s/d NFR-309).
  - `USE_CASES.md`: Kasus penggunaan keamanan dan skenario penanganan jeda kuota (UC-307 s/d UC-311).
  - `REQUIREMENT_TRACEABILITY.md`: Matriks keterlacakan kebutuhan dari audit ke desain, implementasi, dan pengujian.
- `09_CHANGE_CONTROL/`:
  - `CHANGE_LOG.md`: Catatan perubahan baseline dari v0.3.0 ke v0.3.1.
- `10_PHASE_GATES/`:
  - `PHASE_STATUS.md`: Status pelacakan gerbang fase Waterfall 1 s/d 7.
  - `PHASE_1_REQUIREMENTS_GATE.md`: Dokumen verifikasi persetujuan gerbang Fase 1.
