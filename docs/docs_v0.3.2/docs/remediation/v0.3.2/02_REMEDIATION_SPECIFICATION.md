# Remediation Specification — v0.3.2

> # ALMUDAYA MULTI-AGENT
# REMEDIATION SPECIFICATION v0.3.2

**Release Name:** Security & Concurrency Hardening  
**Module:** Agent Capability Governance (ACG)  
**Document Type:** Technical Remediation Specification  
**Baseline Version:** v0.3.1  
**Target Version:** v0.3.2  
**Status:** APPROVED – DESIGN AND IMPLEMENTATION SPECIFICATION  
**Project:** Almudaya Multi-Agent

---

# 1. Executive Summary

Almudaya Multi-Agent v0.3.2 merupakan remediation release yang berfokus pada penguatan keamanan eksekusi, konsistensi komunikasi antar-agent, keandalan pemrosesan pesan, dan pengendalian kapabilitas agent terhadap host operating system.

Release ini memperkenalkan **Agent Capability Governance (ACG)** sebagai mekanisme terpusat untuk mengatur akses agent terhadap sumber daya dan kapabilitas sistem.

ACG dirancang untuk memungkinkan agent melakukan berbagai aktivitas, termasuk:

- Membaca file di luar project root.
- Membuat, mengubah, dan menghapus file di luar project root.
- Mengakses direktori konfigurasi pengguna.
- Menjalankan program eksternal.
- Mengakses jaringan.
- Menjalankan perintah sistem secara lebih luas.
- Menggunakan kapabilitas tambahan yang mungkin diperkenalkan pada versi berikutnya.

Namun, seluruh kapabilitas tersebut harus berada di bawah mekanisme kebijakan dan persetujuan yang eksplisit.

Secara default, kapabilitas eksternal berada dalam keadaan **DENY**.

v0.3.2 juga harus menyelesaikan atau memperbaiki temuan keamanan dan reliabilitas yang berasal dari audit v0.3.0, pengujian v0.3.0, dan audit sumber v0.3.1.

# 2. Design Principles

## 2.1 Default Deny

Tidak ada kapabilitas eksternal yang diberikan secara otomatis kepada agent.

Setiap akses harus memenuhi kebijakan yang berlaku.

## 2.2 Explicit Authorization

Kapabilitas harus diberikan melalui tindakan eksplisit oleh pengguna atau administrator yang berwenang.

## 2.3 Least Privilege

Agent hanya mendapatkan kapabilitas yang diperlukan untuk menyelesaikan tugasnya.

## 2.4 Scoped Authorization

Setiap grant harus memiliki ruang lingkup yang jelas, misalnya:

- Direktori tertentu.
- File atau pola file tertentu.
- Executable tertentu.
- Host atau domain tertentu.
- Session tertentu.
- Bot tertentu.

## 2.5 Revocability

Pengguna dapat mencabut grant kapan saja.

Pencabutan harus berlaku terhadap operasi berikutnya dan, sejauh memungkinkan, membatalkan operasi aktif yang masih dapat dihentikan secara aman.

## 2.6 OS-Level Enforcement

ACG tidak boleh hanya menjadi pemeriksa prompt, validator string, atau parser perintah.

Kebijakan harus ditegakkan pada execution boundary yang benar-benar mengendalikan akses terhadap operating system.

## 2.7 Separation of Authority and Execution Mode

Execution mode dan capability policy merupakan dua hal berbeda.

- Execution mode menentukan bagaimana persetujuan manusia dilakukan.
- Capability policy menentukan tindakan apa yang boleh dilakukan.

Mode TURBO tidak boleh otomatis memberikan kapabilitas baru.

# 3. Scope of Remediation

v0.3.2 mencakup dua kelompok pekerjaan.

## 3.1 New Capability

Implementasi Agent Capability Governance:

1. Capability Registry.
2. Capability Grant Management.
3. Policy Engine.
4. Policy Evaluator.
5. Human Approval Workflow.
6. Execution Enforcement Layer.
7. Capability Audit Trail.
8. Capability CLI.
9. Capability Presets.
10. OS Isolation Abstraction.

## 3.2 Existing Vulnerability Remediation

| ID | Temuan | Prioritas |
|---|---|---|
| SEC-01 | Environment variable leakage | Critical |
| SEC-02 | Prompt injection melalui pesan peer dan work log | High |
| SEC-03 | Arbitrary shell execution tanpa isolasi yang memadai | Critical |
| CONC-01 | Lock TOCTOU dan ownership race | Critical |
| CONC-02 | Broadcast cursor kehilangan event | High |
| RELIA-01 | Inbox acknowledgment dan message processing | High |
| RELIA-02 | JSONL corruption dapat menggagalkan consumer | Medium |
| SEC-04 | Filesystem symlink/junction escape dan TOCTOU | High |
| PERF-01 | Polling dan REPL reentrancy | Medium |
| RELIA-03 | Bot status dan PID lifecycle tidak konsisten | Medium |
| NT-01 | Konsistensi opsi `--no-mark-read` | Medium |
| NT-02 | Tidak adanya native messaging tool | High |
| NT-03 | Gemini retry dan error classification | Medium |

