# Persistence and Storage Audit (`Phase 0`)

**Target:** All persistent files, schemas, locking/fencing primitives, atomic write utilities, JSONL parsers, and redaction boundaries across `src/`.

---

## 1. Complete Inventory of Persistent Files & Formats

Every persistent artifact in Almudaya Multi-Agent v0.3.3 is stored on the local filesystem (zero external database dependencies exist in `package.json`).

| File Path (Relative to `<sessionDir>`) | Format | Write Mechanism | Read Mechanism | Schema & Version | Owner / Writer | Concurrency Guard |
|---|---|---|---|---|---|---|
| `session.json` | JSON | `atomicWriteJson` (`src/core/fs-utils.ts#L32`) | `readJsonValidated` (`#L76`) | `SessionMetadataSchema` (`1.0.0`) | `FilesystemSessionStorage.createSession`, `updateSession` | `withSessionLock` + `verifyStorageFencing` |
| `.lock` | JSON | `fs.open(path, 'wx')` + `handle.writeFile` (`src/core/lock.ts#L147`) | `fs.readFile` + `JSON.parse` | `LockRecord` interface (`src/core/lock.ts#L16-L24`) | `acquireLock`, `renewLease`, `releaseFn` | Kernel `O_CREAT \| O_EXCL` (`wx`) + `.lock_barrier` directory mutex |
| `.fencing_token` | Plain text integer | `fs.writeFile` (`src/core/lock.ts#L70`) | `fs.readFile` + `parseInt` | Monotonic integer (`1, 2, ...`) | `getNextFencingToken` (called inside `acquireLock`) | Held under `.lock` (`O_EXCL`) |
| `registry/bots.json` | JSON | `atomicWriteJson` | `readJsonValidated` | `BotRegistrySchema` (`1.0.0`) | `FilesystemSessionStorage.saveBotRegistry` (via `BotService`) | `withSessionLock` + `verifyStorageFencing` |
| `registry/project_roots.json` | JSON | `atomicWriteJson` | `readJsonValidated` | `ProjectRootsRegistrySchema` (`1.0.0`) | `FilesystemSessionStorage.saveProjectRootsRegistry` (via `SharedContextService`) | `withSessionLock` + `verifyStorageFencing` |
| `registry/environment.json` | JSON | `atomicWriteJson` | `readJsonValidated` | `EnvironmentMetadataSchema` (`1.0.0`) | `FilesystemSessionStorage.saveEnvironmentMetadata` | `withSessionLock` + `verifyStorageFencing` |
| `registry/documents.json` | JSON | `atomicWriteJson` | `readJsonValidated` | `SdlcDocumentsRegistrySchema` (`1.0.0`) | `FilesystemSessionStorage.saveDocumentsRegistry` | `withSessionLock` + `verifyStorageFencing` |
| `broadcast/events.jsonl` | JSONL | `fs.appendFile` (`src/blackboard/filesystem.ts#L332`) | `readJsonlFile(..., { strict: false })` | `BroadcastEventSchema` (per line) | `FilesystemSessionStorage.appendBroadcast` | `withSessionLock` + `verifyStorageFencing` |
| `broadcast/events.corrupt.jsonl` | JSONL | `fs.appendFile` (`src/core/jsonl.ts#L118`) | Diagnostic inspection | Quarantine object (`source_file`, `quarantined_at`, `line_number`, `raw_line`, `error`) | `readJsonlFile` when malformed line encountered | Best-effort append |
| `inbox/<botId>/messages.json` | JSON | `atomicWriteJson` | `readJsonValidated` | `InboxStoreSchema` (`1.0.0`) | `FilesystemSessionStorage.saveInbox` (via `MessagingService`, `InboxDeliveryService`) | `withSessionLock` + `verifyStorageFencing` |
| `inbox/<botId>/broadcast_cursor.json` | JSON | `atomicWriteJson` | `readJsonValidated` | `BroadcastCursorSchema` | `FilesystemSessionStorage.saveBroadcastCursor` | `withSessionLock` + `verifyStorageFencing` |
| `work_log.jsonl` | JSONL | `fs.appendFile` (`src/blackboard/filesystem.ts#L542`) | `readJsonlFile(..., { strict: true })` | `WorkLogEntrySchema` (per line) | `FilesystemSessionStorage.appendWorkLog` (via `WorkLogService`) | `withSessionLock` + `verifyStorageFencing` |
| `work_log.corrupt.jsonl` | JSONL | `fs.appendFile` (`src/core/jsonl.ts#L118`) | Diagnostic inspection | Quarantine object | `readJsonlFile` | Best-effort append |
| `capabilities/grants.jsonl` | JSONL | `fs.writeFile` full rewrite (`src/capability/persistence.ts#L80, L136`) | `readJsonlFile(..., { strict: false })` | `CapabilityGrantSchema` (per line) | `CapabilityPersistence.saveGrant`, `updateGrantStatus`, `deleteGrant`, `resetCapabilities` | `CapabilityPersistence.withSessionLock` |
| `capabilities/grants.corrupt.jsonl` | JSONL | `fs.appendFile` | Diagnostic inspection | Quarantine object | `readJsonlFile` | Best-effort append |
| `capabilities/audit.jsonl` | JSONL | `appendJsonlRecord` (`fs.appendFile`, `src/capability/persistence.ts#L185`) | `readJsonlFile(..., { strict: false })` | `SecurityAuditEventSchema` (per line) | `CapabilityPersistence.recordAuditEvent` | Append-only OS write |

---

## 2. Concurrency & Integrity Safeguards

