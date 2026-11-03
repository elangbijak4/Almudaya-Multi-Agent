# Phase 4 Gate — Interactive Bot Console REPL (v0.3.0)

## Required Deliverables

- **Implementasi All-in-One Interactive Bot Console (`src/bot/console.ts`):**
  - Implementasi kelas `BotConsole` membungkus modul standar `node:readline` tanpa dependensi eksternal berat (ADR-301, NFR-301).
  - Tampilan prompt interaktif non-blocking berbasis nama bot (`<BotName>> `).
  - Dispatcher perintah slash lengkap:
    - `/msg <targetBot> <pesan>` atau `/send`: Mengirim pesan langsung ke rekan bot.
    - `/broadcast <pesan>` atau `/shout`: Mengirim pesan broadcast ke seluruh session.
    - `/peers`: Memeriksa rekan bot aktif dan stale dalam session.
    - `/roots`: Memeriksa daftar project roots terdaftar.
    - `/log [limit] [root]`: Memeriksa linimasa riwayat kerja sesi.
    - `/mode [review|turbo]`: Memeriksa dan mengubah mode eksekusi secara dinamis (FR-307).
    - `/status`: Memeriksa status bot, PID, session ID, provider AI, dan mode keamanan.
    - `/clear`: Membersihkan tampilan layar terminal (mendukung ANSI TTY dan non-TTY fallback).
    - `/help`: Panduan bantuan ringkas seluruh perintah interaktif.
    - `/exit`, `/quit`: Penutupan graceful bot dan konsol (FR-318).
  - Forwarding teks bahasa alami langsung ke `AutonomousAgentLoop` (FR-304).
  - Algoritma *Non-Destructive TTY Output Rendering* (`\r\x1b[K` ANSI) agar pesan masuk Blackboard tidak merusak teks ketikan operator (FR-310).
  - Penanganan prompt konfirmasi interaktif Human-in-the-Loop (`askQuestion`) terintegrasi dengan `ExecutionModeController` (FR-317).
  - Dukungan stream virtual (`inputStream`, `outputStream`) untuk pengujian otomatis 100% offline (NFR-302).
- **Integrasi CLI (`src/cli/commands/bot.ts`):**
  - Perintah `almudaya bot run` mentransformasikan loop blokir pasif lama menjadi siklus konsol REPL aktif interaktif.
  - Notifikasi pesan dan broadcast masuk dialirkan melalui `printNotification` konsol.
- **Ekspor Subsystem (`src/bot/index.ts` & `src/index.ts`):**
  - `BotConsole` dan antarmuka `BotConsoleOptions` diekspor secara publik.
- **Pengujian Unit Komprehensif (`tests/bot/console.test.ts`):**
  - 17 unit test mencakup inisialisasi banner, seluruh perintah slash, pengalihan mode, instruksi AI, rendering ANSI non-destruktif, prompt konfirmasi review, dan penutupan graceful.

## Exit Criteria

- [x] Kode `src/bot/console.ts` terkompilasi TypeScript strict tanpa error (`npm run build`).
- [x] Seluruh 17 pengujian unit di `tests/bot/console.test.ts` lulus 100%.
- [x] Seluruh rangkaian pengujian sistem (29 berkas pengujian, 170 tests) lulus 100% tanpa regresi (`npm test`).
- [x] Invariant 1 (Session-Centric), Invariant 2 (Stable Identity), Invariant 6 (Review Sovereignty), NFR-301 (TypeScript Strict), NFR-302 (Offline Testing), NFR-303 (Cross-Platform), dan NFR-304 (Instant Keyboard Latency) terpenuhi secara penuh.
- [x] Perintah `almudaya bot run` berhasil menjadi terminal all-in-one tanpa memerlukan pembukaan terminal tambahan untuk komunikasi antar-bot.

## Gate Decision

- **Hasil:** PASSED
- **Evidence:**
  - Build status: Clean compile (`tsc` exit code 0).
  - Test status: 29 test suites passed, 170 tests passed in 2.70s.
  - Deliverables: `src/bot/console.ts`, `src/cli/commands/bot.ts`, `src/bot/index.ts`, `tests/bot/console.test.ts`.
- **Rekomendasi:** Lanjut ke Phase 5: ReAct Loop Integration & Context Prompt Injection (`src/ai/prompts.ts`, `src/bot/agent-loop.ts`, `src/tools/work-log-tool.ts`).
- **Tanggal:** 2026-11-03
