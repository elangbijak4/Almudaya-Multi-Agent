# Requirement Traceability Matrix — Almudaya Multi-Agent v0.2.0

**Status:** IN PROGRESS (Phase 5 Verified)  
**Date:** 2026-11-02  

Dokumen ini memetakan setiap kebutuhan fungsional dan non-fungsional v0.2.0 ke modul desain, modul implementasi, dan pengujian otomatis pendukungnya.

---

## 1. Functional Requirements Matrix

| Requirement | Deskripsi Singkat | Modul Desain | Modul Implementasi | Rencana Verifikasi | Status |
|---|---|---|---|---|:---:|
| **FR-201** | Abstraksi provider AI (`IAIModelProvider`) | ADR-201, SYSTEM_DESIGN | `src/ai/provider.ts` | `tests/ai/provider.test.ts` | **VERIFIED** |
| **FR-202** | Adapter Google Gemini SDK | ADR-201, SYSTEM_DESIGN | `src/ai/gemini.ts` | `tests/ai/gemini.test.ts` | **VERIFIED** |
| **FR-203** | Konfigurasi AI independen per bot | ADR-201, SYSTEM_DESIGN | `src/bot/runtime.ts` | `tests/ai/gemini.test.ts` | **VERIFIED** |
| **FR-204** | Resolusi API key proses lokal aman | ADR-201, SYSTEM_DESIGN | `src/ai/credentials.ts` | `tests/ai/credentials.test.ts` | **VERIFIED** |
| **FR-205** | Injeksi konteks dinamis ke System Prompt | ADR-201, SYSTEM_DESIGN | `src/ai/prompts.ts` | `tests/ai/provider.test.ts` | **VERIFIED** |
| **FR-206** | File Tool: `read_file` | ADR-202, SYSTEM_DESIGN | `src/tools/file-tools.ts` | `tests/tools/file-tools.test.ts` | **VERIFIED** |
| **FR-207** | File Tool: `write_file` | ADR-202, SYSTEM_DESIGN | `src/tools/file-tools.ts` | `tests/tools/file-tools.test.ts` | **VERIFIED** |
| **FR-208** | File Tool: `edit_file` | ADR-202, SYSTEM_DESIGN | `src/tools/file-tools.ts` | `tests/tools/file-tools.test.ts` | **VERIFIED** |
| **FR-209** | File Tools: `list_dir` & `search_files` | ADR-202, SYSTEM_DESIGN | `src/tools/file-tools.ts` | `tests/tools/file-tools.test.ts` | **VERIFIED** |
| **FR-210** | Path Traversal Sandbox Enforcement | ADR-202, SYSTEM_DESIGN | `src/tools/sandbox.ts` | `tests/tools/sandbox.test.ts` | **VERIFIED** |
| **FR-211** | Command Tool: `run_command` | ADR-203, SYSTEM_DESIGN | `src/tools/command-tools.ts`| `tests/tools/command-tools.test.ts` | **VERIFIED** |
| **FR-212** | Command Tool: Timeout & stdout/stderr | ADR-203, SYSTEM_DESIGN | `src/tools/command-tools.ts`| `tests/tools/command-tools.test.ts` | **VERIFIED** |
| **FR-213** | Mode Keamanan: `REQUEST_REVIEW` | ADR-203, SYSTEM_DESIGN | `src/bot/execution-mode.ts` | `tests/bot/execution-mode.test.ts` | **VERIFIED** |
| **FR-214** | Mode Keamanan: `TURBO` | ADR-203, SYSTEM_DESIGN | `src/bot/execution-mode.ts` | `tests/bot/execution-mode.test.ts` | **VERIFIED** |
| **FR-215** | Konfigurasi mode via CLI flag | ADR-203, SYSTEM_DESIGN | `src/cli/commands/bot.ts` | `tests/bot/execution-mode.test.ts` | **VERIFIED** |
| **FR-216** | Autonomous Multi-Bot ReAct Loop | ADR-204, SYSTEM_DESIGN | `src/bot/agent-loop.ts` | `tests/bot/agent-loop.test.ts` | PENDING |
| **FR-217** | Audit Trail Logging di Blackboard | ADR-204, SYSTEM_DESIGN | `src/blackboard/` | `tests/e2e/autonomous-coding.test.ts` | PENDING |
| **FR-218** | CLI `almudaya bot run` AI parameters | ADR-204, SYSTEM_DESIGN | `src/cli/commands/bot.ts` | `tests/cli/bot-cli.test.ts` | PENDING |

---

## 2. Non-Functional Requirements Matrix

| ID | Deskripsi Singkat | Strategi Verifikasi | Status |
|---|---|---|:---:|
| **NFR-201** | TypeScript strict mode | `npm run build` (tsc strict clean build) | **VERIFIED** |
| **NFR-202** | Mock AI Provider untuk offline testing | `tests/ai/provider.test.ts` (100% offline passing) | **VERIFIED** |
| **NFR-203** | Resilience jaringan & retry cerdas | `tests/ai/gemini.test.ts` (Transient retry passing) | **VERIFIED** |
| **NFR-204** | Efisiensi I/O pembacaan berkas | `tests/tools/file-tools.test.ts` (10MB limit & line ranges) | **VERIFIED** |
| **NFR-205** | Kompatibilitas lintas platform (Windows/POSIX) | Path normalization tests | **VERIFIED** |
