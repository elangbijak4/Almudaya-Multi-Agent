# Phase 6 Gate — Autonomous Multi-Bot Agent Loop & Blackboard Collaboration (v0.2.0)

## Required Deliverables

- **Implementasi Autonomous ReAct Agent Loop (`src/bot/agent-loop.ts`):**
  - Siklus otonom ReAct (Reason - Act - Observe) sesuai ADR-204 & FR-216.
  - Pengambilan konteks dinamis Session Blackboard (identitas bot, rekan bot aktif, project roots) untuk membentuk System Prompt dinamis.
  - Resolusi function calling terintegrasi dengan perkakas sandboxed (`read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`, `run_command`).
  - Integrasi controller mode keamanan (`REQUEST_REVIEW` vs `TURBO`) sebelum eksekusi mutasi.
  - Pencatatan Audit Trail transparan (FR-217) ke `broadcast/events.jsonl` Blackboard untuk seluruh aktivitas dan keputusan koding.
  - Balasan otomatis (*autonomous reply*) ke bot pengirim melalui `MessagingService.sendDirectMessage`.
  - Guardrail pembatasan maksimal iterasi ReAct (`maxIterations`, default 10) guna mencegah infinite loop.
- **Ekspansi CLI `almudaya bot run` (FR-218):**
  - Penambahan opsi `--provider <gemini|mock>`, `--model <model>`, `--mode <review|turbo>`, dan `--max-iterations <count>`.
  - Inisialisasi otomatis Gemini AI jika env `GEMINI_API_KEY` terdeteksi.
- **Automated Tests (`tests/bot/agent-loop.test.ts` & `tests/cli/bot-cli.test.ts`):**
  - Uji eksekusi tugas otonom di mode `TURBO` dan pengiriman balasan langsung.
  - Uji penolakan review di mode `REQUEST_REVIEW` yang menjamin zero file mutation pada disk.
  - Uji guardrail pemutus infinite loop pada ambang batas iterasi.
  - Uji verifikasi eksposur flag AI pada antarmuka CLI.

## Exit Criteria

- [x] Autonomous Agent Loop mampu memproses pesan masuk dan melakukan ReAct bolak-balik dengan model AI (FR-216).
- [x] Jejak pemanggilan tool dan keputusan koding tercatat secara transparan di Blackboard broadcast (FR-217).
- [x] Parameter CLI `--provider`, `--model`, `--mode`, dan `--max-iterations` terekspos dan berfungsi di `almudaya bot run` (FR-218).
- [x] TypeScript strict compilation lulus 100% tanpa kompromi (`npm run build`).
- [x] Seluruh 136 pengujian otomatis lulus 100% (`npm test`).

## Gate Decision

- **Hasil:** PASSED
- **Evidence:** 136 automated tests passing across 26 test suites (~3.3s).
- **Rekomendasi:** Lanjut ke Phase 7: End-to-End Verification & Validation (Multi-Bot Autonomous Coding Benchmark).
- **Tanggal:** 2026-11-02
