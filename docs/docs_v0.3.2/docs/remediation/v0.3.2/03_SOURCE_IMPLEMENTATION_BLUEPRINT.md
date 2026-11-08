# Source-Based Implementation Blueprint — v0.3.2

> # ALMUDAYA MULTI-AGENT v0.3.2
# SOURCE-BASED IMPLEMENTATION BLUEPRINT

**Release:** Security & Concurrency Hardening  
**Baseline:** v0.3.1  
**Target:** v0.3.2  
**Status:** APPROVED FOR IMPLEMENTATION PLANNING  
**Implementation approach:** Incremental remediation of the existing codebase  
**Primary language:** TypeScript  
**Runtime:** Node.js >= 22.12.0  
**Module system:** ESM  
**Validation:** TypeScript + Vitest

---

# 1. Purpose

Dokumen ini menerjemahkan Remediation Specification v0.3.2 menjadi implementation blueprint yang terikat pada source code v0.3.1.

Tujuannya bukan membangun ulang Almudaya Multi-Agent, tetapi melakukan perubahan yang terukur terhadap arsitektur existing.

Setiap pekerjaan harus dapat ditelusuri ke:

1. Existing source file.
2. Existing class, function, atau interface.
3. Proposed modification.
4. New class atau interface jika diperlukan.
5. Existing test yang harus dipertahankan.
6. New test yang harus ditambahkan.
7. Acceptance criteria.
8. Urutan implementasi dan dependensi.

## 1.1 Evidence Classification

Blueprint menggunakan tiga klasifikasi.

| Label | Arti |
|---|---|
| VERIFIED | Ditemukan pada source archive yang diperiksa |
| PROPOSED | Rancangan perubahan untuk v0.3.2 |
| UNVERIFIED | Membutuhkan build, runtime test, atau eksperimen OS |

Blueprint ini didasarkan pada pemeriksaan statis source archive. Build dan seluruh test suite belum dijalankan secara independen dalam proses penyusunan blueprint.

---

# 2. Baseline Source Code

## 2.1 Package Metadata

**VERIFIED**

`package.json`:

- Package: `almudaya-multiagent`
- Version: `0.3.1`
- Type: `module`
- Node.js: `>=22.12.0`
- Build: `tsc`
- Test: `vitest run`
- CLI executable: `dist/cli/bin.js`

Dependencies utama:

- `@google/genai`
- `commander`
- `zod`

Development dependencies:

- `typescript`
- `vitest`
- `@types/node`

Implikasi implementasi:

1. Pertahankan ESM import convention dengan ekstensi `.js` pada import TypeScript.
2. Gunakan Zod untuk validasi schema persistence dan input.
3. Gunakan Commander untuk CLI.
4. Gunakan Vitest untuk seluruh test baru.
5. Hindari menambah dependency besar sebelum kebutuhan teknisnya dibuktikan.

## 2.2 Existing Source Structure

**VERIFIED**

```text
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

Existing tests:

```text
tests/
  ai/
  blackboard/
  bot/
  cli/
  core/
  e2e/
  messaging/
  shared/
  tools/
```

## 2.3 Architectural Constraint

Jangan memindahkan seluruh implementasi existing ke struktur baru.

Sebagai contoh, `src/tools/command-tools.ts` tidak perlu dihapus dan diganti dengan sistem baru. File tersebut tetap menjadi adapter tool untuk AI, tetapi eksekusi internalnya harus dialihkan ke Execution Controller.

Prinsip yang sama berlaku untuk:

- File tools.
- Messaging service.
- Bot runtime.
- Execution mode.
- Blackboard persistence.
- CLI.

---

# 3. Existing Architecture and Integration Points

## 3.1 Agent Execution Flow

**VERIFIED**

Pusat agent loop berada pada:

`src/bot/agent-loop.ts`

Class:

`AutonomousAgentLoop`

Interface:

`AgentLoopOptions`

Agent loop saat ini:

1. Membaca informasi bot.
2. Membaca peer bots.
3. Membaca project roots.
4. Mengambil recent work logs.
5. Membentuk system prompt.
6. Mendaftarkan file tools, command tool, dan work-log tool.
7. Mengirim request ke AI provider.
8. Memproses tool calls.
9. Memanggil execution-mode controller.
10. Menjalankan tool.
11. Mencatat hasil pekerjaan.

Titik integrasi paling penting adalah tool dispatch pada `AutonomousAgentLoop`.

**Target v0.3.2:**

```text
AutonomousAgentLoop
       |
       v
Tool Dispatcher
       |
       v
Execution Controller
       |
       +----------------------+
       |                      |
       v                      v
Capability Evaluator     Approval Controller
       |                      |
       +----------+-----------+
                  |
                  v
            OS Enforcement
                  |
                  v
             Tool Result
```

Agent loop tidak boleh memutuskan sendiri apakah akses host diizinkan.

## 3.2 Command Execution Flow

**VERIFIED**

File:

`src/tools/command-tools.ts`

Existing function:

`executeRunCommand(projectRoots, args)`

Existing interface:

- `RunCommandArgs`
- `RunCommandResult`

Saat ini fungsi tersebut:

- Memvalidasi working directory melalui `validateSandboxedPath`.
- Menggunakan `spawn`.
- Menjalankan shell command.
- Menggunakan `sanitizeChildEnv`.
- Membatasi output.
- Mengimplementasikan timeout.
- Melakukan output redaction.

Masalah utama:

Working directory dibatasi, tetapi command string masih dijalankan melalui shell.

Pembatasan working directory tidak membatasi seluruh akses filesystem atau proses yang dapat dilakukan oleh shell.

**Target v0.3.2:**

`executeRunCommand` dipertahankan sebagai public tool adapter, tetapi internal implementation diarahkan ke `ExecutionController`.

## 3.3 Filesystem Flow

**VERIFIED**

File:

- `src/tools/file-tools.ts`
- `src/tools/sandbox.ts`

Existing functions:

- `executeReadFile`
- `executeWriteFile`
- `executeEditFile`
- `executeListDir`
- `executeSearchFiles`
- `executeFileTool`
- `validateSandboxedPath`
- `getCanonicalPath`
- `isPathInsideRoot`
- `sanitizeChildEnv`
- `redactSensitiveOutput`

Existing file tools dibatasi oleh project roots.

**Target v0.3.2:**

Project root tetap menjadi default boundary.

ACG memperluas akses melalui explicit external capability grants tanpa menghilangkan perlindungan existing.

## 3.4 Persistence Flow

**VERIFIED**

File:

- `src/blackboard/interface.ts`
- `src/blackboard/filesystem.ts`

Existing abstraction:

`IBlackboardStorage`

Interface tersebut menggabungkan:

- Session storage.
- Bot registry storage.
- Messaging storage.
- Shared context storage.
- Work log storage.

**Target v0.3.2:**

Tambahkan capability persistence dan audit persistence sebagai interface terpisah.

Jangan memperbesar `IBlackboardStorage` secara berlebihan jika pemisahan interface lebih tepat.

---

# 4. Target Architecture

## 4.1 Proposed Source Structure

Struktur berikut merupakan tambahan terhadap source existing.

```text
src/
  capability/
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

  execution/
    types.ts
    executor.ts
    command-policy.ts
    environment.ts
    context.ts

    isolation/
      interface.ts
      windows.ts
      linux.ts
      unsupported.ts

    index.ts

  core/
    jsonl.ts
    lock.ts
    errors.ts

  messaging/
    schema.ts
    service.ts
    inbox-state.ts
    delivery.ts
    cursor.ts

  tools/
    command-tools.ts
    file-tools.ts
    sandbox.ts
    messaging-tools.ts

  cli/
    commands/
      capability.ts