Catatan: identitas NT-01 sampai NT-03 merupakan label pelacakan untuk spesifikasi ini. Implementasi harus mempertahankan hubungan dengan issue atau test case asalnya.

# 4. Agent Capability Governance (ACG)

## 4.1 Architectural Overview

ACG merupakan policy management subsystem yang mengendalikan kapabilitas agent.

Arsitektur konseptual:

```text
                  HUMAN USER
                      |
                      v
              Capability CLI / API
                      |
                      v
             Capability Governance
                      |
          +-----------+-----------+
          |                       |
          v                       v
    Capability Registry      Grant Manager
          |                       |
          +-----------+-----------+
                      |
                      v
                 Policy Engine
                      |
                      v
                Policy Evaluator
                      |
                      v
              Execution Controller
                      |
              +-------+-------+
              |               |
              v               v
        OS Isolation      Audit Logger
              |
              v
       Host Operating System
```

Semua operasi yang memerlukan kapabilitas eksternal harus melalui execution controller.

Agent tidak boleh mengakses jalur eksekusi alternatif yang dapat melewati pemeriksaan ACG.

## 4.2 Capability Registry

ACG harus memiliki registry untuk mendefinisikan seluruh kapabilitas yang tersedia.

Kapabilitas awal:

| Capability ID | Deskripsi |
|---|---|
| `filesystem.read_external` | Membaca file di luar project root |
| `filesystem.write_external` | Menulis atau memodifikasi file di luar project root |
| `filesystem.delete_external` | Menghapus file di luar project root |
| `system.config_access` | Mengakses direktori konfigurasi pengguna |
| `process.execute_external` | Menjalankan executable eksternal |
| `network.outbound` | Melakukan koneksi jaringan keluar |
| `command.arbitrary` | Menjalankan perintah sistem yang lebih luas |
| `system.environment_access` | Mengakses environment variable host tertentu |
| `system.process_control` | Mengendalikan proses eksternal yang diizinkan |

Kapabilitas harus bersifat granular.

Contohnya, izin membaca file tidak otomatis memberikan izin menulis atau menghapus file.

`command.arbitrary` tidak boleh dianggap sebagai pengganti semua grant lainnya. Grant tersebut tetap harus tunduk pada enforcement dan batas isolasi yang ditentukan.

## 4.3 Capability Grant Model

Setiap pemberian kapabilitas harus direpresentasikan oleh objek grant.

Contoh TypeScript:

```ts
export type ApprovalMode =
  | "per_action"
  | "session"
  | "persistent";

export type GrantStatus =
  | "active"
  | "revoked"
  | "expired";

export interface CapabilityScope {
  paths?: string[];
  executables?: string[];
  network_hosts?: string[];
  environment_variables?: string[];
  operations?: string[];
}

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

Ketentuan:

1. `grant_id` harus unik.
2. Setiap grant harus memiliki identitas pemberi.
3. Grant dapat dibatasi pada session atau bot.
4. Grant dapat memiliki masa berlaku.
5. Grant harus dapat dicabut.
6. Grant tidak boleh berubah secara diam-diam.
7. Perubahan grant harus menghasilkan audit event.
8. Grant dengan scope kosong tidak boleh ditafsirkan sebagai unrestricted access.

## 4.4 Grant Lifecycle

Siklus hidup grant:

```text
       REQUESTED
           |
           v
        APPROVED
           |
           v
         ACTIVE
        /  |  \
       /   |   \
      v    v    v
  REVOKED EXPIRED SUSPENDED
```

Status `SUSPENDED` dapat ditambahkan untuk penanganan keamanan sementara.

Grant yang sudah dicabut atau kedaluwarsa tidak boleh digunakan kembali.

Pemberian ulang harus menghasilkan grant baru.

# 5. Capability Policy Engine

## 5.1 Policy Evaluation

Setiap operasi harus melewati policy evaluator sebelum dijalankan.

Contoh:

```ts
export interface CapabilityRequest {
  capability: string;

  session_id: string;
  bot_id: string;

  resource?: string;
  operation?: string;

  executable?: string;
  network_host?: string;
}

export type PolicyDecision =
  | "ALLOW"
  | "DENY"
  | "REQUIRE_APPROVAL";

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reason: string;

  matched_grant_id?: string;
  required_capability?: string;
}
```

## 5.2 Policy Precedence

Urutan evaluasi:

1. Security hard-deny rules.
2. Explicit deny rules.
3. Active capability grants.
4. Scope validation.
5. Execution mode approval requirement.
6. OS enforcement availability.
7. Final execution decision.

Aturan utama:

**Tidak ada grant yang boleh melewati hard-deny policy.**

Jika policy evaluator tidak dapat menentukan keputusan secara pasti, hasilnya adalah `DENY`.

## 5.3 Scope Matching

Contoh grant:

```text
Capability:
filesystem.read_external

