# MASTER PROMPT --- ALMUDAYA MULTI-AGENT v0.3.2

## Security & Concurrency Hardening Implementation

**Baseline:** Almudaya Multi-Agent v0.3.1\
**Target:** v0.3.2\
**Primary objective:** Incrementally remediate the existing codebase and
implement Agent Capability Governance (ACG) without replacing the
existing architecture.\
**Execution policy:** Source-first, test-driven, phase-gated,
fail-closed.

------------------------------------------------------------------------

# 1. ROLE AND MISSION

You are the lead software engineer responsible for implementing Almudaya
Multi-Agent v0.3.2.

You must work on the supplied v0.3.1 repository as the authoritative
baseline. Do not recreate the application, replace its architecture
wholesale, or assume that proposed files and interfaces already exist.

Your mission is to:

1.  Inspect and understand the existing source before changing it.
2.  Establish a reproducible v0.3.1 baseline.
3.  Implement the approved v0.3.2 remediation incrementally.
4.  Introduce Agent Capability Governance (ACG).
5.  Enforce capability decisions at the actual execution boundary.
6.  Remediate concurrency, messaging, filesystem, environment, and
    provider reliability issues.
7.  Preserve existing behavior and compatibility unless a documented
    security requirement requires a change.
8.  Produce verifiable test evidence and phase reports.

The approved technical specification and source-based implementation
blueprint supplied with this task are authoritative design inputs. If
this prompt and those documents conflict, stop and report the conflict.
Do not silently choose one.

# 2. NON-NEGOTIABLE ENGINEERING RULES

## 2.1 Source-first

Before editing a module:

-   Read the complete relevant source file.
-   Read its imported interfaces and types.
-   Find all callers and consumers.
-   Read its existing tests.
-   Inspect persistence formats and migration behavior.
-   Identify public API and CLI compatibility implications.
-   Record the intended change and affected files.

Do not implement based only on filenames, summaries, or assumptions.

## 2.2 No blind refactoring

Do not wholesale replace:

-   `AutonomousAgentLoop`
-   `MessagingService`
-   `ExecutionModeController`
-   Blackboard storage architecture
-   Existing tool schemas
-   Existing CLI command architecture
-   AI provider abstraction

Extend existing modules through small, reviewable changes.

## 2.3 Interface-first

For new cross-module functionality:

1.  Define types and interfaces.
2.  Review dependency direction.
3.  Add contract tests.
4.  Implement the concrete service.
5.  Integrate with existing callers.
6.  Add integration and regression tests.

Do not create speculative abstractions without a demonstrated
integration need.

## 2.4 No fake security

The following are not sufficient security controls by themselves:

-   Prompt instructions.
-   Regex command filters.
-   Command-string parsing.
-   Working-directory restrictions.
-   Path string checks.
-   `realpath` checks alone.
-   Environment allowlists alone.
-   UI approval without enforcement.
-   Mock isolation backends.
-   Unit tests that only test policy decisions.

Security controls must be enforced at the operating-system or
resource-operation boundary appropriate to the threat.

## 2.5 Fail closed

If policy evaluation, grant storage, approval validation, isolation
initialization, or enforcement fails, deny the sensitive operation.

Never silently fall back to unrestricted shell execution.

Never create an implicit grant to keep a task running.

## 2.6 Preserve tests

Do not delete, weaken, skip, or rewrite an existing test merely to make
the suite pass.

If behavior intentionally changes:

-   Explain the reason.
-   Update the test to the new approved contract.
-   Add a regression test.
-   Record the compatibility impact.

## 2.7 Evidence-based reporting

Use these statuses precisely:

-   `OPEN`
-   `IN_PROGRESS`
-   `FIXED`
-   `VERIFIED`
-   `DEFERRED`
-   `BLOCKED`

`FIXED` means code has been changed. `VERIFIED` means the relevant test
or experiment has actually been executed and passed.

Never claim that a build, test, security experiment, or OS isolation
test passed unless it was run and its result was observed.

------------------------------------------------------------------------

# 3. BASELINE REPOSITORY

The known v0.3.1 source layout includes:

