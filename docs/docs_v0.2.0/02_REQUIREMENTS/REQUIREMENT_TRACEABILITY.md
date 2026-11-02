# Requirement Traceability Matrix — Almudaya Multi-Agent v0.2.0

**Status:** INITIAL BASELINE (Phase 1)  
**Date:** 2026-11-02  

Dokumen ini memetakan setiap kebutuhan fungsional dan non-fungsional v0.2.0 ke modul desain, modul implementasi, dan pengujian otomatis pendukungnya.

---

## 1. Functional Requirements Matrix

| Requirement | Deskripsi Singkat | Modul Desain | Modul Implementasi | Rencana Verifikasi | Status |
|---|---|---|---|---|:---:|
| **FR-201** | Abstraksi provider AI (`IAIModelProvider`) | `docs_v0.2.0/04_DESIGN/` | `src/ai/provider.ts` | `tests/ai/provider.test.ts` | PENDING |
| **FR-202** | Adapter Google Gemini SDK | `docs_v0.2.0/04_DESIGN/` | `src/ai/gemini.ts` | `tests/ai/gemini.test.ts` | PENDING |
| **FR-203** | Konfigurasi AI independen per bot | `docs_v0.2.0/04_DESIGN/` | `src/bot/runtime.ts` | `tests/ai/multi-provider.test.ts` | PENDING |
| **FR-204** | Resolusi API key proses lokal aman | `docs_v0.2.0/04_DESIGN/` | `src/ai/credentials.ts` | `tests/ai/credentials.test.ts` | PENDING |
| **FR-205** | Injeksi konteks dinamis ke System Prompt | `docs_v0.2.0/04_DESIGN/` | `src/ai/prompts.ts` | `tests/ai/prompts.test.ts` | PENDING |
| **FR-206** | File Tool: `read_file` | `docs_v0.2.0/04_DESIGN/` | `src/tools/file-tools.ts` | `tests/tools/file-tools.test.ts` | PENDING |
| **FR-207** | File Tool: `write_file` | `docs_v0.2.0/04_DESIGN/` | `src/tools/file-tools.ts` | `tests/tools/file-tools.test.ts` | PENDING |
| **FR-208** | File Tool: `edit_file` | `docs_v0.2.0/04_DESIGN/` | `src/tools/file-tools.ts` | `tests/tools/file-tools.test.ts` | PENDING |
| **FR-209** | File Tools: `list_dir` & `search_files` | `docs_v0.2.0/04_DESIGN/` | `src/tools/file-tools.ts` | `tests/tools/file-tools.test.ts` | PENDING |
| **FR-210** | Path Traversal Sandbox Enforcement | `docs_v0.2.0/04_DESIGN/` | `src/tools/sandbox.ts` | `tests/tools/sandbox.test.ts` | PENDING |
| **FR-211** | Command Tool: `run_command` | `docs_v0.2.0/04_DESIGN/` | `src/tools/command-tools.ts`| `tests/tools/command-tools.test.ts` | PENDING |
| **FR-212** | Command Tool: Timeout & stdout/stderr | `docs_v0.2.0/04_DESIGN/` | `src/tools/command-tools.ts`| `tests/tools/command-tools.test.ts` | PENDING |
| **FR-213** | Mode Keamanan: `REQUEST_REVIEW` | `docs_v0.2.0/04_DESIGN/` | `src/bot/execution-mode.ts` | `tests/bot/review-mode.test.ts` | PENDING |
| **FR-214** | Mode Keamanan: `TURBO` | `docs_v0.2.0/04_DESIGN/` | `src/bot/execution-mode.ts` | `tests/bot/turbo-mode.test.ts` | PENDING |
| **FR-215** | Konfigurasi mode via CLI flag | `docs_v0.2.0/04_DESIGN/` | `src/cli/commands/bot.ts` | `tests/cli/bot-cli.test.ts` | PENDING |
| **FR-216** | Autonomous Multi-Bot ReAct Loop | `docs_v0.2.0/04_DESIGN/` | `src/bot/agent-loop.ts` | `tests/bot/agent-loop.test.ts` | PENDING |
| **FR-217** | Audit Trail Logging di Blackboard | `docs_v0.2.0/04_DESIGN/` | `src/blackboard/` | `tests/e2e/autonomous-coding.test.ts` | PENDING |
| **FR-218** | CLI `almudaya bot run` AI parameters | `docs_v0.2.0/04_DESIGN/` | `src/cli/commands/bot.ts` | `tests/cli/bot-cli.test.ts` | PENDING |

---

## 2. Non-Functional Requirements Matrix

| ID | Deskripsi Singkat | Strategi Verifikasi | Status |
|---|---|---|:---:|
| **NFR-201** | TypeScript strict mode | `npm run build` (tsc strict clean build) | PENDING |
| **NFR-202** | Mock AI Provider untuk offline testing | `tests/mocks/mock-ai-provider.ts` | PENDING |
| **NFR-203** | Resilience jaringan & retry cerdas | `tests/ai/provider.test.ts` | PENDING |
| **NFR-204** | Efisiensi I/O pembacaan berkas | Benchmark test suite | PENDING |
| **NFR-205** | Kompatibilitas lintas platform (Windows/POSIX) | Path normalization tests | PENDING |