```

File existing lain tetap dipertahankan.

## 4.2 Dependency Direction

Aturan dependency:

```text
bot/agent-loop
       |
       v
execution/executor
       |
       +------> capability/service
       |
       +------> execution/isolation
       |
       +------> core/audit
```

`capability` tidak boleh bergantung pada `bot/agent-loop`.

`execution` tidak boleh bergantung pada AI provider.

`tools` menjadi adapter yang menghubungkan AI tool calling dengan execution subsystem.

Dengan demikian, policy engine dapat diuji tanpa memerlukan Gemini atau agent loop.

---

# 5. Detailed Implementation Mapping

# 5.1 ACG Schema and Registry

**Priority:** P0  
**Phase:** 2

## Existing files

Belum ada capability subsystem pada source v0.3.1.

## New files

### `src/capability/schema.ts`

Mendefinisikan:

- `CapabilityDefinitionSchema`
- `CapabilityScopeSchema`
- `CapabilityGrantSchema`
- `CapabilityRequestSchema`
- `CapabilityDecisionSchema`
- `CapabilityAuditEventSchema`

TypeScript types:

```ts
export type ApprovalMode =
  | 'per_action'
  | 'session'
  | 'persistent';

export type GrantStatus =
  | 'active'
  | 'revoked'
  | 'expired';

export interface CapabilityGrant {
  grant_id: string;
  capability: string;
  scope: CapabilityScope;

  granted_by: string;
  granted_at: string;
  expires_at?: string;

  session_id: string;
  bot_id?: string;

  approval_mode: ApprovalMode;
  status: GrantStatus;

  reason?: string;
  revoked_at?: string;
  revoked_by?: string;
}
```

Schema harus memvalidasi:

- ID.
- Timestamp.
- Capability identifier.
- Scope.
- Approval mode.
- Grant status.
- Expiry.
- Session dan bot binding.

Jangan menerima `scope: {}` sebagai unrestricted access.

### `src/capability/registry.ts`

Proposed class:

`CapabilityRegistry`

Responsibilities:

- Mendaftarkan capability.
- Mengambil definisi capability.
- Memvalidasi capability identifier.
- Memastikan capability tidak didaftarkan dua kali.
- Menyediakan capability metadata.

Initial registry:

```text
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

### `src/capability/service.ts`

Proposed class:

`CapabilityService`

Methods:

```ts
grantCapability(...)
revokeCapability(...)
getGrant(...)
listGrants(...)
listGrantsBySession(...)
listGrantsByBot(...)
expireGrants(...)
resetSessionGrants(...)
```

Ketentuan:

- Grant baru harus menghasilkan ID baru.
- Revoke harus mencatat aktor dan waktu.
- Grant yang telah dicabut tidak boleh diaktifkan kembali.
- Expired grant tidak boleh dipakai.
- Scope tidak boleh berubah tanpa audit event.

## Persistence integration

New interface:

`ICapabilityStorage`

Lokasi yang disarankan:

`src/capability/persistence.ts`

Methods:

```ts
interface ICapabilityStorage {
  listCapabilityGrants(
    sessionId: string
  ): Promise<CapabilityGrant[]>;

  saveCapabilityGrant(
    grant: CapabilityGrant
  ): Promise<void>;

  getCapabilityGrant(
    grantId: string
  ): Promise<CapabilityGrant | null>;

  revokeCapabilityGrant(
    grantId: string,
    actor: string
  ): Promise<void>;
}
```

Implementasi filesystem dapat ditempatkan pada:

`src/blackboard/filesystem.ts`

atau adapter terpisah:

`src/blackboard/capability-storage.ts`

**Rekomendasi:** gunakan adapter terpisah agar `filesystem.ts` tidak berkembang menjadi satu class persistence yang terlalu besar.

Storage target:

```text
sessions/
  S001/
    capabilities/
      grants.jsonl
      audit.jsonl
```

Penyimpanan harus mendukung atomicity dan concurrent access.

## Tests

New:

- `tests/capability/schema.test.ts`
- `tests/capability/registry.test.ts`
- `tests/capability/service.test.ts`
- `tests/blackboard/capability-storage.test.ts`

Test minimal:

1. Valid capability diterima.
2. Unknown capability ditolak.
3. Empty scope ditolak untuk capability scoped.
4. Grant berhasil disimpan.
5. Grant hanya berlaku pada session yang sesuai.
6. Grant bot-specific tidak berlaku untuk bot lain.
7. Expired grant tidak aktif.
8. Revoked grant tidak aktif.
9. Revoke menghasilkan audit event.

---

# 5.2 Policy Engine and Evaluator

**Priority:** P0  
**Phase:** 2

## New files

### `src/capability/policy-engine.ts`

Proposed class:

`CapabilityPolicyEngine`

Responsibilities:

- Menentukan policy precedence.
- Menggabungkan hard-deny rules.
- Mengevaluasi capability request.
- Menolak kondisi ambigu.
- Menghasilkan structured policy decision.

### `src/capability/evaluator.ts`

Proposed class:

`CapabilityEvaluator`

Method:

```ts
evaluate(
  request: CapabilityRequest
): Promise<PolicyEvaluation>;
```

Evaluation flow:

```text
REQUEST
   |
   v
Validate Request
   |
   v
Hard-Deny Evaluation
   |
   v
Explicit Deny Evaluation
   |
   v
Find Active Grant
   |
   v
Validate Scope
   |
   v
Validate Session/Bot
   |
   v
Validate Expiration
   |
   v
Approval Evaluation
   |
   v
ALLOW / DENY / REQUIRE_APPROVAL
```

Important:

Policy engine harus membedakan:

- Capability not granted.
- Grant expired.
- Scope mismatch.
- Approval required.
- Unsupported isolation.
- Explicit denial.

Jangan mengembalikan `ALLOW` hanya karena capability identifier ditemukan dalam registry.

## Existing integration

`src/bot/execution-mode.ts`

Existing class:

`ExecutionModeController`

Tetap bertanggung jawab terhadap execution mode dan review interaction.

Jangan menempatkan capability policy di dalam class ini.

## Tests

New:

- `tests/capability/policy-engine.test.ts`
- `tests/capability/evaluator.test.ts`

Required scenarios:

| Test | Expected |
|---|---|
| No grant | DENY |
| Active grant, correct scope | ALLOW |
| Active grant, wrong scope | DENY |
| Expired grant | DENY |
| Revoked grant | DENY |
| Wrong session | DENY |
| Wrong bot | DENY |
| Hard deny | DENY |
| Approval required | REQUIRE_APPROVAL |
| Policy evaluation failure | DENY |

---

# 5.3 Presets

**Priority:** P1  
**Phase:** 2

New file:

`src/capability/presets.ts`

Proposed class:

`CapabilityPresetService`

Presets:

- `restricted`
- `controlled`
- `extended`
- `unrestricted`

Preset application harus menghasilkan daftar perubahan yang dapat ditinjau.

Jangan langsung mengubah semua grant tanpa preview dan persetujuan.

Test:

`tests/capability/presets.test.ts`

Required:

- Restricted tidak memberikan external grants.
- Controlled hanya memberikan scope yang ditentukan.
- Preset tidak mengaktifkan grant yang telah dicabut.
- Preset tidak mengubah persistent grants secara diam-diam.
- Unrestricted tetap tunduk pada hard-deny dan isolation policy.

---

# 5.4 Approval Workflow

**Priority:** P0  
**Phase:** 2

## Existing file