Scope:
D:/shared-data
```

Agent hanya boleh membaca sumber daya yang berada dalam direktori tersebut.

Implementasi harus memperhatikan:

- Canonical path resolution.
- Symlink.
- Windows junction.
- UNC paths.
- Path traversal.
- Alternate data streams pada Windows.
- Race condition antara validasi dan operasi file.
- Hardlink dan mekanisme filesystem lain yang relevan.

Validasi string path saja tidak cukup.

Jika memungkinkan, akses harus menggunakan handle atau mekanisme OS yang mencegah perubahan target antara proses validasi dan operasi.

# 6. Capability Presets

ACG menyediakan empat preset awal.

| Preset | Nama | Karakteristik |
|---|---|---|
| Level 0 | Restricted | Hanya akses project yang diizinkan |
| Level 1 | Controlled | Akses eksternal terbatas berdasarkan scope |
| Level 2 | Extended | Akses lebih luas dengan batas executable dan resource |
| Level 3 | Unrestricted | Otoritas host yang sangat luas dalam lingkungan terisolasi |

## 6.1 Restricted

Preset default.

- Tidak ada akses filesystem eksternal.
- Tidak ada akses konfigurasi pengguna.
- Tidak ada executable eksternal di luar kebijakan dasar.
- Tidak ada akses jaringan kecuali secara eksplisit diizinkan.
- Tidak ada arbitrary command execution.

## 6.2 Controlled

- Akses direktori eksternal tertentu.
- Executable yang diizinkan.
- Network host allowlist.
- Grant dapat dibatasi per session.
- Human approval tersedia untuk tindakan sensitif.

## 6.3 Extended

- Beberapa direktori eksternal.
- Lebih banyak executable.
- Akses jaringan berdasarkan kebijakan.
- Kapabilitas dapat diberikan kepada beberapa bot.
- Audit tetap diwajibkan.

## 6.4 Unrestricted

Preset ini bukan berarti menonaktifkan seluruh kontrol keamanan.

Unrestricted hanya dapat digunakan ketika pengguna secara eksplisit memberikan otoritas luas.

Penggunaan yang direkomendasikan:

- Dedicated VM.
- Container dengan batas host yang jelas.
- Dedicated operating-system user.
- Disposable development environment.

Pada sistem host utama, Level 3 harus memberikan peringatan yang jelas dan meminta konfirmasi eksplisit.

# 7. Human-in-the-Loop Approval

## 7.1 Approval Model

ACG menyediakan tiga approval mode.

### Per Action

Setiap operasi yang membutuhkan persetujuan harus dikonfirmasi secara terpisah.

### Session

Kapabilitas berlaku selama session aktif.

### Persistent

Kapabilitas berlaku sampai dicabut atau kedaluwarsa.

Persistent grant harus membutuhkan konfirmasi eksplisit.

## 7.2 Approval Request

Contoh:

```text
CAPABILITY REQUEST

Bot:
research-agent-01

Requested Capability:
filesystem.read_external

Resource:
D:/research/datasets

Operation:
READ

Session:
S001

Approval Duration:
SESSION

[APPROVE] [DENY]
```

Informasi yang harus ditampilkan:

- Identitas bot.
- Session.
- Kapabilitas.
- Resource target.
- Jenis operasi.
- Masa berlaku grant.
- Dampak keamanan.

Persetujuan terhadap satu operasi tidak boleh otomatis menjadi persistent grant.

## 7.3 Approval and TURBO

TURBO adalah execution mode, bukan security privilege.

| Kondisi | Perilaku |
|---|---|
| TURBO + Restricted | Operasi eksternal tetap ditolak |
| TURBO + Controlled | Operasi yang memiliki grant dapat berjalan sesuai scope |
| TURBO + per_action | Persetujuan tetap diperlukan |
| TURBO + session grant | Operasi sesuai grant dapat berjalan tanpa approval berulang |
| TURBO + no grant | DENY |

Dengan demikian, pengguna dapat mengaktifkan TURBO tanpa memberikan akses host secara otomatis.

# 8. CLI Specification

ACG menyediakan command group khusus:

```bash
almudaya capability
```

## 8.1 List

```bash
almudaya capability list
almudaya capability list --session S001
almudaya capability list --bot research-agent-01
```

Menampilkan seluruh grant yang relevan.

## 8.2 Inspect

```bash
almudaya capability inspect filesystem.read_external
almudaya capability inspect <grant-id>
```

Menampilkan definisi kapabilitas atau detail grant.

## 8.3 Grant

```bash
almudaya capability grant filesystem.read_external \
  --scope "D:/shared-data" \
  --session S001
```

```bash
almudaya capability grant filesystem.write_external \
  --scope "D:/shared-data/output" \
  --session S001
