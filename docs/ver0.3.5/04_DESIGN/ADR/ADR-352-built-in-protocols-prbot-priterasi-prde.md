# ADR-352: Built-in Kernel Governance Protocols (`PrBot`, `PrIterasi`, `PrDE`)

**Status:** ACCEPTED  
**Date:** 2026-11-15  
**Version:** v0.3.5  

---

## 1. Context

Pada eksperimen `QuantumLabs` (`v0.3.3`–`v0.3.4`), tiga kegagalan operasional teridentifikasi:
1. Bot yang terjebak error tool mengulang kesalahan yang sama sampai batas iterasi habis tanpa mekanisme pengalihan model AI yang lebih mampu.
2. Bot saling mengirim balasan tanpa henti (*ping-pong*), sementara pemblokiran kaku `APP-BUG-04` (memblokir seluruh *auto-reply* setelah 1 kali balas) membatasi diskusi multi-putaran yang sebenarnya produktif.
3. Tidak ada tata kelola terukur kapan bot boleh melahirkan bot spesialis baru atau kapan sistem harus berhenti demi mencegah pembengkakan biaya token dan RAM.

---

## 2. Decision

Menanamkan protokol pengaman kernel deterministik (tiga inti tata kelola alur kerja di dokumen ini, diperluas dengan **`PrMEend`** dan **`PrBotGlobal`** pada [ADR-355](./ADR-355-prmeend-and-prbotglobal-protocols.md), serta dikemas menjadi **10 kelas protokol atomic `IProtocol`** bersama **`PrModerator`**, **`PrTransfer`**, **`PrGate`**, dan **`PrReattach`** pada [ADR-356](./ADR-356-atomic-protocol-interface-prmoderator-and-prtransfer.md)) di dalam `ProtocolSupervisor` (`src/protocol/supervisor.ts`) / `ProtocolRegistry` yang parameternya dapat diatur via CLI:

1. **Protokol 1 — `PrBot` (Bot Spawning & Dynamic Rules Governance):**
   - `MASTER` dapat membuat/mematikan bot dan menyusun aturan *on-the-fly* (`dynamic_rules.json`).
   - Bot pekerja dapat mengajukan pembuatan bot baru via tool `request_spawn_bot`, namun **wajib disetujui `MASTER`**.
   - Batas otonom default: **`prBotLimit = 10`** (`--pr-bot`). Jika melewati batas (atau RAM/anggaran token kritis), permintaan dibekukan dan dieskalasi ke **HITL**.
2. **Protokol 2 — `PrIterasi` (10-Iteration Takeover & Cross-Model Handover):**
   - Terpicu apabila bot menyentuh **`prIterasiLimit = 10`** (`--pr-iterasi`), **task timeout** (`--task-timeout`), atau **kuota token/API habis** (HTTP `402`/`429` tak terpulihkan).
   - `MASTER` langsung mengambil alih tugas, membaca `WorkLog` & `PKU`, lalu menugaskan/melahirkan bot pengganti dengan **model AI yang berbeda** (*Cross-Model Handover*) dari `modelPool`.
   - Pengalihan dibatasi **`prIterasiHandoverLimit = 3`** (`--pr-iterasi-handover`). Bila model ke-3 juga gagal, cabang tugas dihentikan (`BLOCKED_HITL`) dan dilaporkan ke **HITL**.
3. **Protokol 3 — `PrDE` (Protocol DeadEnd / Ping-Pong Mediation):**
   - Menggantikan pemutusan 1-balasan statis `APP-BUG-04` pada `v0.3.4`.
   - Percakapan bolak-balik pada utas (`threadId`) dibebaskan hingga **`prDeLimit = 10`** (`--pr-de`) pertukaran pesan (serta dibatasi `threadTimeoutMs` & token budget).
   - Jika melewati `10` pertukaran atau batas waktu/kuota utas, `MASTER` mengambil alih untuk mengevaluasi transkrip diskusi dan memutuskan: `STOP_THREAD`, `REASSIGN_TASK`, atau `SPAWN_SPECIALIST`.
   - Jika `PrDE` terpicu lebih dari **`prDeEscalationLimit = 10`** kali (`--pr-de-escalation`) dalam satu sesi, `MASTER` melaporkan eskalasi ke **HITL**.

---

## 3. Consequences

- Seluruh ambang batas (`10 / 10 / 3 / 10 / 10`), timeout, dan kuota token ditegakkan secara **deterministik oleh TypeScript**, tidak pernah bergantung pada kepatuhan teks prompt LLM.
- Programmer dapat menyetel batas ketat saat pengembangan lokal/hemat kuota (misal `--pr-bot 3 --pr-iterasi 4 --pr-de 3`) atau longgar pada tugas besar.
- Guard `APP-BUG-04` di `src/bot/agent-loop.ts` direfaktor menjadi pelacak `threadId + exchangeCount` yang terhubung langsung ke `PrDE`.