`src/bot/execution-mode.ts`

Existing:

- `ExecutionMode`
- `ToolExecutionRequest`
- `ExecutionApprovalDecision`
- `InteractivePromptHandler`
- `ExecutionModeController`

Existing modes:

- `REQUEST_REVIEW`
- `TURBO`

## Modification

Pertahankan `ExecutionModeController`.

Tambahkan interface baru pada:

`src/capability/approval.ts`

Proposed:

```ts
export interface CapabilityApprovalRequest {
  request_id: string;
  session_id: string;
  bot_id: string;

  capability: string;
  resource?: string;
  operation?: string;

  requested_duration: ApprovalMode;
  reason?: string;
}

export interface ICapabilityApprovalHandler {
  requestApproval(
    request: CapabilityApprovalRequest
  ): Promise<boolean>;
}
```

Proposed class:

`CapabilityApprovalService`

Responsibilities:

- Membuat approval request.
- Menampilkan detail resource.
- Menerima approve/deny.
- Menghasilkan grant setelah approval.
- Mencatat keputusan.
- Mencegah approval lama digunakan kembali.

## Integration rule

Execution mode tidak boleh membuat grant.

Capability approval yang menghasilkan grant harus melalui `CapabilityService`.

TURBO hanya menghilangkan review prompt yang memang dapat dilewati menurut mode dan policy yang berlaku.

TURBO tidak boleh mengubah DENY menjadi ALLOW.

## Tests

New:

- `tests/capability/approval.test.ts`

Extend:

- `tests/bot/execution-mode.test.ts`

Mandatory regression:

Test existing yang menyatakan TURBO melewati review harus tetap berjalan, tetapi harus ditambah test yang membuktikan TURBO tidak melewati ACG.

---

# 5.5 Execution Controller

**Priority:** P0  
**Phase:** 3

## New files

### `src/execution/types.ts`

Define:

- `ExecutionRequest`
- `ExecutionResult`
- `ExecutionContext`
- `ExecutionPolicyResult`
- `ExecutionIdentity`

### `src/execution/context.ts`

Proposed class:

`ExecutionContextFactory`

Membentuk konteks eksekusi yang terikat pada:

- Session ID.
- Bot ID.
- Execution ID.
- Granted capabilities.
- Resource scope.
- Environment policy.
- Working directory.
- Timeout.
- Output limits.

### `src/execution/executor.ts`

Proposed class:

`ExecutionController`

Method:

```ts
execute(
  request: ExecutionRequest
): Promise<ExecutionResult>;
```

Flow:

```text
Tool Request
    |
    v
Validate Input
    |
    v
Create Execution Context
    |
    v
Capability Evaluation
    |
    +---- DENY ----------> Return Denial
    |
    +---- APPROVAL ------> Approval Workflow
    |
    v
Isolation Backend Check
    |
    v
Execute Operation
    |
    v
Redact Output
    |
    v
Write Audit Event
    |
    v
Return Result
```

Execution Controller menjadi satu-satunya jalur untuk menjalankan operasi sistem sensitif.

## Tests

New:

- `tests/execution/executor.test.ts`
- `tests/execution/context.test.ts`

Test:

1. Execution tanpa grant ditolak.
2. Execution dengan grant valid diterima.
3. Wrong session ditolak.
4. Scope mismatch ditolak.
5. Isolation backend tidak tersedia menghasilkan DENY.
6. Execution failure dicatat.
7. Output redaction berjalan.
8. Revocation mencegah operasi berikutnya.
9. Execution ID unik.

---

# 5.6 OS Isolation Backend

**Priority:** P0  
**Phase:** 3

## New files

```text
src/execution/isolation/
  interface.ts
  windows.ts
  linux.ts
  unsupported.ts
```

### `interface.ts`

Proposed:

```ts
export interface IsolationBackend {
  initialize(): Promise<void>;

  execute(
    request: ExecutionRequest
  ): Promise<ExecutionResult>;

  terminate(
    executionId: string
  ): Promise<void>;

  dispose(): Promise<void>;

  getCapabilities(): Promise<string[]>;
}
```

### `windows.ts`

Proposed class:

`WindowsIsolationBackend`

Tahapan implementasi:

1. Process lifecycle management.
2. Timeout dan process-tree termination.
3. Restricted execution identity.
4. Filesystem boundary.
5. Network restriction.
6. Executable policy.
7. Integration dengan OS sandbox yang tersedia.

Penting:

Windows Job Objects berguna untuk mengelola process tree dan resource limits, tetapi tidak cukup untuk mengisolasi filesystem atau jaringan.

Restricted token juga bukan sandbox lengkap.

Jika backend belum dapat memberikan jaminan yang diperlukan, capability terkait harus tetap DENY.

### `linux.ts`

Proposed class:

`LinuxIsolationBackend`

Tahapan:

- Namespace.
- Seccomp.
- cgroups.
- Mount restrictions.
- Dedicated user.
- Network namespace.

### `unsupported.ts`

Proposed class:

`UnsupportedIsolationBackend`

Mengembalikan status unsupported dan menolak operasi yang membutuhkan isolasi.

## Tests

New:

- `tests/execution/isolation/interface.test.ts`
- `tests/execution/isolation/windows.test.ts`
- `tests/execution/isolation/linux.test.ts`
- `tests/execution/isolation/unsupported.test.ts`

OS tests harus dipisahkan dari unit tests.

Mock test tidak boleh dianggap sebagai bukti keberhasilan OS isolation.

---

# 5.7 Command Tool Integration

**Priority:** P0  
**Phase:** 3

## Existing file

`src/tools/command-tools.ts`

Existing:

- `RunCommandArgs`
- `RunCommandResult`
- `executeRunCommand`
- `RUN_COMMAND_TOOL`

## Modification

Pertahankan public tool schema agar kompatibilitas AI provider tidak rusak.

Tambahkan internal dependency:

```ts
interface RunCommandDependencies {
  executionController: ExecutionController;
}
```

Ubah implementasi `executeRunCommand` menjadi adapter yang membentuk `ExecutionRequest` dan meneruskannya ke controller.

Jangan mempertahankan direct `spawn()` sebagai jalur alternatif.

Command tool harus mendukung dua mode:

1. Structured executable + arguments.
2. Shell command yang secara eksplisit diizinkan melalui policy dan isolation backend.

Jika shell mode belum aman, batasi atau nonaktifkan untuk capability yang membutuhkan isolasi yang belum tersedia.

## Existing tests

Pertahankan:

`tests/tools/command-tools.test.ts`

`tests/tools/env-sanitization.test.ts`

## New tests

`tests/execution/command-policy.test.ts`

Tambahkan skenario:

- Shell command tanpa grant.
- Executable tanpa allowlist.
- Argument injection.
- Child process escape.
- Working directory escape.
- Timeout.
- Process-tree termination.
- Environment leakage.
- Command log secret redaction.

---

# 5.8 Environment Security

**Priority:** P0  
**Phase:** 1 dan 3

## Existing file

`src/tools/sandbox.ts`

Existing:

- `SAFE_ENV_ALLOWLIST`
- `sanitizeChildEnv`
- `redactSensitiveOutput`

## Modification

Jangan hanya menambah atau mengurangi daftar environment variable.

Pisahkan:

- Base runtime environment.
- Approved environment variables.
- Secret injection.
- Host environment access.
- Execution-specific environment.

New file:

`src/execution/environment.ts`

Proposed class:

`ExecutionEnvironmentBuilder`

Methods:

```ts
buildBaseEnvironment(...)
addApprovedVariables(...)
injectApprovedSecrets(...)
redactOutput(...)
```

