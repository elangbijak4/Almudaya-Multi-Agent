# System Design & Architecture — Almudaya Multi-Agent v0.3.0

**Versi Dokumen:** 0.3.0  
**Status:** DRAFT (Phase 2 System Design)  
**Tanggal:** 2026-11-03  

---

## 1. Arsitektur Komponen Baru

```text
src/
├── bot/
│   ├── console.ts          <-- [BARU] BotConsole (Interactive REPL, slash commands, non-destructive TTY)
│   ├── agent-loop.ts       <-- [DIPERBARUI] Integrasi WorkLog recording & get_work_log tool
│   ├── runtime.ts          <-- [DIPERBARUI] Menghubungkan event callback ke BotConsole
│   ├── execution-mode.ts   <-- Controller Request Review vs Turbo
│   └── service.ts
├── shared/
│   ├── work-log.ts         <-- [BARU] WorkLogService & skema WorkLogEntry (work_log.jsonl)
│   ├── service.ts          <-- SharedContextService (Roots, Env, Docs)
│   └── schema.ts
├── tools/
│   ├── work-log-tool.ts    <-- [BARU] Tool get_work_log untuk AI Function Calling
│   ├── sandbox.ts          <-- [DIPERBARUI] Resolusi multi-root dengan metadata root
│   ├── file-tools.ts       <-- Auto-recording ke work_log.jsonl saat mutasi berkas
│   └── command-tools.ts    <-- Auto-recording ke work_log.jsonl saat eksekusi shell
├── ai/
│   ├── prompts.ts          <-- [DIPERBARUI] Injeksi ringkasan work_log ke dynamic system prompt
│   └── gemini.ts
└── cli/
    └── commands/
        └── bot.ts          <-- [DIPERBARUI] Mengaktifkan BotConsole saat almudaya bot run
```

---

## 2. Rincian Antarmuka & Modul Utama

### 2.1 Modul `BotConsole` (`src/bot/console.ts`)

Mengelola siklus hidup interaktif terminal operator.

```typescript
export interface BotConsoleOptions {
  runtime: BotRuntime;
  agentLoop?: AutonomousAgentLoop;
  messagingService: MessagingService;
  botService: BotService;
  sharedContextService: SharedContextService;
  workLogService: WorkLogService;
  executionModeController: ExecutionModeController;
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
}

export class BotConsole {
  // Memulai loop interaktif REPL
  public async start(): Promise<void>;
  
  // Menghentikan konsol secara anggun
  public async stop(): Promise<void>;
  
  // Mencetak notifikasi asynchronous tanpa merusak input aktif operator
  public printNotification(text: string): void;
  
  // Handler internal pemrosesan baris input
  public async handleLine(line: string): Promise<void>;
  
  // Handler untuk perintah slash (/msg, /broadcast, /peers, /roots, /log, dll)
  private async executeSlashCommand(command: string, args: string[]): Promise<void>;
  
  // Handler untuk instruksi teks biasa langsung ke bot lokal
  private async executeLocalInstruction(prompt: string): Promise<void>;
}
```

### 2.2 Algoritma Non-Destructive TTY Output Rendering

Ketika pesan dari Blackboard tiba di tengah-tengah operator sedang mengetik di konsol:
```typescript
public printNotification(text: string): void {
  if (this.isTTY && this.readlineInterface) {
    // 1. Bersihkan baris input saat ini
    this.outputStream.write('\r\x1b[K');
    // 2. Cetak notifikasi lengkap di baris baru
    this.outputStream.write(`${text}\n`);
    // 3. Tampilkan ulang prompt dan ketikan operator yang tersimpan di buffer
    this.readlineInterface.prompt(true);
  } else {
    this.outputStream.write(`${text}\n`);
  }
}
```

---

## 3. Modul `WorkLogService` (`src/shared/work-log.ts`)

Mengelola rekaman kerja sesi berbasis lokasi di `sessions/<id>/work_log.jsonl`.

### 3.1 Skema Data `WorkLogEntry`
```typescript
export type WorkActionType = 'WRITE' | 'EDIT' | 'READ' | 'COMMAND' | 'DECISION';

export interface WorkLogEntry {
  entry_id: string;
  session_id: string;
  timestamp: string;
  bot_id: string;
  bot_name: string;
  action_type: WorkActionType;
  target_root_id: string;
  target_root_name: string;
  target_root_path: string;
  relative_path?: string;
  full_path?: string;
  summary: string;
  details?: Record<string, unknown>;
}
```

### 3.2 Antarmuka Layanan
```typescript
export class WorkLogService {
  // Mencatat aksi kerja baru secara atomik dengan locking
  public async recordWork(sessionId: string, input: RecordWorkInput): Promise<WorkLogEntry>;
  
  // Membaca entri riwayat kerja (dengan filter root, bot, dan limit)
  public async readWorkLogs(sessionId: string, options?: ReadWorkLogOptions): Promise<WorkLogEntry[]>;
  
  // Menghasilkan ringkasan singkat dalam format markdown untuk injeksi System Prompt
  public async getRecentSummaryMarkdown(sessionId: string, limit?: number): Promise<string>;
}
```

---

## 4. Perkakas Baru AI: `get_work_log` (`src/tools/work-log-tool.ts`)

Skema JSON Schema untuk LLM Function Calling:
```json
{
  "name": "get_work_log",
  "description": "Mengambil riwayat kerja terkini seluruh bot di session untuk orkestrasi lintas-root yang akurat.",
  "parameters": {
    "type": "object",
    "properties": {
      "limit": { "type": "number", "description": "Jumlah entri maksimal yang diambil (default: 10)." },
      "root_id": { "type": "string", "description": "Filter berdasarkan ID root proyek spesifik (opsional)." },
      "bot_id": { "type": "string", "description": "Filter berdasarkan ID bot spesifik (opsional)." }
    }
  }
}
```
