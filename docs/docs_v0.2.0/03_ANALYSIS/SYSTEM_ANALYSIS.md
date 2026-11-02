# System Analysis — Almudaya Multi-Agent v0.2.0

**Document Version:** 0.2.0  
**Status:** DRAFT (Phase 2 System Analysis)  
**Date:** 2026-11-02  

---

## 1. Pendahuluan & Dekomposisi Sistem

Pada versi 0.2.0, sistem bertransformasi dari sekadar fondasi pesan multi-proses menjadi **mesin coding agen otonom**. Sistem diuraikan menjadi empat subsistem inti:

1. **AI Model Provider Subsystem (`src/ai/`):**
   - Mengabstraksi panggilan ke LLM eksternal.
   - Mengelola serialisasi/deserialisasi tool definitions (*Function Declarations*).
   - Membaca kredensial API key dari lingkungan lokal secara aman tanpa menyimpannya ke Blackboard.
2. **Tooling & Sandboxing Subsystem (`src/tools/`):**
   - Menyediakan sekumpulan perkakas manipulasi file (`read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`).
   - Menyediakan eksekusi perintah shell (`run_command`).
   - Menerapkan batasan keamanan (*Sandbox Guard*) agar operasi terbatas murni di dalam `context roots` yang terdaftar.
3. **Execution Control Subsystem (`src/bot/execution-mode.ts`):**
   - Mengatur kebijakan persetujuan eksekusi:
     - `REQUEST_REVIEW`: Menahan aksi berefek samping dan meminta otorisasi interaktif manusia.
     - `TURBO`: Menjalankan aksi secara langsung dengan pencatatan audit.
4. **Autonomous Agent Loop Subsystem (`src/bot/agent-loop.ts`):**
   - Menjalankan siklus ReAct (*Reason - Act - Observe*).
   - Menerjemahkan pesan masuk di inbox menjadi prompt, mengarahkan LLM, menjalankan tools, dan mengirim balasan ke inbox rekan bot.

---

## 2. Analisis Aktor & Interaksi Sistem

```
┌─────────────────┐       Perintah CLI & Izin Review      ┌───────────────────────┐
│ Operator        ├──────────────────────────────────────►│ Almudaya CLI          │
│ Manusia         │◄──────────────────────────────────────┤ (almudaya bot run)    │
└─────────────────┘       Log & Status Real-time          └──────────┬────────────┘
                                                                     │
                                                                     ▼
                                                          ┌───────────────────────┐
                                                          │ Bot Runtime Daemon    │
                                                          │ - PID & Heartbeat     │
                                                          │ - Autonomous ReAct    │
                                                          └─────┬───────────┬─────┘
                                                                │           │
                       ┌────────────────────────────────────────┘           └──────────────────────────────────────┐
                       │                                                                                           │
                       ▼                                                                                           ▼
         ┌───────────────────────────┐                                                               ┌───────────────────────────┐
         │ AI Model Provider         │                                                               │ Tools & Sandboxed Root    │
         │ (Google Gemini SDK)       │                                                               │ - Target Project Files    │
         │ - System Prompt Dinamis   │                                                               │ - Shell Command Execution │
         │ - Function Calling        │                                                               │ - Path Sandboxing Guard   │
         └─────────────┬─────────────┘                                                               └─────────────┬─────────────┘
                       │                                                                                           │
                       └────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                                │
                                                                ▼
                                                   ┌─────────────────────────┐
                                                   │ Session Blackboard      │
                                                   │ - Inboxes (Direct Msg)  │
                                                   │ - Events (Audit Trail)  │
                                                   │ - Context Roots         │
                                                   └─────────────────────────┘
```

---

## 3. Analisis State Machine Siklus Hidup Agen

Setiap bot cerdas yang berjalan dalam mode otonom memiliki mesin status internal:

```
    ┌────────────────┐
    │    IDLE        │◄───────────────────────────┐
    │ (Menunggu Msg) │                            │
    └───────┬────────┘                            │
            │ Pesan baru di Inbox                 │
            ▼                                     │
    ┌────────────────┐                            │
    │   THINKING     │ (LLM Inference)            │
    └───────┬────────┘                            │
            │ Menghasilkan Tool Call              │ Jawaban Final /
            ▼                                     │ Balasan Dikirim
    ┌────────────────┐                            │
    │  EVAL_SAFETY   │ (Cek Mode)                 │
    └───────┬────────┘                            │
            ├── Mode TURBO ──────────────────────┐│
            │                                    ││
            └── Mode REQUEST_REVIEW              ││
                    │                            ││
                    ▼                            ││
            ┌────────────────┐                   ││
            │ AWAIT_APPROVAL │ (Prompt Manusia)  ││
            └───────┬────────┘                   ││
                    ├── Disetujui (Yes)          ││
                    │   │                        ││
                    │   ▼                        ││
                    │ ┌────────────────┐         ││
                    │ │ EXECUTING_TOOL │◄────────┘│
                    │ └───────┬────────┘          │
                    │         │ Hasil Tool        │
                    │         ▼                   │
                    │ ┌────────────────┐          │
                    │ │    OBSERVE     │──────────┘
                    │ └────────────────┘
                    │
                    └── Ditolak (No)
                        │
                        ▼
                      (Feed Error ke AI)
```

---

## 4. Analisis Kasus Kegagalan & Strategi Mitigasi

| Skenario Kegagalan | Dampak | Strategi Mitigasi Arsitektur |
|---|---|---|
| **API Key Hilang / Invalid** | Model AI gagal diinisialisasi. | Validasi pre-flight saat bot dinyalakan: jika env key kosong, cetak pesan panduan jelas dan hentikan proses dengan exit code 1 tanpa mencemari Blackboard. |
| **Quota / Rate Limit LLM** | Inferensi AI terhenti sementara. | Exponential backoff retry dengan jitter (maks 3 kali percobaan) sebelum melempar `ProviderQuotaExceededError`. |
| **Path Traversal Attack** | Bot mencoba mengakses `../../Windows/System32` atau folder di luar proyek. | Canonical path normalization (`path.resolve`) dan validasi ketat `targetPath.startsWith(projectRoot)`. Melempar `PathTraversalSecurityError`. |
| **Infinite Loop Shell Command** | Perintah shell seperti `npm run watch` menggantung dan memblokir bot. | Batas waktu default (*timeout* 30.000 ms). Jika melebihi batas, anak proses sistem operasi langsung di-`SIGKILL` beserta seluruh pohon prosesnya (*tree-kill*). |
| **Konflik Akses File Bersama** | Dua bot memodifikasi berkas yang sama pada waktu bersamaan. | Menggunakan cooperative session locking pada saat penulisan berkas dan mencatat timestamp pembaruan. |