`PATH`, `COMSPEC`, `PYTHONPATH`, `PYTHONHOME`, `HOME`, `APPDATA`, dan variabel sejenis harus dievaluasi berdasarkan risiko dan backend.

Jangan menganggap semua variabel dalam allowlist otomatis aman.

Credential tidak boleh dimasukkan ke command argument jika mekanisme yang lebih aman tersedia.

## Tests

Extend:

`tests/tools/env-sanitization.test.ts`

Add:

`tests/execution/environment.test.ts`

Test secret leakage ke:

- stdout.
- stderr.
- command log.
- work log.
- broadcast event.
- error message.

---

# 5.9 Filesystem Capability Integration

**Priority:** P0  
**Phase:** 3

## Existing files

- `src/tools/file-tools.ts`
- `src/tools/sandbox.ts`

Existing functions:

- `executeReadFile`
- `executeWriteFile`
- `executeEditFile`
- `executeListDir`
- `executeSearchFiles`
- `executeFileTool`
- `validateSandboxedPath`
- `getCanonicalPath`
- `isPathInsideRoot`

## Modification

Jangan menghapus sandbox project-root existing.

Buat dua kelas akses:

1. Project-root access.
2. External scoped access.

Project-root access tetap mengikuti aturan existing.

External access membutuhkan capability:

| Operation | Required capability |
|---|---|
| Read | `filesystem.read_external` |
| Write | `filesystem.write_external` |
| Delete | `filesystem.delete_external` |
| Config directory | `system.config_access` + operation-specific permission |

Akses konfigurasi pengguna tidak boleh otomatis berarti akses baca-tulis ke seluruh direktori home.

## Proposed new component

`src/execution/filesystem-policy.ts`

Class:

`FilesystemPolicyAdapter`

Responsibilities:

- Canonical path validation.
- Grant scope validation.
- Operation validation.
- Symlink/junction handling.
- Handle-based operation where supported.
- Audit event generation.

## Important technical requirement

`realpath` dan pemeriksaan path saja tidak sepenuhnya menghilangkan TOCTOU.

Untuk implementasi yang lebih kuat, operasi file harus menggunakan OS-level handle atau mekanisme lain yang menghindari pergantian target antara pemeriksaan dan akses.

Hardlink perlu dipertimbangkan secara khusus karena `realpath` tidak menyelesaikan seluruh persoalan identitas objek file.

## Existing tests

Extend:

- `tests/tools/sandbox.test.ts`
- `tests/tools/symlink-defense.test.ts`
- `tests/tools/file-tools.test.ts`

New:

- `tests/capability/filesystem-policy.test.ts`
- `tests/execution/filesystem-enforcement.test.ts`

Mandatory security tests:

- External read tanpa grant.
- External write tanpa grant.
- External delete tanpa grant.
- Correct scope.
- Wrong scope.
- Symlink escape.
- Junction escape.
- Hardlink behavior.
- Path traversal.
- Concurrent path replacement.

---

# 5.10 Agent Loop Integration

**Priority:** P0  
**Phase:** 3

## Existing file

`src/bot/agent-loop.ts`

Existing class:

`AutonomousAgentLoop`

Existing options:

`AgentLoopOptions`

## Modification

Tambahkan dependency injection:

```ts
interface AgentLoopOptions {
  // Existing properties remain.

  executionController?: ExecutionController;
  capabilityService?: CapabilityService;
}
```

Default production configuration harus membuat controller yang benar-benar terhubung ke ACG.

Jangan membuat fallback yang menjalankan direct shell execution jika controller tidak tersedia.

Tool dispatch harus mengklasifikasikan tool berdasarkan capability requirement.

Contoh:

```text
read_file
  -> project filesystem read

write_file
  -> project filesystem write

edit_file
  -> project filesystem write

run_command
  -> process execution / command policy

send_message
  -> messaging.send
```

Klasifikasi tersebut harus berasal dari tool metadata atau registry, bukan hanya nama tool yang dikirim oleh model.

## Tests

Extend:

`tests/bot/agent-loop.test.ts`

Mandatory:

1. Agent tidak dapat membaca file eksternal tanpa grant.
2. Agent tidak dapat menulis file eksternal tanpa grant.
3. Agent tidak dapat menjalankan arbitrary command tanpa grant.
4. TURBO tidak mengubah DENY menjadi ALLOW.
5. Prompt injection tidak dapat memberikan grant.
6. Tool request yang tidak dikenal ditolak.
7. Audit event dibuat untuk operasi sensitif.

---

# 5.11 Capability CLI

**Priority:** P1  
**Phase:** 2

## Existing files

- `src/cli/index.ts`
- `src/cli/commands/session.ts`
- `src/cli/commands/bot.ts`
- `src/cli/commands/messaging.ts`
- `src/cli/commands/context.ts`

Existing function:

`createProgram()`

## New file

`src/cli/commands/capability.ts`

Function:

`registerCapabilityCommands(program)`

Commands:

```bash
almudaya capability list
almudaya capability inspect <capability-or-grant-id>

almudaya capability grant <capability>
almudaya capability revoke <grant-id>

almudaya capability history
almudaya capability reset --session S001

almudaya capability preset list
almudaya capability preset show controlled
almudaya capability preset apply controlled --session S001
```

Grant command harus menyediakan:

- `--scope`
- `--session`
- `--bot`
- `--expires-in`
- `--approval`
- `--reason`

Command harus menampilkan preview dan meminta approval sesuai kebijakan.

## Modification

Tambahkan registration pada:

`src/cli/index.ts`

Jangan membuat storage initialization yang berbeda dari pola existing CLI.

Gunakan workspace resolver dan filesystem storage existing.

## Tests

New:

`tests/cli/capability-cli.test.ts`

Test:

- List.
- Inspect.
- Grant.
- Revoke.
- History.
- Reset.
- Preset preview.
- Invalid capability.
- Invalid scope.
- Missing session.
- Approval denial.

---

# 5.12 Capability Audit Trail

**Priority:** P0  
**Phase:** 2 dan 3

## Existing files

- `src/shared/work-log.ts`
- `src/blackboard/filesystem.ts`
- `src/blackboard/interface.ts`

Existing:

`WorkLogService`

Work log saat ini mencatat aktivitas kerja bot seperti WRITE, EDIT, READ, COMMAND, dan DECISION.

## Design decision

Jangan mencampurkan security audit event ke work log biasa.

Work log adalah catatan aktivitas kerja.

Capability audit adalah catatan otoritas dan keputusan keamanan.

Gunakan storage terpisah:

```text
sessions/
  S001/
    capabilities/
      grants.jsonl
      audit.jsonl
```

## New file

`src/capability/audit.ts`

Class:

`CapabilityAuditService`

Methods:

```ts
recordEvent(...)
readEvents(...)
```

Audit events:

- CAPABILITY_REQUESTED
- CAPABILITY_APPROVED
- CAPABILITY_DENIED
- CAPABILITY_GRANTED
- CAPABILITY_REVOKED
- CAPABILITY_EXPIRED
- POLICY_EVALUATED
- EXECUTION_STARTED
- EXECUTION_COMPLETED
- EXECUTION_FAILED
- EXECUTION_TERMINATED
- ISOLATION_FAILURE

Audit event harus mencatat actor, session, bot, capability, resource, decision, grant ID, dan execution ID jika relevan.

Secret mentah tidak boleh disimpan.

## Tests

New:

- `tests/capability/audit.test.ts`
- `tests/blackboard/audit-storage.test.ts`

Test:

