# Almudaya Multi-Agent v0.3.2 — Remediation Scaffold

Scaffold dokumentasi untuk revisi v0.3.2. Paket ini mengatur hubungan dokumen, traceability, phase gates, dan bukti verifikasi. Ini bukan klaim bahwa implementasi v0.3.2 telah dilakukan atau diuji.

## Urutan dokumen dan otoritas
1. `00_MASTER_PROMPT.md` — instruksi kerja coding agent: bagaimana bekerja, batasan, phase gates.
2. `01_BASELINE_AUDIT_REGISTER.md` — daftar temuan baseline dan status bukti.
3. `02_REMEDIATION_SPECIFICATION.md` — persyaratan normatif: apa yang wajib diperbaiki/dibangun.
4. `03_SOURCE_IMPLEMENTATION_BLUEPRINT.md` — pemetaan persyaratan ke source, modul, urutan implementasi, dan test.
5. `04_ARCHITECTURE_DECISIONS.md` — keputusan arsitektur yang disetujui (ADR).
6. `05_TRACEABILITY_MATRIX.md` — Finding → Requirement → Source → Test → Evidence.
7. `06_IMPLEMENTATION_STATUS.md` — status aktual, blocker, keputusan, dan phase gate.
8. `phases/` — rencana/laporan tiap fase; `reports/` — bukti build, test, security, migration, release.

## Aturan konflik
- Master Prompt mengatur proses, bukan menggantikan spesifikasi teknis.
- Specification mengatur apa yang harus benar.
- Blueprint memetakan requirement ke source; tidak boleh mengubah requirement tanpa persetujuan.
- ADR mengunci keputusan desain; konflik dengan Specification harus dieskalasikan.
- Audit Register adalah baseline historis, bukan spesifikasi baru.
- PASS harus didukung eksekusi dan output yang tersimpan, bukan sekadar deklarasi test.

## Cara menggunakan
1. Letakkan scaffold ini pada root repository.
2. Ganti `02_REMEDIATION_SPECIFICATION.md` dan `03_SOURCE_IMPLEMENTATION_BLUEPRINT.md` dengan isi lengkap dokumen yang telah disetujui sebelumnya.
3. Rekonsiliasi Audit Register dengan source/commit aktual; pertahankan ID temuan.
4. Isi Traceability Matrix sebelum coding.
5. Jalankan fase berurutan. Phase 0 hanya baseline; jangan mengubah production source sebelum baseline report dan persetujuan.
6. Update Implementation Status setelah setiap fase.
