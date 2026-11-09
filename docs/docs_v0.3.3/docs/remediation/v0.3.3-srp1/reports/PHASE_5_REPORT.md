# SRP-1 Phase 5 Report — Secret, Prompt, Preset, and Cancellation

- **Phase:** 5 — Secret, Prompt, Preset, and Cancellation
- **Date:** 2026-11-09
- **Commit SHA:** `115aac0`
- **OS/Runtime:** Windows 11 (NT 10.0.26200.0), Node.js v24.21.0, npm 11.19.0
- **Implementer/Reviewer:** Antigravity AI / User Project Owner

---

## 1. Findings and Requirements in Scope

| Finding ID | Severity | Requirement ID | Summary & Target Outcome |
|---|---|---|---|
| **AUD-11** | High | REQ-07 | Secret lifecycle and redaction: CLI accepts API keys via `--api-key` in process argv exposing secrets to `ps` and shell history; redaction is fragmented across components. Target outcome: Deprecate `--api-key` in CLI with explicit security warning; register secrets at provider initialization and dispose them on shutdown; enforce centralized recursive secret redaction (`redactRecursively`) across all persistence sinks (work logs, broadcasts, direct messages, audit history, command execution outputs); verify absence of raw secrets with multi-token canary tests. |
| **AUD-13** | High | REQ-09 | Capability presets do not produce promised permissions: `controlled`, `extended`, and `unrestricted` presets had empty or omitted `paths` / `commands`, triggering `scopeRequired` failures in the policy engine. Target outcome: Reconcile `scopeRequired` with preset definitions by configuring explicit wildcards (`paths: ['*']`, `commands: ['*']`) in templates while supporting caller path overrides; support wildcard `*` matching in policy engine; fail closed on registered but unenforced capabilities (`system.config_access`, `network.outbound`, etc.); add comprehensive table-driven tests for all presets and capability types. |
| **AUD-15** | Medium | REQ-10 | Untrusted peer messages and shared work logs are wrapped in `<<<UNTRUSTED_*>>>` delimiters without escaping internal control characters or delimiter markers, enabling prompt delimiter breakout attacks. Target outcome: Implement `escapePromptDelimiters` escaping `<<<` to `\<\<\<` and `>>>` to `\>\>\>`; sanitize message content, sender metadata attributes, and shared work log entries prior to prompt assembly; clarify in `UNTRUSTED_BOUNDARY_NOTICE` that delimiters are defense-in-depth, not an authorization boundary; add adversarial injection regression tests. |
| **AUD-20** | Low | REQ-12 | Cancellation signal does not propagate through agent loop, provider calls, retry wait backoff, or bot runtime shutdown. Target outcome: Add `AbortController` ownership to `BotRuntime` and `AutonomousAgentLoop`; propagate `AbortSignal` to provider `generateResponse`; interrupt rate-limit retry pause immediately via `sleepWithSignal` without post-stop retry; clean provider disposal on shutdown; verify with cancellation regression tests. |

---

## 2. Files and Symbols Changed

1. **`src/execution/environment.ts`**:
   - Expanded `redactSecrets()` regexes: added patterns for OpenAI (`sk-`), Anthropic (`sk-ant-`), GitLab (`glpat-`), and Slack (`xox[baprs]-`).
   - Implemented and exported `redactRecursively<T>(value: T, customSecrets?: string[]): T` to recursively sanitize strings, arrays, and nested object fields before serialization.

2. **`src/ai/provider.ts`**:
   - Added optional `dispose?(): void;` lifecycle method to `IAIModelProvider` interface for deterministic credential cleanup.

3. **`src/ai/gemini.ts`**:
   - Updated `GeminiProvider`: registers API key in `registerSecret(key)` upon constructor initialization; unregisters key in `dispose()` upon provider termination.

4. **`src/cli/commands/bot.ts`**:
   - Marked `--api-key` in `bot run` command description as `[DEPRECATED - INSECURE] Explicit AI model API key (exposes argv; use GEMINI_API_KEY env var)`.
   - Action handler registers provided `--api-key` immediately via `registerSecret(options.apiKey)` to ensure it is redacted from all sinks even if supplied.
   - Updated message callback: passes `signal` from `BotRuntime` to `agentLoop.handleMessage(msg, signal)`.

5. **`src/shared/work-log.ts`**:
   - In `WorkLogService.recordWork`: applied `redactRecursively` to `summary` and all `details` fields before validation and persistence.

