# Kasus Penggunaan (Use Cases) — Almudaya Multi-Agent v0.3.1

Dokumen ini mendefinisikan skenario kasus penggunaan utama yang menjadi dasar pengujian dan verifikasi untuk rilis v0.3.1.

---

## UC-307: Eksekusi Perintah Shell dengan Lingkungan Bersih (Env Sanitization)

- **Aktor:** Bot AI (melalui perkakas `run_command`) atau Operator.
- **Kondisi Awal:** Proses bot berjalan dengan variabel lingkungan rahasia terdefinisi (`GEMINI_API_KEY=AIzaSy...`, `GITHUB_TOKEN=ghp_...`).
- **Alur Utama:**
  1. Bot AI memanggil perkakas `run_command` dengan perintah inspeksi lingkungan (misal: `echo %GEMINI_API_KEY%` di Windows atau `env` di Linux).
  2. Modul `sandbox.ts` menyiapkan dictionary lingkungan baru yang telah disanitasi:
     - Kunci `GEMINI_API_KEY`, `GITHUB_TOKEN`, dan variabel sensitif lainnya dihapus dari daftar environment.
  3. Perintah dieksekusi dalam child process menggunakan environment yang bersih.
  4. Output perintah (`stdout`) tidak mengandung nilai kunci rahasia.
  5. Entri `work_log.jsonl` mencatat eksekusi perintah dengan output bersih tanpa membocorkan kredensial rahasia (mematuhi Invariant 7).
- **Kondisi Akhir:** Kredensial sistem induk tetap aman dan tidak bocor ke output log publik atau blackboard.

---

## UC-308: Pencegahan Akses Berkas di Luar Sandbox Melalui Directory Junction / Symlink

- **Aktor:** Bot AI (melalui perkakas `read_file`, `write_file`, atau `edit_file`).
- **Kondisi Awal:** Terdapat symbolic link atau Windows Directory Junction (`mklink /J`) di dalam root proyek terdaftar (misal `backend/outside_link`) yang menunjuk ke direktori sensitif di luar root (misal `C:\Windows` atau folder proyek lain yang belum terdaftar).
- **Alur Utama:**
  1. Bot AI mencoba membaca berkas melalui tautan tersebut, misalnya `read_file("backend/outside_link/secret.txt")`.
  2. Fungsi `assertWithinRoot` di `sandbox.ts` menyelesaikan path kanonikal berkas menggunakan `fs.realpathSync`.
  3. Sistem mendeteksi bahwa path fisik berkas berada di luar direktori root proyek yang terdaftar.
  4. Sistem segera membatalkan operasi dan melempar error `Access denied: Target path resolves to ... which is outside registered project roots`.
  5. Operasi I/O berkas dibatalkan sebelum menyentuh berkas fisik di luar sandbox (mematuhi Invariant 5).
- **Kondisi Akhir:** Direktori dan berkas di luar root proyek terlindungi sepenuhnya dari akses bot.

---

## UC-309: Pemrosesan Pesan Transaksional Tanpa Kehilangan Pesan saat Crash

- **Aktor:** Pengirim Pesan (Bot Rekan atau Operator) dan Bot Penerima.
- **Kondisi Awal:** Terdapat pesan berstatus `unread` di inbox Bot Penerima.
- **Alur Utama:**
  1. Bot Penerima melakukan siklus polling dan mengambil pesan `unread` dari inbox.
  2. Sistem **TIDAK** langsung mengubah status pesan menjadi `READ` atau `ACKNOWLEDGED`.
  3. Bot Penerima memulai siklus penalaran ReAct atas isi pesan tersebut.
  4. *Skenario A (Sukses):* Siklus penalaran dan eksekusi perkakas berhasil tuntas. Bot secara resmi menandai status pesan menjadi `acknowledged` di berkas inbox.
  5. *Skenario B (Gagal/Crash):* Proses bot mati mendadak atau terhenti akibat error tak tertangani di tengah jalan. Status pesan di disk tetap `unread` (atau status retry yang aman).
  6. Ketika bot di-restart kembali (`almudaya bot run`), bot mendeteksi pesan yang belum tuntas tersebut dan memprosesnya kembali (*at-least-once delivery*).
