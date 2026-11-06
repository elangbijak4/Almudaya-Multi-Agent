# Software Requirements Specification (SRS) — Almudaya Multi-Agent v0.3.1

**Versi Target:** 0.3.1 (*Security, Concurrency & Reliability Patch*)  
**Paket:** `almudaya-multiagent`  
**Status:** DRAFT (Approved for Requirements Baseline)  
**Tanggal:** 2026-11-06  

Dokumen ini mendefinisikan spesifikasi kebutuhan fungsional dan non-fungsional untuk rilis perbaikan keamanan, konkurensi, dan keandalan Almudaya Multi-Agent Versi 0.3.1.

---

## 1. Pendahuluan

### 1.1 Tujuan
Menutup seluruh celah keamanan prioritas P0 (kebocoran variabel lingkungan, pelarian direktori via symlink/junction), memastikan keandalan pemrosesan pesan melalui model transaksional, menangani pembatasan laju kuota model AI (HTTP 429) secara adaptif tanpa kepanikan pengguna, serta menyempurnakan konsistensi antarmuka CLI dan dokumentasi.

### 1.2 Ruang Lingkup
Mencakup modifikasi pada modul:
- `src/tools/sandbox.ts`: Sanitasi variabel lingkungan subprocess dan resolusi path kanonikal (`fs.realpathSync`).
- `src/messaging/service.ts`: Kursor broadcast atomik dan penyempurnaan pembacaan pesan transaksional.
- `src/bot/agent-loop.ts`: Transisi status pesan inbox yang aman (*at-least-once processing*).
- `src/ai/gemini.ts`: Pengenalan error 429, ekstraksi `retryDelay`, dan jeda adaptif.
- `src/bot/console.ts`: Indikator ramah jeda kuota pada konsol REPL.
- `src/cli/commands/messaging.ts`: Penambahan opsi `--no-mark-read`.
- `README.md` dan dokumentasi terkait: Sinkronisasi kategori broadcast.

---

## 2. Kebutuhan Fungsional (Functional Requirements)

