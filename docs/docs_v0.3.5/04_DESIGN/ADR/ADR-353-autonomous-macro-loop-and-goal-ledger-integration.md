# ADR-353: Autonomous Macro-Loop Integrated with Master Goal Ledger (Rejecting Rigid Pipeline Loops)

**Status:** ACCEPTED  
**Date:** 2026-11-15  
**Version:** v0.3.5  

---

## 1. Context

Terdapat dua rancangan untuk menjadikan *looping development* lintas-bot sebagai sifat bawaan Almudaya:
- **Opsi A:** Memasang *State Machine Pipeline* yang kaku di kernel (setiap mutasi berkas wajib memicu urutan tetap `Builder -> Inspector -> Critic`).
- **Opsi B:** Membiarkan bot bekerja melalui rantai pemicu pesan otonom yang fleksibel (**Macro-Loop**) di bawah wasit `MASTER` + 3 Protokol (`PrBot`, `PrIterasi`, `PrDE`), dengan mengintegrasikan **Goal Ledger** dan peran **Consistency/Improvement Bot** ke dalam kendali `MASTER`.

---

## 2. Decision

Memilih **Opsi B (Sinergi Terarah)** dan **menolak** penggabungan dengan *Rigid Pipeline* Opsi A secara paralel:

1. **Goal Ledger di Tangan `MASTER` (`goal_ledger.json`):**
   - Programmer cukup menyerahkan Peta Pekerjaan (*Blueprint*). `MASTER` menerjemahkannya menjadi daftar tugas terukur beserta *Acceptance Criteria* di `goal_ledger.json`.
2. **Unified Natural Lifecycle (Tanpa Mode Klasik vs Mode Macro-Loop Terpisah):**
   - Almudaya tidak membedakan "mode klasik" dengan "mode macro-loop". Ke-10 protokol selalu aktif secara bawaan, dan setiap bot di akhir kerjanya wajib mengirim pesan tugas (`send_message` / `submit_task_handoff` dengan `PrTransfer` + `CC: MASTER`). Jika tujuan langsung selesai dalam satu giliran ($L=1$), `MASTER` + `PrGate` menyetujui `TASK_0` dan sesi berhenti saat itu juga. Jika masih ada pekerjaan lanjutan atau rantai pesan berpindah antar-bot, siklus otomatis berputar sebagai *Macro-Loop* ($L>1$) sampai salah satu dari tiga kondisi penghenti terjadi:
     1. Seluruh item pada **Goal Ledger** mencapai status `DONE` (termasuk lolos verifikasi fisik **`PrGate`**) dan disahkan **`GOAL_ACHIEVED`** oleh `MASTER`.
     2. Terjadi pelanggaran berat terhadap aturan aktif (`dynamic_rules.json`).
     3. Terjadi jalan buntu atau error tak terpulihkan yang melewati `PrIterasi` / `PrDE` / `PrBot` / `PrBotGlobal` lalu dieskalasi ke **HITL**.
3. **Pemeriksa Konsistensi & Penyempurna Berkelanjutan sebagai Anggota Pool:**
   - `MASTER` secara bawaan menugaskan peran **Consistency Inspector** dan **Continuous Improvement/Critic** ke dalam rantai proyek (terhitung dalam kuota `PrBot`), tanpa memaksa alur komunikasi kaku per baris kode.

---

## 3. Consequences

- Menghindari *dual-brain overhead* (konflik antara aturan pipeline kaku vs kewenangan `MASTER`).
- Menjamin programmer benar-benar bisa menyerahkan Peta Pekerjaan dan membiarkan tim bot bekerja otonom tanpa berhenti prematur sebelum seluruh tujuan pada Goal Ledger selesai dan konsisten.