### 2.1 Atomic JSON Replacement (`atomicWriteJson`, `src/core/fs-utils.ts#L32-L70`)
- Serializes payload with `JSON.stringify(data, null, 2)`.
- Writes to a unique temporary sibling file: `${targetPath}.${process.pid}.${Date.now()}.${randomSuffix}.tmp`.
- Calls `fs.rename(tempPath, targetPath)` with a 5-attempt linear backoff loop (`attempts * 25` ms) for Windows `EPERM` / `EBUSY` transient handle locks.
- Cleans up `tempPath` in `catch` if rename fails.

### 2.2 Cooperative Directory Lock & Monotonic Fencing (`src/core/lock.ts#L126-L330`)
- **Acquisition:** Uses `fs.open(lockFilePath, 'wx')` (`O_CREAT | O_EXCL`).
- **Fencing Epoch:** Increments `<sessionDir>/.fencing_token` monotonically (`getNextFencingToken`, `#L57-L72`) while holding `.lock` and writes `LockRecord` (`lock_id`, `owner_token`, `pid`, `holder`, `locked_at`, `lease_expires_at`, `fencing_token`).
- **Mutual Exclusion Barrier (`withBarrier`, `#L78-L113`):** Uses atomic `fs.mkdir('<sessionDir>/.lock_barrier')` (with 2000ms stale barrier recovery) around lock release, lease renewal, and stale lock breaking to prevent TOCTOU races (`AUD-09`).
- **Storage Fencing Enforcement (`verifyStorageFencing`, `src/blackboard/filesystem.ts#L234-L255`):**
  - Before any state write in `FilesystemSessionStorage`, compares the caller's fencing token (from `AsyncLocalStorage` or explicit parameter) against `.fencing_token` on disk. If `token < diskToken`, throws `StaleLockFencingError` (`REQ-06`).

### 2.3 JSONL Corruption Isolation & Strictness Asymmetry (`src/core/jsonl.ts`)
- **Important Asymmetry Identified:**
  - `FilesystemSessionStorage.readBroadcasts()` (`src/blackboard/filesystem.ts#L344-L347`) calls `readJsonlFile` with `strict: false`: corrupted lines are quarantined to `broadcast/events.corrupt.jsonl` and valid records are returned.
  - `FilesystemSessionStorage.readWorkLogs()` (`src/blackboard/filesystem.ts#L554-L557`) calls `readJsonlFile` with `strict: true`: `parseJsonl()` throws `CorruptedDataError` on the **first** invalid line (`src/core/jsonl.ts#L67-L72`) **before** `readJsonlFile()` reaches line 106 where `quarantineFilePath` is written!
  - **Impact for PKU Migration (`Phase 2`):** The PKU legacy exporter must read `work_log.jsonl` (or handle `CorruptedDataError` / use `readJsonlFile` with `strict: false` and explicit quarantine reporting) so that a single malformed legacy line is quarantined with diagnostics rather than aborting an entire migration batch (`Master Prompt Phase 2: "Quarantine malformed records with diagnostics; never silently drop"`).

---

## 3. Storage Architecture Findings & Migration Risks

1. **Single-Lock Contention Domain (`<sessionDir>/.lock`):**
   - Currently, all session mutations (bot heartbeats every 2s, broadcast publishes, inbox claims/completions, work-log appends, capability grants) contend on the single per-session `.lock` file.
   - **Risk:** If PKU synchronous writes were added inside `withSessionLock`, lock hold times would increase and cause `LockTimeoutError` (5000ms timeout) under multi-bot load.
   - **Mitigation:** PKU event capture must be decoupled from the critical section of `withSessionLock` (or use an asynchronous outbox/append-only journal outside the session lock).
2. **Full-File Rewrite Scaling in `messages.json` and `bots.json`:**
   - `InboxStore` (`inbox/<botId>/messages.json`) rewrites the entire array of messages on every claim, completion, or new message.
   - `BotRegistry` (`registry/bots.json`) rewrites the entire array of bots on every heartbeat (`touchHeartbeat` every 2000ms per active bot!).
   - **Mitigation for PKU:** **Never** persist routine `touchHeartbeat` (`last_seen_at`) updates as PKU `MemoryEvent` records! Define an explicit persistence filter policy (`Section 2.1`): only persist meaningful lifecycle transitions (`bot.registered`, `bot.status_changed`, `bot.renamed`), not 2-second heartbeat ticks.
3. **`CapabilityPersistence` Workspace Root Mismatch:**
   - `CapabilityPersistence` (`src/capability/persistence.ts#L25`) defaults `workspaceRoot` to `process.cwd()` when not passed, whereas `FilesystemSessionStorage` uses `resolveWorkspaceRoot()`. Moreover, `CapabilityPersistence` uses `fs.writeFile` directly (`#L80, L136`) instead of `atomicWriteJson` when rewriting `grants.jsonl`, and does not pass fencing tokens.
   - **Mitigation for PKU:** Include `capabilities/grants.jsonl` and `capabilities/audit.jsonl` in the Phase 2 read-only legacy bridge (checking both the session's `workspaceRoot` and fallback `process.cwd()` if applicable), while keeping `CapabilityPersistence` intact.
4. **Target Project Source Trees vs Session Workspace:**
   - `ProjectRootRecord.path` points to external developer source code directories on disk.
   - **Rule (`Spec §4.2, §10.5`):** Target project source trees are owned by Git/the developer. PKU stores metadata, references, and extracted knowledge about project roots, and must **never** delete, move, or purge files inside `ProjectRootRecord.path`.
