# Implementation Plan — Waterfall Work Breakdown

Do not implement later phases before the preceding phase gate is passed.

## Phase 1 — Project scaffold

- Inspect environment and repository.
- Establish package metadata and scripts.
- Configure strict TypeScript.
- Configure Vitest.
- Create CLI entry point with help/version.
- Add minimal test and build smoke test.
- Inspect `npm pack --dry-run`.
- Record environment and gate status.

**Exit:** scaffold acceptance criteria pass.

## Phase 2 — Session and persistent Blackboard

- Finalize workspace root strategy.
- Implement Session metadata schema and validation.
- Implement filesystem repository abstraction.
- Implement safe create/read/update operations.
- Add atomic write and locking strategy.
- Add Session create/list/inspect CLI operations as approved.
- Test persistence and malformed data.

**Exit:** Session state survives restart; persistence tests pass.

## Phase 3 — Bot registration and discovery

- Implement Bot ID and display-name rules.
- Implement safe default-name sequence allocation.
- Implement register/join/list/rename/status.
- Implement peer discovery.
- Add independent-process tests for concurrent registration.

**Exit:** two processes register in one Session without identity collision.

## Phase 4 — Messaging

- Implement broadcast event schema and append/read operations.
- Implement Individual Blackboard/inbox.
- Implement direct message send/read.
- Implement read/ack state.
- Test concurrent writers and restart persistence.

**Exit:** broadcast and direct-message acceptance criteria pass.

## Phase 5 — Shared project context

- Implement project root registry.
- Implement environment registry.
- Implement SDLC document reference registry.
- Validate path and metadata handling.
- Ensure secrets are excluded/redacted.

**Exit:** shared context can be registered and read by multiple bots.

## Phase 6 — Independent bot runtime

- Implement bot process entry/lifecycle.
- Implement start/stop/status behavior within approved scope.
- Handle process errors and stale status.
- Verify one bot's blocked operation does not block another process.

**Exit:** multi-process runtime scenario passes.

## Phase 7 — End-to-end verification

- Run unit, persistence, concurrency, CLI, package, and integration suites.
- Execute two-terminal acceptance scenario.
- Verify shutdown/restart and rename invariants.
- Update traceability and test report.

**Exit:** all Must requirements verified or explicitly dispositioned.

## Phase 8 — Release preparation and closure

- Finalize README, changelog, license decision, package metadata.
- Inspect package contents.
- Check npm package-name availability before any publication attempt.
- Do not publish without explicit authorization.
- Document limitations and next-version candidates.
- Complete final phase gate and handover.

**Exit:** release candidate is reproducible and documented.
