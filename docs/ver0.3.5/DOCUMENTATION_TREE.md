# Documentation Tree — Almudaya Multi-Agent v0.3.5

Daftar lengkap artefak dokumentasi Waterfall dalam direktori `docs/ver0.3.5/` (dicerminkan secara identik ke `docs/docs_v0.3.5/` untuk keselarasan konvensi versi):

```text
docs/ver0.3.5/
├── 00_READ_FIRST.md
├── 01_PROJECT_CHARTER.md
├── DOCUMENTATION_TREE.md
├── 02_REQUIREMENTS/
│   ├── SRS.md
│   ├── USE_CASES.md
│   └── REQUIREMENT_TRACEABILITY.md
├── 03_ANALYSIS/
│   ├── SYSTEM_ANALYSIS.md
│   └── DATA_FLOWS.md
├── 04_DESIGN/
│   ├── SYSTEM_DESIGN.md
│   ├── DATA_MODEL.md
│   └── ADR/
│       ├── ADR-351-unified-master-hitl-console-and-dual-spawn-mode.md
│       ├── ADR-352-built-in-protocols-prbot-priterasi-prde.md
│       ├── ADR-353-autonomous-macro-loop-and-goal-ledger-integration.md
│       ├── ADR-354-master-failover-and-token-timeout-circuit-breakers.md
│       ├── ADR-355-prmeend-and-prbotglobal-protocols.md
│       └── ADR-356-atomic-protocol-interface-prmoderator-and-prtransfer.md
├── 05_IMPLEMENTATION/
│   └── IMPLEMENTATION_PLAN.md
├── 06_TESTING/
│   └── TEST_STRATEGY.md
├── 07_RELEASE/
│   └── RELEASE_PLAN.md
├── 09_CHANGE_CONTROL/
│   └── CHANGE_LOG.md
└── 10_PHASE_GATES/
    └── PHASE_STATUS.md
```

---

## Ringkasan Peran Setiap Dokumen

| Dokumen | Fungsi Utama sebagai Panduan Revisi & Refactoring |
|---|---|
| `00_READ_FIRST.md` | Ikhtisar evolusi dari v0.3.4 ke v0.3.5 dan daftar 10 butir protokol atomic (`IProtocol`). |
| `01_PROJECT_CHARTER.md` | Visi, sasaran terukur, prinsip desain *Protocol-Oriented*, serta batas cakupan (*in/out of scope*). |
| `02_REQUIREMENTS/SRS.md` | Spesifikasi rinci kebutuhan fungsional (`FR-350`..`FR-395`) dan non-fungsional (`NFR-350`..`NFR-355`). |
| `02_REQUIREMENTS/USE_CASES.md` | Skenario interaksi aktor (`UC-351`..`UC-362`) untuk seluruh 10 protokol dan kasus eskalasi. |
| `02_REQUIREMENTS/REQUIREMENT_TRACEABILITY.md` | Matriks penelusuran Requirements $\rightarrow$ ADR $\rightarrow$ Use Cases $\rightarrow$ Modul Kode Target $\rightarrow$ Pengujian (`TC-350-01`..`TC-350-20`). |
| `03_ANALYSIS/SYSTEM_ANALYSIS.md` | Analisis keputusan desain, evaluasi 8 celah teknis (*red-team review*), penyatuan via `PrModerator`/`PrTransfer`, dan peta titik *refactoring* `v0.3.4`. |
| `03_ANALYSIS/DATA_FLOWS.md` | Diagram urutan (*Sequence Diagrams*) dan mesin status (*State Machine*) seluruh protokol termasuk `PrModerator`, `PrTransfer`, `PrGate`, dan `PrReattach`. |
| `04_DESIGN/SYSTEM_DESIGN.md` | Desain kelas TypeScript (`IProtocol`, `ProtocolRegistry`, 10 kelas protokol), integrasi `ExecutionModeController`/`ACG`, CLI flags, dan slash commands. |
| `04_DESIGN/DATA_MODEL.md` | Skema Zod & struktur berkas Blackboard (`protocol/`, `moderator_state.json`, `checkpoints/`, `PrTransferEnvelope`, `CapabilityToken`). |
| `04_DESIGN/ADR/ADR-351..356` | Catatan Keputusan Arsitektur (*Architecture Decision Records*) formal. |
| `05_IMPLEMENTATION/IMPLEMENTATION_PLAN.md` | Rencana eksekusi implementasi & *refactoring* bertahap (Phase A–F) per berkas sumber di `src/`. |
| `06_TESTING/TEST_STRATEGY.md` | Rencana skenario pengujian (`TC-350-01`..`TC-350-20`), simulasi offline Vitest, dan kriteria keluar. |
| `07_RELEASE/RELEASE_PLAN.md` | Kriteria kesiapan rilis `v0.3.5` (*Go/No-Go checklist*). |
| `09_CHANGE_CONTROL/CHANGE_LOG.md` | Log perubahan terencana (`CHG-351`..`CHG-364`) dari `v0.3.4` menuju `v0.3.5`. |
| `10_PHASE_GATES/PHASE_STATUS.md` | Pelacakan gerbang fase (*Waterfall Phase Gates*) pengembangan `v0.3.5`. |
