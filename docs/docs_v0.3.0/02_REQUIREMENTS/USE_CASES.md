# Use Cases — Almudaya Multi-Agent v0.3.0

Dokumen ini memetakan skenario penggunaan nyata untuk konsol interaktif all-in-one dan memori kerja sesi lintas-root.

---

## UC-301: Operator Mengoperasikan Bot Melalui All-in-One Console REPL
- **Aktor:** Operator Manusia.
- **Prekondisi:** Session `S002` aktif, target project roots terdaftar, bot `BOT001` terdaftar.
- **Alur Utama:**
  1. Operator menjalankan `almudaya bot run --session S002 --bot BOT001`.
  2. Sistem menampilkan banner status bot dan memunculkan prompt interaktif `Architect> `.
  3. Proses bot di latar belakang mengaktifkan loop heartbeat dan mendengarkan pesan masuk tanpa memblokir input keyboard.
  4. Operator dapat langsung mengetik perintah atau instruksi kapan saja.

---

## UC-302: Operator Mengirim Pesan ke Bot Lain dari Terminal Lokal
- **Aktor:** Operator Manusia di Terminal Bot "Architect".
- **Alur Utama:**
  1. Di prompt `Architect> `, operator mengetik:
     `/msg Coder Tolong implementasikan fungsi registerUser di modul auth.js.`
  2. Konsol mem-parsing target recipient `"Coder"` dan isi pesan.
  3. Sistem menyelesaikan `"Coder"` ke Bot ID `BOT002` dan mengirim pesan via `MessagingService.sendDirectMessage`.
  4. Konsol menampilkan feedback: `✅ Pesan terkirim ke Coder (BOT002).`
  5. Terminal "Coder" (di jendela terpisah) langsung menerima pesan dan menjalankan siklus kodingnya tanpa operator perlu membuka terminal ketiga.

---

## UC-303: Operator Memerintahkan Bot Lokal Menggunakan Bahasa Alami
- **Aktor:** Operator Manusia di Terminal Bot "Architect".
- **Alur Utama:**
  1. Di prompt `Architect> `, operator mengetik instruksi langsung tanpa awalan garis miring:
     `Analisis struktur project root dan buatkan dokumen arsitektur di docs/architecture.md.`
  2. Konsol mendeteksi input sebagai instruksi lokal operator.
  3. Bot membungkus input sebagai pesan dari `"OPERATOR"` dan meneruskannya ke `AutonomousAgentLoop`.
  4. Bot AI berpikir (*reasoning*), memanggil perkakas yang sesuai, meminta izin jika di mode `REQUEST_REVIEW`, dan menulis berkas ke target project root.
  5. Bot mencetak kesimpulan pekerjaannya langsung di konsol terminal tersebut.

---

## UC-304: Pencatatan Otomatis Memori Kerja Lintas-Root (Location-Aware Work Log)
- **Aktor:** Bot AI (misal: "Coder").
- **Alur Utama:**
  1. Bot "Coder" memanggil tool `write_file` dengan target `backend/src/server.ts`.
  2. Sistem memvalidasi sandboxing path dan mendeteksi bahwa berkas berada di root `backend` (`D:\testingbot\backend`).
  3. Berkas ditulis secara atomik ke disk.
  4. Sistem secara otomatis membuat entri log presisi:
     - `action_type`: `WRITE`
     - `target_root_id`: `backend`
     - `relative_path`: `src/server.ts`
     - `summary`: `Menulis berkas backend/src/server.ts (1450 bytes)`
  5. Entri di-append secara atomik ke `sessions/<sessionId>/work_log.jsonl`.
  6. Seluruh bot dan operator kini dapat melihat catatan kerja ini secara transparan.

---

## UC-305: Bot AI Mengorkestrasi Tugas Berdasarkan Riwayat Kerja Rekan (`get_work_log`)
- **Aktor:** Bot AI (misal: "Tester" / "Architect").
- **Alur Utama:**
  1. Bot "Tester" menerima instruksi: *"Uji modul server yang baru saja dibuat oleh Coder."*
  2. Bot "Tester" memanggil perkakas AI `get_work_log({ root_id: 'backend', limit: 5 })`.
  3. Sistem mengembalikan daftar 5 aksi terakhir di root `backend`, termasuk info bahwa Coder baru saja membuat `src/server.ts` dan port default adalah `8080`.
  4. Berbekal informasi lokasi yang akurat tersebut, Tester langsung membuat tes integrasi `tests/server.test.ts` dan menjalankannya via `run_command`.
  5. Orkestrasi koding lintas-bot dan lintas-root berhasil tanpa ambiguitas jalur file.

---

## UC-306: Operator Memeriksa Status, Peers, Roots, dan Log Kerja
- **Aktor:** Operator Manusia di Konsol Bot mana pun.
- **Alur Utama:**
  1. Operator mengetik `/peers` ➔ Konsol menampilkan daftar rekan bot aktif/stale dan PID-nya.
  2. Operator mengetik `/roots` ➔ Konsol menampilkan seluruh project root terdaftar (misal: `frontend`, `backend`, `docs`).
  3. Operator mengetik `/log` ➔ Konsol mencetak 10 aktivitas koding terakhir di session lengkap dengan timestamp, bot pelaku, dan path file.
  4. Operator mengetik `/mode turbo` ➔ Konsol mengalihkan bot ke mode otonom langsung.
  5. Operator mengetik `/exit` ➔ Bot berhenti secara anggun (*graceful stop*).