### 2.1 Pengerasan Keamanan Eksekusi Shell & Sandbox

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-319** | **Subprocess Environment Sanitization (SEC-01):**<br>Eksekutor perkakas `run_command` pada `src/tools/sandbox.ts` dilarang meneruskan `process.env` mentah ke child process. Sistem wajib menghapus variabel sensitif (`GEMINI_API_KEY`, `GITHUB_TOKEN`, token sesi, dan pola `*KEY*`, `*SECRET*`, `*TOKEN*`) atau hanya mewarisi variabel sistem standar yang aman (`PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `COMSPEC`, `PATHEXT`, `HOME`, `USERPROFILE`, `LANG`, `TERM`). | **Must** |
| **FR-320** | **Realpath Symlink & Windows Junction Defense (§14/6):**<br>Fungsi `assertWithinRoot` pada `src/tools/sandbox.ts` wajib memvalidasi path target menggunakan `fs.realpathSync` (atau resolusi kanonikal direktori induk jika berkas target baru akan dibuat). Upaya mengakses atau memodifikasi berkas di luar root proyek melalui symbolic link atau Windows Directory Junction (`mklink /J`) wajib ditolak dengan pesan error `Access denied`. | **Must** |

---

### 2.2 Keandalan Pemrosesan Pesan & Penanganan Jeda Kuota Model AI

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-321** | **Transactional Inbox Message Processing (RELIA-01):**<br>Siklus otonom bot (`AutonomousAgentLoop`) dilarang menandai pesan inbox sebagai `READ` atau `ACKNOWLEDGED` sebelum siklus penalaran ReAct atas pesan tersebut selesai dengan sukses. Jika terjadi kegagalan (crash proses, interupsi, atau penundaan kuota), status pesan wajib dipertahankan tetap belum tuntas (`UNREAD` atau status transisi aman) agar dapat diproses ulang pada iterasi berikutnya (*at-least-once delivery*). | **Must** |
| **FR-322** | **Gemini Adaptive 429 Quota Throttling & Server `retryDelay` Parsing (NT-05):**<br>Penyedia `GeminiProvider` pada `src/ai/gemini.ts` wajib mendeteksi respons error HTTP 429 / `RESOURCE_EXHAUSTED`. Provider wajib mem-parsing field `retryDelay` dari payload error Google API (misal format string `"39.61s"` atau integer durasi), dan melakukan jeda tunda yang sesuai dengan permintaan server (bukan fixed backoff 2 detik) sebelum mencoba kembali (*adaptive backoff*). | **Must** |
| **FR-323** | **Non-Alarming Rate-Limit Indicator in Console REPL (NT-06):**<br>Ketika terjadi penundaan akibat kuota 429, runtime bot dilarang menampilkan pesan kegagalan yang mengindikasikan koneksi putus (`❗ Gagal memproses pesan...`). Sebagai gantinya, konsol wajib menampilkan notifikasi status yang menenangkan: `⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED). Menunggu jeda ${delaySeconds} detik sebelum mencoba kembali...` dan melanjutkan proses secara otomatis setelah jeda tuntas. | **Must** |

---

### 2.3 Perbaikan Konkurensi & Sinkronisasi Kursor Broadcast

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-324** | **Atomic Broadcast Cursor Management & Filter Race Prevention (CONC-02):**<br>Operasi pembacaan event broadcast dengan kursor pada `MessagingService.readBroadcasts` wajib berada di bawah perlindungan penguncian sesi (*session lock*). Pemfilteran berdasarkan kategori wajib dievaluasi dengan benar tanpa menyebabkan kursor maju melompati event yang belum pernah disajikan ke pemanggil, memastikan tidak ada event yang hilang permanen. | **Must** |

---

### 2.4 Antarmuka CLI & Penyelarasan Dokumentasi

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-325** | **CLI Option `--no-mark-read` Support (NT-01):**<br>Perintah CLI `almudaya message read` pada `src/cli/commands/messaging.ts` wajib mendukung opsi eksplisit `--no-mark-read`, memungkinkan pengguna atau skrip otomatis membaca isi kotak masuk tanpa mengubah status pesan dari `unread` menjadi `read`. | **Should** |
| **FR-326** | **Broadcast Category Documentation & Schema Alignment (§16/1):**<br>Contoh perintah dan manual pada `README.md` serta dokumen pengguna wajib diselaraskan dengan skema enum Zod `BroadcastCategoryEnum` (`ANNOUNCEMENT`, `ACTIVITY`, `DECISION`, `WARNING`, `ERROR`). Seluruh referensi usang seperti `--category SPEC_READY` dihapus dan diganti dengan kategori yang valid. | **Should** |

---

## 3. Kebutuhan Non-Fungsional (Non-Functional Requirements)

| ID | Kebutuhan | Metrik / Kriteria Penerimaan |
|---|---|---|
| **NFR-306** | **Strict Credential Protection (Invariant 7):** | Tidak ada token rahasia (`GEMINI_API_KEY`, dsb.) yang tampil pada output `stdout`/`stderr` perintah shell anak atau terekam ke `work_log.jsonl`. |
| **NFR-307** | **Filesystem Canonical Isolation (Invariant 5):** | Pemanggilan operasi I/O file pada direktori yang ditautkan ke luar sandbox via symlink/junction ditolak 100% tanpa celah bypass. |
| **NFR-308** | **100% Offline Testability:** | Seluruh fitur perbaikan wajib memiliki unit test dan integration test yang dapat dijalankan secara luring (*offline*) menggunakan Mock Provider dan fixture direktori temporer. |
| **NFR-309** | **Backward Compatibility & Type Safety:** | Seluruh kode ditulis dalam TypeScript *strict mode* tanpa error kompilasi (`tsc`), dan mempertahankan kompatibilitas penuh dengan 179 tes yang sudah ada tanpa regresi. |
