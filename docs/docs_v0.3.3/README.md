# Almudaya Multi-Agent — Security Remediation Patch SRP-1

**Baseline:** v0.3.2  
**Proposed release target:** v0.3.3  
**Purpose:** remediate audit findings AUD-01–AUD-20 without rewriting the architecture.

## Versioning policy
Treat v0.3.2 as immutable audit baseline. Do not silently rewrite its release tag or historical reports. Apply SRP-1 changes on a dedicated branch and release as v0.3.3 after all release gates pass. If the project owner explicitly chooses a different version, update this package before implementation.

## Document authority
1. `00_EXECUTION_DIRECTIVE.md` — process and coding-agent rules.
2. `01_AUDIT_FINDINGS_REGISTER.md` — canonical audit findings AUD-01–AUD-20.
3. `02_REMEDIATION_REQUIREMENTS.md` — normative requirements and acceptance criteria.
4. `03_IMPLEMENTATION_SEQUENCE.md` — source mapping strategy and implementation order.
5. `04_ARCHITECTURE_DECISIONS.md` — decisions that must not be weakened by implementation.
6. `05_TRACEABILITY_MATRIX.md` — Finding → Requirement → Code → Test → Evidence.
7. `06_STATUS_AND_GATES.md` — current status and phase approvals.
8. `phases/` and `reports/` — implementation and verification evidence.

## Critical rules
- Do not start production changes until Phase 0 baseline is reproduced and approved.
- A process group / process-tree kill mechanism is not an OS security sandbox.
- Missing session, bot identity, grant, policy decision, audit persistence, or required isolation means DENY.
- Capability registry presence does not prove enforcement.
- No finding may be closed by assertion alone; require a test and retained evidence.
- Preserve AUD-01–AUD-20 IDs. Do not reuse these IDs for different issues.
- Do not claim full test PASS unless the test command actually ran successfully on the stated platform.

## Getting started
Read `00_EXECUTION_DIRECTIVE.md`, then run Phase 0 only. The coding agent must stop and request human approval before Phase 1.
