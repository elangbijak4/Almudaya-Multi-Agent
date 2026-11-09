# SRP-1 Phase 4 Report — Lock, Audit, and Approval Integrity

- **Phase:** 4 — Lock, Audit, and Approval Integrity
- **Date:** 2026-11-09
- **Commit SHA:** `df55c20`
- **OS/Runtime:** Windows 11 (NT 10.0.26200.0), Node.js v24.21.0, npm 11.19.0
- **Implementer/Reviewer:** Antigravity AI / User Project Owner

---

## 1. Findings and Requirements in Scope

| Finding ID | Severity | Requirement ID | Summary & Target Outcome |
|---|---|---|---|
| **AUD-09** | High | REQ-06 | Lock stale recovery reads a lock, determines it is stale, and unlinks by path, allowing a new owner to be replaced and deleted between read and unlink. Lease renewal and release have similar TOCTOU races. Storage writes do not validate the lock manager's fencing token. Target outcome: Implement atomic, ownership-safe lock protocol with mutual-exclusion directory barrier; enforce monotonic fencing token validation at the storage write boundary so stale holders cannot commit after lease expiry. |
| **AUD-12** | High | REQ-08 | For external file access, `REQUIRE_APPROVAL` throws an error instead of calling `CapabilityApprovalService.promptUser()`, lacking an approval callback. Target outcome: Provide trusted human approval callback in `ExecutionController.authorizeFileAccess`, record `CAPABILITY_APPROVED` / `CAPABILITY_DENIED` security audit events, and reject `per_action` grants at creation time if no approval interface is available. |
| **AUD-16** | Medium | REQ-11 | Capability grant/revoke and command execution audit logging is best-effort and swallowed on error. Target outcome: Mandatory security audit logging; fail-closed with transaction/rollback if audit write fails on capability grant; fail-closed on revocation and sensitive execution audit failure; pass all audit records through central recursive secret redaction. |

---

## 2. Files and Symbols Changed

1. **`src/core/errors.ts`**:
   - Added `StaleLockFencingError`: thrown when a storage write boundary detects that a caller's fencing token is older than the active disk epoch.
   - Added `AuditPersistenceError`: thrown when mandatory security audit logging fails for capability lifecycle or sensitive execution.

2. **`src/core/lock.ts`**:
   - Implemented `withBarrier(targetDir, fn)`: an internal mutual exclusion coordination barrier using atomic directory creation (`.lock_barrier`) with bounded timeout and stale barrier self-healing.
   - Hardened `releaseFn`: coordinates under `withBarrier`, re-reads `lockFilePath`, and unlinks only if the disk lock record matches the exact `owner_token` and `lock_id`.
   - Hardened `renewLease`: coordinates under `withBarrier`, verifies `owner_token` and `lock_id`, updates `lease_expires_at`, and writes atomically. Fails closed with an error if ownership was lost.
   - Hardened stale lock recovery (`isStale`): coordinates under `withBarrier`, re-verifies that the lock record on disk still matches the observed stale record before unlinking, preventing concurrent new owner lock deletion.
   - Hardened corrupt lock recovery: coordinates under `withBarrier`, safely backs up corrupt lock file to `.lock.corrupt.<timestamp>`.

3. **`src/blackboard/interface.ts`**:
   - `ISessionStorage`: Updated `withSessionLock<T>(sessionId: string, action: (fencingToken?: number) => Promise<T>): Promise<T>` to propagate `fencingToken` to lock callers.
   - Storage write methods (`saveBotRegistry`, `saveInbox`, `saveBroadcastCursor`, `appendBroadcast`, `updateSession`, `appendWorkLog`, `saveProjectRootsRegistry`, `saveDocumentsRegistry`, `saveEnvironmentMetadata`): Added optional `fencingToken?: number` parameter.