6. **`src/messaging/service.ts`**:
   - In `publishBroadcast`: applied `redactRecursively` to `content` and `metadata` before event creation and disk appending.
   - In `sendDirectMessage`: applied `redactRecursively` to `content` and `metadata` before message dispatch and inbox saving.

7. **`src/blackboard/filesystem.ts`**:
   - Enforced defensive secret redaction on storage write methods: `appendBroadcast`, `saveInbox`, and `appendWorkLog` sanitize incoming records via `redactRecursively` before writing to disk.

8. **`src/capability/presets.ts`**:
   - Reconciled preset definitions with `scopeRequired` governance:
     - `controlled`: template includes `scope: { paths: ['*'], operations: ['read', 'list'] }` for `filesystem.read_external` and `scope: { paths: ['*'], operations: ['write', 'edit'] }` for `filesystem.write_external`.
     - `extended`: template includes `paths: ['*']` for `filesystem.read_external` and `filesystem.write_external`, and `commands: ['git', 'npm', 'tsc', 'node']` for `process.execute_external`.
     - `unrestricted`: template includes explicit `paths: ['*']` for external filesystem read/write and `commands: ['*']` for `command.arbitrary`.
   - In `generateGrants`: caller-supplied `options.paths` overrides default `paths: ['*']` for scoped/bounded preset application.

9. **`src/capability/policy-engine.ts`**:
   - In path scope evaluation: added `p === '*' || isPathInsideRoot(...)` to support wildcard path scopes cleanly.
   - In command scope evaluation: added `c === '*' || ...` to support wildcard command scopes.
   - In enforcement verification (step 9): added fail-closed check for registered capabilities lacking an active enforcement implementation (`system.config_access`, `network.outbound`, `system.environment_access`, `system.process_control`), returning `DENY` unless an enforcement backend is explicitly available.

10. **`src/ai/prompts.ts`**:
    - Implemented and exported `escapePromptDelimiters(text: string): string` converting `<<<` to `\<\<\<` and `>>>` to `\>\>\>`.
    - In `formatUntrustedDirectMessage`: sanitized `senderDisplayName`, `senderBotId`, `timestamp`, and `content` using `escapePromptDelimiters` and quote escaping.
    - In `buildDynamicSystemPrompt`: sanitized `context.recentWorkLogsMarkdown` via `escapePromptDelimiters`.
    - In `UNTRUSTED_BOUNDARY_NOTICE`: added explicit declaration that delimiter markers are defense-in-depth, not an authorization boundary.

11. **`src/bot/runtime.ts`**:
    - Added `private abortController = new AbortController();` and exposed `public get signal(): AbortSignal`.
    - In `start()`: re-instantiates `this.abortController = new AbortController()`.
    - In `stop()`: triggers `this.abortController.abort()`.
    - In `pollCycle()`: checks `this.abortController.signal.aborted` at entry and within loop; passes `this.abortController.signal` to `onMessageCallback(msg, signal)`.

12. **`src/bot/agent-loop.ts`**:
    - Added `private abortController = new AbortController();` and implemented `public stop(): void` to abort internal controller and call `this.provider.dispose?.()`.
    - Updated `handleMessage(message: DirectMessage, signal?: AbortSignal): Promise<string>`:
      - Validates signal abortion at start of call and at start of each ReAct iteration.
      - Propagates effective signal (`signal ?? this.abortController.signal`) to `provider.generateResponse({ ..., signal })`.
      - Replaced raw `setTimeout` in rate-limit error handling with `sleepWithSignal((delaySec + 1) * 1000, effectiveSignal)`. If aborted during wait, immediately stops without retrying.

13. **`.gitignore`**:
    - Added `sessions/` to ignore local test/benchmark session directories.