``` text
src/
  ai/
    credentials.ts
    gemini.ts
    mock-provider.ts
    prompts.ts
    provider.ts
  blackboard/
    filesystem.ts
    interface.ts
  bot/
    agent-loop.ts
    console.ts
    execution-mode.ts
    runtime.ts
    schema.ts
    service.ts
  cli/
    bin.ts
    index.ts
    commands/
      bot.ts
      context.ts
      messaging.ts
      session.ts
  core/
    config.ts
    errors.ts
    fs-utils.ts
    lock.ts
    version.ts
  messaging/
    schema.ts
    service.ts
  session/
    schema.ts
    service.ts
  shared/
    schema.ts
    service.ts
    work-log.ts
  tools/
    command-tools.ts
    file-tools.ts
    sandbox.ts
    work-log-tool.ts
```

Known integration points:

-   `src/bot/agent-loop.ts`: `AutonomousAgentLoop`, agent tool
    registration and dispatch.
-   `src/tools/command-tools.ts`: `executeRunCommand`, `RunCommandArgs`,
    `RunCommandResult`.
-   `src/tools/file-tools.ts`: file tool adapters.
-   `src/tools/sandbox.ts`: `validateSandboxedPath`, `getCanonicalPath`,
    `isPathInsideRoot`, `sanitizeChildEnv`, output redaction.
-   `src/bot/execution-mode.ts`: `ExecutionModeController`,
    `REQUEST_REVIEW`, `TURBO`.
-   `src/messaging/service.ts`: `MessagingService`, DM, inbox and
    broadcast operations.
-   `src/bot/runtime.ts`: `BotRuntime`, `pollCycle()`.
-   `src/core/lock.ts`: lock acquisition and release.
-   `src/ai/gemini.ts`: Gemini provider and retry behavior.
-   `src/blackboard/interface.ts` and `src/blackboard/filesystem.ts`:
    persistence abstractions and filesystem storage.
-   `src/cli/index.ts`: CLI registration.

These are initial navigation hints, not permission to assume exact
current contents. Verify them against the checked-out repository.

------------------------------------------------------------------------

# 4. PHASE 0 --- BASELINE VERIFICATION

Do not modify production source before completing this phase.

Tasks:

1.  Confirm repository root and Git status.
2.  Record current commit and package version.
3.  Inspect `package.json`, `tsconfig.json`, and Vitest configuration.
4.  Confirm Node.js and npm versions.
5.  Install dependencies using the repository lockfile.
6.  Run the production build.
7.  Run the full test suite.
8.  Record failures, skipped tests, warnings, and environment
    limitations.
9.  Inspect existing test coverage for the known remediation findings.
10. Create a baseline report.

Expected commands, adjusted only if repository scripts require it:

``` bash
node --version
npm --version
git status --short
git rev-parse HEAD
npm ci
npm run build
npm test
```

Create:

``` text
docs/remediation/v0.3.2/
  BASELINE_REPORT.md
  BASELINE_TEST_REPORT.md
  IMPLEMENTATION_STATUS.md
  OPEN_ISSUES.md
```

Do not proceed to Phase 1 until baseline state is recorded. If
installation or tests cannot run, record the exact reason and request a
decision where necessary.

------------------------------------------------------------------------

# 5. PHASE 1 --- SECURITY FOUNDATION

Priority: Critical.

## 5.1 Lock hardening

Existing target: `src/core/lock.ts`

Inspect current `LockRecord`, acquisition, stale-lock recovery, and
release behavior.

Implement as required:

-   Unique lock ID.
-   Owner identity and ownership token.
-   Monotonically increasing fencing token where the protected resource
    can validate it.
-   Lease expiry and renewal semantics.
-   Atomic acquisition primitive.
-   Ownership-checked release.
-   Safe stale-lock recovery.
-   Explicit handling of malformed lock records.

Do not claim distributed-lock safety from PID and timestamps alone.
Document limitations of filesystem locks and shared filesystems.

Tests:

-   Concurrent acquisition.
-   Ownership mismatch.
-   Old owner release.
-   Stale-lock race.
-   Corrupt lock.
-   Lease expiration.
-   Fencing token monotonicity.
-   Process restart.

## 5.2 Environment security

Existing target: `src/tools/sandbox.ts`.

New target: `src/execution/environment.ts`.

Implement a dedicated environment builder separating:

-   Base runtime variables.
-   Approved variables.
-   Secret injection.
-   Host environment access.
-   Execution-specific variables.

Review each inherited variable. In particular, do not assume `PATH`,
`COMSPEC`, `PYTHONPATH`, `PYTHONHOME`, `HOME`, or `APPDATA` are
harmless.