- Event append.
- Event read.
- Concurrent append.
- Secret redaction.
- Corrupt record handling.
- Access restrictions.

---

# 5.13 Distributed Locking

**Priority:** P0  
**Phase:** 1

## Existing file

`src/core/lock.ts`

Existing:

- `LockOptions`
- `LockRecord`
- `isProcessRunning`
- `acquireLock`
- `withLock`

## Existing weakness

Lock record saat ini memiliki:

- PID.
- locked_at.
- holder.

Release memeriksa PID, tetapi tidak memiliki unique ownership token atau fencing token.

Recovery stale lock masih memiliki race antara pemeriksaan dan unlink.

## Modification

Tambahkan:

- Lock ID.
- Owner token.
- Fencing token.
- Lease expiration.
- Ownership verification.

Proposed interface:

```ts
interface LockRecord {
  lock_id: string;
  owner_id: string;
  owner_token: string;

  pid: number;
  holder: string;

  fencing_token: number;

  locked_at: string;
  expires_at: string;
}
```

Pertimbangkan bahwa file lock berbasis filesystem saja tidak dapat menyediakan fencing guarantee untuk seluruh external side effects.

Jika operasi membutuhkan fencing, resource yang dilindungi harus memvalidasi fencing token.

Untuk shared filesystem dan multi-process concurrency, implementasikan primitive acquisition yang benar-benar atomik.

Jangan mengklaim distributed lock correctness hanya berdasarkan PID dan timestamp.

## Existing tests

Extend:

`tests/core/lock.test.ts`

New:

`tests/core/lock-concurrency.test.ts`

Mandatory:

- Concurrent acquisition.
- Ownership mismatch.
- Old owner release.
- Stale lock race.
- Corrupt lock.
- Fencing token monotonicity.
- Expired lease.
- Process restart.

---

# 5.14 Messaging Inbox State Machine

**Priority:** P0  
**Phase:** 4

## Existing files

- `src/messaging/schema.ts`
- `src/messaging/service.ts`
- `src/bot/runtime.ts`
- `src/blackboard/interface.ts`
- `src/blackboard/filesystem.ts`

Existing class:

`MessagingService`

Existing methods include:

- `sendDirectMessage`
- `readInbox`
- `markMessagesAsRead`
- `acknowledgeMessage`

Existing `BotRuntime.pollCycle()` membaca pesan unread, menjalankan callback, lalu menandai pesan read.

## Modification

Tambahkan explicit processing state:

```text
RECEIVED
   |
   v
PROCESSING
   |
   +------> COMPLETED
   |
   +------> RETRY_PENDING
   |
   +------> DEAD_LETTER
```

Schema additions:

- `processing_state`
- `attempt_count`
- `lease_owner`
- `lease_expires_at`
- `last_attempt_at`
- `last_error`
- `idempotency_key`

## New files

- `src/messaging/inbox-state.ts`
- `src/messaging/delivery.ts`

Proposed class:

`InboxDeliveryService`

Responsibilities:

- Claim message.
- Set processing lease.
- Track attempt.
- Complete message.
- Schedule retry.
- Move exhausted message to dead letter.
- Apply idempotency checks.

## Migration

Existing statuses:

- unread
- read
- acknowledged

Tidak boleh langsung dihapus.

Tambahkan schema migration yang mempertahankan interpretasi data lama.

Contoh:

- unread -> RECEIVED.
- read -> legacy processed/read state.
- acknowledged -> COMPLETED.

Migration harus mengikuti semantik existing dan tidak menganggap semua legacy `read` sebagai successful business processing tanpa bukti.

## Existing tests

Extend:

`tests/messaging/transactional-inbox.test.ts`

`tests/bot/runtime.test.ts`

New:

- `tests/messaging/inbox-state.test.ts`
- `tests/messaging/inbox-delivery.test.ts`
- `tests/messaging/inbox-concurrency.test.ts`

Mandatory:

- Crash before processing.
- Crash during processing.
- Crash after side effect before acknowledgment.
- Duplicate delivery.
- Expired lease recovery.
- Idempotent retry.
- Dead-letter transition.
- Concurrent polling.

---

# 5.15 Polling Reentrancy

**Priority:** P0  
**Phase:** 4

## Existing file

`src/bot/runtime.ts`

Existing:

`BotRuntime`

`pollCycle()`

Polling menggunakan:

`setInterval(async () => pollCycle(), pollIntervalMs)`

## Modification

Tambahkan single-flight guard.

Contoh konseptual:

```ts
private pollInFlight = false;

public async pollCycle(): Promise<void> {
  if (!this.isRunning || this.pollInFlight) {
    return;
  }

  this.pollInFlight = true;

  try {
    await this.performPollCycle();
  } finally {
    this.pollInFlight = false;
  }
}
```

Namun, boolean hanya melindungi satu instance runtime.

Untuk beberapa process, gunakan inbox lease dan storage-level claim.

## Tests

Extend:

`tests/bot/runtime.test.ts`

Test:

- Overlapping pollCycle calls.
- Concurrent process polling.
- Poll error recovery.
- Stop while polling.
- Message is not processed concurrently twice.

---

# 5.16 Broadcast Cursor

**Priority:** P0  
**Phase:** 4

## Existing files

- `src/messaging/schema.ts`
- `src/messaging/service.ts`
- `src/blackboard/interface.ts`
- `src/blackboard/filesystem.ts`

Existing:

- `BroadcastEvent`
- `BroadcastCursor`
- `readBroadcasts`
- `getBroadcastCursor`
- `saveBroadcastCursor`

## Modification

Perjelas semantik cursor:

- Last scanned sequence.
- Last successfully consumed sequence.
- Filtered event visibility.
- Consumer identity.

Cursor tidak boleh maju melewati event yang belum dikonsumsi.

Filtering dan limit harus diterapkan dengan semantics yang tidak kehilangan event.

Pertimbangkan cursor per consumer jika satu bot memiliki lebih dari satu consumer stream.

## Existing tests

Extend:

`tests/messaging/broadcast-cursor-atomic.test.ts`

`tests/messaging/broadcast.test.ts`

New:

`tests/messaging/broadcast-cursor-concurrency.test.ts`

Mandatory:

- Filtered event.
- Limit.
- Concurrent readers.
- Cursor save race.
- Consumer restart.
- Event append during read.
- Failed event processing.

---

# 5.17 JSONL Resilience

**Priority:** P1  
**Phase:** 4

## Existing files

- `src/blackboard/filesystem.ts`
- `src/core/fs-utils.ts`
- `src/core/errors.ts`
- `src/shared/work-log.ts`

Existing behavior pada work log memiliki `CorruptedDataError` ketika menemukan JSONL invalid.

## New file

`src/core/jsonl.ts`

Proposed:

`JsonlReader`

Responsibilities:

- Parse per line.
- Validate per record.
- Return valid records.
- Report malformed records.
- Preserve raw evidence.
- Support quarantine.

Jangan mengubah corrupt record menjadi data valid secara diam-diam.

Tentukan strategi per store:

- Critical state: fail closed atau recover melalui backup.
- Append-only audit: preserve raw record dan laporkan.
- Non-critical work log: dapat membaca record valid sambil melaporkan record rusak.

## Tests

New:

`tests/core/jsonl.test.ts`

Extend:

- `tests/shared/work-log.test.ts`
- `tests/blackboard/persistence.test.ts`

---

# 5.18 Native Messaging Tool

**Priority:** P1  
**Phase:** 4

## Existing files

- `src/messaging/service.ts`
- `src/messaging/schema.ts`
- `src/bot/agent-loop.ts`
- `src/tools/index.ts`