4. **`src/blackboard/filesystem.ts`**:
   - Added `activeFencingContext = new AsyncLocalStorage<Map<string, number>>()` to automatically track active lock fencing epochs across asynchronous calls within `withSessionLock`.
   - Updated `withSessionLock`: sets the active fencing token in `activeFencingContext` and passes `handle.fencingToken` to the action callback.
   - Added `verifyStorageFencing(sessionId: string, explicitToken?: number)`: reads `.fencing_token` from disk in the session directory; if the caller's token (explicit or from context) is less than the active disk token, throws `StaleLockFencingError`.
   - Wired `verifyStorageFencing` into all protected writes: `updateSession`, `saveBotRegistry`, `appendBroadcast`, `saveBroadcastCursor`, `saveInbox`, `appendWorkLog`, `saveProjectRootsRegistry`, `saveEnvironmentMetadata`, `saveDocumentsRegistry`.

5. **`src/capability/persistence.ts`**:
   - Added `deleteGrant(sessionId: string, grantId: string): Promise<boolean>` to allow transactional rollback of capability grants when audit persistence fails.
   - Updated `recordAuditEvent`: applied deep recursive secret redaction (`redactRecursively`) across all nested objects and string fields in audit details before durable persistence.

6. **`src/capability/service.ts`**:
   - Added `approvalPromptCallback`, `setApprovalPromptCallback`, `getApprovalPromptCallback`, and `hasApprovalInterface`.
   - In `grantCapability`:
     - Rejects `approvalMode: 'per_action'` for external filesystem operations (`filesystem.*`) at creation time if no trusted human approval interface is available (`!this.hasApprovalInterface()`).
     - Made audit logging mandatory via `recordAuditMandatory`: if audit persistence fails, rolls back the newly created grant via `persistence.deleteGrant` and throws `AuditPersistenceError`.
   - In `revokeGrant`:
     - Made audit logging mandatory: if audit persistence fails on revocation, throws `AuditPersistenceError`.
   - In `applyPreset`:
     - Made audit logging mandatory: throws `AuditPersistenceError` if any grant audit event fails to persist.

7. **`src/execution/controller.ts`**:
   - Added `approvalCallback`, `setApprovalCallback(cb)`, and `getApprovalCallback()`. Wired `setApprovalCallback` to synchronize with `CapabilityService.setApprovalPromptCallback`.
   - In `executeCommand`:
     - Made audit logging mandatory for execution: if audit persistence fails, throws `AuditPersistenceError` and suppresses output (fail-closed).
   - In `authorizeFileAccess`:
     - When `evalResult.decision === 'REQUIRE_APPROVAL'`:
       - If no approval callback is registered: logs `CAPABILITY_DENIED` audit event with reason and fails closed with error.
       - If approval callback is registered: invokes `CapabilityApprovalService.promptUser(...)`.
       - If operator approves: logs `CAPABILITY_APPROVED` audit event (fails closed with `AuditPersistenceError` if write fails) and permits access.
       - If operator rejects: logs `CAPABILITY_DENIED` audit event and throws error denying access.

8. **Regression Tests Added**:
   - **`tests/core/lock.test.ts`**:
     - `AUD-09 race 1: stale recovery must not unlink a newly acquired lock`: Deterministic test verifying that stale recovery re-verifies ownership under barrier and does not unlink a newly acquired lock.
     - `AUD-09 race 2: renew-vs-reacquire must throw and not overwrite new owner lock`: Deterministic test verifying that expired owner cannot renew lease or overwrite a reacquired lock.
     - `AUD-09 storage fencing: storage write with stale fencing token must be rejected`: Verifies that a storage write with a stale fencing token is rejected with `StaleLockFencingError`, while writes with the active fencing token succeed.
   - **`tests/execution/controller.test.ts`**:
     - `AUD-12: should prompt approval callback on external file access and allow on approve`: Verifies approval prompt is presented, operator approval permits file access, and `CAPABILITY_APPROVED` audit event is durably recorded.
     - `AUD-12: should deny access and record CAPABILITY_DENIED when operator rejects`: Verifies operator rejection denies access and records `CAPABILITY_DENIED` audit event.
     - `AUD-12: should fail closed and record CAPABILITY_DENIED when no approval callback registered`: Verifies that lack of approval callback denies access and records audit.
     - `AUD-16: should fail closed with AuditPersistenceError when command audit fails`: Verifies sensitive execution fails closed if audit log cannot be written.
   - **`tests/capability/capability.test.ts`**:
     - `AUD-12: should reject per_action grant for external filesystem without registered approval interface`: Verifies `grantCapability` throws error and rejects grant at creation time.
     - `AUD-12: should allow per_action grant when approval interface is registered`: Verifies grant creation succeeds when approval callback is set.
     - `AUD-16: should rollback grant and fail closed when mandatory audit persistence fails`: Verifies newly created grant is deleted from disk and `AuditPersistenceError` is thrown when audit write fails.
     - `AUD-16: should fail closed when mandatory audit persistence fails on revoke`: Verifies revocation throws `AuditPersistenceError` on audit write failure.
     - `AUD-16 / REQ-07: should recursively redact secrets from audit event details`: Verifies that deeply nested objects, arrays, and token strings in audit details are sanitized before persistence.