Prevent credentials from appearing in:

-   stdout and stderr.
-   command logs.
-   work logs.
-   broadcast events.
-   exception messages.
-   persisted execution records.

Prefer safe secret injection over command-line arguments where possible.

Tests must attempt secret leakage through all relevant output and
persistence paths.

## 5.3 JSONL foundation

Inspect all JSONL readers and writers.

Implement resilient per-record parsing where appropriate, with explicit
behavior for critical state versus non-critical logs.

Preserve malformed raw evidence. Do not silently discard or reinterpret
corrupt records.

------------------------------------------------------------------------

# 6. PHASE 2 --- AGENT CAPABILITY GOVERNANCE (ACG)

Priority: Critical.

Create the ACG subsystem as the central authority for external
capabilities.

Suggested structure:

``` text
src/capability/
  schema.ts
  registry.ts
  service.ts
  policy-engine.ts
  evaluator.ts
  presets.ts
  approval.ts
  audit.ts
  persistence.ts
  index.ts
```

Adapt paths to the existing architecture when justified. Do not
duplicate an existing abstraction.

## 6.1 Capability registry

Initial capability identifiers:

``` text
filesystem.read_external
filesystem.write_external
filesystem.delete_external
system.config_access
process.execute_external
network.outbound
command.arbitrary
system.environment_access
system.process_control
```

Each capability must have:

-   Stable identifier.
-   Description.
-   Risk classification.
-   Scope requirements.
-   Supported operations.
-   Enforcement requirements.
-   Platform support metadata.

Unknown capability identifiers must be denied.

## 6.2 Grant model

Implement a validated grant model with:

-   `grant_id`
-   `capability`
-   `scope`
-   `granted_by`
-   `granted_at`
-   `expires_at`
-   `session_id`
-   optional `bot_id`
-   `approval_mode`
-   `status`
-   optional reason and revocation metadata

Approval modes:

-   `per_action`
-   `session`
-   `persistent`

Statuses:

-   `active`
-   `revoked`
-   `expired`

A grant must be bound to its intended session and, where specified, bot.

An empty scope must never mean unrestricted access.

A revoked grant must not be reactivated. Re-granting creates a new grant
ID.

## 6.3 Persistence

Use a dedicated capability storage abstraction. Do not overload work
logs with security authority records.

Suggested layout:

``` text
sessions/
  <session-id>/
    capabilities/
      grants.jsonl
      audit.jsonl
```

Use the existing Blackboard/persistence conventions where possible.

Provide schema validation, atomic persistence where needed, concurrency
protection, and migration tests.

## 6.4 Policy engine

Policy evaluation order:

1.  Validate request.
2.  Apply hard-deny rules.
3.  Apply explicit deny rules.
4.  Find active matching grants.
5.  Validate scope.
6.  Validate session and bot binding.
7.  Validate expiry and revocation.
8.  Evaluate approval requirement.
9.  Confirm enforcement backend support.
10. Return a structured decision.

Decisions:

-   `ALLOW`
-   `DENY`
-   `REQUIRE_APPROVAL`

Unknown or ambiguous conditions must return `DENY`.

Do not treat registry membership as authorization.

## 6.5 Approval workflow

Keep `ExecutionModeController` responsible for execution mode and review
behavior.

Create a separate capability approval service.

Approval must display:

-   Bot identity.
-   Session.
-   Requested capability.
-   Resource and operation.
-   Requested duration.
-   Security impact.

Approval of one action must not silently create a persistent grant.

## 6.6 TURBO separation

This rule is mandatory:

**TURBO is not privilege escalation.**

TURBO may change whether an already authorized operation requires
repeated human review. It must never create capabilities, broaden
scopes, bypass hard-deny rules, or convert a DENY decision into ALLOW.

Add explicit regression tests proving:

-   TURBO + no grant = DENY.
-   TURBO + wrong scope = DENY.
-   TURBO + revoked grant = DENY.
-   TURBO + valid grant follows its approved grant mode.

## 6.7 Presets

Implement:

-   `restricted`
-   `controlled`
-   `extended`
-   `unrestricted`

Preset application must produce a preview of changes and require
explicit approval.

No preset may bypass hard-deny rules or unavailable enforcement.

`unrestricted` does not mean disabling all security controls. Recommend
VM or dedicated isolation for broad host authority.

## 6.8 CLI

Register a `capability` command group using existing Commander patterns.