Existing `MessagingService.sendDirectMessage()` sudah menyediakan fondasi.

## New file

`src/tools/messaging-tools.ts`

Define:

- `SEND_MESSAGE_TOOL`
- `executeSendMessage`

Tool schema:

```text
send_message
  recipient
  message_type
  content
```

Agent identity harus berasal dari execution context.

Jangan mempercayai sender bot ID yang diberikan langsung oleh model.

## Integration

Tambahkan native messaging tool ke daftar `availableTools` dalam `AutonomousAgentLoop`.

Gunakan `MessagingService` yang sudah ada.

Jangan memanggil CLI melalui `run_command` untuk mengirim pesan.

## Tests

New:

`tests/tools/messaging-tools.test.ts`

Extend:

- `tests/messaging/direct-message.test.ts`
- `tests/bot/agent-loop.test.ts`

---

# 5.19 Gemini Retry

**Priority:** P1  
**Phase:** 5

## Existing file

`src/ai/gemini.ts`

Existing:

- `GeminiProvider`
- `GeminiProviderError`
- `parseRetryDelay`
- `RateLimitPauseError`

Existing tests:

`tests/ai/gemini-retry.test.ts`

## Modification

Perbaiki:

- RetryInfo handling.
- Exponential backoff.
- Jitter.
- Maximum retry count.
- Total deadline.
- Cancellation.
- Error classification.

Retry delay dari server harus dihormati.

Jika server menyatakan retry setelah 39 detik, client tidak boleh terus mencoba ulang setelah delay beberapa detik.

Tambahkan cancellation mechanism agar shutdown tidak menunggu retry yang tidak diperlukan.

## Tests

Extend:

`tests/ai/gemini-retry.test.ts`

Mandatory:

- RetryInfo 39 seconds.
- 429.
- 503.
- Network timeout.
- Permanent authentication failure.
- Cancellation.
- Retry deadline.
- Retry exhaustion.
- Correct user-facing error.

---

# 5.20 Prompt Injection and Sender Trust

**Priority:** P0  
**Phase:** 3 dan 4

## Existing files

- `src/ai/prompts.ts`
- `src/bot/agent-loop.ts`
- `src/messaging/schema.ts`
- `src/messaging/service.ts`
- `src/bot/service.ts`

Existing agent loop memasukkan pesan peer ke conversation sebagai user content.

Recent work log juga dimasukkan ke dynamic system prompt.

## Modification

Pisahkan trusted system instruction dari untrusted data.

Data berikut harus diperlakukan sebagai untrusted:

- Peer message.
- Work log.
- File content.
- Tool output.
- Bot description.
- External document.
- Broadcast event.

Tambahkan sender verification berdasarkan bot registry.

Namun, autentikasi sender tidak boleh hanya mengandalkan string `sender_bot_id` yang dapat dipalsukan oleh caller.

Identitas harus berasal dari trusted runtime context.

## Security rule

Pesan peer tidak boleh memberikan capability grant.

Pesan peer tidak boleh mengubah policy.

Tool execution harus tetap dievaluasi ACG.

## Tests

New:

`tests/security/prompt-injection.test.ts`

`tests/messaging/sender-authentication.test.ts`

Extend:

`tests/bot/agent-loop.test.ts`

---

# 5.21 REPL and CLI Lifecycle

**Priority:** P1  
**Phase:** 5

## Existing files

- `src/bot/console.ts`
- `src/bot/runtime.ts`
- `src/cli/commands/bot.ts`
- `src/cli/commands/messaging.ts`

## Modification

Periksa:

- Async line handling.
- Event ordering.
- Poll reentrancy.
- PID lifecycle.
- Stop/start lifecycle.
- Session existence validation.
- Bot identity.
- CLI enum validation.
- Numeric argument validation.

`--no-mark-read` sudah ditemukan pada CLI messaging source dan harus dipertahankan.

Test terkait:

- `tests/cli/message-read-flag.test.ts`
- `tests/bot/console.test.ts`
- `tests/bot/runtime.test.ts`
- `tests/bot/liveness.test.ts`
- `tests/cli.test.ts`

Jangan menghapus atau mengganti test tersebut hanya karena implementasi internal berubah.

---

# 6. Requirement-to-Source Traceability Matrix

Tabel ini merupakan peta utama implementasi.

| Requirement | Existing source | Proposed modification | Test |
|---|---|---|---|
| Capability registry | None | `capability/registry.ts` | registry.test |
| Grant lifecycle | None | `capability/service.ts` | service.test |
| Grant schema | None | `capability/schema.ts` | schema.test |
| Policy engine | None | `capability/policy-engine.ts` | policy-engine.test |
| Policy evaluator | None | `capability/evaluator.ts` | evaluator.test |
| Approval workflow | `bot/execution-mode.ts` | `capability/approval.ts` | approval.test |
| Presets | None | `capability/presets.ts` | presets.test |
| Capability persistence | `blackboard/interface.ts`, `filesystem.ts` | capability storage adapter | capability-storage.test |
| Audit trail | `shared/work-log.ts` | `capability/audit.ts` | audit.test |
| Execution controller | `bot/agent-loop.ts`, `tools/command-tools.ts` | `execution/executor.ts` | executor.test |
| OS isolation | `tools/command-tools.ts` | `execution/isolation/*` | OS integration tests |
| Environment policy | `tools/sandbox.ts` | `execution/environment.ts` | environment.test |
| Command execution | `tools/command-tools.ts` | adapter to controller | command-tools.test |
| Filesystem grants | `tools/file-tools.ts`, `sandbox.ts` | filesystem policy adapter | filesystem-enforcement.test |
| TURBO separation | `bot/execution-mode.ts` | policy integration | execution-mode.test |
| Agent loop | `bot/agent-loop.ts` | controller and tool registry injection | agent-loop.test |
| CLI capability | `cli/index.ts` | `cli/commands/capability.ts` | capability-cli.test |
| Lock fencing | `core/lock.ts` | ownership token and fencing | lock-concurrency.test |
| Inbox lifecycle | `messaging/service.ts`, `schema.ts` | inbox state machine | inbox-delivery.test |
| Polling mutex | `bot/runtime.ts` | single-flight and leases | runtime.test |
| Broadcast cursor | `messaging/service.ts`, `schema.ts` | cursor semantics | broadcast-cursor tests |
| JSONL resilience | `blackboard/filesystem.ts` | `core/jsonl.ts` | jsonl.test |
| Native messaging | `messaging/service.ts`, `agent-loop.ts` | `tools/messaging-tools.ts` | messaging-tools.test |
| Gemini retry | `ai/gemini.ts` | retry policy | gemini-retry.test |
| Prompt trust boundary | `ai/prompts.ts`, `agent-loop.ts` | untrusted context handling | prompt-injection.test |
| Sender verification | `messaging/service.ts`, `bot/service.ts` | trusted sender context | sender-authentication.test |
| CLI lifecycle | `cli/commands/*`, `bot/console.ts` | validation and lifecycle fixes | existing CLI/runtime tests |

---

# 7. Recommended Implementation Order

Implementasi harus mengikuti dependency order. Jangan membiarkan coding agent mengerjakan seluruh modul secara paralel sebelum kontrak antar-modul disepakati.

## Phase 0 – Baseline and Repository Lock

**Goal:** Memastikan baseline v0.3.1 tidak berubah tanpa diketahui.

Tasks:

1. Extract source ke working directory baru.
2. Identifikasi Git commit baseline.
3. Periksa package version.
4. Jalankan `npm ci`.
5. Jalankan `npm run build`.
6. Jalankan `npm test`.
7. Simpan hasil baseline.
8. Buat branch `release/v0.3.2`.
9. Buat tag atau backup source v0.3.1.

