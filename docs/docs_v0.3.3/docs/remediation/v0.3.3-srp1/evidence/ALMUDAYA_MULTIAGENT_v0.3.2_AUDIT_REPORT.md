# Audit Report --- Almudaya Multi-Agent v0.3.2

**Audit date:** 8 November 2026\
**Audited archive:** `almudaya_multiagent_v0.1.0 (2).zip`\
**Release commit in archive:**
`23bc928e3a7309c69cad1f0e5023d03a81b86bf1` (`main`)\
**Baseline commit:** `6c617febfb9e7185a46ecfc92f6dd3ac18dc9a94`\
**Package version:** `0.3.2`

## 1. Executive conclusion

**Release recommendation: NO-GO for security-hardened release until the
Critical and High findings below are remediated and retested.**

The repository has meaningful progress: the package version is 0.3.2,
the TypeScript build passes in the audit environment, ACG modules and an
Execution Controller exist, messaging has a delivery state machine, and
retry handling has been expanded.

However, the most important security claim is not supported by the
implementation: the Windows and Linux backends are
process-tree/process-group termination mechanisms, not OS security
sandboxes. In addition, several policy and messaging paths still permit
bypasses or data loss. Multiple runtime reproductions confirmed these
defects.

This is a source-based audit with targeted runtime reproductions, not a
full penetration test or a Windows-host validation.

## 2. Verification performed

  ------------------------------------------------------------------------
  Check                   Result                  Notes
  ----------------------- ----------------------- ------------------------
  Archive inventory       PASS                    4,832 ZIP entries;
                                                  source, tests, docs,
                                                  `.git`, and
                                                  `node_modules` included

  Git release identity    PASS                    `main` points to
                                                  `23bc928`; baseline
                                                  commit `6c617fe` is
                                                  present in history

  Package version         PASS                    `package.json`,
                                                  `src/core/version.ts`,
                                                  and built CLI report
                                                  0.3.2

  TypeScript build        PASS                    `npm run build`
                                                  succeeded using the
                                                  bundled dependency tree

  Vitest suite            NOT VERIFIED            The bundled dependencies
                                                  contain the Windows
                                                  Rolldown native binding
                                                  only. On Linux, Vitest
                                                  fails because the Linux
                                                  native binding is
                                                  missing.

  Clean dependency        NOT VERIFIED            `npm ci` timed out while
  install                                         accessing the registry;
                                                  offline install failed
                                                  because packages were
                                                  not cached

  Targeted runtime        PASS                    Confirmed inbox limit
  reproductions                                   mutation, broadcast
                                                  cursor loss, no-session
                                                  command execution,
                                                  bot-scope bypass,
                                                  case-insensitive path
                                                  scope, stale lease
                                                  mutation, sender
                                                  spoofing, ACG path
                                                  traversal, and
                                                  non-functional
                                                  per-action external-file
                                                  approval
  ------------------------------------------------------------------------

The archive contains 44 test files. A simple static scan found 296
explicit `it()`/`test()` declarations, while the release report claims
295 executed tests. This count needs reconciliation; it is not a
substitute for an executed test report.

## 3. Findings

### CRITICAL --- Release blocker

#### AUD-01 --- "OS isolation" backends do not provide OS-level isolation

**Affected:** `src/execution/isolation/windows.ts:12,47,63`;
`src/execution/isolation/linux.ts:10,42,45`;
`src/execution/controller.ts:138`

The Windows backend starts `cmd.exe` and uses `taskkill /T /F` for
process-tree termination. It does not create or assign a Windows Job
Object, Restricted Token, or AppContainer. The Linux backend starts
`/bin/sh -c` in a detached process group and kills that group on
timeout; it does not create user, mount, PID, or network namespaces, nor
use seccomp/cgroups/chroot.

`isAvailable()` only checks the platform. `ExecutionController` checks
only `isAvailable()` and never calls `supportsCapability()`. Both
backends advertise `filesystem_sandbox` despite not enforcing a
filesystem boundary.

**Runtime reproduction:** with `projectRoots` restricted to a temporary
project directory and no session grant,
`executeCommand({projectRoots:[project]}, {command:'cat /etc/hostname'})`
succeeded. The reported isolation type was `linux_process_group`.

**Impact:** arbitrary shell commands can still read/write host files and
access the network. ACG cannot enforce separate
filesystem/network/process capabilities inside such a shell. The release
report's claims of Windows Job Objects and Linux namespaces are not
supported by these source files.