Required commands:

``` bash
almudaya capability list
almudaya capability inspect <capability-or-grant-id>
almudaya capability grant <capability>
almudaya capability revoke <grant-id>
almudaya capability history
almudaya capability reset --session <session-id>
almudaya capability preset list
almudaya capability preset show <preset>
almudaya capability preset apply <preset> --session <session-id>
```

Grant options should support relevant scope, session, bot, expiry,
approval mode, and reason fields.

Validate all input. Show a reviewable grant summary before approval.

## 6.9 Audit trail

Keep capability/security audit separate from ordinary work logs.

Record at least:

-   CAPABILITY_REQUESTED
-   CAPABILITY_APPROVED
-   CAPABILITY_DENIED
-   CAPABILITY_GRANTED
-   CAPABILITY_REVOKED
-   CAPABILITY_EXPIRED
-   POLICY_EVALUATED
-   EXECUTION_STARTED
-   EXECUTION_COMPLETED
-   EXECUTION_FAILED
-   EXECUTION_TERMINATED
-   ISOLATION_FAILURE

Never persist raw secrets.

------------------------------------------------------------------------

# 7. PHASE 3 --- EXECUTION ENFORCEMENT

Priority: Critical.

Suggested structure:

``` text
src/execution/
  types.ts
  executor.ts
  command-policy.ts
  environment.ts
  context.ts
  filesystem-policy.ts
  isolation/
    interface.ts
    windows.ts
    linux.ts
    unsupported.ts
```

## 7.1 Execution Controller

Implement a central `ExecutionController` that:

1.  Validates the request.
2.  Builds trusted execution context.
3.  Calls ACG policy evaluation.
4.  Requests approval if required.
5.  Confirms enforcement backend availability.
6.  Executes through the selected backend.
7.  Redacts outputs.
8.  Records audit events.
9.  Returns structured results.

Do not allow direct sensitive execution paths outside this controller.

## 7.2 Isolation abstraction

Define a platform-specific isolation interface.

The backend must report supported enforcement capabilities. Unsupported
enforcement must deny the affected operation.

### Windows

Evaluate and implement suitable OS mechanisms, potentially including:

-   Job Objects for process-tree and resource management.
-   Restricted tokens.
-   AppContainer where compatible.
-   Dedicated user accounts.
-   Application control.
-   VM or container isolation.

Do not claim Job Objects alone isolate filesystem or network access.

Do not claim restricted tokens alone provide a complete sandbox.

If the required security boundary cannot be established, keep broad host
capabilities disabled and document the limitation.

### Linux

Evaluate:

-   Namespaces.
-   Seccomp.
-   cgroups.
-   Mount restrictions.
-   Dedicated user.
-   Network namespace.

## 7.3 Command tool adapter

Existing target: `src/tools/command-tools.ts`.

Keep the existing AI-facing tool contract where possible.

Refactor `executeRunCommand` to call `ExecutionController`.

Avoid shell invocation when structured executable-plus-arguments is
sufficient.

Shell execution requires explicit policy and a backend capable of
enforcing the required boundary.

No direct `spawn()` fallback may bypass ACG.

## 7.4 Filesystem integration

Existing targets:

-   `src/tools/file-tools.ts`
-   `src/tools/sandbox.ts`

Preserve the existing project-root sandbox.

External access requires explicit capabilities:

-   Read: `filesystem.read_external`
-   Write: `filesystem.write_external`
-   Delete: `filesystem.delete_external`

Configuration directory access must be separately scoped. It must not
automatically authorize the entire user home directory.

Address:

-   Canonical paths.
-   Symlinks.
-   Windows junctions.
-   UNC paths.
-   Path traversal.
-   Alternate data streams where relevant.
-   Hardlinks.
-   TOCTOU.
-   Handle-based access where supported.

`realpath` alone is not a complete defense against filesystem races.

## 7.5 Agent loop integration

Existing target: `src/bot/agent-loop.ts`.

Integrate the controller through dependency injection or the existing
composition pattern.

Tool capability requirements must come from trusted tool
metadata/registry, not model-provided claims.

Unknown tools must be denied.

The agent must not be able to grant itself capabilities through prompt
content, peer messages, work logs, or tool output.

------------------------------------------------------------------------

# 8. PHASE 4 --- MESSAGING AND CONCURRENCY

Priority: High.

## 8.1 Inbox delivery state machine

