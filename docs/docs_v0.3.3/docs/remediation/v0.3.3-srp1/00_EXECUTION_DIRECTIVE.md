# Execution Directive — SRP-1

## Mission
Remediate the 20 findings in the independent source/runtime audit of Almudaya Multi-Agent v0.3.2. Preserve working architecture where possible. Do not rewrite the project wholesale.

## Baseline and release identity
- Audited baseline: package v0.3.2
- Proposed target: package v0.3.3
- Work branch: `security/srp-1-v0.3.3`
- Audit finding IDs: AUD-01 through AUD-20
- Source of truth: repository source at the recorded baseline commit, not an old ZIP filename.

## Mandatory workflow
### Phase 0 — Baseline reproduction (ONLY)
1. Verify repository URL/path, branch, commit SHA, package version, lockfile version.
2. Inspect `git status`, tags, and recent history. Do not overwrite user changes.
3. Perform clean dependency installation using the documented lockfile.
4. Run build and full tests on Linux and Windows where available.
5. Run targeted reproductions for AUD-01–AUD-20, recording exact commands and outputs.
6. Produce `reports/PHASE_0_BASELINE.md`.
7. STOP. Do not modify production source until the project owner approves Phase 1.

If environment/network prevents a check, report `BLOCKED` with exact reason. Do not convert unavailable verification into PASS.

### Phases 1–6
Implement in the order defined in `03_IMPLEMENTATION_SEQUENCE.md`. Each phase must:
- link every code change to requirement IDs;
- add regression tests before/with the fix;
- preserve backward compatibility where safe;
- document migration and security implications;
- update traceability and status;
- produce a phase report;
- stop at the phase gate for human approval.

## Security invariants
1. Default deny. Missing `sessionId`, authenticated `botId`, grant, policy decision, or required isolation MUST deny.
2. Never describe process-tree/process-group termination as filesystem/network isolation.
3. No direct shell execution path may bypass `ExecutionController`.
4. Grant scope comparison must be canonical and platform-aware.
5. A grant bound to a bot requires exact authenticated bot identity.
6. A worker can ACK/fail only a message lease it currently owns, with a valid fencing token.
7. Cursor advancement must not lose events when callbacks fail or filters/limits are used.
8. Secrets must be redacted before every persistence/output boundary.
9. Mandatory security audit failure must prevent the protected operation from succeeding.
10. Capability support must be enforced, not inferred from registry metadata.

## Implementation constraints
- Do not weaken tests to make them pass.
- Do not delete failing tests without an approved rationale.
- Do not introduce an unrestricted fallback if sandbox/isolation is unavailable.
- Do not silently change finding IDs or acceptance criteria.
- Use typed APIs; avoid shell-string interpolation where argument-vector execution is possible.
- Do not claim Windows/Linux isolation is complete without platform-specific negative tests.
- Record residual risks and unsupported platforms explicitly.

## Required deliverables
- Phase 0 baseline report.
- Updated requirements and traceability matrix.
- Regression tests for every finding.
- Phase reports and security evidence.
- Migration notes.
- Final verification report and release decision.
