# Phase 2 Report — Agent Capability Governance (ACG)

- **Date:** 2026-11-07
- **Environment:** Windows 11 (win32 x64) / Node.js v24.21.0 / npm 11.19.0
- **Baseline Commit:** `6c617febfb9e7185a46ecfc92f6dd3ac18dc9a94`
- **Owner:** Almudaya Engineering Team
- **Reviewer:** Security Auditor

---

## 1. Scope and Linked Requirements

Phase 2 introduces the central Agent Capability Governance (ACG) subsystem:
- **`SEC-03` (`REQ-ACG-EXEC-01`):** Central authority for all sensitive external capabilities; default fail-closed deny; explicit grant requirements.
- **`ADR-001` (Agent Capability Governance):** Validated, expiring, revocable, session/bot-bound grant model; hard-deny rules; empty scope restriction.
- **`ADR-005` (Security Audit Trail):** Dedicated security audit persistence in `sessions/<id>/capabilities/audit.jsonl` separate from work logs, with secret redaction.
- **Section 6.6 (TURBO Separation):** Enforced rule that TURBO mode is not privilege escalation; TURBO cannot bypass capability policy or convert DENY to ALLOW.
- **Section 6.7 (Architectural Presets):** Defined `restricted`, `controlled`, `extended`, and `unrestricted` presets.
- **Section 6.8 (CLI Capability Group):** Registered `almudaya capability` commands for list, inspect, grant, revoke, history, reset, and presets.

---

## 2. Source Files Added & Modified

### New Modules (`src/capability/`):
1. [`src/capability/schema.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/schema.ts): Zod schemas for RiskLevel, CapabilityId, CapabilityDefinition, CapabilityGrant, PolicyDecision, PolicyEvaluationResult, and SecurityAuditEvent.
2. [`src/capability/registry.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/registry.ts): Registry of the 9 canonical capability identifiers (`filesystem.read_external`, `filesystem.write_external`, `filesystem.delete_external`, `system.config_access`, `process.execute_external`, `network.outbound`, `command.arbitrary`, `system.environment_access`, `system.process_control`).
3. [`src/capability/persistence.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/persistence.ts): Isolated capability storage at `sessions/<id>/capabilities/grants.jsonl` and `audit.jsonl` with atomic locking, auto-expiry, and secret redaction.
4. [`src/capability/policy-engine.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/policy-engine.ts): 10-step fail-closed policy engine enforcing hard-denies, scope validation, bot/session binding, and TURBO isolation.
5. [`src/capability/approval.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/approval.ts): Review prompt generator and approval coordinator.
6. [`src/capability/presets.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/presets.ts): Preset templates for `restricted`, `controlled`, `extended`, and `unrestricted`.
7. [`src/capability/service.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/service.ts): Central facade coordinating grants, revocations, evaluation, presets, and audit logging.
8. [`src/capability/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/capability/index.ts): Public capability barrel export.

### CLI & Index Integration:
1. [`src/cli/commands/capability.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/cli/commands/capability.ts): Registered `capability list`, `inspect`, `grant`, `revoke`, `history`, `reset`, and `preset` commands.
2. [`src/cli/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/cli/index.ts): Integrated capability command group.
3. [`src/index.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/index.ts): Exported capability subsystem.

### New Test Suite:
- [`tests/capability/capability.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/capability/capability.test.ts): 20 comprehensive unit and integration tests.

---

## 3. ADRs Addressed
- **ADR-001 (Agent Capability Governance):** Accepted & Implemented.
- **ADR-005 (Security Audit Trail):** Accepted & Implemented.

---

## 4. Tests Executed

- **Command:** `npm test` (`vitest run`)
- **Exit Code:** `0`
- **Results:**
  - **40 test files passed (100%)**
  - **240 tests passed (100%)** (201 baseline + 19 Phase 1 + 20 Phase 2)
  - **0 failed, 0 skipped**
  - **Duration:** 2.83s (100% offline & deterministik)

---

## 5. Security & Invariant Verification
- **Default Deny:** Verified that unknown capabilities, requests without grants, or requests with an empty scope return `DENY`.
- **Hard-Deny Defense:** Verified that attempts to target sensitive OS files (e.g. `/etc/shadow`, `SAM`) are rejected with `DENY` even when broad grants are present.
- **TURBO Separation (Section 6.6):** 4 mandatory regression tests confirm:
  1. TURBO + no grant = `DENY`.
  2. TURBO + wrong scope = `DENY`.
  3. TURBO + revoked grant = `DENY`.
  4. TURBO + valid grant executes strictly within granted approval mode.
- **Audit Separation & Redaction:** Verified that security events are persisted to `audit.jsonl` with API keys and secrets automatically masked.

---

## 6. Limitations and Residual Risks
- The ACG subsystem is now fully established, but enforcement in `executeRunCommand` and tool adapters will be wired in Phase 3 (Execution Enforcement & OS Isolation).

---

## 7. Exit Criteria & Gate Decision

- [x] All Phase 2 ACG core specifications implemented.
- [x] All 240 unit and integration tests executed and passing.
- [x] Mandatory TURBO regression suite verified.
- [x] CLI commands tested and functional.
- [x] Traceability matrix updated.

**Gate Decision:** **PASS**  
**Ready for Phase 3 (Execution Enforcement & OS Isolation).**
