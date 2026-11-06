# Log Kontrol Perubahan (Change Control Log) — Almudaya Multi-Agent v0.3.1

Dokumen ini mencatat inisiasi dan evolusi perubahan baseline spesifikasi untuk rilis v0.3.1 (*Security, Concurrency & Reliability Patch*).

---

## Catatan Perubahan Baseline

### [CHG-3101] Inisiasi Rilis Patch Keamanan & Stabilitas v0.3.1
- **Tanggal:** 2026-11-06
- **Pengusul:** System Architect & Quality Auditor
- **Status:** APPROVED (Baseline Inisiasi Fase 1)
- **Dasar Perubahan:**
  - Laporan audit arsitektur komprehensif pada [`AUDIT.md`](file:///d:/almudaya_multiagent_v0.1.0/AUDIT.md).
  - Laporan pengujian fungsional dan verifikasi live pada [`TESTING.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING.md).
  - Laporan pengujian orkestrasi bot real-Gemini pada [`TESTING2.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING2.md).
- **Rincian Perubahan:**
  1. Menetapkan kebutuhan sanitasi variabel lingkungan subprocess (`run_command`) guna mencegah eksfiltrasi token rahasia ke `work_log.jsonl` (SEC-01 / FR-319).
  2. Menetapkan kebutuhan validasi path kanonikal (`fs.realpathSync`) guna mencegah pelarian sandbox melalui symlink atau Windows Directory Junction (§14/6 / FR-320).
  3. Menetapkan kebutuhan pemrosesan pesan transaksional di `AutonomousAgentLoop` (*at-least-once delivery*) guna mencegah hilangnya pesan inbox saat terjadi interupsi atau kegagalan (RELIA-01 / FR-321).
  4. Menetapkan kebutuhan deteksi respons HTTP 429, parsing `retryDelay`, dan jeda adaptif pada `GeminiProvider` guna menangani pembatasan laju kuota free-tier secara elegan (NT-05, NT-06 / FR-322).
  5. Menetapkan kebutuhan indikator penundaan kuota yang ramah pada antarmuka konsol REPL guna mencegah kepanikan operator (NT-06 / FR-323).
  6. Menetapkan kebutuhan penguncian sesi pada pembaruan kursor broadcast guna mencegah hilangnya event akibat penyaringan (CONC-02 / FR-324).
  7. Menetapkan kebutuhan opsi CLI `--no-mark-read` pada perintah pembacaan pesan (NT-01 / FR-325).
  8. Menetapkan penyelarasan dokumentasi kategori broadcast dengan skema Zod (§16/1 / FR-326).
- **Dampak Arsitektur:** Perubahan terbatas pada layer tools, messaging service, provider AI, dan agent loop; tidak merusak kompatibilitas antarmuka publik atau struktur berkas Blackboard.