**Required remediation:** do not label these backends as OS sandboxes.
Until a real OS isolation adapter is implemented and capability-tested,
mark the backend unavailable for sensitive execution and fail closed.
For Windows, implement and verify a real Job Object plus
filesystem/network restrictions appropriate to the threat model, or use
AppContainer/dedicated account/VM. For Linux, use namespaces, mount
restrictions, seccomp, cgroups, and network isolation or a container/VM.
Add negative tests proving the child cannot read a host sentinel file or
access a disallowed network endpoint.

### HIGH --- Must fix before release

#### AUD-02 --- ACG is skipped when `sessionId` is absent

**Affected:** `src/execution/controller.ts:84`;
`src/tools/command-tools.ts` (`context` is optional)

Policy evaluation is conditional on `if (context.sessionId)`. If no
session is supplied, the controller proceeds to the backend. The
exported `executeRunCommand()` also accepts omitted context.

**Runtime reproduction:** a no-session call successfully executed
`cat /etc/hostname` and returned `deniedByPolicy: false`.

**Required remediation:** require a valid session and authenticated bot
identity for every agent command. Missing context must return DENY, not
skip policy evaluation. Add tests that assert no-session and no-bot
execution are denied.

#### AUD-03 --- Capability persistence accepts path-traversal session IDs

**Affected:** `src/capability/persistence.ts:26-39`;
`src/cli/commands/capability.ts`

`getCapabilitiesDir()` and `withSessionLock()` interpolate `sessionId`
into filesystem paths without calling the existing session ID validator.
Capability CLI commands pass the supplied `--session` value directly to
`CapabilityService`.

**Runtime reproduction:** with a workspace root under a temporary
directory, a grant using session ID `../../../outside-session` created
`grants.jsonl` at `/tmp/outside-session/capabilities/grants.jsonl`,
outside the configured workspace.

**Required remediation:** validate session IDs using the same strict
validator as `FilesystemSessionStorage` before any path construction.
Resolve and verify the final canonical directory remains under the
configured workspace. Require the target session to exist before
granting, revoking, or applying presets.

#### AUD-04 --- Bot-bound grants can match when caller omits `botId`

**Affected:** `src/capability/policy-engine.ts:97`

The current condition rejects a grant only when both the grant's
`bot_id` and the request's `botId` are present and different. If a grant
is bound to `BOT-A` and the caller omits `botId`, the grant is accepted.

**Runtime reproduction:** a grant bound to `BOT-A` evaluated to `ALLOW`
when the request had no `botId`.

**Required remediation:** if a grant contains `bot_id`, require exact
equality with the caller's authenticated `botId`; missing identity must
deny.

#### AUD-05 --- Path scope comparison is case-insensitive on case-sensitive filesystems

**Affected:** `src/capability/policy-engine.ts:137`

The evaluator lowercases both `path.resolve(targetResource)` and grant
paths. On Linux and case-sensitive filesystems, `/tmp/Secret` and
`/tmp/secret` are different paths.

**Runtime reproduction:** a grant scoped to `/tmp/Secret` returned
`ALLOW` for `/tmp/secret/credentials.txt`.

**Required remediation:** use platform-aware canonical path comparison.
On case-sensitive platforms preserve case; use `path.relative()` and
canonical real paths, and reject ambiguous or unresolved paths.

#### AUD-06 --- `readInbox()` marks messages read before applying the limit

**Affected:** `src/messaging/service.ts:207-224`

The method mutates every matched unread message to `read`, saves the
inbox, and only afterward applies `slice(-limit)`.

**Runtime reproduction:** with three unread messages and
`{markAsRead:true, limit:1}`, only the newest message was returned, but
all three messages were persisted as `read`.

**Required remediation:** apply filtering and the requested limit before
any status mutation. Only returned/explicitly acknowledged messages may
change state. Add a regression test with at least three messages and
limit 1.

#### AUD-07 --- Broadcast cursor can skip unconsumed events

**Affected:** `src/messaging/service.ts:79-93,116`;
`src/bot/runtime.ts:150-157`

The cursor path filters events and then uses `slice(-limit)`. It
advances the single global per-bot cursor to the last matching event.
This can skip earlier events of other categories. In addition,
`BotRuntime` advances the cursor inside `readBroadcasts()` before
invoking `onBroadcastCallback`; if the callback fails or the process
crashes, the event has already been consumed from the cursor's
perspective.

