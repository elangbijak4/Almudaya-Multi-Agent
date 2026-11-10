# Agent Runtime Audit (`Phase 0`)

**Target:** `src/bot/runtime.ts`, `src/bot/agent-loop.ts`, `src/bot/console.ts`, `src/bot/execution-mode.ts`, `src/ai/prompts.ts`, `src/ai/provider.ts`, `src/ai/gemini.ts`, and `src/cli/commands/bot.ts`.  
**Architectural Role in PKU:** Multi-Agent Runtime, Context Construction (KOE target), and Register Lifecycle Host.

---

## 1. Bot Creation, Initialization & Runtime Startup

### 1.1 CLI Entrypoints (`src/cli/commands/bot.ts`)
1. **`almudaya bot join` (`#L21-L69`):**
   - Resolves `workspaceRoot` via `resolveWorkspaceRoot({ workspace: options.workspace })`.
   - Instantiates `FilesystemSessionStorage(workspaceRoot)` and `BotService(storage)`.
   - Calls `botService.registerBot(options.session, { botId, displayName, description })` which allocates `BOT001`.. and `<session-name>_001`.. under `withSessionLock(sessionId)` and persists to `registry/bots.json`.
2. **`almudaya bot run` (`#L71-L260`):**
   - Primary runtime composition root.
   - Validates `--interval` (default `2000` ms) and `--max-iterations` (default `10`).
   - Registers any `--api-key` secret into `registerSecret()` (`src/execution/environment.ts#L77-L81`) and configures `IAIModelProvider` (`GeminiProvider` or `MockAIProvider`).
   - Instantiates `ExecutionModeController` (`REQUEST_REVIEW` default, or `TURBO`).
   - Instantiates `BotRuntime(storage, { sessionId, botId, displayName, description, heartbeatIntervalMs, autoAcknowledge, onMessage, onBroadcast })`.
   - Calls `const botRecord = await runtime.start()` (`#L224`).
   - **Crucial Ordering:** Only **after** `runtime.start()` resolves `botRecord.bot_id` does `bot.ts` instantiate `AutonomousAgentLoop` (`#L227-L243`) and `BotConsole` (`#L246-L255`).

### 1.2 `BotRuntime.start()` (`src/bot/runtime.ts#L69-L144`)
1. Guards against double start (`if (this.isRunning) throw ...`).
2. Resets `this.abortController = new AbortController()`.
3. Checks if `this.botId` already exists in `registry/bots.json` via `this.botService.getBot(this.sessionId, this.botId)`:
   - **Existing Bot (Re-activation):** Calls `this.botService.updateStatus(this.sessionId, existing.bot_id, 'active', { pid: process.pid })`, preserving `bot_id` and `display_name`.
   - **New Bot (Registration):** Calls `this.botService.registerBot(this.sessionId, { botId, displayName, description, status: 'active', pid: process.pid })`.
4. Sets `this.isRunning = true`.
5. Starts `this.heartbeatTimer` (`setInterval` every `heartbeatIntervalMs`, default `2000` ms) calling `this.botService.touchHeartbeat(this.sessionId, this.botId)`.
6. Starts `this.pollTimer` (`setInterval` every `pollIntervalMs`, default `1000` ms) calling `this.pollCycle()` if `onMessageCallback`, `onBroadcastCallback`, or `autoAcknowledge` is enabled.
7. Attaches `SIGINT` and `SIGTERM` process signal handlers (`#L130-L141`) to invoke `await this.stop()`.

---

## 2. Task Assignment & Polling Lifecycle (`BotRuntime.pollCycle()`)

Located in `src/bot/runtime.ts#L151-L230`:
1. **Single-Flight Reentrancy Guard (`#L152-L153`):**
   - `if (!this.isRunning || this.pollInFlight || this.abortController.signal.aborted) return;`
   - Prevents overlapping poll cycles within the same process (`PERF-01`).
2. **Broadcast Consumption (`#L157-L176`):**
   - Reads unread broadcasts with `autoAdvanceCursor: false`.
   - Executes `await this.onBroadcastCallback(evt)` sequentially and calls `await this.messagingService.advanceBroadcastCursor(this.sessionId, this.botId, evt)` strictly after each callback succeeds (`AUD-07`).
