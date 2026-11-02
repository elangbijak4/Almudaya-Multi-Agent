# System Design Document — Almudaya Multi-Agent v0.2.0

**Document Version:** 0.2.0  
**Status:** DRAFT (Phase 2 Architecture & Design)  
**Date:** 2026-11-02  

---

## 1. Arsitektur Modul Baru (Folder Structure)

Untuk mengimplementasikan kapabilitas v0.2.0, struktur direktori kode sumber diperluas secara modular tanpa merusak kode v0.1.0:

```text
src/
├── ai/                     # [BARU] Lapisan Abstraksi AI Multi-Provider
│   ├── provider.ts         # Definisi interface IAIModelProvider, ToolDefinition, AIRequest/Response
│   ├── gemini.ts           # Adapter resmi Google Gemini (@google/genai)
│   ├── mock-provider.ts    # Deterministic mock provider untuk unit testing offline
│   ├── credentials.ts      # Resolusi API key proses lokal aman (env resolver)
│   └── prompts.ts          # Generator System Prompt dinamis berbasis Blackboard
│
├── tools/                  # [BARU] Perkakas Koding & Eksekusi Shell
│   ├── file-tools.ts       # read_file, write_file, edit_file, list_dir, search_files
│   ├── command-tools.ts    # run_command dengan timeout dan output capture
│   └── sandbox.ts          # Path traversal security guard (Invariant 5)
│
├── bot/                    # [DIPERLUAS]
│   ├── schema.ts           # Schema bot v0.1.0
│   ├── service.ts          # Registri bot v0.1.0
│   ├── runtime.ts          # BotRuntime diperluas mendukung agent loop
│   ├── execution-mode.ts   # [BARU] Pengendali mode REQUEST_REVIEW vs TURBO & prompt CLI
│   └── agent-loop.ts       # [BARU] Mesin ReAct loop (Reason - Act - Observe)
│
├── blackboard/             # [v0.1.0] Persistensi Session, Inboxes, Events (Tidak Berubah)
├── messaging/              # [v0.1.0] Broadcast & Direct Message Services (Tidak Berubah)
├── shared/                 # [v0.1.0] Project Roots, Env Redaction, SDLC Docs (Tidak Berubah)
├── core/                   # [v0.1.0] Errors, Locking, Config, Version
└── cli/                    # [DIPERLUAS] Menambahkan flags --provider, --model, --mode pada 'bot run'
```

---

## 2. Diagram Kelas & Relasi Antar-Komponen

```
 ┌─────────────────────────┐
 │   IAIModelProvider      │◄─────────────────────────────┐
 │  (src/ai/provider.ts)   │                              │
 └───────────▲─────────────┘                              │
             │ implements                                 │
    ┌────────┴────────┐                          ┌────────┴────────┐
    │ GeminiProvider  │                          │ MockAIProvider  │
    │ (@google/genai) │                          │ (Offline Tests) │
    └─────────────────┘                          └─────────────────┘
             ▲                                            ▲
             │                                            │
             └─────────────────────┬──────────────────────┘
                                   │ delegates to
                        ┌──────────┴──────────┐
                        │    AgentLoop        │
                        │ (src/bot/agent-loop)│
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
     ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
     │  ExecutionMode  │  │  FileTools      │  │  CommandTools   │
     │ (Review / Turbo)│  │ (read/write/edit│  │  (run_command)  │
     └─────────────────┘  └────────┬────────┘  └────────┬────────┘
                                   │                    │
                                   └─────────┬──────────┘
                                             │
                                             ▼
                                  ┌─────────────────────┐
                                  │   SandboxGuard      │
                                  │ (project root check)│
                                  └──────────┬──────────┘
                                             │
                                             ▼
                                  ┌─────────────────────┐
                                  │ Target Project Root │
                                  │   (D:\testingbot)   │
                                  └─────────────────────┘
```

---

## 3. Spesifikasi Skema Tool Calling (JSON Schema)

### A. Tool `read_file`
```json
{
  "name": "read_file",
  "description": "Membaca isi berkas teks di dalam target project root.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Path relatif terhadap project root." },
      "start_line": { "type": "number", "description": "Baris awal untuk membaca (opsional, 1-indexed)." },
      "end_line": { "type": "number", "description": "Baris akhir untuk membaca (opsional)." }
    },
    "required": ["path"]
  }
}
```

### B. Tool `write_file`
```json
{
  "name": "write_file",
  "description": "Menulis atau menimpa konten berkas teks di target project root secara atomik.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Path relatif berkas." },
      "content": { "type": "string", "description": "Konten teks lengkap yang akan ditulis." },
      "overwrite": { "type": "boolean", "description": "Apakah boleh menimpa jika berkas sudah ada." }
    },
    "required": ["path", "content"]
  }
}
```

### C. Tool `edit_file`
```json
{
  "name": "edit_file",
  "description": "Mengganti blok teks tertentu dalam berkas dengan blok teks baru secara presisi.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Path relatif berkas." },
      "target": { "type": "string", "description": "Potongan teks eksak yang akan diganti." },
      "replacement": { "type": "string", "description": "Teks pengganti baru." }
    },
    "required": ["path", "target", "replacement"]
  }
}
```

### D. Tool `run_command`
```json
{
  "name": "run_command",
  "description": "Menjalankan perintah sistem / shell di dalam direktori project root target.",
  "parameters": {
    "type": "object",
    "properties": {
      "command": { "type": "string", "description": "Perintah shell lengkap yang akan dieksekusi." },
      "timeout_ms": { "type": "number", "description": "Batas waktu eksekusi dalam milidetik (default: 30000)." }
    },
    "required": ["command"]
  }
}
```

---

## 4. Keamanan & Sandboxing (Invariant 5 & Invariant 6)

1. **Path Resolution Security:**
   Fungsi `validateSandboxedPath(projectRoots: string[], requestedPath: string): string` memastikan path yang diakses dinormalisasi menjadi path absolut menggunakan `path.resolve` dan dipastikan dimulai dengan salah satu string root proyek yang sah. Jika gagal, operasi langsung dibatalkan dengan melempar `PathTraversalSecurityError`.
2. **Review Sovereignty:**
   Dalam mode `REQUEST_REVIEW`, fungsi `ExecutionModeController.requestApproval(action)` menampilkan pratinjau diff dan menanti masukan `y/n/d` dari stream `process.stdin`. Jika pengguna menolak, tool tidak pernah disentuh dan pesan penolakan dikembalikan ke konteks AI.
