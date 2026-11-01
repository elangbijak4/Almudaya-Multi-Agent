# Project Charter

**Project:** Almudaya Multi-Agent  
**Target version:** 0.1.0  
**Package name (proposed):** `almudaya-multiagent`  
**CLI name (proposed):** `almudaya`  
**Status:** DRAFT

## 1. Vision

Membangun fondasi lingkungan coding multi-agent yang session-centric. Beberapa bot independen dapat bergabung ke satu Session, berbagi konteks proyek, menemukan satu sama lain, melakukan broadcast, dan bertukar pesan langsung melalui Blackboard persisten.

## 2. Objectives

- Menyediakan Session sebagai batas kolaborasi.
- Menjalankan setiap bot sebagai proses independen.
- Menyimpan identitas dan state bersama secara persisten.
- Menyediakan shared Session Blackboard dan Individual Blackboard.
- Menyediakan komunikasi broadcast dan direct messaging.
- Menyediakan registri project roots, environment, dan dokumen SDLC.
- Menyediakan CLI lintas Windows, Linux, dan macOS.
- Menyediakan fondasi yang dapat diperluas tanpa memaksakan orchestrator.

## 3. Success measures

1. Dua proses bot dapat bergabung ke Session yang sama.
2. Kedua bot terdaftar dan dapat menemukan satu sama lain.
3. Broadcast dan direct message dapat dikirim, dibaca, dan di-acknowledge.
4. Data tetap tersedia setelah proses dihentikan dan dijalankan kembali.
5. Uji integrasi multi-process lulus.
6. Package dapat dibangun dan diperiksa melalui npm pack.

## 4. Principles

- Session-first, bukan team-first.
- Multi-process, bukan satu proses monolitik.
- Persistent state, bukan volatile-only memory.
- Human-directed and interaction-driven collaboration.
- No mandatory orchestrator.
- Minimal viable infrastructure before AI intelligence.
- Cross-platform and testable.

## 5. Scope boundary

Termasuk: CLI, session lifecycle, bot registry, Blackboard, messaging, shared project/environment/document registries, persistence, tests, package scaffold.

Tidak termasuk: LLM provider, autonomous orchestration, MCP, RAG, vector database, GUI, marketplace, standalone SDK, distributed remote execution.

## 6. Constraints and assumptions

- Node.js 22.12+ menjadi baseline awal yang harus diverifikasi.
- TypeScript menjadi bahasa utama.
- npm menjadi package manager/distribution target.
- File system menjadi persistence backend v0.1.0.
- Bot runtime disimulasikan untuk pengujian awal.
- Package name masih harus diperiksa ketersediaannya sebelum publikasi.
- Instalasi system-wide atau perubahan global memerlukan izin pengguna.

## 7. Stakeholders

- Product owner: Almudaya Research Institute.
- Primary operator: project owner/developer.
- Users: developers and AI coding agents participating in a Session.

## 8. Deliverables

- Source code and npm package scaffold.
- CLI.
- Technical design and schemas.
- Automated test suite.
- User and developer documentation.
- Environment and verification reports.
- Release checklist and known limitations.