3. **Expired Lease Recovery (`#L181`):**
   - Calls `await this.messagingService.delivery.recoverExpiredLeases(this.sessionId, this.botId)` to reclaim stalled `PROCESSING` messages whose 30s lease expired.
4. **Leased Direct-Message Claim & Execution (`#L184-L224`):**
   - Uses `consumerId = "${this.botId}:pid-${process.pid}"`.
   - Loops calling `claimNextMessage(this.sessionId, this.botId, consumerId, undefined, processedInThisCycle)`.
   - Invokes `await this.onMessageCallback(msg, this.abortController.signal)`.
   - On success: calls `completeMessage(this.sessionId, this.botId, msg.message_id, consumerId, msg.fence_token)`.
   - On error: calls `failMessage(this.sessionId, this.botId, msg.message_id, errMsg, consumerId, msg.fence_token)`.
5. **Interactive Operator Task Assignment (`BotConsole.handleNaturalLanguageInstruction()`, `src/bot/console.ts#L413-L447`):**
   - When a human operator types plain text in the console REPL, `BotConsole` synthesizes an in-memory `DirectMessage` (`sender_bot_id: 'OPERATOR'`, `metadata: { source: 'console_repl' }`) and passes it directly to `this.agentLoop.handleMessage(syntheticMsg)`.

---

## 3. Context Construction & Prompt Assembly (`AutonomousAgentLoop` & `prompts.ts`)

When `AutonomousAgentLoop.handleMessage(message, signal)` (`src/bot/agent-loop.ts#L98-L439`) runs:
1. **Dynamic Context Gathering (`#L105-L112`):**
   - `currentBot = await this.botService.getBot(this.sessionId, this.botId)`
   - `peerBots = await this.botService.listBots(this.sessionId)`
   - `projectRoots = await this.sharedContextService.listProjectRoots(this.sessionId)`
   - `recentWorkLogsMarkdown = await this.workLogService.getRecentSummaryMarkdown(this.sessionId, 10)`
   - **Note:** Registered SDLC documents (`documents.json`) and environment metadata (`environment.json`) are **not** currently injected into `buildDynamicSystemPrompt()`! KOE (`Phase 6`) can bridge this gap by retrieving relevant SDLC documents, architecture decisions, and project knowledge on demand.
2. **System Prompt Assembly (`buildDynamicSystemPrompt`, `src/ai/prompts.ts#L64-L124`):**
   - Renders Bot identity & persona (`displayName`, `botId`, `role`/`description`).
   - Renders Session ID & Execution Mode (`REQUEST_REVIEW` vs `TURBO`).
   - Renders all registered Project Roots (`root_id`, `name`, `root_type`, `path`, `description`).
   - Renders active Peer Bots in the session.
   - Renders the last 10 Work Log entries wrapped inside `<<<UNTRUSTED_WORK_LOG_START>>> ... <<<UNTRUSTED_WORK_LOG_END>>>` with `escapePromptDelimiters()`.
   - Appends `UNTRUSTED_BOUNDARY_NOTICE` and operational coding guidelines.
3. **User Turn Assembly (`formatUntrustedDirectMessage`, `src/ai/prompts.ts#L42-L59`):**
   - Verifies `senderDisplayName` from `botService.getBot()` (`src/bot/agent-loop.ts#L135-L141`).
   - Wraps `message.content` inside `<<<UNTRUSTED_PEER_MESSAGE_START ...>>> ... <<<UNTRUSTED_PEER_MESSAGE_END>>>` with delimiter escaping (`AUD-15`).

---

## 4. Execution Lifecycle, Tools, Heartbeat, Shutdown & Recovery

1. **Bounded ReAct Loop (`src/bot/agent-loop.ts#L162-L403`):**
   - Executes up to `this.maxIterations` (default `10`).
   - Checks `isAborted()` before and after each LLM call and rate-limit sleep (`AUD-20`).
   - Handles `RateLimitPauseError` (HTTP 429) by notifying `onStatusCallback`, sleeping via `sleepWithSignal()`, and decrementing `iteration--` so quota pauses do not consume reasoning steps (`#L177-L192`).
