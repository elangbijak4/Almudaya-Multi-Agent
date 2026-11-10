# Blackboard Audit — Global Register (`Phase 0`)

**Target:** `src/blackboard/interface.ts`, `src/blackboard/filesystem.ts`, and all domain services/consumers.  
**Architectural Role in PKU:** Operational **Global Register** (shared session workspace).

---

## 1. Blackboard Interfaces (`src/blackboard/interface.ts`)

`IBlackboardStorage` (`src/blackboard/interface.ts#L83-L88`) is a composite interface extending five domain-specific storage interfaces:

### 1.1 `ISessionStorage` (`#L19-L31`)
- `createSession(metadata: SessionMetadata): Promise<void>`
- `getSession(sessionId: string): Promise<SessionMetadata>`
- `updateSession(sessionId: string, updater: (current: SessionMetadata) => SessionMetadata, fencingToken?: number): Promise<SessionMetadata>`
- `sessionExists(sessionId: string): Promise<boolean>`
- `listSessions(): Promise<SessionMetadata[]>`
- `getSessionDir(sessionId: string): string`
- `withSessionLock<T>(sessionId: string, action: (fencingToken?: number) => Promise<T>): Promise<T>`

### 1.2 `IBotRegistryStorage` (`#L36-L41`)
- `getBotRegistry(sessionId: string): Promise<BotRegistry>`
- `saveBotRegistry(sessionId: string, registry: BotRegistry, fencingToken?: number): Promise<void>`
- `getBot(sessionId: string, botIdOrDisplayName: string): Promise<BotRecord>`
- `listBots(sessionId: string): Promise<BotRecord[]>`

### 1.3 `IMessagingStorage` (`#L46-L58`)
- `appendBroadcast(sessionId: string, event: BroadcastEvent, fencingToken?: number): Promise<void>`
- `readBroadcasts(sessionId: string): Promise<BroadcastEvent[]>`
- `getBroadcastCursor(sessionId: string, botId: string): Promise<BroadcastCursor>`
- `saveBroadcastCursor(sessionId: string, botId: string, cursor: BroadcastCursor, fencingToken?: number): Promise<void>`
- `getInbox(sessionId: string, botId: string): Promise<InboxStore>`
- `saveInbox(sessionId: string, botId: string, store: InboxStore, fencingToken?: number): Promise<void>`
- `appendMessageToInbox(sessionId: string, recipientBotId: string, message: DirectMessage): Promise<void>`

### 1.4 `ISharedContextStorage` (`#L63-L70`)
- `getProjectRootsRegistry(sessionId: string): Promise<ProjectRootsRegistry>`
- `saveProjectRootsRegistry(sessionId: string, registry: ProjectRootsRegistry, fencingToken?: number): Promise<void>`
- `getEnvironmentMetadata(sessionId: string): Promise<EnvironmentMetadata | null>`
- `saveEnvironmentMetadata(sessionId: string, metadata: EnvironmentMetadata, fencingToken?: number): Promise<void>`
- `getDocumentsRegistry(sessionId: string): Promise<SdlcDocumentsRegistry>`
- `saveDocumentsRegistry(sessionId: string, registry: SdlcDocumentsRegistry, fencingToken?: number): Promise<void>`

### 1.5 `IWorkLogStorage` (`#L75-L78`)
- `appendWorkLog(sessionId: string, entry: WorkLogEntry, fencingToken?: number): Promise<void>`
- `readWorkLogs(sessionId: string): Promise<WorkLogEntry[]>`

---

## 2. Concrete Implementation (`src/blackboard/filesystem.ts`)

`FilesystemSessionStorage` (`src/blackboard/filesystem.ts#L56-L560`) is the sole production implementation of `IBlackboardStorage`.

### 2.1 On-Disk Session Directory Structure
Resolved via `getSessionDir(workspaceRoot, validId)` (`src/core/config.ts#L63-L65`):