**Runtime reproduction:** events `A=ACTIVITY`, `B=DECISION`,
`C=ACTIVITY`; reading with category `DECISION` returned B, and the next
unfiltered read returned C. A was permanently skipped. The existing
cursor test repeats this scenario but only asserts C; it does not assert
that A remains available.

**Required remediation:** use a delivery/ack model for broadcasts, or
maintain per-category cursors. Do not advance a cursor before successful
callback completion. For bounded pagination use the earliest next page
(`slice(0, limit)`), not the last N events. Add tests for mixed
categories, limits, callback failure, and restart recovery.

#### AUD-08 --- Stale inbox consumer can mutate another consumer's lease

**Affected:** `src/messaging/delivery.ts:122-129,151-185`

`failMessage()` accepts `_consumerId` but never validates it against
`lease_owner`. A stale worker can therefore fail a message currently
leased by another worker. `completeMessage()` also skips ownership
validation when `lease_owner` is null.

**Runtime reproduction:** consumer A claimed a message with a short
lease; after expiry consumer B reclaimed it. A then called
`failMessage(..., 'consumer-A')`; the message changed from B's
`PROCESSING` lease to `RETRY_PENDING` and its owner was cleared. B could
subsequently complete it despite the lease having been cleared.

**Required remediation:** require exact consumer/lease ownership for
both failure and completion transitions. Add a monotonically increasing
per-message lease/fencing token and reject stale tokens. Make ownership
mandatory for worker ACK/fail operations; keep administrative override
as a separate explicit API.

#### AUD-09 --- Lock stale recovery and fencing are still vulnerable to races

**Affected:** `src/core/lock.ts:134-168,193-205`;
`src/blackboard/filesystem.ts:211`

Owner tokens improve the implementation, but stale recovery still reads
a lock, decides it is stale, then unlinks by path. A new owner can
replace the file between the read and unlink. Release has a similar
read-then-unlink race; lease renewal reads then overwrites the file
non-atomically.

The fencing token is generated and returned by `LockHandle`, but storage
operations do not validate it.
`FilesystemSessionStorage.withSessionLock()` does not pass the token
into writes, so stale holders are not fenced from committing after lease
expiry.

**Required remediation:** implement an atomic ownership-safe lock
protocol and make every protected write validate the fencing token at
the storage boundary. Add deterministic race tests for stale recovery,
release-vs-reacquire, renew-vs-reacquire, and stale-writer rejection.

#### AUD-10 --- Sender identity is not verified at the messaging service boundary

**Affected:** `src/messaging/service.ts:37-44,129-165`;
`src/cli/commands/messaging.ts`; `src/bot/agent-loop.ts:122-128`

`sendDirectMessage()` and `publishBroadcast()` trust the caller-supplied
`senderBotId`. The CLI exposes `--sender`/`--bot`. In the agent loop, a
failed lookup of the sender bot merely falls back to the raw ID and
continues processing the message.

**Runtime reproduction:** `sendDirectMessage()` accepted
`senderBotId: 'BOT_NOT_REGISTERED'` and persisted the message.

**Required remediation:** authenticate sender identity against the
active session bot registry inside `MessagingService`, not only in the
native tool adapter. Reject unknown/inactive senders except for an
explicitly typed HUMAN/system principal. Do the same for broadcasts.

#### AUD-11 --- Secret handling is not centralized; `--api-key` still exposes argv

**Affected:** `src/cli/commands/bot.ts:84,123-150`;
`src/bot/agent-loop.ts:196-205,267-276,327+`; `src/shared/work-log.ts`;
`src/messaging/service.ts`

The CLI still accepts `--api-key` and passes the value to the provider
after printing a warning. The warning does not remove exposure through
process listings or shell history. The traceability matrix says secrets
are injected through env/stdin rather than argv, but the implementation
does not enforce that.

Redaction is applied to command output and selected top-level audit
detail strings. Work logs and broadcast metadata still persist raw
command arguments/details. The redactor does not recursively sanitize
arbitrary nested objects and has a limited token-pattern set.
`registerSecret()` is not wired to the Gemini provider's API-key
lifecycle.

**Required remediation:** remove or deprecate `--api-key` as a normal
input path; use environment injection, protected prompt/stdin, or a
secret provider. Introduce one recursive redaction boundary before all
logs, work logs, Blackboard records, broadcasts, audit events,
exceptions, and CLI output. Add canary-secret tests across every
persistence path.