- **Kondisi Akhir:** Tidak ada pesan inbox yang hilang tanpa sengaja akibat interupsi atau kegagalan eksekusi.

---

## UC-310: Penanganan Elegan Jeda Kuota Model Gemini 429 Tanpa Kepanikan

- **Aktor:** Bot AI (menghubungi Gemini API) dan Operator di Konsol.
- **Kondisi Awal:** Penggunaan kuota free-tier Gemini mencapai batas laju (5 RPM).
- **Alur Utama:**
  1. Bot AI mengirim permintaan inferensi ReAct ke Google Gemini API.
  2. Server Gemini merespons dengan HTTP status 429 `RESOURCE_EXHAUSTED` dan payload menyertakan `retryDelay: "39.61s"`.
  3. `GeminiProvider` mengenali respons sebagai jeda tarif kuota, mengekstrak nilai jeda 39 detik, dan melempar event / status `RateLimitPause`.
  4. Konsol bot menangkap status jeda ini dan mencetak notifikasi informatif:
     ```
     ⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED).
     Menunggu jeda 39 detik sebelum mencoba kembali...
     ```
  5. Bot menunda siklus selama 39 detik, lalu secara otomatis mencoba kembali panggilan inferensi.
  6. Setelah jeda berlalu, server Gemini menerima permintaan dan proses berlanjut normal.
  7. Operator memahami bahwa proses sedang tertunda sementara (bukan putus koneksi internet atau error fatal).
- **Kondisi Akhir:** Pemrosesan AI berjalan mulus melalui jendela pembatasan kuota tanpa kegagalan palsu.

---

## UC-311: Pembacaan Broadcast dengan Filter Kategori Tanpa Mengorbankan Kursor

- **Aktor:** Bot Konsumen Broadcast.
- **Kondisi Awal:** Terdapat 5 event broadcast di `events.jsonl` (2 event `ACTIVITY`, 2 event `DECISION`, 1 event `WARNING`). Kursor bot berada di awal.
- **Alur Utama:**
  1. Bot memanggil pembacaan broadcast dengan filter khusus: `readBroadcasts(sessionId, { botId: 'BOT002', category: 'DECISION' })`.
  2. Sistem mengakuisisi session lock untuk menjamin pembacaan kursor atomik.
  3. Sistem hanya mengembalikan 2 event berkategori `DECISION` kepada pemanggil.
  4. Kursor diperbarui secara konsisten sehingga pembacaan umum berikutnya tanpa filter kategori tetap dapat membaca event `ACTIVITY` dan `WARNING` yang belum pernah diterima oleh bot tersebut.
- **Kondisi Akhir:** Tidak ada event broadcast yang terbuang atau hilang permanen akibat pembacaan dengan filter.

---

## UC-312: Pemeriksaan Kotak Masuk Tanpa Mengubah Status Baca (`--no-mark-read`)

- **Aktor:** Operator CLI atau Skrip Monitoring.
- **Kondisi Awal:** Terdapat 3 pesan berstatus `unread` di inbox bot `BOT002`.
- **Alur Utama:**
  1. Operator menjalankan perintah:
     ```bash
     almudaya message read --session S001 --bot BOT002 --no-mark-read
     ```
  2. CLI menampilkan ketiga pesan yang ada di kotak masuk ke layar terminal.
  3. Sistem mempertahankan status ketiga pesan tersebut tetap `unread` di disk Blackboard.
  4. Bot `BOT002` yang berjalan di latar belakang tetap dapat melihat dan memproses pesan-pesan tersebut pada siklus polling berikutnya.
- **Kondisi Akhir:** Operator dapat memantau isi kotak masuk tanpa menginterupsi antrean pemrosesan bot.