```

```bash
almudaya capability grant process.execute_external \
  --allow "python.exe,node.exe" \
  --session S001
```

```bash
almudaya capability grant network.outbound \
  --hosts "api.example.com" \
  --session S001
```

```bash
almudaya capability grant command.arbitrary \
  --session S001 \
  --approval session
```

Perintah grant harus menjalankan approval workflow.

## 8.4 Revoke

```bash
almudaya capability revoke <grant-id>
```

## 8.5 History

```bash
almudaya capability history
almudaya capability history --session S001
```

## 8.6 Reset

```bash
almudaya capability reset --session S001
```

Reset mencabut seluruh grant dalam scope session tersebut.

## 8.7 Preset

```bash
almudaya capability preset list
almudaya capability preset show controlled
almudaya capability preset apply controlled --session S001
```

Preset tidak boleh diam-diam mengubah grant yang sudah ada. Penerapannya harus menghasilkan preview perubahan dan membutuhkan persetujuan.

# 9. Execution Architecture

## 9.1 Execution Controller

Semua eksekusi harus melalui satu entry point.

Contoh:

```ts
export interface ExecutionRequest {
  session_id: string;
  bot_id: string;

  command?: string;
  executable?: string;
  args?: string[];

  working_directory?: string;

  required_capabilities: string[];
}

export interface ExecutionResult {
  success: boolean;
  exit_code?: number;

  stdout?: string;
  stderr?: string;

  policy_decision: PolicyDecision;
  execution_id: string;
}
```

Execution Controller bertanggung jawab untuk:

1. Memvalidasi request.
2. Meminta policy evaluation.
3. Memastikan grant aktif.
4. Memastikan scope cocok.
5. Memastikan approval telah terpenuhi.
6. Membuat execution context.
7. Menjalankan operasi melalui isolation backend.
8. Mencatat audit event.
9. Membersihkan resource setelah eksekusi.

## 9.2 OS Isolation Abstraction

Struktur:

```text
src/
  execution/
    executor.ts
    command-policy.ts
    environment.ts

    isolation/
      interface.ts
      windows.ts
      linux.ts
      unsupported.ts

    index.ts
```

Antarmuka:

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

Backend harus menyatakan kemampuan isolasinya secara eksplisit.

## 9.3 Windows Backend

Target awal implementasi adalah Windows.

Pilihan mekanisme:

- Windows Job Objects untuk pengelolaan dan pembatasan proses.
- Restricted Token untuk mengurangi hak akses proses.
- AppContainer jika kompatibel dengan kebutuhan aplikasi.
- Windows Defender Application Control atau mekanisme application control yang tersedia.
- Dedicated user account.
- Virtual machine atau container sebagai batas isolasi yang lebih kuat.

Windows Job Objects sendiri tidak cukup untuk mengisolasi filesystem atau jaringan.

Restricted token juga bukan pengganti sandbox lengkap.

Implementasi harus mendokumentasikan batas keamanan masing-masing mekanisme.

## 9.4 Linux Backend

Dukungan lanjutan:

- Namespaces.
- Seccomp.
- cgroups.
- Linux capabilities.
- Mount namespace.
- Dedicated user.
- Network namespace.

## 9.5 Unsupported Backend

Jika isolation backend tidak tersedia atau tidak dapat memberikan jaminan yang dibutuhkan:

- Operasi yang membutuhkan isolasi tersebut harus ditolak.
- Sistem tidak boleh diam-diam fallback ke unrestricted shell execution.
- Pengguna harus memperoleh penjelasan mengenai keterbatasan platform.

# 10. Shell Execution Security

Perbaikan SEC-03 harus memperhatikan karakteristik shell.

Pemeriksaan string seperti:

```ts
if (command.includes("rm")) {
  deny();
}
```

tidak dapat dianggap sebagai mekanisme keamanan yang memadai.

Demikian juga, parsing command string tidak dapat menjamin pembatasan akses karena command dapat menggunakan:

- Child processes.
- Shell variables.
- Script files.
- Command substitution.
- Executable chaining.
- Interpreter.
- Symbolic links.
- Network utilities.
- Environment variables.

Karena itu, keamanan harus diterapkan melalui OS-level execution boundary.

`run_command` harus menjadi interface menuju execution controller, bukan jalur langsung menuju unrestricted `spawn()`.

Untuk command yang tidak membutuhkan shell, gunakan executable dan argument array.

Shell invocation hanya boleh tersedia melalui kebijakan dan isolation backend yang sesuai.

# 11. Environment Variable Security

Temuan SEC-01 harus diperbaiki secara menyeluruh.

## 11.1 Environment Allowlist

Child process tidak boleh menerima seluruh `process.env`.

Gunakan environment allowlist.

Contoh:

```ts
const SAFE_ENV_KEYS = [
  "PATH",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC"
];
```

Daftar tersebut adalah contoh baseline, bukan jaminan bahwa setiap variabel aman.

Khususnya:

- `PATH` dapat memengaruhi pemilihan executable.
- `PYTHONPATH` dan `PYTHONHOME` dapat mengubah perilaku interpreter.
- `COMSPEC` dapat memengaruhi shell yang digunakan.

Setiap variabel harus dinilai berdasarkan backend dan execution policy.

## 11.2 Secret Handling

- API key tidak boleh dicatat dalam work log.
- Secret tidak boleh dimasukkan ke command-line argument jika mekanisme yang lebih aman tersedia.
- Hindari menampilkan secret dalam stdout/stderr.
- Gunakan secret redaction sebelum persistence dan broadcast.
- Gunakan secret injection yang terkontrol apabila diperlukan.
- Hindari menyimpan API key melalui shell history atau process listing.

## 11.3 Logging

Raw command, argument, dan environment harus diperlakukan sebagai data yang berpotensi mengandung secret.

Audit log perlu menyimpan informasi yang cukup untuk investigasi tanpa menyimpan credential secara tidak sengaja.

# 12. Filesystem Security

Perbaikan SEC-04.

## 12.1 Path Validation

Semua operasi filesystem harus:

1. Mengidentifikasi root yang diizinkan.
2. Melakukan canonicalization.
3. Memvalidasi scope.
4. Memeriksa symbolic link dan junction.
5. Memastikan target berada dalam batas otorisasi.
6. Menghindari TOCTOU sejauh mungkin.

## 12.2 Filesystem Operations

Operasi berikut harus melewati evaluator:

- Read.
- Write.
- Append.
- Delete.
- Rename.
- Move.
- Create directory.
- Directory traversal.

## 12.3 External Access

Akses eksternal hanya diberikan melalui grant yang sesuai.

Contoh:

```text
filesystem.read_external:
D:/research/datasets