#### AUD-12 --- External filesystem `per_action` approval cannot be completed

**Affected:** `src/execution/controller.ts:212-252`

For external file access, `REQUIRE_APPROVAL` throws an error instead of
calling `CapabilityApprovalService.promptUser()`. The method has no
approval callback. The feature therefore fails closed but is not
operational for per-action file grants.

**Required remediation:** provide a trusted approval callback to the
external filesystem execution path and record approval/denial audit
events. If no operator UI is available, clearly report that this
approval mode is unsupported and reject the grant at creation time.

### MEDIUM --- Correct before declaring all remediation closed

#### AUD-13 --- Capability presets do not produce the permissions their descriptions promise

**Affected:** `src/capability/presets.ts`;
`src/capability/policy-engine.ts:118-160`; `src/execution/controller.ts`

`controlled` and `extended` filesystem templates supply only
`operations`; the policy engine's `scopeRequired` check requires
paths/commands/hosts/env vars and therefore denies them. The
`unrestricted` preset's external filesystem grants have empty scope and
are also denied. The `extended` preset grants
`process.execute_external`, but the command controller evaluates
`command.arbitrary` instead. Command scope comparison uses
`path.basename(rawCommand)`, so a command such as `npm install` does not
match the executable name `npm`.

**Required remediation:** define a consistent capability-to-operation
mapping, validate presets against the policy engine, and add tests that
evaluate every preset end-to-end. Do not advertise a preset as working
until those tests pass.

#### AUD-14 --- Registered capabilities are not all enforced

**Affected:** `src/capability/registry.ts`; execution and tool adapters

Capabilities such as `network.outbound`, `system.config_access`,
`system.environment_access`, and `system.process_control` are
registered, but the current execution paths do not consistently evaluate
or enforce them. `supportsCapability()` exists on isolation backends but
is never called.

**Required remediation:** either implement enforcement adapters for each
capability or mark unsupported capabilities as unavailable/denied.
Registry presence must not imply effective enforcement.

#### AUD-15 --- Prompt delimiters are not escaped

**Affected:** `src/ai/prompts.ts:36-37` and work-log prompt assembly

Peer message content is inserted verbatim between
`<<<UNTRUSTED_..._START>>>` and `..._END>>>` delimiters. A message can
contain the closing delimiter and additional text. The tests verify
wrapper presence, not delimiter injection resistance.

**Required remediation:** encode or escape delimiter sequences and use
structured message serialization where supported. Treat delimiters as
defense-in-depth, not a security boundary. Add adversarial tests with
embedded closing markers and newlines.

#### AUD-16 --- Audit logging is best-effort and may silently fail

**Affected:** `src/capability/service.ts:202-220`;
`src/execution/controller.ts:175-194`

Capability grant and policy audit failures are swallowed. Execution
audit logging is also best-effort. A grant or sensitive execution may
therefore succeed without the required security audit event.

**Required remediation:** define which actions require durable audit
before proceeding. For grant/revoke and sensitive execution, fail closed
if the mandatory audit write cannot be persisted. Use an atomic or
recoverable transaction/outbox pattern for grant plus audit.

#### AUD-17 --- Filesystem path validation still has hardlink and TOCTOU limitations

**Affected:** `src/tools/sandbox.ts:59-160`;
`src/tools/file-tools.ts:123-189,173-272`

`realpath` resolves symlinks/junctions but does not identify hardlink
aliases. The file tool validates/canonicalizes a path and then performs
a later `stat`/read/write; a path can be replaced between validation and
use. These are not OS-enforced filesystem boundaries.

**Required remediation:** use OS-level sandbox enforcement for sensitive
operations and descriptor-based operations where possible (open with
no-follow semantics, verify the opened object, operate through the file
descriptor). Document hardlink behavior explicitly.

#### AUD-18 --- Specification, register, and status use inconsistent finding IDs/counts

**Affected:** `01_BASELINE_AUDIT_REGISTER.md`,
`02_REMEDIATION_SPECIFICATION.md` §3.2, `05_TRACEABILITY_MATRIX.md`,
`06_IMPLEMENTATION_STATUS.md`, `OPEN_ISSUES.md`

