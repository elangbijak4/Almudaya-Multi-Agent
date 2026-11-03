# Phase 5 Gate — ReAct Loop Integration & Context Prompt Injection (v0.3.0)

## Required Deliverables

- **Perkakas Baru AI `get_work_log` (`src/tools/work-log-tool.ts`):**
  - Definisi function declaration JSON Schema `GET_WORK_LOG_TOOL` (dengan parameter `limit`, `root_id`, `bot_id`).
  - Eksekutor `executeGetWorkLog(storage, sessionId, args)` untuk menelusuri riwayat kerja tim lintas-root secara terprogram bagi model AI (FR-315, ADR-302).
  - Ekspor fungsi dan tipe data di `src/tools/index.ts` dan `src/index.ts`.
- **Injeksi Konteks ke System Prompt Dinamis (`src/ai/prompts.ts`):**
  - Parameter `recentWorkLogsMarkdown` ditambahkan ke antarmuka `PromptContext`.
  - Generator `buildDynamicSystemPrompt` menginjeksikan ringkasan Markdown riwayat kerja tim terkini (`## Riwayat Kerja Terakhir di Sesi Ini (Shared Work Memory)`) ke system prompt (FR-314).
  - Model AI secara otomatis memperoleh *team situational awareness* sebelum menyusun rencana atau menulis kode.
- **Pencatatan Otomatis pada Tool Execution (`src/bot/agent-loop.ts`):**
  - Integrasi `WorkLogService` ke dalam ReAct loop `AutonomousAgentLoop`.
  - Setiap eksekusi `write_file`, `edit_file`, dan `run_command` secara otomatis mencatat `WorkLogEntry` ke `work_log.jsonl` di bawah penguncian sesi atomik (FR-313).
  - Resolusi lokasi kerja presisi multi-root (`target_root_id`, `target_root_name`, `target_root_path`, `relative_path`, `full_path`) menggunakan verifikasi sandbox `isPathInsideRoot`.
  - Penambahan perkakas `GET_WORK_LOG_TOOL` ke daftar `availableTools` loop penalaran model AI.
- **Pengujian Unit & Integrasi (`tests/tools/work-log-tool.test.ts`, `tests/bot/agent-loop.test.ts`, `tests/ai/provider.test.ts`):**
  - 5 pengujian unit untuk eksekutor dan skema `get_work_log`.
  - Pengujian ReAct loop untuk pencatatan otomatis mutasi berkas ke memori kerja sesi.
  - Pengujian ReAct loop untuk pemanggilan function calling `get_work_log` oleh model AI.
  - Pengujian injeksi Markdown memori kerja ke System Prompt dinamis.

## Exit Criteria

- [x] Kode `src/tools/work-log-tool.ts`, `src/ai/prompts.ts`, dan `src/bot/agent-loop.ts` terkompilasi TypeScript strict tanpa error (`npm run build`).
- [x] Pengujian perkakas `tests/tools/work-log-tool.test.ts` lulus 100%.
- [x] Seluruh rangkaian pengujian sistem (30 berkas pengujian, 178 tests) lulus 100% tanpa regresi (`npm test`).
- [x] Invariant 1 (Session-Centric), Invariant 5 (Sandbox Boundary), FR-313 (Automatic Mutation Recording), FR-314 (Dynamic Prompt Injection), dan FR-315 (AI Tool `get_work_log`) terpenuhi secara penuh.

## Gate Decision

- **Hasil:** PASSED
- **Evidence:**
  - Build status: Clean compile (`tsc` exit code 0).
  - Test status: 30 test suites passed, 178 tests passed in 2.79s.
  - Deliverables: `src/tools/work-log-tool.ts`, `src/ai/prompts.ts`, `src/bot/agent-loop.ts`, `tests/tools/work-log-tool.test.ts`.
- **Rekomendasi:** Lanjut ke Phase 6: End-to-End Multi-Root Verification Benchmark (`tests/e2e/multi-root-orchestration.test.ts`).
- **Tanggal:** 2026-11-03
