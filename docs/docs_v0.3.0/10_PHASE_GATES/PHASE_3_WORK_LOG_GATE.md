# Phase 3 Gate — Shared Session Work Memory Engine (v0.3.0)

## Required Deliverables

- **Implementasi Mesin Memori Kerja (`src/shared/work-log.ts`):**
  - Definisi tipe dan Zod schema `WorkActionTypeSchema` (`WRITE`, `EDIT`, `READ`, `COMMAND`, `DECISION`).
  - Skema data `WorkLogEntrySchema` dan antarmuka `WorkLogEntry` dengan dimensi lokasi presisi (`target_root_id`, `target_root_name`, `target_root_path`, `relative_path`, `full_path`, `summary`, `details`).
  - Generator ID entri unik `generateWorkEntryId` berformat `work_<timestamp>_<hex>`.
  - Kelas `WorkLogService` menyediakan metode:
    - `recordWork(sessionId, input)`: Pencatatan mutasi kerja ke berkas `work_log.jsonl` di bawah penguncian sesi atomik.
    - `readWorkLogs(sessionId, options)`: Penelusuran dan pemfilteran log (berdasarkan `rootId`, `botId`, `actionType`, serta pembatasan *tail slice* `limit`).
    - `getRecentSummaryMarkdown(sessionId, limit)`: Peringkas riwayat kerja tim terformat Markdown untuk injeksi System Prompt AI.
- **Integrasi Abstraksi Penyimpanan Blackboard (`src/blackboard/interface.ts` & `src/blackboard/filesystem.ts`):**
  - Antarmuka `IWorkLogStorage` ditambahkan ke `IBlackboardStorage`.
  - Implementasi metode `appendWorkLog`, `readWorkLogs`, dan `getWorkLogFilePath` pada `FilesystemSessionStorage`.
  - Pengecekan korupsi berkas JSONL dengan pelemparan `CorruptedDataError`.
- **Ekspor Modul (`src/index.ts`):**
  - Seluruh skema, kelas, dan fungsi utilitas memori kerja diekspor secara publik.
- **Pengujian Unit Komprehensif (`tests/shared/work-log.test.ts`):**
  - 16 pengujian unit mencakup: validasi skema, pencatatan mutasi, pelacakan multi-root, filter dan pembatasan limit, peringkasan markdown, ketahanan korupsi berkas, serta simulasi eksekusi konkuren multi-proses (25 thread paralel tanpa data loss).

## Exit Criteria

- [x] Kode `src/shared/work-log.ts` terkompilasi TypeScript strict tanpa error (`npm run build`).
- [x] Seluruh 16 pengujian unit di `tests/shared/work-log.test.ts` lulus 100%.
- [x] Seluruh rangkaian pengujian sistem (28 berkas pengujian, 153 tests) lulus 100% tanpa regresi (`npm test`).
- [x] Invariant 1 (Session-Centric), Invariant 5 (Sandbox Boundary), dan NFR-305 (Atomic Append & Multi-Process Safety) terpenuhi secara penuh.
- [x] Penulisan baris JSONL menggunakan penguncian atomik `withSessionLock`.

## Gate Decision

- **Hasil:** PASSED
- **Evidence:**
  - Build status: Clean compile (`tsc` exit code 0).
  - Test status: 28 test suites passed, 153 tests passed in 3.04s.
  - Deliverables: `src/shared/work-log.ts`, `src/blackboard/interface.ts`, `src/blackboard/filesystem.ts`, `src/index.ts`, `tests/shared/work-log.test.ts`.
- **Rekomendasi:** Lanjut ke Phase 4: Interactive Bot Console REPL (`src/bot/console.ts`).
- **Tanggal:** 2026-11-03
