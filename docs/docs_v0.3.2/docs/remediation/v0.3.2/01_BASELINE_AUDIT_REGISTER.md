# Baseline Audit Register — v0.3.2

**Baseline target:** v0.3.1 source tree (nama arsip lama tidak membuktikan versi kode).  
**Evidence:** `source-evidence/AUDIT.md`, `TESTING.md`, `TESTING2.md`.  
**Validitas:** laporan yang disertakan adalah evidence historis. Inventaris statis 37 test files/201 deklarasi `it()` bukan bukti eksekusi. Build/Vitest harus dijalankan ulang pada Phase 0.

| ID | Area | Temuan baseline / risiko | Status awal | Target penanganan |
|---|---|---|---|---|
| SEC-01 | Environment | Child process environment berpotensi mewarisi variabel sensitif/berisiko | Partial | Allowlist minimal dan test sentinel |
| SEC-02 | Prompt trust | Peer DM/work log masuk prompt tanpa trust boundary memadai | Open | Tandai untrusted, struktur prompt, verifikasi sender |
| SEC-03 | Command sandbox | Shell berjalan pada host; cwd/path check bukan OS sandbox | Open | Execution Controller + OS isolation; fail closed |
| SEC-04 | Secret handling | Redaction tidak menyeluruh; args/payload dapat tersimpan pada log/Blackboard/broadcast | Partial/Open | Redaction terpusat sebelum persistence/output |
| CONC-01 | Lock | Stale-lock/unlink race; release dapat menghapus lock bukan miliknya | Open | Ownership-safe lock dan fencing/lease strategy |
| CONC-02 | Broadcast cursor | Filter/limit/cursor berpotensi melewatkan event | Partial | Cursor monotonic dan pagination tanpa skip |
| RELIA-01 | Inbox | At-least-once perlu idempotency; crash setelah side effect berpotensi duplicate | Improved/residual | Idempotency key dan ack eksplisit |
| RELIA-02 | Inbox limit | Mark-read sebelum limit slicing dapat menandai pesan belum diproses | Open/verify | Batasi kandidat sebelum state berubah; ack per pesan |
| RELIA-03 | JSONL | Satu baris rusak dapat menggagalkan seluruh pembacaan | Open | Isolasi record rusak dan diagnostics |
| PERF-01 | Runtime | Polling async dan REPL berpotensi reentrant | Open | Single-flight/mutex dan lifecycle aman |
| NT-01 | Gemini retry | 429/RetryInfo perlu menghormati waktu server | Partial/mostly fixed | RetryInfo, bounded backoff, cancellation |
| NT-02 | CLI secrets | `--api-key` berisiko terekspos di process list/shell history | Needs explicit remediation | Env/stdin/secret provider; hindari argv |
| NT-03 | Messaging | Belum ada native `send_message`; workaround CLI/run_command | Open | Native typed messaging tool |
| IDV-01 | Identity | Identitas pengirim DM/broadcast perlu diverifikasi | Open | Authentication/authorization sender |
| DOC-01 | Documentation | README/version/test count/scope tidak konsisten | Open | Sinkronisasi docs, changelog, versi, hasil test |

Pertahankan ID di atas. Jika status berubah, catat bukti dan tanggal; jangan menghapus sejarah temuan.