```text
<workspaceRoot>/sessions/<sessionId>/
├── session.json                         # SessionMetadata (JSON, atomicWriteJson)
├── .lock                                # Cooperative LockRecord (O_CREAT | O_EXCL 'wx')
├── .lock_barrier/                       # Ephemeral mkdir mutex for stale lock recovery/release
├── .lock.corrupt.<timestamp>            # Preserved corrupt lock evidence (if any)
├── .fencing_token                       # Monotonic integer epoch counter
├── registry/
│   ├── bots.json                        # BotRegistry (JSON, atomicWriteJson)
│   ├── project_roots.json               # ProjectRootsRegistry (JSON, atomicWriteJson)
│   ├── environment.json                 # EnvironmentMetadata (JSON, atomicWriteJson)
│   └── documents.json                   # SdlcDocumentsRegistry (JSON, atomicWriteJson)
├── broadcast/
│   ├── events.jsonl                     # BroadcastEvent stream (JSONL, appendFile under lock)
│   └── events.corrupt.jsonl             # Quarantined malformed lines (strict: false)
├── inbox/
│   └── <botId>/
│       ├── messages.json                # InboxStore (JSON, atomicWriteJson)
│       └── broadcast_cursor.json        # BroadcastCursor (JSON, atomicWriteJson)
├── work_log.jsonl                       # WorkLogEntry stream (JSONL, appendFile under lock)
├── work_log.corrupt.jsonl               # Quarantined malformed lines (strict: true)
└── capabilities/                        # Managed by CapabilityPersistence (src/capability/persistence.ts)
    ├── grants.jsonl                     # CapabilityGrant records (JSONL rewrite under lock)
    ├── grants.corrupt.jsonl             # Quarantined malformed grant lines
    └── audit.jsonl                      # SecurityAuditEvent stream (JSONL append)
```

### 2.2 Storage Lifecycle & Concurrency Mechanics
1. **Path Traversal & ID Validation:** Every method validates `sessionId` via `validateSessionId()` (`/^[a-zA-Z0-9_-]{1,64}$/`, `src/session/schema.ts#L4-L54`) and `botId` via `validateBotId()` (`/^[a-zA-Z0-9_-]{1,64}$/`, `src/bot/schema.ts#L4-L64`).
2. **Cooperative Locking & Fencing (`#L216-L255`):**
   - `withSessionLock(sessionId, action)` acquires the directory lock on `<sessionDir>`, increments `.fencing_token`, stores `Map<sessionId, fencingToken>` in `this.activeFencingContext` (`AsyncLocalStorage`), and passes `fencingToken` to `action`.
   - Every mutating storage method calls `verifyStorageFencing(validId, fencingToken)` which compares the caller's explicit or `AsyncLocalStorage` token against `.fencing_token` on disk and throws `StaleLockFencingError` (`src/core/errors.ts#L99-L110`) if `token < diskToken`.
3. **Default Empty Structures on Read:**
   - If `registry/bots.json`, `registry/project_roots.json`, `registry/documents.json`, `inbox/<botId>/messages.json`, or `inbox/<botId>/broadcast_cursor.json` does not exist yet (for an existing session), `FilesystemSessionStorage` returns a valid default in-memory object without mutating disk.
   - If `registry/environment.json` does not exist, `getEnvironmentMetadata()` returns `null`.
4. **Secret Redaction on Persistence:**
   - `appendBroadcast()` (`#L327`), `saveInbox()` (`#L410`), and `appendWorkLog()` (`#L537`) apply `redactRecursively()` (`src/execution/environment.ts#L172-L187`) before schema validation and disk write.
   - `SharedContextService.registerEnvironment()` (`src/shared/service.ts#L99`) applies `redactSecrets()` (`src/shared/schema.ts#L14-L24`) to environment variables before calling `saveEnvironmentMetadata()`.

---

## 3. Schemas Owned by Blackboard

| Schema | Source File | `schema_version` | Primary Key / Identity |
|---|---|---|---|
| `SessionMetadataSchema` | `src/session/schema.ts#L10-L21` | `'1.0.0'` | `session_id` |
| `BotRegistrySchema` / `BotRecordSchema` | `src/bot/schema.ts#L18-L43` | `'1.0.0'` | `session_id` + `bot_id` (`display_name` unique per session, case-insensitive) |
| `BroadcastEventSchema` | `src/messaging/schema.ts#L18-L26` | N/A (JSONL record) | `event_id` (`evt_<ts>_<hex>`) |
| `BroadcastCursorSchema` | `src/messaging/schema.ts#L29-L35` | N/A | `(session_id, bot_id)` implicit via file path |
| `InboxStoreSchema` / `DirectMessageSchema` | `src/messaging/schema.ts#L66-L99` | `'1.0.0'` | `message_id` (`msg_<ts>_<hex>`), optional `idempotency_key` |
| `ProjectRootsRegistrySchema` / `ProjectRootRecordSchema` | `src/shared/schema.ts#L30-L49` | `'1.0.0'` | `root_id` (slug) |
| `EnvironmentMetadataSchema` | `src/shared/schema.ts#L60-L70` | `'1.0.0'` | `session_id` |
| `SdlcDocumentsRegistrySchema` / `SdlcDocumentRecordSchema` | `src/shared/schema.ts#L98-L117` | `'1.0.0'` | `document_id` (slug) |
| `WorkLogEntrySchema` | `src/shared/work-log.ts#L15-L29` | N/A (JSONL record) | `entry_id` (`work_<ts>_<hex>`) |

