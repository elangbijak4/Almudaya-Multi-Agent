# Diagram Alir Data & Sekuens (Data Flows) — Almudaya Multi-Agent v0.3.1

Dokumen ini memvisualisasikan alur pemrosesan data, validasi keamanan, dan transisi status untuk rilis v0.3.1.

---

## 1. Eksekusi Shell Tersanitasi & Redaksi Output (`run_command`)

Diagram urutan berikut menggambarkan bagaimana variabel lingkungan dibersihkan sebelum subprocess shell dijalankan, serta bagaimana output divalidasi sebelum disimpan ke memori kerja:

```mermaid
sequenceDiagram
    autonumber
    participant Bot as AutonomousAgentLoop
    participant Sandbox as SandboxTool (sandbox.ts)
    participant Sanitizer as EnvSanitizer (Allowlist)
    participant Child as OS Child Process (exec)
    participant WorkLog as WorkLogService (work_log.jsonl)

    Bot->>Sandbox: executeRunCommand({ command, working_dir })
    Sandbox->>Sandbox: assertWithinRoot(working_dir) via realpathSync
    Sandbox->>Sanitizer: sanitizeChildEnv(process.env)
    Note over Sanitizer: Hapus GEMINI_API_KEY, GITHUB_TOKEN<br/>Pertahankan hanya PATH, SYSTEMROOT, TEMP, dll.
    Sanitizer-->>Sandbox: sanitizedEnv
    Sandbox->>Child: child_process.exec(command, { cwd, env: sanitizedEnv, timeout })
    Child-->>Sandbox: { stdout, stderr, exitCode }
    Sandbox->>Sandbox: redactSensitiveOutput(stdout/stderr)
    Sandbox->>WorkLog: recordWorkLog({ action: "COMMAND", summary, details: { stdout_snippet } })
    WorkLog-->>Sandbox: OK (tersimpan aman di work_log.jsonl)
    Sandbox-->>Bot: ToolExecutionResult { exitCode, stdout, stderr }
```

---

## 2. Resolusi Kanonikal Filesystem Sandbox (`assertWithinRoot`)

Diagram alir berikut memvalidasi apakah suatu path target (berkas yang sudah ada atau berkas baru) lolos verifikasi isolasi kanonikal terhadap seluruh root proyek terdaftar:

```mermaid
flowchart TD
    Start["Menerima targetPath & registeredRoots"] --> Resolve["path.resolve(targetPath)"]
    Resolve --> CheckExist{"Apakah targetPath ada di disk?"}
    
    CheckExist -- Ya --> RealPathTarget["fs.realpathSync(targetPath)"]
    CheckExist -- Tidak --> RealPathParent["Cari parent direktori terdekat yang ada<br/>fs.realpathSync(existingParent) + subPath"]
    
    RealPathTarget --> LoopRoots["Periksa terhadap setiap Registered Project Root"]
    RealPathParent --> LoopRoots
    
    LoopRoots --> CanonicalRoot["fs.realpathSync(root.path)"]
    CanonicalRoot --> MatchCheck{"Apakah target fisik diawali<br/>dengan canonical root path?"}
    
    MatchCheck -- Ya --> Allow["Izin Diberikan (Path Valid & Terisolasi)"]
    MatchCheck -- Tidak --> NextRoot{"Masih ada root lain?"}
    NextRoot -- Ya --> LoopRoots
    NextRoot -- Tidak --> Deny["Tolak Akses: Access denied (Symlink/Junction Escape Ditangkal)"]
```

---

## 3. Siklus Transaksional Pesan Inbox (*At-Least-Once Delivery*)

Diagram status berikut menunjukkan transisi status pesan inbox, menjamin bahwa kegagalan di tengah jalan tidak mengakibatkan pesan hilang:

```mermaid
stateDiagram-v2
    [*] --> UNREAD: Pesan masuk ke inbox/<botId>/messages.jsonl
    
    UNREAD --> PICKED_UP: Bot polling cycle membaca pesan (markAsRead=false)
    
    state PICKED_UP {
        [*] --> REACT_REASONING: Inisiasi siklus AI ReAct
        REACT_REASONING --> TOOL_EXECUTION: Panggilan perkakas (bila ada)
        TOOL_EXECUTION --> RESPONSE_SYNTHESIS: Sintesis jawaban akhir
        RESPONSE_SYNTHESIS --> [*]: Selesai dengan sukses
    }
    
    PICKED_UP --> ACKNOWLEDGED: Eksekusi turn berhasil penuh (Auto-Ack / Mark as Read)
    PICKED_UP --> UNREAD: Terjadi crash, timeout, atau jeda kuota 429 (Re-queue / Siap Diproses Ulang)
    
    ACKNOWLEDGED --> [*]: Siklus tuntas terarsip
```

---

## 4. Penanganan Adaptif Jeda Kuota Model Gemini (429 Throttling)

Diagram sekuens berikut menunjukkan alur penanganan respons 429 yang menenangkan operator dan mengotomatiskan jeda tunggu:

```mermaid
sequenceDiagram
    autonumber
    participant Agent as AutonomousAgentLoop
    participant Provider as GeminiProvider (gemini.ts)
    participant GeminiAPI as Google Gemini API
    participant Console as BotConsole (REPL)

    Agent->>Provider: generateResponse(messages)
    Provider->>GeminiAPI: generateContent(...)
    GeminiAPI-->>Provider: HTTP 429 RESOURCE_EXHAUSTED (RetryInfo: retryDelay "39.61s")
    
    Provider->>Provider: parseRetryDelay("39.61s") -> 39610 ms
    Provider-->>Agent: lempar RateLimitPauseError(durationMs: 39610)
    
    Agent->>Console: printNotification("⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED). Menunggu jeda 40 detik...")
    Console-->>Console: Render status jeda tanpa merusak kursor ketikan operator
    
    Agent->>Agent: sleep(retryDelayMs + 1000ms jitter)
    Note over Agent: Pesan inbox TETAP berstatus UNREAD selama masa jeda
    
    Agent->>Provider: generateResponse(messages) (Percobaan Ulang Otomatis)
    Provider->>GeminiAPI: generateContent(...)
    GeminiAPI-->>Provider: HTTP 200 OK (Respons Model Diterima)
    Provider-->>Agent: ProviderResult { content, toolCalls }
    Agent->>Agent: Lanjutkan pemrosesan ReAct & tandai pesan ACKNOWLEDGED
```
