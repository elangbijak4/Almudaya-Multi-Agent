# Requirement Traceability Matrix — Almudaya Multi-Agent v0.3.0

**Status:** BASELINE ESTABLISHED (Phase 1 Approved)  
**Date:** 2026-11-03  

Dokumen ini memetakan setiap kebutuhan fungsional dan non-fungsional v0.3.0 ke modul desain, modul implementasi, dan pengujian otomatis pendukungnya.

---

## 1. Functional Requirements Matrix

| Requirement | Deskripsi Singkat | Modul Desain | Modul Implementasi | Rencana Verifikasi | Status |
|---|---|---|---|---|:---:|
| **FR-301** | Non-blocking Interactive Console REPL | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-302** | Direct Message Command (`/msg`) | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-303** | Broadcast Command (`/broadcast`) | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-304** | Natural Language Direct Instruction | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-305** | Peer Discovery Command (`/peers`) | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-306** | Roots Inspection Command (`/roots`) | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-307** | Dynamic Mode Switch (`/mode`) | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-308** | Work Log Inspection (`/log`) | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-309** | Utility Commands (`/help`, `/clear`, `/exit`) | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-310** | Non-destructive Output Rendering | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-311** | Work Memory Storage (`work_log.jsonl`) | ADR-302, SYSTEM_DESIGN | `src/shared/work-log.ts` | `tests/shared/work-log.test.ts` | PENDING |
| **FR-312** | Location-Aware Work Log Schema | ADR-302, SYSTEM_DESIGN | `src/shared/work-log.ts` | `tests/shared/work-log.test.ts` | PENDING |
| **FR-313** | Automatic Tool Mutation Logging | ADR-302, SYSTEM_DESIGN | `src/bot/agent-loop.ts` | `tests/shared/work-log.test.ts` | PENDING |
| **FR-314** | Dynamic Work Log Prompt Injection | ADR-302, SYSTEM_DESIGN | `src/ai/prompts.ts` | `tests/ai/prompts.test.ts` | PENDING |
| **FR-315** | AI Tool `get_work_log` | ADR-302, SYSTEM_DESIGN | `src/tools/work-log-tool.ts` | `tests/tools/work-log-tool.test.ts` | PENDING |
| **FR-316** | Cross-Root Sandboxed Tool Dispatching | ADR-302, SYSTEM_DESIGN | `src/tools/sandbox.ts` | `tests/tools/sandbox.test.ts` | PENDING |
| **FR-317** | Inline Human Review in Console | ADR-301, SYSTEM_DESIGN | `src/bot/execution-mode.ts` | `tests/bot/console.test.ts` | PENDING |
| **FR-318** | Graceful Shutdown on Exit | ADR-301, SYSTEM_DESIGN | `src/bot/console.ts` | `tests/bot/console.test.ts` | PENDING |

---

## 2. Non-Functional Requirements Matrix

| ID | Deskripsi Singkat | Strategi Verifikasi | Status |
|---|---|---|:---:|
| **NFR-301** | TypeScript strict mode (0 error) | `npm run build` (tsc clean) | PENDING |
| **NFR-302** | 100% Offline Testability | Virtual TTY Streams & Mock AI Provider | PENDING |
| **NFR-303** | Kompatibilitas Windows cmd.exe, PowerShell, POSIX | Cross-platform readline & path tests | PENDING |
| **NFR-304** | Responsivitas input (< 10ms) | REPL benchmark test suite | PENDING |
| **NFR-305** | Penulisan atomik & penguncian work log | Concurrent append test suite | PENDING |
