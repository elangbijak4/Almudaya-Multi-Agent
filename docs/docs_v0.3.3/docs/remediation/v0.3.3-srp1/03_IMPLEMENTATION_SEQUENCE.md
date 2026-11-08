# Implementation Sequence and Source Map — SRP-1

This sequence is a plan. Source paths/symbols must be reverified against the exact Phase 0 commit before editing.

## Phase 0 — Reproduce baseline
- Verify release commit, tags, package/lock versions, clean worktree.
- Clean install, build, tests on Linux and Windows.
- Reproduce all AUD-01–AUD-20 where possible.
- No production changes. Exit only with approved baseline report.

## Phase 1 — Fail-closed execution and identity
**Findings:** AUD-01, AUD-02, AUD-04, AUD-14  
**Likely source areas:** `src/execution/controller.ts`, `src/execution/isolation/*`, `src/capability/policy-engine.ts`, `src/tools/command-tools.ts`.
- Require session and authenticated bot context.
- Remove policy skip when context absent.
- Enforce adapter capability support.
- Disable sensitive execution on platforms lacking actual isolation.
- Define platform isolation threat model and negative tests.
**Gate:** no command runs without authenticated identity, grant, and supported isolation.

## Phase 2 — Scope and persistence integrity
**Findings:** AUD-03, AUD-05, AUD-17  
**Likely source areas:** `src/capability/persistence.ts`, `src/capability/policy-engine.ts`, `src/tools/sandbox.ts`, `src/tools/file-tools.ts`.
- Validate session IDs before path construction.
- Canonical, platform-aware path scope.
- Reduce path validation/use TOCTOU with descriptor-based operations where supported.
- Ensure external filesystem actions use the same enforcement controller.
**Gate:** traversal/case/symlink/hardlink tests pass; unsupported operations deny.

## Phase 3 — Messaging delivery correctness
**Findings:** AUD-06, AUD-07, AUD-08, AUD-10  
**Likely source areas:** `src/messaging/service.ts`, `src/messaging/delivery.ts`, `src/bot/runtime.ts`, `src/tools/messaging-tools.ts`.
- Fix inbox limit before mutation.
- Implement broadcast delivery/ack or per-category cursor.
- Add lease fencing and ownership validation.
- Authenticate sender at service boundary.
**Gate:** no skipped messages under filters/limits/failures; stale consumer cannot mutate current lease.

## Phase 4 — Lock, audit, and approval integrity
**Findings:** AUD-09, AUD-12, AUD-16  
**Likely source areas:** `src/core/lock.ts`, `src/blackboard/filesystem.ts`, `src/capability/service.ts`, `src/execution/controller.ts`, `src/capability/approval.ts`.
- Make lock protocol atomic and storage writes fencing-aware.
- Wire per-action approval or reject unsupported grants.
- Make mandatory audit durable before protected operations.
**Gate:** race tests pass; audit failure prevents protected action; approval has verifiable human decision.

## Phase 5 — Secret, prompt, preset, cancellation
**Findings:** AUD-11, AUD-13, AUD-15, AUD-20  
**Likely source areas:** `src/cli/commands/bot.ts`, `src/shared/work-log.ts`, `src/messaging/service.ts`, `src/ai/prompts.ts`, `src/capability/presets.ts`, `src/bot/agent-loop.ts`, `src/ai/provider.ts`, `src/ai/gemini.ts`.
- Remove argv secret path; central recursive redaction.
- Validate presets end-to-end and capability support.
- Encode untrusted peer messages.
- Propagate AbortSignal through runtime/provider/retry.
**Gate:** secret canaries absent from all sinks; preset matrix correct; adversarial prompt tests pass; stop aborts request.

## Phase 6 — Documentation and release verification
**Findings:** AUD-18, AUD-19 plus all closure evidence.
- Canonical ID reconciliation.
- Package/lockfile consistency.
- Clean source archive.
- Linux/Windows clean install/build/test/security regression.
- Migration and release notes.
**Gate:** all Critical/High closed, full traceability, independent review, GO decision.

## Change management
- Prefer small commits by finding or tightly coupled group.
- Do not mix documentation-only closure with unverified code closure.
- Every commit message should include one or more `AUD-xx` and `REQ-xx`.
