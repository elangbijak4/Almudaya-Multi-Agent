# ADR-301: Non-Blocking Interactive Bot Console REPL Architecture

- **Status:** APPROVED
- **Date:** 2026-11-03
- **Deciders:** Product Owner, Lead Architect
- **Consulted:** SRS v0.3.0 (FR-301 s/d FR-310, NFR-301..304)
- **Resolves:** `OI-301` (Interactive prompt suspension during [REVIEW REQUIRED] and concurrent output)

---

## 1. Konteks & Masalah

Pada versi v0.1.0 dan v0.2.0, ketika pengguna menjalankan perintah `almudaya bot run --session <id> --bot <id>`, proses bot berjalan di latar depan (*foreground*) dan terminal menjadi beku (*blocked*). Terminal tersebut hanya pasif mendengarkan pesan dan mencetak log detak heartbeat atau event.

Jika seorang operator manusia ingin:
1. Mengirim pesan instruksi ke bot lain (`almudaya message send`),
2. Memeriksa status rekan bot (`almudaya bot list`),
3. Memeriksa project roots yang sedang aktif (`almudaya context root list`),

Operator **terpaksa harus membuka jendela Command Prompt / PowerShell baru** (terminal ke-3 atau ke-4). Hal ini menimbulkan friksi pengalaman pengguna (*poor UX*) dan memecah konsentrasi operator. Isu terbuka `OI-301` mempertanyakan bagaimana menjalankan REPL interaktif di dalam terminal bot tanpa memblokir polling background dan tanpa merusak teks yang sedang diketik operator saat ada pesan masuk.

---

## 2. Keputusan yang Diambil

1. **Transformasi `almudaya bot run` Menjadi All-in-One Console REPL (`src/bot/console.ts`):**
   - Menggunakan modul standar `node:readline` bawaan Node.js tanpa dependensi eksternal pihak ketiga.
   - Terminal menampilkan banner bot dan prompt interaktif: `<DisplayName>> ` (misal `Architect> ` atau `Coder> `).
   - Event loop Node.js tetap memompa heartbeat setiap 2 detik dan melakukan polling pesan masuk secara asynchronous di latar belakang.

2. **Dua Mode Input di Prompt Konsol:**
   - **Slash Commands (`/<command>`):** Digunakan untuk perintah operasional cepat:
     - `/msg <bot> <pesan>` atau `/send`: Mengirim pesan langsung ke bot lain.
     - `/broadcast <pesan>`: Mempublikasikan pengumuman ke seluruh bot.
     - `/peers`: Menampilkan tabel rekan bot aktif di session.
     - `/roots`: Menampilkan daftar project root terdaftar.
     - `/log`: Menampilkan riwayat kerja terkini sesi.
     - `/mode review|turbo`: Mengubah mode eksekusi secara instan.
     - `/help`, `/clear`, `/exit`.
   - **Natural Language Direct Instruction:** Teks biasa tanpa awalan `/` langsung diteruskan ke `AutonomousAgentLoop` bot lokal sebagai instruksi operator, sehingga bot lokal langsung bernalar dan bekerja tanpa operator harus mengetik perintah kirim pesan yang panjang.

3. **Mekanisme Non-Destructive TTY Output Rendering (Solusi `OI-301`):**
   - Saat ada event masuk dari Blackboard (misal: pesan dari rekan bot atau event broadcast), metode `printNotification(text)` akan:
     1. Menulis escape sequence ANSI `\r\x1b[K` untuk membersihkan baris kursor saat ini.
     2. Mencetak notifikasi pesan baru di baris baru.
     3. Memanggil `readlineInterface.prompt(true)` untuk merender kembali prompt dan memulihkan teks ketikan pengguna yang sedang diketik sebelum interupsi.
   - Hal ini menjamin ketikan operator tidak pernah hilang atau berantakan (*mangled*).

---

## 3. Konsekuensi

- **Positif:**
  - Konsep "Satu Bot, Satu Terminal All-in-One" terwujud sepenuhnya.
  - Operator tidak lagi membutuhkan terminal terpisah hanya untuk mengirim pesan.
  - Interaksi Human-in-the-Loop menjadi alami dan terpusat langsung pada konsol bot.
- **Negatif / Mitigasi:**
  - Lingkungan non-TTY (misal CI/CD atau piping terminal) tidak mendukung ANSI escape sequence.
  - *Mitigasi:* Sistem mendeteksi `process.stdout.isTTY`: jika bukan TTY (misal dalam automated test headless), sistem beralih ke fallback streaming teks standar.
