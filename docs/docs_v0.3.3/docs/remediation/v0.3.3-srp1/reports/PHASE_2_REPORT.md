# SRP-1 Phase 2 Report — Scope and Persistence Integrity

- **Phase:** 2 — Scope and Persistence Integrity
- **Date:** 2026-11-08
- **Commit SHA:** `95914d6`
- **OS/Runtime:** Windows 11 (NT 10.0.26200.0), Node.js v24.21.0, npm 11.19.0
- **Implementer/Reviewer:** Antigravity AI / User Project Owner

---

## 1. Findings and Requirements in Scope

| Finding ID | Severity | Requirement ID | Summary & Target Outcome |
|---|---|---|---|
| **AUD-03** | High | REQ-03 | Capability persistence allows session ID path traversal (`../../`) escaping workspace root. Target outcome: Strict session ID validation and canonical containment checks preventing directory traversal. |
| **AUD-05** | High | REQ-03 | Lowercase string comparison weakens case-sensitive path scope evaluation on POSIX systems. Target outcome: Platform-aware canonical path containment preserving case sensitivity on Linux/POSIX. |
| **AUD-17** | Medium | REQ-03, REQ-01 | File tools open by path without descriptor safety (TOCTOU) and mutate external targets via hard links. Target outcome: Descriptor-based file operations and hard link breaking before writes/edits. |

---

## 2. Files and Symbols Changed

1. **`src/tools/sandbox.ts`**:
   - Enhanced `isPathInsideRoot(rootDirectory, targetPath, platform = process.platform)`:
     - On `win32`: uses `path.win32`, case-insensitive lowercasing, and segment boundary check.
     - On POSIX (`linux`, `darwin`, etc.): uses `path.posix`, preserves exact casing, and checks `!relative.startsWith('..') && !path.posix.isAbsolute(relative)`.
     - Completely prevents prefix collision bypasses (e.g., `/app/project` vs `/app/project-fake`).

2. **`src/capability/policy-engine.ts`**:
   - Added optional `platform?: NodeJS.Platform` property to `PolicyEvaluationRequest`.
   - In Step 8 (path scope evaluation), replaced raw lowercased `.startsWith()` matching with `isPathInsideRoot(allowedPath, targetResource, request.platform ?? process.platform)`.
   - On Linux, `/tmp/Secret` strictly rejects `/tmp/secret/credentials.txt`, while on Windows, case-insensitive access is safely supported.

3. **`src/capability/persistence.ts`**:
   - In `getCapabilitiesDir(sessionId)`: added `validateSessionId(sessionId)` and enforced `isPathInsideRoot(this.workspaceRoot, sessionDir)` throwing `PathTraversalSecurityError` if path escapes workspace root.
   - In `withSessionLock(sessionId, ...)`: added `validateSessionId(sessionId)` and verified `sessionDir` containment within `this.workspaceRoot`.

4. **`src/cli/commands/capability.ts`**:
   - Added `validateSessionId(options.session)` validation to CLI capability subcommands (`list`, `inspect`, `grant`, `revoke`, `history`, `reset`, `preset apply`), returning exit code 1 on traversal attempts.

5. **`src/tools/file-tools.ts`**:
   - `executeReadFile`: Switched from unbounded path-based read to descriptor-based lifecycle (`handle = await fs.open(fullPath, 'r')` -> `stat = await handle.stat()` -> `content = await handle.readFile({ encoding: 'utf8' })` -> `await handle.close()`), eliminating TOCTOU race vulnerabilities between stat and read.
   - `executeWriteFile`: Added hardlink detection via `stat.nlink > 1`. If hard link count exceeds 1, `await fs.unlink(fullPath)` severs the link before writing, ensuring external files sharing the inode are never mutated.
   - `executeEditFile`: Added descriptor-based read and hard link breaking (`stat.nlink > 1 -> unlink`) before writing replaced content.

6. **`tests/capability/capability.test.ts`**:
   - Added AUD-03 regression tests: persistence layer rejects `../../outside`, no directories are created outside workspace, and CLI commands reject traversing session IDs.
   - Added AUD-05 regression tests: policy evaluation strictly denies case mismatch on Linux (`/var/log/Audit` denies `/var/log/audit/report.log`), allows matching case, allows case-insensitive access on `win32`, and rejects prefix collision traps.

7. **`tests/tools/sandbox.test.ts`**:
   - Added unit tests for platform-aware `isPathInsideRoot` comparing Linux case sensitivity, Windows case insensitivity, and cross-platform prefix collision protection.

8. **`tests/tools/file-tools.test.ts`**:
   - Added AUD-17 regression tests:
     - `executeWriteFile` breaks hard links, updates internal file, and preserves external file untouched (`stat.nlink` resets from 2 to 1).
     - `executeEditFile` breaks hard links, updates internal file, and leaves outside file intact.
     - `executeReadFile` reads via file descriptor successfully.

---

## 3. Verification Commands and Raw Outputs

### 3.1 Build Verification
```powershell
npm run build
```
- **Exit Code:** 0
- **Output:**
```
> almudaya-multiagent@0.3.2 build
> tsc
```

### 3.2 Capability Regression Tests
```powershell
npx vitest run tests/capability/capability.test.ts
```
- **Exit Code:** 0
- **Summary:** 27 passed (27)

### 3.3 Sandbox Unit Tests
```powershell
npx vitest run tests/tools/sandbox.test.ts
```
- **Exit Code:** 0
- **Summary:** 13 passed (13)

### 3.4 File Tools Hardlink & TOCTOU Tests
```powershell
npx vitest run tests/tools/file-tools.test.ts
```
- **Exit Code:** 0
- **Summary:** 19 passed (19)

### 3.5 Full Test Suite Run
```powershell
npx vitest run
```
- **Exit Code:** 0
- **Summary:**
```
Test Files  44 passed (44)
     Tests  316 passed (316)
  Duration  7.63s
```

---

## 4. Known Limitations & Environment Notes
1. **Hardlink Test Support:** Hardlink testing (`fs.link`) was executed natively on Windows NTFS filesystem; link counts (`nlink: 2 -> nlink: 1`) and link-breaking unlinking behavior were verified directly on disk.
2. **Platform-Aware Testing:** POSIX case-sensitive semantics are tested directly in Node.js via explicit `platform: 'linux'` parameterization passed to `isPathInsideRoot` and `PolicyEngine.evaluate`.

---

## 5. Phase 2 Gate Evaluation

- [x] Session ID path traversal blocked at persistence and CLI layers (AUD-03).
- [x] Platform-aware, case-sensitive path containment implemented in policy engine and sandbox (AUD-05).
- [x] Hard link breaking and descriptor-based operations prevent TOCTOU and external file corruption (AUD-17).
- [x] Full build and 44 test suites pass cleanly (316 tests, 0 failures).
- [x] Gate status: Phase 2 Complete, awaiting human approval before proceeding to Phase 3.
