# System Analysis — Almudaya Multi-Agent v0.3.0

**Versi Dokumen:** 0.3.0  
**Status:** DRAFT (Phase 2 System Analysis)  
**Tanggal:** 2026-11-03  

---

## 1. Pendahuluan & Dekomposisi Sistem

Pada versi 0.3.0, sistem bertransformasi dari antarmuka daemon pasif menjadi **ekosistem konsol interaktif mandiri (*Interactive All-in-One Bot Console*)** yang didukung oleh **memori kerja terpadu sesi berbasis lokasi (*Cross-Root Location-Aware Work Memory*)**.

Sistem diuraikan menjadi empat subsistem inti yang saling berkolaborasi:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ALMUDAYA BOT CONSOLE SUBSYSTEM                        │
│                                 (src/bot/console.ts)                            │
│  - Interactive Non-blocking REPL Prompt (<BotName>> _)                          │
│  - Built-in Slash Commands (/msg, /broadcast, /peers, /roots, /log, /mode, etc.)│
│  - Operator Direct Natural Language Prompt Routing                              │
│  - Non-destructive TTY Line Suspension & Restoration Engine                     │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
┌───────────────────────────────────────┐ ┌───────────────────────────────────────┐
│     BOT RUNTIME & REACT ENGINE        │ │     SESSION WORK MEMORY SUBSYSTEM     │
│   (src/bot/runtime.ts, agent-loop.ts) │ │        (src/shared/work-log.ts)       │
│  - Asynchronous Heartbeat Loop        │ │  - Structured work_log.jsonl Append   │
│  - Inbox Message Consumer             │ │  - Location-Aware WorkLogEntry Schema │
│  - Dynamic Context Injection          │ │  - Dynamic Prompt Injection Engine    │
│  - ReAct Tool Calling Loop            │ │  - Cross-Root Query Tool get_work_log │
└───────────────────┬───────────────────┘ └───────────────────┬───────────────────┘
                    │                                         │
                    └────────────────────┬────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       MULTI-ROOT SANDBOXED TOOLING LAYER                        │
│                   (src/tools/file-tools.ts, command-tools.ts)                   │
│  - Cross-Root Path Validation (Primary, Secondary, Docs, Frontend, Backend)     │
│  - Atomic File Mutation & Precise String Replacements                           │
│  - Tree-kill Protected Command Execution in Target Working Directories          │
│  - Human-in-the-Loop Review Sovereignty (REQUEST_REVIEW vs TURBO)               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Analisis Tantangan Teknis Utama

### A. Tantangan 1: Non-Blocking REPL vs Asynchronous Background Tasks
- **Masalah:** Node.js berjalan pada event loop *single-threaded*. Saat terminal sedang menunggu input keyboard operator di prompt `Architect> `, bot juga harus tetap:
  1. Memompa heartbeat ke Blackboard setiap 2 detik.
  2. Melakukan polling inbox dan broadcast log.
  3. Menjalankan inferensi LLM dan eksekusi tool jika ada tugas masuk.
- **Solusi Analisis:**
  Menggunakan `node:readline` dengan *event-driven stream architecture*. Prompt REPL beroperasi tanpa `while(true)` synchronous yang memblokir. Saat event I/O tiba (misal: pesan masuk), baris input pengguna saat ini disuspensi sementara (*suspended*), pesan dicetak bersih di atas garis, dan prompt beserta teks ketikan pengguna dipulihkan kembali (*restored*) menggunakan escape code ANSI terminal (`readline.cursorTo`, `readline.clearLine`).

### B. Tantangan 2: Lokasi Kerja Multidimensi (*Cross-Root Location Awareness*)
- **Masalah:** Pada sesi yang memiliki lebih dari satu root (misal `frontend` di `D:\project\web` dan `backend` di `D:\project\api`), catatan log tradisional hanya mencatat nama file (misal `src/index.js`), sehingga bot lain tidak tahu apakah file tersebut berada di folder `frontend` atau `backend`.
- **Solusi Analisis:**
  Entri `WorkLogEntry` mewajibkan metadata lokasi lengkap:
  `{ target_root_id, target_root_name, target_root_path, relative_path }`.
  Dengan demikian, jika bot Coder membuat `src/index.js` di root `backend`, bot Tester atau Architect dapat secara akurat mengetahui lokasi absolut dan relatifnya tanpa kebingungan.

### C. Tantangan 3: Persistensi & Akses Konkuren Work Log
- **Masalah:** Beberapa bot yang berjalan di proses OS berbeda dapat menulis atau membaca `work_log.jsonl` pada mikrodetik yang sama.
- **Solusi Analisis:**
  Memanfaatkan mekanisme penguncian file atomik (*kernel-atomic locking*) yang sudah teruji di Session Blackboard untuk append ke `work_log.jsonl`. Pembacaan bersifat non-blocking (*shared read*) untuk performa maksimal.

---

## 3. Analisis Perintah Konsol Interaktif

| Perintah | Argumen | Fungsi |
|---|---|---|
| `/msg` / `/send` | `<botIdentifier> <pesan>` | Mengirim pesan langsung (*point-to-point*) ke bot lain tanpa membuka terminal terpisah. |
| `/broadcast` / `/shout` | `<pesan>` | Mempublikasikan pengumuman ke seluruh bot di session. |
| `/peers` / `/bots` | - | Menampilkan daftar seluruh bot di session beserta status keaktifan dan PID-nya. |
| `/roots` | - | Menampilkan seluruh target direktori proyek yang terdaftar beserta tipe dan path. |
| `/mode` | `<review \| turbo>` | Mengubah mode keamanan eksekusi secara instan di sesi konsol aktif. |
| `/log` | `[limit] [root]` | Menampilkan N riwayat kerja terakhir di session (dapat difilter per root). |
| `/status` | - | Menampilkan ringkasan status bot lokal, model AI, mode keamanan, dan session. |
| `/help` | - | Menampilkan daftar seluruh perintah konsol yang tersedia. |
| `/clear` | - | Membersihkan tampilan layar terminal konsol. |
| `/exit` / `/quit` | - | Menghentikan bot lokal secara anggun (*graceful stop*) dan keluar dari terminal. |
| *(Teks biasa)* | `<instruksi>` | Meneruskan teks sebagai instruksi langsung dari operator ke model AI bot lokal untuk dieksekusi. |