The Baseline Audit Register and Traceability Matrix use `SEC-04` for
secret redaction, `RELIA-02` for inbox limit, `RELIA-03` for JSONL, and
`NT-01/02/03` for Gemini retry, CLI secrets, and native messaging. The
Specification §3.2 assigns several of these IDs to different issues (for
example `SEC-04` to filesystem symlink escape, `RELIA-02` to JSONL,
`RELIA-03` to PID lifecycle, and `NT-01/02/03` to different items). The
status says "all 10 remediation issues" while the traceability matrix
contains 15 findings.

**Required remediation:** preserve the original finding IDs and create a
single canonical mapping table. Correct all phase reports, status, open
issues, changelog, and traceability references. Do not close an item
based on a test for a different finding.

#### AUD-19 --- Release metadata and archive hygiene need correction

**Affected:** `package.json`, `package-lock.json`,
`docs/docs_v0.3.2/README.md`, ZIP contents

`package.json` is 0.3.2 but the root package metadata in
`package-lock.json` still says 0.3.1. The `docs/docs_v0.3.2/README.md`
still describes the folder as a scaffold with Specification/Blueprint
placeholders, despite the nested documents being populated and the
status claiming release completion. The phase reports are duplicated
both at the remediation root and in `phases/`. The archive also contains
111 MB of `node_modules`, including only the Windows Rolldown native
binding, making the archive platform-specific and unsuitable as a clean
source distribution.

**Required remediation:** regenerate and commit `package-lock.json` for
0.3.2; replace the stale docs README with a release index; remove
duplicate report copies or declare one canonical location; exclude
`node_modules` from source archives and rely on the lockfile for
reproducible installation.

#### AUD-20 --- Provider cancellation is not wired through the agent runtime

**Affected:** `src/bot/agent-loop.ts:153-166`; `src/ai/provider.ts`;
`src/ai/gemini.ts`

The provider accepts an `AbortSignal`, but the agent loop calls
`generateResponse()` without passing a signal. The rate-limit pause path
uses an ordinary timer. Runtime stop therefore does not cancel an
in-flight model request or the agent-loop pause.

**Required remediation:** create a per-bot/per-message
`AbortController`, pass its signal through the agent loop to the
provider, abort it during stop/shutdown, and use signal-aware waiting
for rate-limit pauses.

## 4. What is genuinely improved

The following areas show substantive implementation progress, subject to
the findings above: - Package and CLI version are 0.3.2. -
`ExecutionEnvironmentBuilder` introduces a clearer environment
construction boundary. - `src/core/jsonl.ts` implements per-record
parsing/quarantine behavior. - ACG schema, registry, service, policy
engine, presets, approval service, persistence, and CLI are present. -
`ExecutionController` centralizes command execution calls. - Inbox
delivery state, lease fields, and idempotency support are present. - A
native `send_message` tool is registered in the agent loop. - Gemini
retry classification, server delay parsing, backoff, and provider-level
abort handling are implemented. - TypeScript build passes in the audit
environment.

These improvements do not offset the critical isolation and policy
enforcement defects.

## 5. Prioritized remediation order

1.  **P0:** Replace the fake OS-isolation backends with real isolation
    or disable sensitive shell execution by default.
2.  **P1:** Close no-session ACG bypass, validate session IDs, enforce
    bot binding, and correct path-scope comparison.
3.  **P1:** Fix inbox limit semantics, broadcast cursor/ack behavior,
    and lease ownership/fencing.
4.  **P1:** Harden lock atomicity and actually enforce fencing tokens at
    storage write boundaries.
5.  **P1:** Enforce sender identity at the messaging service boundary.
6.  **P1:** Remove argv API-key handling and centralize recursive
    redaction.
7.  **P1/P2:** Wire per-action approvals and validate all capability
    presets and registered enforcement adapters.
8.  **P2:** Fix prompt delimiter handling, mandatory audit persistence,
    and filesystem TOCTOU/hardlink exposure.
9.  **P2:** Reconcile finding IDs, update package-lock metadata, clean
    documentation/archive layout, and add cancellation propagation.
10. Re-run clean install, build, complete test suite, and targeted
    security tests on Windows 11 and Linux. Preserve logs and exact
    commit SHA.

## 6. Final audit decision

**Build:** PASS\
**Tests:** NOT INDEPENDENTLY VERIFIED in this audit environment\
**Security acceptance:** FAIL\
**Release recommendation:** **NO-GO pending remediation of AUD-01
through AUD-12 at minimum.**

The existing `FINAL_VERIFICATION_REPORT.md` should be treated as the
implementation team's reported evidence, not as independent proof that
all security acceptance criteria have been met.
