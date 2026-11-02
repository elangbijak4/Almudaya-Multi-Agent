# Data Flows & Sequence Diagrams — Almudaya Multi-Agent v0.2.0

Dokumen ini memodelkan aliran data dan urutan interaksi temporal antara subsistem pada versi 0.2.0.

---

## 1. Aliran Data ReAct Loop dengan Mode `REQUEST_REVIEW`

Ketika sebuah bot (misal: "Coder") menerima instruksi koding dari bot lain (misal: "Architect") di bawah mode `REQUEST_REVIEW`:

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Operator Manusia
    participant Inbox as Blackboard (inbox/BOT002/)
    participant Bot as BotRuntime (BOT002)
    participant AI as Gemini Provider
    participant Sandbox as Sandbox & Tools
    participant Disk as Target Project Root (D:\testingbot\)
    participant Events as Blackboard (events.jsonl)

    Inbox->>Bot: Pesan baru tiba ("Buat modul auth.ts")
    Bot->>AI: generateResponse(Prompt + Context Roots + Tools Definition)
    AI-->>Bot: Tool Call: write_file("src/auth.ts", content)
    
    rect rgb(255, 240, 230)
    Note over Bot,Operator: Mode REQUEST_REVIEW Aktif
    Bot->>Operator: Tampilkan Pratinjau Diff & Prompt (y/n/d)?
    Operator-->>Bot: Input: 'y' (Disetujui)
    end

    Bot->>Sandbox: executeTool("write_file", args)
    Sandbox->>Sandbox: Validasi path di dalam project root
    Sandbox->>Disk: Tulis file src/auth.ts
    Disk-->>Sandbox: Sukses ditulis (bytes: 1420)
    Sandbox-->>Bot: Tool Result: { success: true, path: "..." }

    Bot->>Events: Catat Audit Event (ACTIVITY: File Created)
    Bot->>AI: Kirim Tool Result kembali ke LLM
    AI-->>Bot: Final Response: "File auth.ts berhasil dibuat dengan validasi."
    Bot->>Inbox: Kirim Direct Message Balasan ke "Architect"
```

---

## 2. Aliran Data ReAct Loop dengan Mode `TURBO`

Ketika bot dijalankan dengan flag `--mode turbo`, siklus eksekusi berjalan tanpa interupsi manusia:

```mermaid
sequenceDiagram
    autonumber
    participant Inbox as Blackboard Inbox
    participant Bot as BotRuntime
    participant AI as Gemini Provider
    participant Tools as Command Tools
    participant Shell as OS Shell Process
    participant Events as Blackboard Event Log

    Inbox->>Bot: Pesan instruksi ("Jalankan unit test auth")
    Bot->>AI: generateResponse(Prompt + Tools)
    AI-->>Bot: Tool Call: run_command("npm test")

    rect rgb(230, 255, 230)
    Note over Bot,Tools: Mode TURBO: Langsung Eksekusi Mandiri
    Bot->>Tools: executeCommand("npm test", timeout: 30000)
    Tools->>Shell: spawnProcess("npm test", cwd: projectRoot)
    Shell-->>Tools: Output: "3 passed, 0 failed" (exitCode: 0)
    Tools-->>Bot: Result: { exitCode: 0, stdout: "...", stderr: "" }
    end

    Bot->>Events: Catat Audit Event (DECISION/ACTIVITY: Tests Passed)
    Bot->>AI: Kirim output terminal ke LLM
    AI-->>Bot: Final Response: "Seluruh pengujian unit auth telah lulus 100%."
    Bot->>Inbox: Balas ke pengirim
```

---

## 3. Aliran Data Injeksi Konteks ke System Prompt

Sebelum memanggil model AI, sistem menyusun System Prompt secara dinamis dari Session Blackboard:

```
┌─────────────────────────────────┐
│ Identitas Bot                   │ -> Display Name, Bot ID, Role, Description
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ Rekan Bot Aktif (Peer Registry) │ -> Daftar bot yang aktif di Session (misal: Architect, Reviewer)
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ Target Project Roots            │ -> Path absolut folder proyek (misal: D:\testingbot)
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ Aturan Perilaku & Format Tool   │ -> Definisi fungsi JSON (read_file, write_file, edit_file, run_command)
└────────────────┬────────────────┘
                 │
                 ▼
      [ Dynamic System Prompt ] ───► Dikirim ke Google Gemini API
```