Commands:

```bash
npm ci
npm run build
npm test
```

Output:

```text
docs/
  remediation/
    v0.3.2/
      BASELINE_REPORT.md
      BASELINE_TEST_REPORT.md
      IMPLEMENTATION_STATUS.md
```

Gate 0:

- Baseline build diketahui.
- Baseline test diketahui.
- Existing failures dicatat.
- Tidak ada source yang diubah tanpa baseline.

## Phase 1 – Security Foundation

**Priority:** Critical

Tasks:

1. Perbaiki `src/core/lock.ts`.
2. Tambahkan fencing token.
3. Perkuat environment sanitization.
4. Pisahkan environment builder.
5. Perbaiki command log redaction.
6. Tambahkan JSONL foundation.
7. Pastikan error handling tidak membocorkan secret.

Files:

```text
src/core/lock.ts
src/core/jsonl.ts
src/execution/environment.ts
src/tools/sandbox.ts
src/tools/command-tools.ts
```

Tests:

```text
tests/core/lock.test.ts
tests/core/lock-concurrency.test.ts
tests/core/jsonl.test.ts
tests/tools/env-sanitization.test.ts
tests/execution/environment.test.ts
```

Gate 1:

- Lock ownership test pass.
- Environment leakage test pass.
- Secret redaction test pass.
- JSONL behavior terdokumentasi.

## Phase 2 – ACG Core

**Priority:** Critical

Tasks:

1. Implementasi capability schema.
2. Implementasi registry.
3. Implementasi persistence.
4. Implementasi grant service.
5. Implementasi policy engine.
6. Implementasi evaluator.
7. Implementasi approval workflow.
8. Implementasi presets.
9. Implementasi audit service.
10. Implementasi CLI.

Files:

```text
src/capability/
src/blackboard/capability-storage.ts
src/cli/commands/capability.ts
src/cli/index.ts
```

Tests:

```text
tests/capability/
tests/blackboard/capability-storage.test.ts
tests/cli/capability-cli.test.ts
```

Gate 2:

- Grant lifecycle bekerja.
- Default deny bekerja.
- Scope matching bekerja.
- Audit trail bekerja.
- TURBO belum dapat melewati policy.

## Phase 3 – Execution Enforcement

**Priority:** Critical

Tasks:

1. Implementasi Execution Controller.
2. Implementasi Execution Context.
3. Implementasi isolation interface.
4. Implementasi Windows backend.
5. Integrasikan command tool.
6. Integrasikan file tools.
7. Integrasikan agent loop.
8. Implementasikan hard-deny fallback.
9. Jalankan OS-level adversarial tests.

Files:

```text
src/execution/
src/tools/command-tools.ts
src/tools/file-tools.ts
src/tools/sandbox.ts
src/bot/agent-loop.ts
```

Tests:

```text
tests/execution/
tests/tools/command-tools.test.ts
tests/tools/file-tools.test.ts
tests/tools/symlink-defense.test.ts
tests/bot/agent-loop.test.ts
```

Gate 3:

- Tidak ada direct shell path yang melewati controller.
- External filesystem access tanpa grant ditolak.
- OS isolation diuji nyata.
- Isolation failure menghasilkan DENY.
- TURBO tidak memberikan otoritas tambahan.

Jika Windows isolation belum memenuhi security requirement, fitur yang memerlukan isolation tersebut tidak boleh dinyatakan selesai.

## Phase 4 – Messaging and Concurrency

**Priority:** High

Tasks:

1. Inbox state machine.
2. Delivery lease.
3. Idempotency.
4. Retry dan dead-letter.
5. Polling mutex.
6. Broadcast cursor consistency.
7. Native messaging tool.
8. Sender verification.

Files:

```text
src/messaging/
src/bot/runtime.ts
src/tools/messaging-tools.ts
src/bot/agent-loop.ts
```

Tests:

```text
tests/messaging/
tests/bot/runtime.test.ts
tests/tools/messaging-tools.test.ts
tests/security/prompt-injection.test.ts
```

Gate 4:

- Tidak ada double processing tanpa kontrol.
- Crash recovery bekerja.
- Broadcast cursor tidak kehilangan event.
- Agent dapat mengirim native message.
- Sender identity diverifikasi.

## Phase 5 – Provider and Runtime Reliability

**Priority:** Medium

Tasks:

1. Perbaiki Gemini retry.
2. Tambahkan cancellation.
3. Perbaiki error classification.
4. Perbaiki REPL event ordering.
5. Perbaiki PID lifecycle.
6. Perketat CLI input validation.
7. Perbarui dokumentasi.

Files:

```text
src/ai/gemini.ts
src/bot/console.ts
src/bot/runtime.ts
src/cli/commands/*
```

Tests:

```text
tests/ai/gemini-retry.test.ts
tests/bot/console.test.ts
tests/bot/liveness.test.ts
tests/cli.test.ts
```

Gate 5:

- RetryInfo dihormati.
- Cancellation berjalan.
- REPL tidak reentrant.
- Bot lifecycle konsisten.

## Phase 6 – Full Verification and Release

Tasks:

1. Full build.
2. Full unit test.
3. Integration test.
4. E2E test.
5. OS isolation test.
6. Security test.
7. Migration test.
8. Documentation review.
9. Changelog.
10. Release packaging.

Gate 6:

Seluruh critical acceptance criteria harus terpenuhi sebelum release.

---

# 8. Commit Strategy

Gunakan commit kecil yang mudah diaudit.

Urutan yang direkomendasikan:

```text
v0.3.2-001 baseline verification
v0.3.2-002 lock ownership hardening
v0.3.2-003 environment security
v0.3.2-004 JSONL resilience

v0.3.2-005 capability schema and registry
v0.3.2-006 capability persistence
v0.3.2-007 grant lifecycle
v0.3.2-008 policy engine
v0.3.2-009 approval workflow
v0.3.2-010 presets and audit
v0.3.2-011 capability CLI

v0.3.2-012 execution controller
v0.3.2-013 isolation interface
v0.3.2-014 Windows isolation backend
v0.3.2-015 command tool integration
v0.3.2-016 filesystem integration
v0.3.2-017 agent loop integration

v0.3.2-018 inbox state machine
v0.3.2-019 delivery lease and idempotency
v0.3.2-020 broadcast cursor hardening
v0.3.2-021 native messaging tool
v0.3.2-022 sender trust boundary

v0.3.2-023 Gemini retry
v0.3.2-024 runtime and REPL hardening
v0.3.2-025 documentation
v0.3.2-026 release verification
```

Setiap commit harus:

- Memiliki scope yang jelas.
- Menyertakan test.
- Tidak menggabungkan perubahan tidak terkait.
- Dapat di-review secara independen.

---

# 9. Coding Agent Execution Rules

Instruksi berikut wajib diterapkan kepada Antigravity, Codex, OpenCode, atau coding agent lain.

## 9.1 Source-First Rule

Sebelum mengubah file:

1. Baca file existing.
2. Baca interface yang digunakan.
3. Baca test terkait.
4. Identifikasi caller.
5. Identifikasi persistence impact.
6. Identifikasi compatibility impact.

Jangan membuat file baru jika existing module dapat diperluas secara aman.

## 9.2 No Blind Refactoring

Jangan:

- Mengganti seluruh `AutonomousAgentLoop`.
- Mengganti seluruh `MessagingService`.
- Menghapus `ExecutionModeController`.
- Mengganti Blackboard architecture.
- Mengubah seluruh tool schema tanpa alasan.
- Mengganti Zod dengan validator lain.
- Menambah framework baru tanpa kebutuhan yang terukur.