filesystem.write_external:
D:/research/output
```

Kedua grant tersebut harus tetap terpisah.

# 13. Messaging and Inbox Reliability

## 13.1 Message Acknowledgment

Perbaiki RELIA-01.

Pemrosesan pesan tidak boleh kehilangan pesan hanya karena pesan ditandai read sebelum operasi berhasil.

Implementasikan state:

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

Setiap message harus memiliki:

- Message ID.
- Processing state.
- Attempt count.
- Processing timestamp.
- Lease expiry.
- Idempotency key.
- Last error.

## 13.2 Polling Mutex

Perbaiki reentrancy pada asynchronous polling.

Implementasikan mekanisme single-flight:

```ts
if (isPolling) {
  return;
}

isPolling = true;

try {
  await pollCycle();
} finally {
  isPolling = false;
}
```

Implementasi final juga harus mempertimbangkan proses paralel dan session-level locking, bukan hanya satu boolean lokal.

## 13.3 At-Least-Once Delivery

Sistem harus menjamin setidaknya satu kali pengiriman selama retry policy berlaku.

Karena itu, consumer wajib mendukung idempotency.

Exactly-once execution tidak boleh diklaim tanpa transaksi atau mekanisme deduplikasi yang dapat menjamin sifat tersebut.

## 13.4 Native Messaging Tool

Agent harus memperoleh native messaging tool.

Nama awal:

```text
send_message
```

Fungsi:

- Mengirim DM kepada bot lain.
- Mengirim pesan kepada bot dalam session yang sama.
- Mengirim pesan ke channel yang diizinkan.
- Menghasilkan message ID.
- Mendukung structured payload.

Tool harus menggunakan messaging service internal dan tidak memerlukan `run_command` sebagai workaround.

# 14. Broadcast Cursor Consistency

Perbaiki CONC-02.

Ketentuan:

1. Cursor tidak boleh melewati event yang belum diproses.
2. Filtering harus konsisten dengan cursor semantics.
3. Limit tidak boleh menyebabkan event lama terlewati.
4. Concurrent consumer tidak boleh menimpa cursor secara tidak konsisten.
5. Cursor update harus dilakukan setelah event yang relevan berhasil diproses atau diakui.
6. Cursor persistence harus atomik.

Desain harus membedakan:

- Event sequence.
- Consumer cursor.
- Filtered view.
- Acknowledgment position.

Jangan menggunakan posisi event terakhir yang dibaca sebagai cursor jika terdapat event yang belum dikonsumsi.

# 15. Distributed Locking

Perbaiki CONC-01.

Lock harus memiliki:

- Lock ID.
- Owner ID.
- Session ID.
- Creation timestamp.
- Expiration timestamp.
- Fencing token.
- Ownership verification.

Contoh:

```ts
export interface LockRecord {
  lock_id: string;
  owner_id: string;
  session_id: string;

  fencing_token: number;

