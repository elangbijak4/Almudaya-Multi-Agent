# ADR-351: Unified Master-HITL Console at Startup (`t = 0`) and Dual Child-Bot Spawn Mode

**Status:** ACCEPTED  
**Date:** 2026-11-15  
**Version:** v0.3.5  

---

## 1. Context

Pada `v0.3.4`, operator harus menyalakan sesi secara terpisah, mendaftarkan root proyek, lalu menyalakan satu per satu bot secara manual (`almudaya bot run`). Tidak ada proses pemimpin yang aktif sejak detik awal untuk menerima Peta Pekerjaan dari programmer, melahirkan bot-bot spesialis secara otomatis, menegakkan protokol `PrBot`/`PrIterasi`/`PrDE`, dan menjadi titik eskalasi tunggal ke manusia (*Human-in-the-Loop*).

Selain itu, muncul kebutuhan UX ketika Master Bot melahirkan bot anak:
- Saat jumlah bot moderat, programmer ingin melihat **jendela terminal CLI terpisah** untuk setiap bot agar alur pikir dan interaksinya tampak nyata dan dapat disapa langsung.
- Ketika bot sangat banyak, jendela yang terlalu banyak membuat layar desktop berantakan sehingga dibutuhkan opsi satu konsol terpadu (*multiplexed*).

---

## 2. Decision

1. **Unified Master-HITL Startup (`t = 0`):**
   - Menambahkan perintah utama `almudaya up` (alias `start`) yang sejak detik pertama (`t = 0`) langsung mendaftarkan **`MASTER` (`BOT000`)** beserta antarmuka REPL interaktif milik **Human-in-the-Loop (HITL)** dalam **satu terminal utama yang sama** ("Satu Konsol, Dua Kursi").
   - `MASTER` otomatis memuat otak model AI default dari konfigurasi CLI atau deteksi kredensial lingkungan, dan hanya boleh ada satu kursi `MASTER` aktif per sesi. Proses bot lain yang bergabung otomatis berstatus `WORKER`.
2. **Dual Child-Bot Terminal Spawn Mode:**
   - Menambahkan opsi CLI `--spawn-mode <windows | multiplexed>` (plus alias `--separate-windows` / `--multiplexed`) serta perintah runtime `/spawn-mode`.
   - **Default: `windows`** — `SpawnManager` membuka jendela terminal OS baru (`wt` / `powershell` / `cmd` pada Windows; `Terminal.app` pada macOS; terminal emulator pada Linux) untuk setiap bot anak yang dibuat oleh Master Bot.
   - **Alternatif: `multiplexed`** — bot anak dijalankan sebagai proses latar belakang dengan log berlabel `[BOT00X]` dialirkan rapi ke konsol utama Master, atau otomatis aktif apabila jumlah jendela melampaui ambang opsional `--max-windows`.

---

## 3. Consequences

### Positif
- *Zero-friction startup*: programmer cukup menjalankan 1 perintah (`almudaya up`) lalu memasukkan Peta Pekerjaan.
- Alur eskalasi HITL selalu mendarat di satu terminal yang pasti (`BOT000` / HITL Console).
- Mendukung keterlihatan penuh multi-CLI secara default (`windows`) namun tetap skalabel untuk armada bot besar (`multiplexed`).

### Konsekuensi Implementasi
- Harus menangani perbedaan sintaks peluncur terminal antar OS (`win32`, `darwin`, `linux`) serta *graceful fallback* ke `multiplexed` ketika dijalankan di lingkungan tanpa GUI / CI headless (termasuk saat `vitest` dijalankan).
- Diperlukan mekanisme pembersihan (*process tree teardown*) agar proses anak tidak tertinggal sebagai *orphan* ketika terminal Master ditutup.
