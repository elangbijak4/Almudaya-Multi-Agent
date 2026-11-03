# Data Flows & Interaction Sequences — Almudaya Multi-Agent v0.3.0

Dokumen ini memodelkan diagram alir data dan urutan interaksi (*Sequence Diagrams*) untuk subsistem v0.3.0.

---

## 1. Alir Pemrosesan Perintah Konsol REPL

```mermaid
flowchart TD
    A["Operator Mengetik Input di Prompt"] --> B{"Apakah Berawalan Slash (/)? "}
    
    B -- Ya (Perintah Konsol) --> C["Parse Command & Arguments"]
    C --> D{"Tipe Perintah"}
    D -- "/msg <bot> <pesan>" --> E["MessagingService.sendDirectMessage"]
    D -- "/broadcast <pesan>" --> F["MessagingService.publishBroadcast"]
    D -- "/peers" --> G["BotService.listBots & Render Tabel"]
    D -- "/roots" --> H["SharedContextService.listProjectRoots"]
    D -- "/log" --> I["WorkLogService.readRecentWorkLogs"]
    D -- "/mode <review|turbo>" --> J["ExecutionModeController.setMode"]
    D -- "/clear" --> K["console.clear()"]
    D -- "/exit" --> L["runtime.stop() & process.exit(0)"]
    
    B -- Tidak (Bahasa Alami) --> M["Bungkus sebagai Pesan Operator"]
    M --> N["AutonomousAgentLoop.handleMessage"]
    N --> O["AI Model Provider Reasoning"]
    O --> P["Tool Execution & Work Log Recording"]
    P --> Q["Cetak Jawaban Akhir di Konsol"]
    
    E --> R["Tampilkan Konfirmasi & Kembalikan Prompt"]
    F --> R
    G --> R
    H --> R
    I --> R
    J --> R
    K --> R
    Q --> R
```

---

## 2. Diagram Urutan Pengiriman Pesan Antar-Terminal Melalui Konsol (`/msg`)

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Operator di Terminal 1
    participant C1 as BotConsole (Terminal 1 - Architect)
    participant MS as MessagingService (Blackboard)
    participant C2 as BotConsole (Terminal 2 - Coder)
    participant AL as AutonomousAgentLoop (Coder AI)
    participant FS as Sandboxed Project Root Disk

    Operator->>C1: Ketik: /msg Coder "Buatkan modul auth.js"
    C1->>MS: sendDirectMessage(to: "Coder", content: "Buatkan modul auth.js")
    MS-->>C1: Message Stored (Status: unread)
    C1-->>Operator: ✅ Pesan terkirim ke Coder (BOT002)

    Note over MS,C2: Polling Asynchronous (Interval: 1000ms)
    MS->>C2: Inbox Message Delivered ("Buatkan modul auth.js")
    C2->>AL: handleMessage(msg)
    AL->>FS: write_file("src/auth.js", content)
    FS-->>AL: File Created Atomically
    AL->>MS: appendWorkLog("Coder", WRITE, "backend", "src/auth.js")
    AL->>MS: sendDirectMessage(to: "Architect", content: "Modul auth.js selesai.")
    
    MS->>C1: Inbox Message Arrived from Coder
    C1->>C1: Suspend prompt line -> Print Message -> Restore prompt
    C1-->>Operator: ✉️ [BOT BOT001] Pesan masuk dari Coder: "Modul auth.js selesai."
```

---

## 3. Diagram Alir Pencatatan & Pembacaan Memori Kerja Sesi (`work_log.jsonl`)

```mermaid
sequenceDiagram
    autonumber
    participant Bot as Bot AI Agent
    participant FT as File/Command Tools
    participant SB as Sandbox Guard
    participant WLS as WorkLogService
    participant BB as sessions/<id>/work_log.jsonl

    Bot->>FT: executeTool("write_file", path: "src/server.ts")
    FT->>SB: validateSandboxedPath(path)
    SB-->>FT: Path Resolved to Root "backend" (D:\testingbot\backend)
    FT->>FT: Atomic Write to Disk
    FT->>WLS: recordWorkEntry({ botId, rootId: "backend", relativePath: "src/server.ts", action: "WRITE" })
    WLS->>BB: withSessionLock -> appendLine(WorkLogEntry JSON)
    BB-->>WLS: Persisted
    WLS-->>FT: Work Log Saved
    FT-->>Bot: Tool Execution Result

    Note over Bot,BB: Bot Lain Ingin Mengetahui Aktivitas Terkini
    participant PeerBot as Peer Bot (Tester / Architect)
    PeerBot->>WLS: get_work_log({ rootId: "backend", limit: 5 })
    WLS->>BB: readLines & filter(rootId == "backend")
    BB-->>WLS: WorkLogEntry[]
    WLS-->>PeerBot: [{ timestamp, bot: "Coder", action: "WRITE", file: "src/server.ts" }]
```