  created_at: string;
  expires_at: string;
}
```

Ketentuan:

1. Lock acquisition harus atomik.
2. Stale lock recovery tidak boleh hanya berdasarkan pemeriksaan timestamp.
3. Release hanya boleh dilakukan oleh pemilik lock yang sah.
4. Fencing token harus meningkat secara monoton.
5. Consumer harus dapat menolak operasi dari pemegang lock dengan token usang.
6. Corrupt lock tidak boleh dihapus secara membabi buta.
7. Lock timeout dan heartbeat harus didefinisikan.

# 16. JSONL Resilience

Perbaiki RELIA-02.

JSONL reader harus mampu menghadapi record rusak tanpa otomatis menggagalkan seluruh consumer.

Ketentuan:

- Validasi per record.
- Identifikasi record yang rusak.
- Logging kesalahan.
- Recovery yang tidak mengubah data secara diam-diam.
- Mekanisme quarantine untuk record yang tidak dapat diproses.
- Atomic write untuk operasi yang memerlukan konsistensi.

Corrupt record tidak boleh diam-diam dianggap valid.

# 17. Gemini Retry and Error Handling

Perbaiki retry behavior berdasarkan hasil pengujian Gemini nyata.

Ketentuan:

1. Membaca retry delay dari server ketika tersedia.
2. Memperhatikan `RetryInfo`.
3. Menggunakan exponential backoff jika informasi server tidak tersedia.
4. Menambahkan jitter.
5. Memiliki maximum retry limit.
6. Memiliki total retry deadline.
7. Mendukung cancellation.
8. Mengklasifikasikan rate limit secara benar.
9. Menampilkan error yang dapat dipahami pengguna.

Retry delay dari server tidak boleh dipotong secara agresif hingga menyebabkan request terus gagal.

Error HTTP 429 harus dibedakan dari error autentikasi, konfigurasi, dan kesalahan permanen lainnya.

# 18. Prompt Injection and Trust Boundary

Perbaiki SEC-02.

Semua konten yang berasal dari peer agent, work log, file, atau deskripsi eksternal harus diperlakukan sebagai untrusted input.

Ketentuan:

- Pesan peer tidak boleh mengubah system policy.
- Work log tidak boleh memberikan otoritas baru.
- Bot identity harus diverifikasi.
- Sender authorization harus diperiksa.
- Tool execution tetap tunduk pada ACG.
- Instruksi yang berasal dari data tidak boleh dianggap sebagai grant.

Prompt injection tidak dapat diselesaikan hanya melalui prompt engineering.

Security enforcement harus tetap berada di luar model.

# 19. CLI and Runtime Consistency

Ketentuan:

- `--no-mark-read` harus terdaftar dan berfungsi sesuai spesifikasi.
- Validasi enum CLI harus ketat.
- Session existence harus divalidasi.
- Bot lifecycle dan PID tracking harus konsisten.
- REPL tidak boleh memproses input secara reentrant.
- `readInbox` harus menghormati limit tanpa menandai pesan yang belum dikonsumsi sebagai read.
- Interval polling harus divalidasi.
- `list_dir.max_depth` harus benar-benar diterapkan.
- Versi package dan dokumentasi harus konsisten.
- Opsi `--api-key` harus dievaluasi ulang karena berpotensi membocorkan secret melalui process listing dan shell history.

# 20. Proposed Source Structure

Struktur target:

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
    index.ts

  execution/
    executor.ts
    command-policy.ts
    environment.ts

    isolation/
      interface.ts
      windows.ts
      linux.ts
      unsupported.ts

    index.ts

  messaging/
    service.ts
    inbox-state.ts
    delivery.ts
    cursor.ts

  core/
    lock.ts
    jsonl.ts
    audit.ts

  cli/
    commands/
      capability.ts

  tools/
    command-tools.ts
    messaging-tools.ts
    sandbox.ts
```

Struktur ini merupakan target desain. Implementasi boleh menyesuaikan struktur existing selama seluruh tanggung jawab dan enforcement boundary tetap terpenuhi.

# 21. Audit Trail

Semua perubahan otoritas dan operasi sensitif harus menghasilkan audit event.

Jenis event:

```text
CAPABILITY_REQUESTED
CAPABILITY_APPROVED
CAPABILITY_DENIED
CAPABILITY_GRANTED
CAPABILITY_REVOKED
CAPABILITY_EXPIRED

POLICY_EVALUATED
EXECUTION_STARTED
EXECUTION_COMPLETED
EXECUTION_FAILED
EXECUTION_TERMINATED

SECURITY_VIOLATION
ISOLATION_FAILURE
```

Audit record minimal:

```ts
export interface CapabilityAuditEvent {
  event_id: string;
  timestamp: string;

  session_id: string;
  bot_id?: string;

  actor: string;
  event_type: string;

  capability?: string;
  resource?: string;

  decision?: PolicyDecision;
  grant_id?: string;

  execution_id?: string;
  reason?: string;
}
```

Audit log harus append-only secara logis, memiliki pembatasan akses, dan tidak menyimpan secret mentah.

