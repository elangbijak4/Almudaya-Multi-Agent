# Analisis Sistem (System Analysis) — Almudaya Multi-Agent v0.3.1

**Versi Target:** 0.3.1 (*Security, Concurrency & Reliability Patch*)  
**Paket:** `almudaya-multiagent`  
**Status:** DRAFT (Approved for Design Baseline)  
**Tanggal:** 2026-11-06  

Dokumen ini menyajikan analisis mendalam terhadap lima area pengerasan sistem (*hardening*) untuk menyelesaikan temuan prioritas P0 pada [`AUDIT.md`](file:///d:/almudaya_multiagent_v0.1.0/AUDIT.md), [`TESTING.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING.md), dan [`TESTING2.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING2.md).

---

## 1. Dekomposisi Area Masalah & Analisis Akar Penyebab

### 1.1 Area 1: Pewarisan Kredensial Lingkungan ke Subprocess (`SEC-01` / FR-319)
- **Kondisi Saat Ini:**
  Pada [`src/tools/sandbox.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/tools/sandbox.ts), implementasi perkakas `executeRunCommand` memanggil Node `child_process.exec(command, options, callback)` dengan `options.cwd = workingDir`. Karena properti `options.env` tidak didefinisikan secara eksplisit, fungsi `exec` bawaan Node.js secara default mewarisi 100% `process.env` dari proses induk.
- **Dampak Keamanan:**
  Proses induk bot menjalankan runtime dengan variabel lingkungan sensitif:
  - `GEMINI_API_KEY`: Kunci akses model AI.
  - `GITHUB_TOKEN`: Token otentikasi repo/CI.
  - Token sesi internal atau variabel lingkungan OS sensitif.
  Perintah shell anak seperti `echo %GEMINI_API_KEY%` atau skrip paket npm/pip yang membaca environment dapat mengeksfiltrasi nilai rahasia ini. Nilai tersebut kemudian tercetak pada `stdout_snippet` yang dicatat secara permanen ke `work_log.jsonl` dan dipublikasikan via broadcast `ACTIVITY`. Hal ini melanggar **Invariant 7 (Security & Privacy of Credentials)**.
- **Pendekatan Analisis Solusi:**
  1. *Allowlist Sanitization:* Membuat salinan environment khusus yang hanya menyertakan variabel OS dasar non-sensitif yang diperlukan untuk menjalankan binary kompilator/runtime (misal: Node, Python, git).
  2. *Sensitive Key Purging:* Memastikan bahwa setiap kunci yang memuat substring `KEY`, `SECRET`, `TOKEN`, `AUTH`, `PASS`, atau `CREDENTIAL` dihapus secara eksplisit.
  3. *Output Redaction:* Menyaring `stdout` dan `stderr` sebelum disimpan ke `work_log.jsonl` menggunakan fungsi `maskApiKey` atau regex redaksi generik.

---

### 1.2 Area 2: Pelarian Direktori via Tautan Fisik Symlink/Junction (`§14/6` / FR-320)
- **Kondisi Saat Ini:**
  Fungsi `assertWithinRoot(targetPath, roots)` di [`src/tools/sandbox.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/tools/sandbox.ts) hanya melakukan normalisasi string leksikal:
  ```typescript
  const resolvedTarget = path.resolve(targetPath);
  // Pengecekan hanya: resolvedTarget.startsWith(resolvedRoot)
  ```
- **Dampak Keamanan:**
  Di Windows dan sistem Unix:
  - Pengguna atau skrip eksternal dapat membuat Windows Directory Junction (`mklink /J outside C:\Windows`) atau symbolic link di dalam project root target.
  - Secara leksikal, path `D:\project\backend\outside\system32\calc.exe` tampak diawali dengan `D:\project\backend` (lulus validasi).
  - Namun ketika berkas dibaca via `fs.readFile`, kernel OS menyelesaikan tautan fisik ke `C:\Windows\system32\calc.exe`, sehingga bot dapat membaca/menulis berkas sensitif di luar root yang diizinkan (melanggar **Invariant 5: Filesystem Sandbox Boundary**).
- **Pendekatan Analisis Solusi:**
  1. Menggunakan `fs.realpathSync` bawaan Node.js untuk menyelesaikan seluruh symlink, junction, dan hardlink ke path fisik kanonikal sebelum memverifikasi apakah path tersebut berada di bawah `fs.realpathSync(registeredRoot)`.
  2. Untuk operasi penulisan berkas baru (`write_file`) di mana berkas target belum ada di disk: sistem menyelesaikan `fs.realpathSync` pada direktori induknya (`path.dirname(targetPath)`), kemudian menggabungkannya dengan nama berkas baru.

---

### 1.3 Area 3: Reliabilitas Pemrosesan Antrean Pesan Inbox (`RELIA-01` / FR-321)
- **Kondisi Saat Ini:**
  Pada siklus otonom bot [`src/bot/agent-loop.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/bot/agent-loop.ts), alur pengambilan pesan inbox berjalan sebagai berikut:
  ```
  1. pollCycle() -> messagingService.readInbox(sessionId, botId, { markAsRead: true })
  2. handleMessage(message) -> ReAct reasoning loop (bisa crash, time out, atau 429)
  3. if (autoAck) messagingService.acknowledgeMessage(message.id)
  ```
- **Dampak Reliabilitas:**
  Pesan diubah statusnya menjadi `READ` segera setelah diambil dari disk. Jika terjadi kegagalan fatal pada langkah (2) (misalnya proses mati mendadak, kuota API habis dan loop abort, atau syntax error pada prompt AI), pesan tersebut sudah tidak lagi `UNREAD`. Pada siklus polling berikutnya, pesan tersebut **tidak akan pernah diambil lagi**, mengakibatkan hilangnya instruksi tugas tanpa jejak (*message loss*).
- **Pendekatan Analisis Solusi:**
  1. *Transaksional At-Least-Once Delivery:* Pesan tidak boleh ditandai `READ` atau `ACKNOWLEDGED` sebelum eksekusi ReAct selesai dengan sukses.
  2. Pemanggilan `readInbox` pada polling awal wajib menggunakan `{ markAsRead: false }`.
  3. Status pesan baru di-ack atau di-mark-read setelah fungsi `handleMessage` berhasil mengembalikan respons dan mempublikasikan broadcast penyelesaian.
  4. Jika terjadi error tak tertangani, pesan tetap berstatus `unread` (atau status `error`/`retry_pending`), sehingga siap diambil kembali pada iterasi selanjutnya atau setelah bot di-restart.

---

### 1.4 Area 4: Penanganan Jeda Kuota Model Gemini 429 & UX Konsol (`NT-05`, `NT-06` / FR-322, FR-323)
- **Kondisi Saat Ini:**
  Pada [`src/ai/gemini.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/ai/gemini.ts):
  - Error HTTP 429 `RESOURCE_EXHAUSTED` (kuota laju tercapai, misal free-tier 5 RPM) ditangani oleh mekanisme retry umum dengan backoff eksponensial tetap: `attempt 1 (500ms)`, `attempt 2 (1000ms)`, `attempt 3 (2000ms)`. Total durasi retry hanya ~3.5 detik.
  - Server Gemini menyertakan informasi durasi tunggu resmi pada `error.errorDetails` (misal: `RetryInfo: retryDelay "39.61s"`).
  - Karena provider kehabisan kesempatan retry sebelum jeda 39 detik selesai, provider melempar `GeminiProviderError`.
  - Konsol REPL menangkap error tersebut dan mencetak: `❗ Gagal memproses pesan: ...`, yang disalahartikan pengguna sebagai koneksi internet putus.
- **Pendekatan Analisis Solusi:**
  1. *Parsing Server RetryInfo:* Mengidentifikasi respons error 429 dan mengekstrak nilai string `retryDelay` (misal `"39.6135s"` menjadi float detik/milidetik).
  2. *Adaptive Quota Pause:* Jika terdeteksi 429 dengan `retryDelay`, provider tidak melempar error kegagalan koneksi fatal, melainkan memancarkan error/status khusus `RateLimitPauseError` dengan metadata durasi jeda.
  3. *REPL Observability:* Konsol REPL mengenali `RateLimitPauseError` dan menampilkan indikator penundaan yang menenangkan:
     `⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED). Menunggu jeda ${delay} detik sebelum mencoba kembali...`
  4. *Autonomous Re-try Latch:* Agent loop menahan eksekusi selama jeda server tersebut (+ jitter 1-2 detik agar aman dari boundary), lalu mengulang panggilan LLM secara otomatis tanpa memerlukan intervensi manual dari operator.

---

### 1.5 Area 5: Atomisitas Kursor Broadcast & Filter Loss (`CONC-02` / FR-324)
- **Kondisi Saat Ini:**
  Pada [`src/messaging/service.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/messaging/service.ts) metode `readBroadcasts`:
  - Jika parameter `botId` disertakan, kursor bot dimajukan ke ID event broadcast terakhir di berkas:
    ```typescript
    if (botId && autoAdvanceCursor && events.length > 0) {
      this.saveBroadcastCursor(sessionId, botId, events[events.length - 1].event_id);
    }
    ```
  - Namun pemfilteran berdasarkan `options.category` atau `options.limit` diterapkan pada kumpulan event tersebut. Jika pemanggil memfilter berdasarkan `--category DECISION`, kursor tetap dimajukan ke event terakhir berkas (yang mungkin berupa `ACTIVITY`).
  - Akibatnya, pemanggilan berikutnya untuk kategori lain atau pemanggilan umum akan melewatkan seluruh event di antara kursor lama dan kursor baru yang belum pernah dibaca oleh bot tersebut.
- **Pendekatan Analisis Solusi:**
  1. Operasi pembacaan dan pembaruan kursor wajib dibungkus dalam penguncian sesi (*session lock*) untuk menghindari race condition antar-proses konkuren.
  2. Kursor broadcast hanya boleh dimajukan hingga ID event terakhir yang **benar-benar disajikan kepada pemanggil**, ATAU jika pemanggilan menggunakan filter kategori khusus, kursor persisten bot tidak dimajukan melompati event yang belum terbaca, kecuali jika pembacaan adalah pembacaan aliran kontinu tanpa filter.

---

## 2. Analisis Kepatuhan Invarian Sistem

| Invarian | Deskripsi Formal | Status v0.3.0 | Status v0.3.1 (Pasca Hardening) |
|---|---|---|---|
| **Invariant 5** | Batasan Filesystem Sandbox: Bot dilarang membaca atau menulis berkas di luar root proyek terdaftar. | Lolos leksikal, namun rentan bypass symlink/junction. | **Terproteksi Penuh:** Resolusi fisik via `fs.realpathSync` menutup 100% bypass symlink dan junction. |
| **Invariant 6** | Kedaulatan Manusia (*Human-in-the-Loop*): Persetujuan eksplisit wajib dihormati pada mode `REQUEST_REVIEW`. | Berfungsi penuh pada konsol REPL v0.3.0. | **Dipertahankan 100%:** Dialog review tetap bekerja identik tanpa regresi. |
| **Invariant 7** | Keamanan & Kerahasiaan Kredensial: Rahasia sistem dilarang terekspos ke log atau broadcast. | Rentan pewarisan `process.env` pada child process shell. | **Terproteksi Penuh:** Allowlist sanitasi environment dan redaksi otomatis pada output stream shell. |