---

## 4. All Consumers of Blackboard (`IBlackboardStorage` / `FilesystemSessionStorage`)

1. **`SessionService` (`src/session/service.ts#L14-L97`):** Consumes `ISessionStorage`.
2. **`BotService` (`src/bot/service.ts#L21-L272`):** Consumes `IBlackboardStorage` (`getSession`, `withSessionLock`, `getBotRegistry`, `saveBotRegistry`, `getBot`, `listBots`).
3. **`MessagingService` (`src/messaging/service.ts#L20-L461`):** Consumes `IBlackboardStorage` (`withSessionLock`, `appendBroadcast`, `readBroadcasts`, `getBroadcastCursor`, `saveBroadcastCursor`, `getInbox`, `saveInbox`).
4. **`InboxDeliveryService` (`src/messaging/delivery.ts#L11-L347`):** Consumes `IBlackboardStorage` (`withSessionLock`, `getInbox`, `saveInbox`) and `BotService`.
5. **`SharedContextService` (`src/shared/service.ts#L27-L187`):** Consumes `IBlackboardStorage` (`withSessionLock`, `getProjectRootsRegistry`, `saveProjectRootsRegistry`, `getEnvironmentMetadata`, `saveEnvironmentMetadata`, `getDocumentsRegistry`, `saveDocumentsRegistry`).
6. **`WorkLogService` (`src/shared/work-log.ts#L57-L154`):** Consumes `IBlackboardStorage` (`appendWorkLog`, `readWorkLogs`).
7. **`BotRuntime` (`src/bot/runtime.ts#L20-L261`):** Accepts `IBlackboardStorage` in constructor and passes it to `BotService` and `MessagingService`.
8. **`AutonomousAgentLoop` (`src/bot/agent-loop.ts#L55-L493`):** Accepts `IBlackboardStorage` in `AgentLoopOptions` and passes it to `BotService`, `MessagingService`, `SharedContextService`, `WorkLogService`, and `executeGetWorkLog`.
9. **`BotConsole` (`src/bot/console.ts#L32-L487`):** Accepts `IBlackboardStorage` in `BotConsoleOptions` and passes it to `BotService`, `MessagingService`, `SharedContextService`, and `WorkLogService`.
10. **`executeGetWorkLog` (`src/tools/work-log-tool.ts#L43-L74`):** Instantiates `new WorkLogService(storage)` on tool call.
11. **CLI Command Handlers (`src/cli/commands/session.ts`, `bot.ts`, `messaging.ts`, `context.ts`):** Instantiate `new FilesystemSessionStorage(workspaceRoot)` per CLI invocation.
12. **Public Package Barrel (`src/index.ts#L9-L10`):** Re-exports `./blackboard/interface.js` and `./blackboard/filesystem.js`.

---

## 5. Preservation & Integration Assessment for PKU

- **What Must Not Change:** `IBlackboardStorage` method signatures, `FilesystemSessionStorage` file paths/schemas, `withSessionLock` and `.fencing_token` verification, and default empty-file return semantics.
- **How PKU Integrates:**
  1. **Phase 2 (Read-Only Legacy Bridge):** Implement `BlackboardLegacyExporter` consuming `IBlackboardStorage` (plus `CapabilityPersistence`) to read and transform session state into canonical `KnowledgeObject` and `MemoryEvent` records with full provenance (`sourceSystem: 'almudaya.blackboard'`, `sourcePath`, `sourceSchemaVersion`, SHA-256 `contentHash`).
  2. **Phase 4 (Global Register Bridge):** Provide a decorator/wrapper or optional hook in `FilesystemSessionStorage` / domain services that captures qualifying state transitions (`createSession`, `updateSession`, `registerProjectRoot`, `registerDocument`, `appendBroadcast`, `appendWorkLog`) into PKU when `PKU_EVENT_CAPTURE=true`, while keeping `FilesystemSessionStorage` as the synchronous operational Global Register.
