# Project Charter — Almudaya Multi-Agent v0.3.1

**Project:** Almudaya Multi-Agent  
**Target Version:** 0.3.1 (*Security, Concurrency & Reliability Patch*)  
**Package:** `almudaya-multiagent`  
**Status:** DRAFT (Approved for Requirements Baseline)  
**Date:** 2026-11-06  

---

## 1. Visi (Vision)

Memperkokoh fondasi Almudaya Multi-Agent v0.3.0 menjadi **platform multi-agent yang aman, tangguh, dan transaksional (*Hardened Multi-Agent Runtime*)**, dengan mengeliminasi seluruh celah kebocoran kredensial lingkungan, memperketat isolasi sandbox dari manipulasi symlink/junction, menjamin integritas pengiriman pesan (*at-least-once message delivery*), serta menangani jeda pembatasan kuota AI model secara adaptif dan elegan.

---

## 2. Sasaran (Objectives)

1. **Sanitasi Kredensial Lingkungan Subprocess (SEC-01):** Menjamin bahwa setiap eksekusi perintah shell melalui perkakas `run_command` tidak mewarisi token atau kredensial sensitif induk (seperti `GEMINI_API_KEY`, `GITHUB_TOKEN`), serta membersihkan output dari potensi kebocoran rahasia.
2. **Isolasi Sandbox Berbasis Realpath (§14/6):** Mencegah potensi lolosnya bot dari direktori kerja yang diizinkan (*sandbox escape*) akibat eksploitasi symlink atau Windows Directory Junction (`mklink /J`) melalui validasi kanonikal `fs.realpathSync`.
3. **Pemrosesan Pesan Transaksional & Anti-Loss (RELIA-01):** Mengubah mekanisme pembacaan antrean pesan inbox menjadi transaksional, memastikan pesan tidak ditandai sebagai selesai sebelum ReAct turn berhasil dieksekusi secara penuh (*at-least-once delivery*).
4. **Penanganan Adaptif Jeda Kuota Model AI (NT-05 & NT-06):** Mengidentifikasi respon HTTP 429 `RESOURCE_EXHAUSTED` sebagai jeda tarif kuota (*quota throttling pause*), mem-parsing nilai `retryDelay` dari respons server Gemini, menerapkan jeda penundaan yang presisi, dan menyajikan notifikasi informatif yang tidak menyesatkan di antarmuka konsol.
5. **Koreksi Kursor Broadcast Terkunci (CONC-02):** Mengamankan pembacaan kursor broadcast di bawah penguncian sesi (*session lock*) dan memastikan kursor tidak membuang event yang belum diproses akibat penyaringan filter.
6. **Koreksi Parameter CLI & Dokumentasi (NT-01 & §16/1):** Mengaktifkan opsi `--no-mark-read` pada perintah `almudaya message read` dan menyelaraskan kategori broadcast di dokumentasi dengan validasi skema Zod.

---

## 3. Ukuran Keberhasilan (Success Measures)

1. Perintah shell `echo %GEMINI_API_KEY%` (Windows) atau `echo $GEMINI_API_KEY` (Linux/macOS) yang dieksekusi melalui perkakas `run_command` menghasilkan string kosong (tidak ada nilai token yang tampil).
2. Upaya membaca, menulis, atau mengedit berkas di luar root melalui symlink atau junction direktori ditolak 100% dengan pesan error akses ditolak.
3. Saat terjadi kegagalan pemrosesan turn (akibat kuota habis atau crash mendadak), pesan inbox yang bersangkutan tetap berada dalam status yang dapat diproses kembali (tidak hilang permanen).
4. Saat model Gemini mengembalikan status 429 `RESOURCE_EXHAUSTED`, runtime secara otomatis membaca instruksi `retryDelay` dari server, melakukan jeda adaptif, dan konsol menampilkan indikator `⏳ Kuota tercapai...` tanpa melempar kegagalan fatal.
5. Membaca broadcast dengan filter kategori tidak menghilangkan event berikutnya saat dilakukan pembacaan tanpa filter.
6. Opsi CLI `message read --no-mark-read` dapat dipanggil tanpa memicu error argumen tidak dikenal dari Commander.
7. Seluruh test suite (minimal 179 pengujian sebelumnya + pengujian unit/integrasi baru untuk patch) lulus 100% secara offline.

---

## 4. Prinsip Desain & Invarian (Design Principles & Invariants)

- **Strict Least Privilege Environment (Invariant 7 Enforcement):** Subprocess koding hanya mendapatkan variabel lingkungan OS minimum yang dibutuhkan untuk mengeksekusi kompilator dan runtime dasar (seperti `PATH`, `SYSTEMROOT`, `TEMP`), tanpa kredensial API.
- **Canonical Filesystem Verification (Invariant 5 Enforcement):** Validasi batasan direktori wajib menyelesaikan seluruh rantai symlink dan junction ke path fisik kanonikal sebelum izin operasi I/O diberikan.
- **Transactional Message Lifecycle:** Status pesan di Blackboard bertransisi secara aman: pesan baru di-ack atau di-mark-read setelah aksi tuntas, mencegah hilangnya pesan akibat kegagalan eksekusi di tengah jalan.
- **Differentiating Throttling from Failure:** Mengakui bahwa pembatasan kuota API adalah kondisi operasional normal pada penyedia LLM, bukan kegagalan sistem permanen, sehingga wajib ditangani dengan jeda adaptif dan pesan status yang menenangkan pengguna.
- **Zero Breaking Changes:** Antarmuka CLI, struktur berkas Blackboard, dan tanda tangan fungsi publik tetap kompatibel penuh ke belakang (*100% backward compatible*).

---

## 5. Batasan Cakupan Rilis v0.3.1 (Scope Boundaries)

### Dalam Cakupan (In Scope):
- Sanitasi variabel lingkungan pada `src/tools/sandbox.ts` (`executeRunCommand`).
- Redaksi nilai kredensial pada `stdout_snippet` / `stderr_snippet` di `work_log.jsonl`.
- Pengecekan path kanonikal (`fs.realpathSync`) pada fungsi `assertWithinRoot` di `src/tools/sandbox.ts`.
- Pembaruan mekanisme pembacaan inbox di `src/messaging/service.ts` dan loop otonom `src/bot/agent-loop.ts` agar beroperasi secara transaksional (*acknowledge-after-turn-success*).
- Peningkatan `GeminiProvider` di `src/ai/gemini.ts` untuk mem-parsing payload error 429, mengekstrak `retryDelay`, dan mengekspos penanganan jeda adaptif.
- Pembaruan tampilan indikator jeda kuota pada konsol interaktif `src/bot/console.ts`.
- Penguncian sesi dan koreksi filter kursor pada `src/messaging/service.ts`.
- Penambahan dukungan `--no-mark-read` pada CLI `src/cli/commands/messaging.ts`.
- Pembaruan dokumentasi kategori broadcast di `README.md` dan panduan terkait.

### Di Luar Cakupan (Out of Scope untuk v0.3.1, dialokasikan ke v0.4.0):
- Penambahan native tools `send_message` dan `publish_broadcast` ke dalam loop ReAct AI (tetap dialokasikan untuk v0.4.0 Autonomous Multi-Agent Mesh).
- Implementasi mekanisme fencing token pada sistem double-checked locking file (`CONC-01`).
- Perombakan parser JSONL toleran terhadap data torn-read (`RELIA-02`).
- Web UI Dashboard atau visualisasi berbasis web.