2. **Tool Dispatch & Automatic Audit/Work-Log Recording (`#L209-L392`):**
   - Publishes `ACTIVITY` broadcast before and after each tool call (`FR-217`).
   - Enforces HITL approval via `this.executionModeController.requestApproval()` for mutating tools (`write_file`, `edit_file`, `run_command`).
   - Dispatches:
     - `send_message` -> `executeSendMessage()` (`src/tools/messaging-tools.ts`)
     - `get_work_log` -> `executeGetWorkLog()` (`src/tools/work-log-tool.ts`)
     - `run_command` -> `executeRunCommand()` -> `ExecutionController.getInstance().executeCommand()` + automatic `WorkLogService.recordWork(..., 'COMMAND', ...)`
     - `read_file`, `write_file`, `edit_file`, `list_dir`, `search_files` -> `executeFileTool()` -> `ExecutionController.getInstance().authorizeFileAccess()` + automatic `WorkLogService.recordWork(..., 'WRITE' | 'EDIT', ...)`
3. **Automated Reply & Decision Broadcast (`#L409-L436`):**
   - When the ReAct loop concludes, if `message.sender_bot_id !== 'OPERATOR'` and `!== this.botId`, sends a `DirectMessage` back to `message.sender_bot_id` with `metadata: { correlationId: message.message_id }`.
   - Publishes a `DECISION` broadcast summarizing task completion with `metadata: { replyToMessageId: message.message_id, iterations }`.
4. **Shutdown & Cancellation (`BotRuntime.stop()`, `src/bot/runtime.ts#L235-L260`, `AutonomousAgentLoop.stop()`, `#L90-L93`):**
   - `BotRuntime.stop()` sets `this.isRunning = false`, calls `this.abortController.abort()` (which propagates `signal` to in-flight `agentLoop.handleMessage()` and `GeminiProvider`), clears `heartbeatTimer` and `pollTimer`, removes `SIGINT`/`SIGTERM` listeners, and updates bot status to `'stopped'` (clearing `pid`) in `registry/bots.json`.

---

## 5. Exact PKU Integration Points in Agent Runtime

| Integration Point | File & Line Reference | Planned PKU Hook (Future Phases) |
|---|---|---|
| **Post-Identity Individual Register Init** | `src/bot/runtime.ts#L108` (inside `BotRuntime.start()` right after `this.botId = record.bot_id`) | Initialize bot's `MemoryIdentity` (`registerKind: 'individual'`) and load/reconstruct ACMA Individual Register state if `PKU_ENABLED`. |
| **Post-Broadcast Callback Event Hook** | `src/bot/runtime.ts#L168` (inside `pollCycle()` after `advanceBroadcastCursor`) | Optional non-blocking hook for Individual Register observation if configured. |
| **Post-Message Completion Hook** | `src/bot/runtime.ts#L205-L211` (after `completeMessage`) | Persist checkpoint / episodic task completion event to PKU without affecting `completeMessage` ACK. |
| **Graceful Shutdown Flush** | `src/bot/runtime.ts#L254` (inside `BotRuntime.stop()`) | Flush any pending buffered PKU events with a bounded timeout; never block status transition to `'stopped'`. |
| **KOE Context Assembly Hook** | `src/bot/agent-loop.ts#L104-L125` (inside `AutonomousAgentLoop.handleMessage()`) | Call `IKnowledgeOptimizationEngine.assembleContext()` in shadow mode (`Phase 6`) or active mode (`Phase 8`), retaining `buildDynamicSystemPrompt()` as mandatory fallback (`PKU-004`, `PKU-012`). |
| **Tool Execution Memory Capture** | `src/bot/agent-loop.ts#L444-L492` (`recordToolExecutionWorkLog`) | Capture `WRITE`, `EDIT`, `COMMAND`, and `DECISION` actions into PKU event stream alongside `workLogService.recordWork()`. |