14. **Regression Tests Added / Expanded**:
    - **`tests/security/secret-redaction-canary.test.ts` (7 tests, new suite)**:
      - Multi-token canary tests verifying that raw canaries (Gemini, OpenAI, Anthropic, GitHub, custom registered token) never appear in persisted work logs, broadcasts, direct message inboxes, or security audit logs.
      - Provider secret lifecycle: verifies registration on init and unregistration on `dispose()`.
      - CLI security: verifies `--api-key` is marked deprecated and insecure.
      - Recursive redactor: verifies nested object, array, and primitive handling.
    - **`tests/capability/presets-table.test.ts` (23 tests, new suite)**:
      - Table-driven verification of all 4 presets (`restricted`, `controlled`, `extended`, `unrestricted`) against actual controller operations.
      - Scoped preset with explicit path overrides.
      - Unenforced capabilities fail closed with `DENY`.
    - **`tests/security/prompt-injection.test.ts` (+4 tests, updated suite)**:
      - `escapePromptDelimiters` unit tests.
      - Adversarial closing delimiter injections (`<<<UNTRUSTED_PEER_MESSAGE_END>>>`) in message body are escaped.
      - Adversarial attribute breakout attempts in sender metadata are escaped.
      - Shared work log delimiter breakout attempts in system prompt are escaped.
    - **`tests/bot/cancellation.test.ts` (5 tests, new suite)**:
      - Pre-aborted signal rejects immediately before inference.
      - Mid-flight inference cancellation propagation.
      - Rate-limit pause cancellation: aborts immediately within milliseconds without retrying.
      - `loop.stop()` disposes provider and aborts controller.
      - `runtime.stop()` cleanly terminates message polling and sets `runtime.signal.aborted`.

---

## 3. Design and ADR References

- **ADR-SRP1-007 (Redaction at trust boundaries & Secret lifecycle):** Secrets are registered on provider creation and unregistered on disposal. Centralized recursive redaction protects all Blackboard and audit sinks.
- **ADR-SRP1-002 (Truthful capability contracts):** Unenforced capabilities fail closed immediately.
- **ADR-001 (Agent Capability Governance):** All presets produce working, verifiable grants consistent with their specifications.
- **ADR-204 (Autonomous Agent Loop):** ReAct loop respects cancellation signals across inference and backoff delays.

---

## 4. Verification Commands and Raw Results

### Command 1: TypeScript Build
```powershell
npm run build
```
**Exit Code:** `0`  
**Output:**
```
> almudaya-multiagent@0.3.2 build
> tsc
```

### Command 2: Unit and Regression Test Suite
```powershell
npx vitest run
```
**Exit Code:** `0`  
**Output:**
```
Test Files  47 passed (47)
     Tests  379 passed (379)
  Start at  14:39:31
  Duration  12.93s
```
*Note: Test suite expanded from 44 test files / 340 tests to 47 test files / 379 tests (+39 regression tests across Phase 5 findings).*

---

## 5. Security Analysis

- **Secret Redaction Completeness (AUD-11, REQ-07):** Canary tests confirm that secrets (standard token formats and custom registered strings) are recursively sanitized across every persistence path: work log, broadcast event log, direct message inbox, and security audit log. Provider secret cleanup eliminates credential leakage after agent lifecycle completion.
- **Preset Security & Policy Engine Consistency (AUD-13, REQ-09):** The table-driven test matrix proves that presets grant only their documented authority. Hard-deny OS paths remain inviolable even in `unrestricted` mode. Registered capabilities without enforcement backends strictly return `DENY`.
- **Untrusted Prompt Boundary (AUD-15, REQ-10):** Adversarial delimiter injection attempts can no longer escape the untrusted message envelope. Embedded closing markers are escaped to harmless text before prompt injection.
- **Cancellation Reliability (AUD-20, REQ-12):** Active operations and rate-limit wait backoffs terminate immediately upon `AbortSignal` trigger, preventing runaway retries, resource waste, or zombie agent loops.

---

## 6. Migration and Backward Compatibility

- Existing configuration files and CLI invocations remain compatible. `--api-key` is retained with deprecation warnings for transition, but immediately registers secrets for redaction.
- Custom path options in `CapabilityPresets.generateGrants` allow fine-grained workspace restrictions without breaking existing preset consumers.

---

## 7. Residual Risks and Deferred Work

- All Phase 5 findings (AUD-11, AUD-13, AUD-15, AUD-20) are fully resolved and verified.
- **Phase 6 (Final Verification & Release):** Version synchronization to `v0.3.3`, canonical audit finding ID verification, clean archive preparation, and final GO/NO-GO release report are scheduled for Phase 6.

---

## 8. Gate Status: PASS (Awaiting User Phase 6 Approval)

All Phase 5 gate criteria are satisfied:
1. Secret canaries are completely absent from all persistence sinks and artifacts.
2. Capability preset matrix is verified end-to-end against controller operations with table-driven tests.
3. Adversarial prompt delimiter breakout tests pass.
4. Stop / abort signal cancels in-flight provider calls and rate-limit waits without post-stop retry.
5. Full test suite (47 test files, 379 tests) passes with 100% pass rate.
