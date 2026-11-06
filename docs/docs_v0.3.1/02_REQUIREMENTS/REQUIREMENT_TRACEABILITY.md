# Matriks Keterlacakan Kebutuhan (Requirement Traceability Matrix) — v0.3.1

Dokumen ini memetakan keterlacakan dari temuan audit dan pengujian ke kebutuhan fungsional (SRS), kasus penggunaan (Use Cases), komponen kode sasaran, dan rencana uji verifikasi pada rilis v0.3.1.

---

| ID Temuan Audit | Kebutuhan SRS | Kasus Penggunaan | Komponen / Modul Sasaran | Berkas Uji Verifikasi | Status |
|---|---|---|---|---|:---:|
| **SEC-01** (🔴 Env Leak) | **FR-319** (Subprocess Env Sanitization) | **UC-307** | `src/tools/sandbox.ts` | `tests/tools/sandbox.test.ts`, `tests/tools/env-sanitization.test.ts` | Planned |
| **§14/6** (🟡 Junction Escape) | **FR-320** (Realpath Junction Defense) | **UC-308** | `src/tools/sandbox.ts` | `tests/tools/sandbox.test.ts`, `tests/tools/symlink-defense.test.ts` | Planned |
| **RELIA-01** (🔴 Message Loss) | **FR-321** (Transactional Inbox Processing) | **UC-309** | `src/bot/agent-loop.ts`, `src/messaging/service.ts` | `tests/bot/agent-loop.test.ts`, `tests/messaging/transactional.test.ts` | Planned |
| **NT-05** (🔴 429 Retry) | **FR-322** (Gemini Adaptive Backoff) | **UC-310** | `src/ai/gemini.ts` | `tests/ai/gemini-retry.test.ts` | Planned |
| **NT-06** (🟡 429 UX Panic) | **FR-323** (Console Rate-Limit Status) | **UC-310** | `src/bot/console.ts`, `src/bot/agent-loop.ts` | `tests/bot/console.test.ts` | Planned |
| **CONC-02** (🔴 Cursor Race) | **FR-324** (Atomic Broadcast Cursor) | **UC-311** | `src/messaging/service.ts` | `tests/messaging/broadcast-cursor.test.ts` | Planned |
| **NT-01** (🔵 CLI Flag) | **FR-325** (CLI `--no-mark-read`) | **UC-312** | `src/cli/commands/messaging.ts` | `tests/cli/message-read-flag.test.ts` | Planned |
| **§16/1** (🔵 Doc Mismatch) | **FR-326** (Broadcast Category Schema Sync) | — | `README.md`, `USER_MANUAL.md` | `tests/messaging/broadcast.test.ts` | Planned |

---

## Verifikasi Keterlacakan Invarian

- **Invariant 5 (Filesystem Sandbox Boundary):** Dijamin oleh **FR-320** melalui resolusi fisik kanonikal `fs.realpathSync`.
- **Invariant 6 (Human in the Loop Sovereignty):** Dipertahankan pada rilis v0.3.1 tanpa perubahan mekanisme review (`REQUEST_REVIEW` vs `TURBO`).
- **Invariant 7 (Security & Privacy of Credentials):** Dijamin secara ketat oleh **FR-319** melalui pembersihan variabel lingkungan rahasia sebelum subprocess dieksekusi.
