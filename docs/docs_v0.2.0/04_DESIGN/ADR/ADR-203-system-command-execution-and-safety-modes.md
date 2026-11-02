# ADR-203: System Command Execution and Safety Modes (Request Review vs Turbo)

- **Status:** APPROVED
- **Date:** 2026-11-02
- **Deciders:** Product Owner, Lead Architect
- **Consulted:** SRS v0.2.0 (FR-211, FR-212, FR-213, FR-214, FR-215, Invariant 6)
- **Resolves:** `OI-202`

---

## 1. Konteks & Masalah

Untuk mewujudkan agen koding otonom seutuhnya, bot tidak hanya perlu mengedit teks, tetapi juga harus mampu menjalankan perintah sistem seperti *compiler* (`tsc`), *test runner* (`npm test`, `pytest`), *formatter* (`prettier`), atau utilitas Git. Namun, mengeksekusi perintah shell sembarangan membawa risiko perintah tak berujung (*infinite hanging process*) atau perubahan tak diinginkan.

Pengguna membutuhkan dua mode fleksibel:
1. **Mode Kehati-hatian (*Request Review*):** Pengembang ingin melihat pratinjau diff atau perintah shell terlebih dahulu dan memberikan persetujuan eksplisit.
2. **Mode Kecepatan (*Turbo*):** Pengembang membiarkan bot bekerja mandiri secara otonom tanpa terhenti pada setiap perintah.

Isu `OI-202` mempertanyakan mekanisme interaktivitas terminal untuk mode `REQUEST_REVIEW`.

---

## 2. Keputusan yang Diambil

1. **Perkakas Perintah Sistem (`run_command`):**
   - Mendefinisikan tool `run_command(command: string, timeout_ms?: number, working_dir?: string)`.
   - Menggunakan `child_process.spawn` dengan shell default platform (`powershell.exe` / `cmd.exe` di Windows, `/bin/sh` di Linux/macOS).
   - Membatasi direktori kerja (`cwd`) hanya pada project root target yang sah.
   - Menerapkan batas waktu default (*timeout* 30.000 ms). Jika melebihi batas, anak proses dimatikan (*tree-kill*) untuk mencegah proses menggantung.

2. **Dua Mode Keamanan Eksekusi (`ExecutionMode`):**
   Sistem mendukung enum mode:
   ```typescript
   export type ExecutionMode = 'REQUEST_REVIEW' | 'TURBO';
   ```
   Dapat disetel saat menjalankan bot via CLI:
   `almudaya bot run --session <id> --bot <id> --mode review` (default)
   `almudaya bot run --session <id> --bot <id> --mode turbo`

3. **Mekanisme Persetujuan Interaktif (Resolusi `OI-202`):**
   - Menggunakan modul standar `node:readline/promises` bawaan Node.js tanpa dependensi pihak ketiga tambahan.
   - Pada mode `REQUEST_REVIEW`, sebelum tool yang memiliki efek samping (`write_file`, `edit_file`, `run_command`) dijalankan, eksekusi dijeda dan terminal menampilkan:
     ```text
     [REVIEW REQUIRED] Bot "Coder" (BOT002) meminta izin:
       Aksi: write_file
       Berkas: D:\testingbot\src\auth.ts
       Ukuran: +48 baris baru
     Apakah Anda menyetujui aksi ini? [y = Setuju, n = Tolak, d = Lihat Diff] (y/n/d): 
     ```
   - Jika operator memilih `y`: Aksi langsung dieksekusi dan hasilnya dikembalikan ke AI.
   - Jika operator memilih `n`: Aksi dibatalkan; tool mengembalikan pesan error `{ success: false, error: "Action rejected by operator" }` sehingga AI dapat berpikir ulang atau mencari alternatif lain.
   - Jika operator memilih `d`: Menampilkan diff baris lengkap sebelum meminta konfirmasi kembali.

4. **Perilaku Mode `TURBO`:**
   - Seluruh pemeriksaan interaktif dilewati. Aksi langsung dieksekusi selama berada di dalam sandbox project root yang sah.
   - Setiap aksi tetap dicatat secara transparan ke log event Session Blackboard untuk audit trail.

---

## 3. Konsekuensi

- **Positif:**
  - Pengembang memiliki kedaulatan mutlak (*Human Sovereignty / Invariant 6*) saat mengawasi pekerjaan bot berisiko tinggi.
  - Pengembang dapat memilih mode `TURBO` saat melakukan tugas repetitif atau pengujian otonom cepat.
  - Nol dependensi eksternal untuk modul persetujuan interaktif.
- **Negatif / Mitigasi:**
  - Pada mode `REQUEST_REVIEW`, proses bot akan menunggu sampai operator merespons terminal. Jika terminal ditinggal, bot berada dalam status menunggu. Hal ini sudah sesuai dengan prinsip desain *human-in-the-loop*.