# 22. Testing Strategy

Testing harus dilakukan pada empat level.

## 22.1 Unit Testing

Target:

- Capability registry.
- Grant lifecycle.
- Scope matching.
- Policy precedence.
- Approval mode.
- Expiration.
- Revocation.
- Environment sanitization.
- Path canonicalization.
- Cursor semantics.
- Lock ownership.
- Inbox state machine.
- Retry calculation.

## 22.2 Integration Testing

Target:

- CLI grant/revoke.
- Agent execution melalui ACG.
- Filesystem access.
- External process execution.
- Network policy.
- Isolation backend.
- Messaging tool.
- Inbox acknowledgment.
- Audit trail.

## 22.3 Security Testing

Minimal test cases:

| Test ID | Skenario | Expected |
|---|---|---|
| ACG-SEC-001 | Membaca file eksternal tanpa grant | DENY |
| ACG-SEC-002 | Menulis file eksternal tanpa grant | DENY |
| ACG-SEC-003 | Mengakses direktori di luar scope | DENY |
| ACG-SEC-004 | Menggunakan grant kedaluwarsa | DENY |
| ACG-SEC-005 | Menggunakan grant yang dicabut | DENY |
| ACG-SEC-006 | TURBO tanpa grant | DENY |
| ACG-SEC-007 | Prompt injection meminta akses host | DENY |
| ACG-SEC-008 | Child process mencoba keluar dari scope | DENY |
| ACG-SEC-009 | Secret environment dicoba dibaca child process | DENY atau tidak tersedia |
| ACG-SEC-010 | Isolation backend gagal | DENY |
| ACG-SEC-011 | Symlink/junction escape | DENY |
| ACG-SEC-012 | Concurrent grant revocation | Tidak ada operasi baru setelah revocation efektif |

Pengujian child process harus benar-benar dijalankan dalam isolation backend, bukan hanya diuji melalui mock policy evaluator.

## 22.4 Regression Testing

Seluruh test suite existing harus dijalankan.

Baseline dari dokumen pengujian v0.3.0 mencatat 216/216 test pass. Namun, keberhasilan test tersebut tidak membuktikan bahwa seluruh kerentanan telah terselesaikan.

Untuk v0.3.2, hasil test harus dilaporkan berdasarkan:

- Test yang benar-benar dijalankan.
- Test yang dilewati.
- Test yang gagal.
- Test yang belum tersedia.
- Test yang hanya menggunakan mock.
- Test yang menggunakan OS isolation nyata.

# 23. Acceptance Criteria

Release v0.3.2 tidak dapat dinyatakan selesai hanya karena unit test lulus.

## A. ACG

- [ ] Capability registry tersedia.
- [ ] Default deny diterapkan.
- [ ] Grant dapat dibuat.
- [ ] Grant dapat dicabut.
- [ ] Grant dapat kedaluwarsa.
- [ ] Grant dapat dibatasi per session.
- [ ] Grant dapat dibatasi per bot.
- [ ] Scope matching berjalan.
- [ ] Approval workflow berjalan.
- [ ] TURBO tidak melewati policy.
- [ ] Semua perubahan grant diaudit.

## B. Execution Security

- [ ] `run_command` terintegrasi dengan execution controller.
- [ ] Tidak ada jalur shell yang melewati ACG.
- [ ] Environment allowlist diterapkan.
- [ ] Secret redaction diterapkan sebelum persistence.
- [ ] Filesystem scope ditegakkan.
- [ ] OS isolation backend diuji secara nyata.
- [ ] Isolation failure menghasilkan DENY.

## C. Concurrency and Reliability

- [ ] Lock TOCTOU diperbaiki.
- [ ] Fencing token diterapkan.
- [ ] Broadcast cursor tidak kehilangan event.
- [ ] Inbox menggunakan acknowledgment state.
- [ ] Polling reentrancy dicegah.
- [ ] Idempotency diterapkan.
- [ ] JSONL corruption ditangani secara resilient.

## D. Agent Runtime

- [ ] Native `send_message` tersedia.
- [ ] Gemini retry menghormati RetryInfo.
- [ ] CLI `--no-mark-read` tersedia.
- [ ] PID dan bot lifecycle konsisten.
- [ ] REPL event processing tidak reentrant.

## E. Release Quality

- [ ] Build berhasil.
- [ ] Unit test berhasil.
- [ ] Integration test berhasil.
- [ ] Security test berhasil.
- [ ] Regression test berhasil.
- [ ] README dan dokumentasi diperbarui.
- [ ] Changelog v0.3.2 tersedia.
- [ ] Known limitations didokumentasikan.

# 24. Implementation Phases

Implementasi disarankan dilakukan secara bertahap.

## Phase 1 – Security Foundation

Prioritas:

- Environment sanitization.
- Secret redaction.
- Filesystem boundary.
- Lock correctness.
- Execution controller interface.

