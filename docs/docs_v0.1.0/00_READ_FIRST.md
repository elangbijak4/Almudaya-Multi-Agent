# Read First — Almudaya Multi-Agent v0.1.0

Dokumen ini adalah pintu masuk dokumentasi pengembangan. Baca berurutan dan gunakan `MASTER_PROMPT.md` di root repository sebagai instruksi utama untuk coding agent.

## Urutan baca

1. `01_PROJECT_CHARTER.md`
2. `02_REQUIREMENTS/SRS.md`
3. `02_REQUIREMENTS/USE_CASES.md`
4. `02_REQUIREMENTS/REQUIREMENT_TRACEABILITY.md`
5. `03_ANALYSIS/SYSTEM_ANALYSIS.md`
6. `03_ANALYSIS/ACCEPTANCE_CRITERIA.md`
7. `04_DESIGN/SYSTEM_DESIGN.md`
8. `04_DESIGN/DATA_MODEL.md`
9. `04_DESIGN/PERSISTENCE_AND_CONCURRENCY.md`
10. `05_IMPLEMENTATION/IMPLEMENTATION_PLAN.md`
11. `06_TESTING/TEST_STRATEGY.md`
12. `07_RELEASE/RELEASE_PLAN.md`
13. `10_PHASE_GATES/PHASE_STATUS.md`

## Aturan penggunaan

- Nomor awalan menentukan urutan Waterfall.
- Dokumen yang belum disetujui berstatus `DRAFT`.
- Jangan mengubah requirement atau keputusan arsitektur secara diam-diam.
- Perubahan harus dicatat di `09_CHANGE_CONTROL/CHANGE_LOG.md`; keputusan arsitektur penting dicatat sebagai ADR.
- Fase tidak boleh dilewati sebelum exit criteria fase sebelumnya terpenuhi.
- Implementasi v0.1.0 tidak mencakup LLM, MCP, RAG, GUI, SDK mandiri, atau autonomous orchestrator.
- Jika terdapat konflik, prioritaskan keputusan terbaru yang tercatat di ADR dan change log. Jika belum jelas, catat sebagai open issue.

## Status baseline

Baseline ini adalah rancangan awal untuk memulai analisis. Coding agent wajib memverifikasi asumsi teknis melalui inspeksi lingkungan dan pengujian, bukan menganggap semua pilihan sudah final.