---

## 3. Design and ADR References

- **ADR-SRP1-005 (Fencing enforced at write boundary):** Fencing tokens are validated directly by the storage resource (`FilesystemSessionStorage.verifyStorageFencing`). Stale holders cannot commit after a newer lease/fencing epoch is active.
- **ADR-SRP1-006 (Mandatory security audit):** Grant, revocation, and command execution require durable audit. If audit persistence fails, the operation fails closed and grants are rolled back.
- **ADR-SRP1-007 (Redaction at trust boundaries):** All audit event details are recursively sanitized via `redactRecursively` prior to storage.
- **ADR-003 (Agent Capability Governance):** Explicit human-in-the-loop authorization for `per_action` capabilities with operator decision recording.

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
Test Files  44 passed (44)
     Tests  340 passed (340)
  Start at  14:07:43
  Duration  11.21s
```
*Note: Test count increased from 328 to 340 tests (+12 regression tests across lock, execution controller, and capability suites).*

---

## 5. Security Analysis

- **Lock Race Prevention:** The introduction of the directory barrier (`.lock_barrier`) ensures that reading and unlinking a stale lock, as well as reading and updating for lease renewal, are strictly coordinated. A process cannot unlink a lock file that has transitioned to a new owner during a recovery window.
- **Storage Write Fencing:** In accordance with ADR-SRP1-005, fencing is enforced at the storage boundary (`verifyStorageFencing`). Even if a stale lock holder continues execution after lease expiration and another process increments `.fencing_token`, any subsequent mutation by the stale holder throws `StaleLockFencingError`.
- **Approval Integrity:** External filesystem access with `per_action` approval mode requires explicit, verifiable human authorization. Without an approval interface, grant creation fails closed at creation time (`REQ-08`), preventing dead grants that would fail unexpectedly during agent execution.
- **Audit Non-Repudiation & Durability:** Security audit logging is no longer best-effort for critical operations. Inability to record audit causes immediate rollback of capability grants and cancellation of sensitive actions, eliminating audit blind spots.

---

## 6. Migration and Backward Compatibility

- All new write method parameters (`fencingToken?: number`) and `ExecutionController` callbacks are optional; existing callers and integrations function without breaking changes.
- Calls within `withSessionLock` receive automatic fencing token tracking via Node.js `AsyncLocalStorage`.
- Pre-existing capability grants with `approval_mode: 'session'` or `'persistent'` remain completely unaffected.

---

## 7. Residual Risks and Deferred Work

- **Phase 5 (Secret, Prompt, Preset, Cancellation):** Secret minimization via argv deprecation (AUD-11), preset scope specification corrections (AUD-13), untrusted message encoding (AUD-15), and AbortSignal cancellation propagation (AUD-20) are scheduled for Phase 5.

---

## 8. Gate Status: PASS

All Phase 4 gate criteria are satisfied:
1. Race tests pass (stale recovery, renew-vs-reacquire, storage boundary fencing).
2. Mandatory audit failure prevents protected action and rolls back grants.
3. Approval workflow has verifiable human decision callback and rejects unsupported `per_action` at creation time.
4. Full test suite (44 test files, 340 tests) passes with 100% pass rate.