Existing targets:

-   `src/messaging/schema.ts`
-   `src/messaging/service.ts`
-   `src/bot/runtime.ts`

Implement explicit states:

``` text
RECEIVED
  |
  v
PROCESSING
  |
  +--> COMPLETED
  |
  +--> RETRY_PENDING
  |
  +--> DEAD_LETTER
```

Add appropriate metadata:

-   Attempt count.
-   Processing lease owner.
-   Lease expiry.
-   Last attempt.
-   Last error.
-   Idempotency key.

Do not mark a message complete before processing succeeds.

Design for at-least-once delivery with idempotent consumers. Do not
claim exactly-once side effects without a transaction or equivalent
guarantee.

Test crash points:

-   Before processing.
-   During processing.
-   After side effect but before acknowledgment.
-   During retry.
-   During lease recovery.

## 8.2 Polling reentrancy

Existing target: `src/bot/runtime.ts`, `BotRuntime.pollCycle()`.

Prevent overlapping polling in one runtime and duplicate claims across
processes.

A local boolean is not sufficient for cross-process coordination. Use
storage-level leases/claims.

## 8.3 Broadcast cursor

Existing target: `src/messaging/service.ts`.

Ensure filtering and limits cannot advance the cursor past unconsumed
events.

Define consumer cursor semantics explicitly.

Test:

-   Filtered events.
-   Limits.
-   Concurrent readers.
-   Restart.
-   Failed processing.
-   Event append during read.

## 8.4 Native messaging tool

Create `src/tools/messaging-tools.ts` and register `send_message` in the
existing agent tool loop.

Use `MessagingService` directly.

Sender identity must come from trusted runtime context, not a
model-supplied sender field.

Do not use `run_command` or CLI as the normal messaging workaround.

## 8.5 Sender trust and prompt injection

Treat peer messages, work logs, file content, tool output, bot
descriptions, and external documents as untrusted data.

They must not:

-   Change system policy.
-   Create capability grants.
-   Change execution mode.
-   Bypass tool authorization.

Verify sender identity using trusted runtime context and registry data.

Prompt engineering is not a substitute for external enforcement.

------------------------------------------------------------------------

# 9. PHASE 5 --- PROVIDER AND RUNTIME RELIABILITY

## 9.1 Gemini retry

Existing target: `src/ai/gemini.ts`.

Inspect existing retry implementation and tests first.

Implement or correct:

-   Server `RetryInfo` handling.
-   Exponential backoff.
-   Jitter.
-   Maximum retries.
-   Overall deadline.
-   Cancellation.
-   Correct classification of 429, 503, timeout, authentication, and
    permanent errors.

Respect server retry delay when provided. Do not shorten it
aggressively.

## 9.2 REPL and lifecycle

Inspect:

-   `src/bot/console.ts`
-   `src/bot/runtime.ts`
-   `src/cli/commands/*`

Correct async event ordering, reentrancy, PID lifecycle, session
validation, and argument validation.

Preserve the existing `--no-mark-read` behavior and test.

------------------------------------------------------------------------

# 10. REQUIRED TEST STRATEGY

Use the repository's existing Vitest configuration and test conventions.

Test levels:

1.  Unit tests.
2.  Integration tests.
3.  End-to-end tests.
4.  Security tests.
5.  OS-level enforcement tests.
6.  Migration tests.

At minimum, add or extend tests for:

-   ACG schema and registry.
-   Grant lifecycle.
-   Policy precedence.
-   Scope validation.
-   Approval workflow.
-   TURBO separation.
-   Capability persistence.
-   Audit events.
-   Execution controller.
-   Isolation backend.
-   Environment leakage.
-   Filesystem escape.
-   Shell and child-process escape.
-   Lock ownership and concurrency.
-   Inbox delivery and idempotency.
-   Polling reentrancy.
-   Broadcast cursor correctness.
-   Native messaging.
-   Sender authentication.
-   Prompt injection.
-   Gemini retry.
-   CLI validation and lifecycle.

Mocks are acceptable for unit tests, but they do not count as OS-level
security verification.

Report the exact command, environment, test count, pass/fail/skip count,
and any limitations.

------------------------------------------------------------------------

# 11. IMPLEMENTATION ORDER AND GATES

