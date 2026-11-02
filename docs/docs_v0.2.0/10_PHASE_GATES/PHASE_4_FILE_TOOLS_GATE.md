# Phase 4 Gate — Project Root File Tools & Path Sandboxing (v0.2.0)

## Required Deliverables

- **Implementasi Modul Sandboxing & Tools (`src/tools/`):**
  - `src/tools/sandbox.ts`: 
    - `validateSandboxedPath`: Validasi ketat batas direktori project root (FR-210 & Invariant 5).
    - `isPathInsideRoot` & `normalizeFsPath`: Penanganan case-insensitivity Windows, traversal `..`, dan pencegahan tabrakan prefiks folder.
    - `PathTraversalSecurityError`: Eksepsi keamanan khusus jika bot mencoba keluar dari root terdaftar.
    - `getRelativeSandboxedPath`: Konversi path internal ke path relatif bersih dengan garis miring konsisten.
  - `src/tools/file-tools.ts`:
    - `read_file` (FR-206): Pembacaan berkas teks aman dengan dukungan line range slicing (1-based) dan proteksi file raksasa (NFR-204).
    - `write_file` (FR-207): Penulisan berkas baru atau penimpaan berkas lama secara atomik via file sementara (`.tmp`), dengan pembuatan folder induk otomatis (`mkdir -p`).
    - `edit_file` (FR-208): Penggantian potongan teks presisi (*exact search-and-replace*) dengan deteksi kesalahan string tidak ditemukan.
    - `list_dir` & `search_files` (FR-209): Penjelajahan pohon berkas dan pencarian kata kunci nama/konten dengan pengabaian folder bising (`.git`, `node_modules`, `.almudaya`).
    - `FILE_TOOLS`: Skema deklarasi perkakas (`ToolDefinition`) standar yang siap diinjeksikan ke AI Function Calling.
    - `executeFileTool`: Dispatcher terpusat untuk eksekusi panggilan tool LLM.
  - `src/tools/index.ts`: Ekspor modul perkakas terpadu.
- **Automated Tests (`tests/tools/`):**
  - `tests/tools/sandbox.test.ts`: Uji validasi relative/absolute paths, penolakan path traversal (`..`), dukungan multi-root, dan isolasi keamanan Windows.
  - `tests/tools/file-tools.test.ts`: Uji seluruh fungsi `read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`, dispatcher, dan schema conformancy.

## Exit Criteria

- [x] Sandboxing mencegah seluruh akses berkas di luar project root terdaftar (FR-210, Invariant 5).
- [x] Perkakas `read_file`, `write_file`, `edit_file`, `list_dir`, dan `search_files` terimplementasi penuh (FR-206, FR-207, FR-208, FR-209).
- [x] Operasi penulisan berkas bersifat atomik untuk mencegah berkas setengah-tulis (ADR-202).
- [x] Direktori induk dibuat otomatis saat membuat berkas baru di path bersarang.
- [x] Format deklarasi tool kompatibel 100% dengan `IAIModelProvider` Function Calling.
- [x] TypeScript strict mode lulus 100% tanpa kompromi (`npm run build`).
- [x] Seluruh 119 pengujian unit dan integrasi lulus 100% (`npm test`).

## Gate Decision

- **Hasil:** PASSED
- **Evidence:** 119 automated tests passing across 23 test suites (~3.1s).
- **Rekomendasi:** Lanjut ke Phase 5: Command Execution Engine & Safety Modes Implementation.
- **Tanggal:** 2026-11-02
