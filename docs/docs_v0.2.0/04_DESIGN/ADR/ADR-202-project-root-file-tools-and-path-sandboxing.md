# ADR-202: Project Root File Tools and Path Sandboxing

- **Status:** APPROVED
- **Date:** 2026-11-02
- **Deciders:** Product Owner, Lead Architect
- **Consulted:** SRS v0.2.0 (FR-206, FR-207, FR-208, FR-209, FR-210, Invariant 5)

---

## 1. Konteks & Masalah

Agar bot dapat melakukan tugas rekayasa perangkat lunak nyata (bukan hanya percakapan teks), bot harus mampu membaca struktur kode sumber, membuat file baru, dan mengedit file yang ada pada direktori target yang dikerjakan. Namun, memberikan akses sistem berkas langsung kepada model AI mengandung risiko keamanan fatal jika bot secara tidak sengaja atau sengaja mencoba memodifikasi file sistem operasi atau direktori pribadi di luar proyek (*Path Traversal Vulnerability*).

---

## 2. Keputusan yang Diambil

1. **Katalog Perkakas Berkas Standar (`src/tools/file-tools.ts`):**
   Mendefinisikan 5 perkakas inti dengan skema JSON Schema yang kompatibel dengan LLM Function Calling:
   - `read_file(path: string, start_line?: number, end_line?: number)`: Membaca isi berkas teks dengan batas baris opsional.
   - `write_file(path: string, content: string, overwrite?: boolean)`: Membuat berkas baru atau menimpa berkas lama secara atomik.
   - `edit_file(path: string, target: string, replacement: string)`: Mengganti potongan teks yang tepat (*exact contiguous block*) dengan kode baru.
   - `list_dir(path?: string, recursive?: boolean)`: Menampilkan daftar file dan sub-folder.
   - `search_files(pattern: string, path?: string)`: Mencari file berdasarkan ekstensi atau nama.

2. **Mekanisme Sandboxing Ketat (Invariant 5):**
   - Sebelum operasi file apa pun dijalankan, path yang diminta bot dinormalisasi menggunakan `path.resolve(projectRoot, requestedPath)`.
   - Sistem memvalidasi apakah path hasil resolusi berakar pada salah satu direktori yang terdaftar di `almudaya context root list --session <id>`.
   - Pada Windows, validasi dilakukan secara *case-insensitive* untuk mencegah *bypass* huruf besar-kecil.
   - Jika path berada di luar seluruh root proyek yang sah, sistem langsung membatalkan operasi dan melempar `PathTraversalSecurityError("Access denied: path is outside registered project roots")`.

3. **Penulisan Atomik & Direktori Otomatis:**
   - Saat bot menulis ke `src/components/Button.tsx`, direktori induk dibuat otomatis (`mkdir -p`).
   - Penulisan menggunakan pola file sementara (`.tmp`) lalu di-rename secara atomik untuk mencegah berkas setengah-tulis (*half-written files*).

---

## 3. Konsekuensi

- **Positif:**
  - Bot dapat bekerja leluasa di dalam proyek target tanpa risiko merusak sistem operasi host.
  - Model AI menerima umpan balik yang terstruktur jika terjadi kesalahan pencarian baris atau penggantian teks.
- **Negatif / Mitigasi:**
  - Bot tidak bisa mengakses file di luar root proyek (misal file konfigurasi global). Mitigasi: Operator dapat menambahkan root sekunder (`context root add --type reference`) jika ada pustaka atau dokumen eksternal yang perlu dibaca bot.