Output: fondasi keamanan yang tidak bergantung pada model AI.

## Phase 2 – ACG Core

Implementasi:

- Capability schema.
- Registry.
- Grant manager.
- Policy evaluator.
- Presets.
- Approval workflow.
- Audit events.

Output: capability governance dapat diuji secara terpisah.

## Phase 3 – OS Execution Enforcement

Implementasi:

- Windows isolation backend.
- Process lifecycle management.
- Filesystem enforcement.
- Network restriction.
- External executable policy.

Output: ACG benar-benar mengendalikan operasi host.

## Phase 4 – Messaging and Concurrency

Implementasi:

- Inbox state machine.
- Polling mutex.
- Broadcast cursor consistency.
- Distributed locking.
- JSONL resilience.
- Native messaging tool.

Output: komunikasi antar-agent lebih andal.

## Phase 5 – Runtime and Provider Reliability

Implementasi:

- Gemini retry.
- Error classification.
- REPL reentrancy.
- CLI consistency.
- Bot lifecycle.

Output: runtime lebih stabil dalam penggunaan nyata.

## Phase 6 – Validation and Release

Implementasi:

- Regression tests.
- Security tests.
- OS isolation tests.
- Documentation.
- Changelog.
- Release packaging.

Output: Almudaya Multi-Agent v0.3.2.

# 25. Migration Strategy

Migrasi dari v0.3.1 harus dilakukan secara konservatif.

Ketentuan:

1. Existing session data tidak boleh rusak.
2. Existing bot configuration harus tetap dapat dibaca.
3. Grant lama tidak boleh dianggap sebagai authorization baru.
4. Semua external capability harus default deny setelah migrasi.
5. Pengguna harus memberikan grant secara eksplisit.
6. Existing TURBO configuration tidak boleh berubah menjadi unrestricted access.
7. Audit log lama tetap dipertahankan.
8. Migration harus memiliki backup dan rollback procedure.

Jika perubahan schema diperlukan, gunakan versioned migration.

# 26. Security Non-Goals and Limitations

ACG bukan pengganti operating-system security.

Beberapa batasan yang harus dinyatakan secara eksplisit:

- Policy evaluator tidak dapat menjamin keamanan jika proses dapat berjalan di luar enforcement boundary.
- Command string parsing tidak cukup untuk mengamankan arbitrary shell execution.
- Environment allowlist tidak otomatis mengisolasi proses.
- Windows Job Objects tidak menyediakan isolasi filesystem secara penuh.
- Prompt injection tidak dapat dicegah hanya dengan system prompt.
- Exactly-once message execution tidak dapat dijamin hanya dengan retry.
- Unrestricted host access tetap memiliki risiko tinggi sekalipun semua tindakan diaudit.

Untuk kapabilitas yang membutuhkan kontrol host yang kuat, penggunaan VM atau lingkungan isolasi khusus merupakan pilihan yang direkomendasikan.

# 27. Final Release Definition

Almudaya Multi-Agent v0.3.2 dinyatakan memenuhi tujuan remediation apabila:

1. ACG menjadi satu-satunya otoritas pemberian kapabilitas agent.
2. Execution Controller menjadi jalur wajib bagi operasi sistem yang sensitif.
3. Default deny berjalan pada execution boundary.
4. TURBO tidak dapat melewati capability policy.
5. Grant memiliki scope, lifecycle, dan audit trail.
6. OS isolation benar-benar diterapkan dan diuji.
7. Temuan concurrency dan messaging prioritas tinggi telah diselesaikan.
8. Seluruh acceptance criteria kritis telah diverifikasi.

**Target identitas release:**

`Almudaya Multi-Agent v0.3.2 – Security & Concurrency Hardening`

**Status dokumen: APPROVED FOR IMPLEMENTATION**

---

**End of Specification**

- Baseline: v0.3.1
- Target: v0.3.2
- Authority: normative requirements
- Approval/revision: isi saat integrasi

## Addendum yang wajib eksplisit dalam spesifikasi penuh
1. Inbox limit diterapkan sebelum perubahan read/ack state; pesan di luar limit tidak boleh ditandai read.
2. API key tidak boleh menjadi jalur normal melalui argv (`--api-key`); gunakan environment injection, stdin, atau secret provider.
3. Redaction terpusat diterapkan sebelum Blackboard, work log, audit log, broadcast, error telemetry, dan CLI output.
4. Path validation/cwd/environment sanitization bukan OS sandbox. Jika isolator wajib tidak tersedia/gagal, sensitive execution harus DENY.
5. TURBO adalah execution mode, bukan privilege; tidak boleh mengubah DENY menjadi ALLOW atau menerbitkan grant.
6. Semantik inbox adalah at-least-once + idempotency + acknowledgment; jangan klaim exactly-once tanpa transaksi atomik end-to-end.

Setiap perubahan requirement harus dicatat pada revision history dan dipetakan ke finding, source, test, dan ADR.