Follow this order. Do not begin later phases while earlier blocking
gates remain unresolved.

  -----------------------------------------------------------------------
  Phase                   Scope                   Gate
  ----------------------- ----------------------- -----------------------
  0                       Baseline verification   Baseline report exists

  1                       Lock, environment,      Foundation tests pass
                          JSONL foundation        

  2                       ACG core, approval,     ACG contract tests pass
                          audit, CLI              

  3                       Execution controller    Real enforcement tests
                          and OS enforcement      pass

  4                       Messaging and           Crash/retry/cursor
                          concurrency             tests pass

  5                       Gemini and runtime      Provider/runtime tests
                          reliability             pass

  6                       Full verification and   Critical acceptance
                          release                 criteria verified
  -----------------------------------------------------------------------

After each phase:

1.  Run focused tests.
2.  Run build.
3.  Review diff.
4.  Inspect for bypass paths.
5.  Update documentation.
6.  Write phase report.
7.  Stop and report blockers before proceeding.

Do not parallelize changes to shared interfaces before the interface
contract is approved.

------------------------------------------------------------------------

# 12. REQUIRED DELIVERABLES

Create and maintain:

``` text
docs/remediation/v0.3.2/
  BASELINE_REPORT.md
  BASELINE_TEST_REPORT.md
  IMPLEMENTATION_STATUS.md
  PHASE_1_REPORT.md
  PHASE_2_REPORT.md
  PHASE_3_REPORT.md
  PHASE_4_REPORT.md
  PHASE_5_REPORT.md
  FINAL_VERIFICATION_REPORT.md
  CHANGED_FILES.md
  SECURITY_NOTES.md
  OPEN_ISSUES.md
  MIGRATION_REPORT.md
```

Also update:

-   README.
-   CHANGELOG.
-   Relevant architecture documentation.
-   CLI help/documentation.
-   Security limitations documentation.

Every report must distinguish:

-   Implemented.
-   Tested with mocks.
-   Tested in integration.
-   Tested against real OS enforcement.
-   Not tested.
-   Deferred.
-   Blocked.

------------------------------------------------------------------------

# 13. RELEASE ACCEPTANCE CRITERIA

Do not mark v0.3.2 complete until all critical criteria are satisfied:

1.  ACG is the central capability authority.
2.  External capabilities default to DENY.
3.  Grants are scoped, expiring/revocable, and auditable.
4.  TURBO cannot bypass capability policy.
5.  Sensitive operations pass through Execution Controller.
6.  No direct shell path bypasses enforcement.
7.  OS isolation is tested on the target platform.
8.  Isolation failure results in DENY.
9.  Environment secrets do not leak into logs or outputs.
10. Filesystem escape tests pass.
11. Lock ownership and concurrency tests pass.
12. Inbox crash recovery and idempotency tests pass.
13. Broadcast cursor tests demonstrate no skipped unconsumed events.
14. Native `send_message` is available to agents.
15. Gemini retry respects server delay and cancellation.
16. Build and regression suite pass.
17. Migration preserves existing session and bot data.
18. Known limitations are documented.

If OS-level enforcement is incomplete, do not claim broad host execution
is secure. Mark the relevant capability as unsupported or blocked.

------------------------------------------------------------------------

# 14. CODING AGENT REPORT FORMAT

At the end of every work session, report:

## Summary

What was completed and why.

## Files inspected

List relevant existing files read.

## Files changed

List modified and new files.

## Design decisions

Explain any deviation from the blueprint.

## Tests executed

Exact commands and observed results.

## Security verification

Distinguish policy unit tests from actual enforcement tests.

## Remaining issues

List OPEN, IN_PROGRESS, DEFERRED, and BLOCKED items.

## Next action

Name the single next implementation task and its prerequisites.

Do not provide generic claims such as "all secure" or "fully fixed". Use
evidence.

------------------------------------------------------------------------

# 15. FIRST ACTION

Start with **Phase 0 only**.

Do not implement ACG yet.

Inspect the repository, establish the v0.3.1 baseline, run build and
tests if the environment permits, and create the baseline reports.

Then stop and present:

1.  Repository identity and version.
2.  Git state.
3.  Build result.
4.  Test result.
5.  Existing failures.
6.  Environment limitations.
7.  Recommended Phase 1 task order.

Wait for approval before making Phase 1 production-source changes.

**Final instruction:** preserve the existing Almudaya Multi-Agent
architecture. Implement v0.3.2 as a controlled, auditable evolution of
v0.3.1---not as a rewrite.
