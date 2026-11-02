# Use Cases — Almudaya Multi-Agent v0.2.0

Dokumen use case ini menggambarkan interaksi nyata antara Operator Manusia, Bot Cerdas (AI Agent), Lapisan Provider Model, dan Target Project Root.

---

## Aktor-Aktor Sistem
1. **Operator Manusia (Human Developer):** Pengembang yang menginisiasi session, mendaftarkan project root, menjalankan bot, dan memberikan persetujuan pada mode review.
2. **Bot AI ("Architect"):** Bot yang bertugas menganalisis kebutuhan, merancang arsitektur sistem, dan memberikan arahan kerja.
3. **Bot AI ("Coder"):** Bot yang bertugas membaca kode sumber, menulis/mengedit file proyek target, dan menjalankan tes kompilasi.
4. **AI Provider (Google Gemini / Mock):** Penyedia layanan LLM eksternal untuk inferensi dan *tool calling*.
5. **Session Blackboard:** Papan pengumuman persisten dan kotak surat antar-bot.
6. **Target Project Root:** Folder kode program eksternal tempat file dibaca dan dimanipulasi.

---

## Daftar Use Cases

### UC-201: Menjalankan Bot dengan Provider Google Gemini
- **Deskripsi:** Operator menjalankan bot runtime dengan model AI Google Gemini.
- **Pra-kondisi:**
  - Session aktif dan project root telah didaftarkan.
  - Variabel lingkungan `GEMINI_API_KEY` telah disetel di terminal operator.
- **Alur Utama:**
  1. Operator menjalankan:
     `almudaya bot run --session S002 --bot BOT001 --provider gemini --model gemini-2.5-flash --mode review`
  2. Sistem membaca `GEMINI_API_KEY` dari environment lokal.
  3. Sistem menginisialisasi provider Gemini dan menyusun System Prompt awal.
  4. Bot mencatat status `active` di Blackboard dan mulai memantau pesan masuk.

---

### UC-202: Bot Menganalisis Struktur Kode di Project Root
- **Deskripsi:** Bot mengeksplorasi folder target untuk memahami struktur proyek.
- **Alur Utama:**
  1. Bot menerima pesan atau instruksi awal untuk menelaah proyek.
  2. Model AI memutuskan memanggil tool `list_dir` pada folder target.
  3. Sistem memvalidasi path berada dalam batas `context root` yang sah.
  4. Sistem mengembalikan daftar file dan folder ke model AI.
  5. Bot membaca file kunci (misal `package.json` atau `README.md`) menggunakan `read_file`.
  6. Bot menyimpulkan pemahaman proyek dan mencatat ringkasannya.

---

### UC-203: Bot Mengubah File dalam Mode `REQUEST_REVIEW`
- **Deskripsi:** Bot melakukan koding dengan meminta izin manusia sebelum menyimpan ke disk.
- **Alur Utama:**
  1. Model AI menghasilkan usulan pembuatan berkas baru `src/auth.ts` atau pengeditan berkas via `write_file` / `edit_file`.
  2. Sistem memeriksa mode eksekusi bot: terdeteksi `REQUEST_REVIEW`.
  3. Sistem menampilkan pratinjau perubahan (*file diff*) di terminal operator:
     ```text
     [REVIEW REQUIRED] Bot "Coder" wants to write to "D:\testingbot\src\auth.ts":
     Do you approve this change? (y/n/diff):
     ```
  4. Operator mengetik `y` (Yes).
  5. Sistem menulis berkas ke target project root.
  6. Hasil eksekusi dikembalikan ke model AI sebagai konfirmasi berhasil.
- **Alur Alternatif (Ditolak):**
  - Pada langkah 4, operator mengetik `n` (No).
  - Sistem membatalkan penulisan dan mengembalikan pesan "Operation rejected by user" ke AI sehingga AI dapat merumuskan alternatif lain.

---

### UC-204: Bot Menjalankan Pengujian Sistem dalam Mode `TURBO`
- **Deskripsi:** Bot secara mandiri mengeksekusi perintah shell untuk menguji kode yang baru ditulis.
- **Alur Utama:**
  1. Bot berjalan dalam mode `--mode turbo`.
  2. Setelah menulis kode, model AI memutuskan memanggil tool `run_command` dengan argumen `npm test`.
  3. Karena berada dalam mode `TURBO`, sistem langsung mengeksekusi perintah di dalam direktori project root target.
  4. Sistem menangkap output terminal (misal: "3 tests passed").
  5. Output dikembalikan ke model AI.
  6. Bot melaporkan hasil pengujian ke Session Blackboard.

---

### UC-205: Kolaborasi Pair Programming Antar-Bot (Architect & Coder)
- **Deskripsi:** Bot "Architect" mengirimkan spesifikasi teknis ke bot "Coder", dan "Coder" mengeksekusinya di kode target.
- **Alur Utama:**
  1. Bot "Architect" mempublikasikan event broadcast atau direct message:
     `"Harap buatkan endpoint login di src/routes/auth.ts dengan validasi email."`
  2. Bot "Coder" yang sedang berjalan live menangkap pesan tersebut di inbox-nya.
  3. Model AI pada "Coder" memahami kebutuhan teknis tersebut.
  4. "Coder" memanggil tool `write_file` untuk menulis `src/routes/auth.ts`.
  5. Setelah selesai, "Coder" mengirim direct message balik ke "Architect":
     `"Endpoint login telah selesai diimplementasikan dan diverifikasi."`
  6. Kedua bot mencatat seluruh rangkaian keberhasilan ke Blackboard.