## 9.3 Interface-First Development

Sebelum mengimplementasikan modul yang saling bergantung:

1. Definisikan interface.
2. Review interface.
3. Buat unit test.
4. Implementasikan class.
5. Integrasikan dengan source existing.

## 9.4 No Fake Security

Dilarang mengklaim keamanan hanya berdasarkan:

- Prompt instruction.
- Regex command filter.
- Path string validation.
- Environment allowlist saja.
- Mock OS backend.
- Unit test policy evaluator.
- UI approval tanpa enforcement.

Security claim harus didukung oleh enforcement test yang sesuai.

## 9.5 No Silent Fallback

Jika ACG atau isolation backend gagal:

- Jangan menjalankan unrestricted command.
- Jangan menonaktifkan policy secara otomatis.
- Jangan memberikan implicit grant.
- Jangan melanjutkan operasi sensitif.

Default outcome adalah DENY.

## 9.6 Test Preservation

Existing tests harus dipertahankan kecuali memang ada perubahan requirement yang terdokumentasi.

Jika test diubah:

- Jelaskan mengapa.
- Jelaskan expected behavior baru.
- Tambahkan regression test.
- Jangan mengubah test hanya untuk membuat test suite pass.

## 9.7 Progress Reporting

Setiap phase menghasilkan:

```text
PHASE_REPORT.md
CHANGED_FILES.md
TEST_REPORT.md
SECURITY_NOTES.md
OPEN_ISSUES.md
```

Setiap finding harus memiliki status:

- OPEN
- IN_PROGRESS
- FIXED
- VERIFIED
- DEFERRED
- BLOCKED

`FIXED` tidak sama dengan `VERIFIED`.

---

# 10. Critical Design Decisions

Keputusan berikut tidak boleh diubah oleh coding agent tanpa ADR baru.

## ADR-321 – ACG as Central Capability Authority

ACG merupakan satu-satunya authority untuk pemberian kapabilitas.

Agent prompt tidak dapat memberikan grant.

## ADR-322 – Execution Controller as Mandatory Boundary

Operasi sistem sensitif harus melalui Execution Controller.

Direct execution path yang melewati controller tidak diperbolehkan.

## ADR-323 – TURBO Is Not Privilege Escalation

TURBO mengatur approval behavior, bukan capability authority.

## ADR-324 – Project Root Remains Default Sandbox

External filesystem access merupakan explicit extension dari project-root sandbox, bukan penghapusan sandbox.

## ADR-325 – Fail Closed on Enforcement Failure

Jika enforcement tidak tersedia atau gagal, operasi sensitif ditolak.

## ADR-326 – Separate Security Audit from Work Log

Security audit dan work log memiliki tujuan, schema, serta access policy berbeda.

## ADR-327 – At-Least-Once Delivery with Idempotency

Messaging menggunakan at-least-once delivery dengan idempotency. Jangan mengklaim exactly-once tanpa jaminan transaksi yang sesuai.

## ADR-328 – OS Isolation Is Platform-Specific

Policy engine bersifat portable. Enforcement backend mengikuti kemampuan OS.

---

# 11. Migration and Compatibility

## 11.1 Existing Session Data

Jangan merusak struktur session existing.

Capability storage ditempatkan pada subdirectory baru.

## 11.2 Existing Bot Records

Bot schema existing tidak perlu diubah secara besar-besaran.

Capability grant dapat mengacu pada `bot_id` existing.

## 11.3 Existing Execution Modes

`REQUEST_REVIEW` dan `TURBO` tetap tersedia.

Jangan mengubah nilai enum tanpa alasan compatibility yang kuat.

## 11.4 Existing Tool Definitions

Pertahankan nama tool existing:

- `read_file`
- `write_file`
- `edit_file`
- `list_dir`
- `search_files`
- `run_command`
- `get_work_log`

Tambahkan `send_message`.

## 11.5 Legacy Sessions

Setelah upgrade:

- External capabilities default deny.
- Tidak ada automatic persistent grants.
- TURBO configuration lama tetap dipertahankan sebagai execution mode.
- User harus memberikan grant secara eksplisit.

---

# 12. Definition of Done

v0.3.2 belum boleh dinyatakan selesai jika salah satu syarat kritis berikut belum terpenuhi:

1. ACG berjalan pada runtime.
2. Semua external capability default deny.
3. Execution Controller menjadi jalur wajib.
4. TURBO tidak dapat melewati ACG.
5. Grant dapat dibatasi dan dicabut.
6. Audit trail tersedia.
7. OS isolation diuji nyata.
8. Shell tidak dapat melewati enforcement boundary.
9. Environment leakage telah diuji.
10. Filesystem escape telah diuji.
11. Inbox crash recovery berjalan.
12. Broadcast cursor tidak kehilangan event.
13. Lock ownership race diperbaiki.
14. Native messaging tool tersedia.
15. Gemini retry menghormati server delay.
16. Build dan regression test berhasil.

Jika OS isolation belum selesai, release boleh memiliki status development atau preview, tetapi tidak boleh mengklaim unrestricted execution telah diamankan.

---

# 13. Final Implementation Directive

**Instruksi utama untuk coding agent:**

Implementasikan Almudaya Multi-Agent v0.3.2 dengan menggunakan source v0.3.1 sebagai baseline yang tidak boleh digantikan secara menyeluruh.

Lakukan perubahan secara incremental, mengikuti implementation phases, source mapping, interface contracts, test requirements, dan critical design decisions dalam dokumen ini.

Sebelum memodifikasi suatu modul, lakukan inspeksi terhadap source dan test existing.

Setiap implementasi harus memiliki test yang membuktikan perilakunya.

Setiap security control harus ditegakkan pada execution boundary, bukan hanya pada prompt, konfigurasi, atau UI.

Jangan menganggap pekerjaan selesai hanya karena file baru sudah dibuat atau unit test berbasis mock berhasil.

Laporkan seluruh keterbatasan platform, perubahan yang belum diverifikasi, serta security issue yang masih terbuka.

**Target akhir:**

`Almudaya Multi-Agent v0.3.2 – Security & Concurrency Hardening`

**Implementation status: APPROVED FOR EXECUTION PLANNING**

---

**END OF IMPLEMENTATION BLUEPRINT**

Untuk setiap requirement, catat source path/symbol yang benar-benar ditemukan, perubahan yang diusulkan (PROPOSED), file/test baru, dependency, migration, dan evidence. Jangan menyatakan file usulan sebagai existing.

## Peta modul awal (PROPOSED)
- `src/capability/`: schema, registry, grants, policy engine, evaluator, approval, persistence, audit.
- `src/execution/`: controller, executor, command policy, environment, filesystem policy.
- `src/execution/isolation/`: interface dan adapter OS.
- `src/messaging/`: inbox state/delivery/cursor.
- `src/tools/messaging-tools.ts`: native messaging tools.
- `src/cli/commands/capability.ts`: grant inspection/management.

## Lokasi source yang perlu diverifikasi
`src/tools/command-tools.ts`, `src/tools/sandbox.ts`, `src/bot/agent-loop.ts`, `src/bot/runtime.ts`, `src/bot/console.ts`, `src/core/lock.ts`, `src/messaging/service.ts`, `src/ai/gemini.ts`, `src/blackboard/filesystem.ts`, `src/shared/work-log.ts`, `src/cli/commands/bot.ts`.

Semua path dan simbol diverifikasi terhadap repository dan commit SHA yang dipakai.
