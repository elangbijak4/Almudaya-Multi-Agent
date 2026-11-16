# ADR-356: Arsitektur Protokol Atomic (`IProtocol`), Protokol `PrModerator`, `PrTransfer`, `PrGate`, dan `PrReattach`

**Status:** ACCEPTED  
**Date:** 2026-11-15  
**Version:** v0.3.5  

---

## 1. Context

Audit arsitektur (*red-team review*) terhadap paket desain awal `v0.3.5` (dengan 5 protokol `PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend` dan `PrMasterFailover`) mengungkapkan dua kebutuhan strategis:

1. **Kebutuhan Modularitas Berbasis Kontrak (`Atomic Protocol Classes`):**
   Logika protokol yang tersebar di berbagai fungsi membuat aturan sulit digunakan ulang, sulit diuji terisolasi, dan berisiko tercampur antar-perhatian (*mixed concerns*). Setiap mekanisme di dalam siklus kerja *Macro-Loop* sebaiknya dirumuskan sebagai **butir protokol atomic** berbentuk kelas mandiri yang mengimplementasikan satu antarmuka formal (`IProtocol`).
2. **Delapan Celah Teknis Operasional di Dunia Nyata:**
   - **Celah 1 (*Zombie Worker Overwrite*):** Saat `PrIterasi` mengalihkan tugas ke model baru pada mode `windows` (proses terpisah), bot lama yang terlambat menyelesaikan tool bisa menimpa file yang sedang dikerjakan bot pengganti.
   - **Celah 2 (*Corrupted Partial File*):** Bot gagal meninggalkan kode setengah tulis/rusak sehingga model baru membuang kuota iterasi untuk memperbaiki kerusakan sisa bot lama.
   - **Celah 3 (*Circular Relay Loop `A -> B -> C -> A`*):** Estafet tugas melingkar tanpa progres nyata lolos dari `PrDE` (bila ganti `threadId`) dan lolos dari Lapis-1 `PrMEend`.
   - **Celah 4 (*Zombie Windows & Quota Drain*):** Handover `PrIterasi` membuka bot/jendela baru tanpa mendaur ulang bot yang gagal sehingga menghabiskan plafon `PrBotGlobal` & `PrBot`.
   - **Celah 5 (*Single-Model Pool Exhaustion*):** Jika operator hanya menyalakan 1 provider dengan 1 model, `selectNextDistinctModel()` langsung gagal sebelum 3x handover berjalan.
   - **Celah 6 (*Master Bot Event Storm*):** Banyak bot anak di mode paralel memicu `PrIterasi`, `PrDE`, dan `PrMEend` di detik yang sama tanpa urutan prioritas maupun opsi delegasi moderasi.
   - **Celah 7 (*Hallucinated Completion pada `Tugas 0`*):** LLM `MASTER` berisiko memercayai laporan teks pekerja bahwa proyek selesai padahal file target belum ada di disk atau kosong.
   - **Celah 8 (*Orphaned Windows Saat Crash/Restart*):** Saat `MASTER` dimatikan dan dijalankan ulang, jendela bot anak dari sesi lama masih hidup sehingga berpotensi terjadi *spawn* ganda.

---

## 2. Decision

Menetapkan **Arsitektur Berbasis 10 Butir Protokol Atomic (`IProtocol`)** dengan menambahkan empat protokol baru (**`PrModerator`**, **`PrTransfer`**, **`PrGate`**, **`PrReattach`**) serta memperketat protokol yang ada:

### 2.1 Kontrak Atomic `IProtocol<TContext, TDecision>`
Seluruh protokol di dalam `src/protocol/protocols/` wajib mengimplementasikan:
- Properti identitas: `protocolId`, `version`, `isEnabled`.
- Metode standar: `configure(limits)`, `evaluate(ctx)`, `enforce(decision, ctx)`, `getStateSnapshot()`.
- Dikelola secara terpusat melalui `ProtocolRegistry` yang dipanggil oleh `ProtocolSupervisor`.

### 2.2 Protokol 6 — `PrModerator` (*Arbitration, Capability Token & Intervention Queue*)
1. **Jabatan Penengah & Delegasi:** Secara bawaan dipegang oleh **`MASTER` (`BOT000`)**, namun **`MASTER` dapat mendelegasikan kewenangan Moderator** ke bot pekerja khusus (misal `BOT_MOD` via `--moderator-bot` atau saat beban paralel tinggi) agar `MASTER` tidak mengalami *bottleneck* (Celah 6).
2. **Distribusi Token Hak Kerja (`CapabilityToken`):** Seluruh hak menulis workspace (`allowedPaths`), memakai komponen/tools (`allowedComponents`), dan mode akses (`EXCLUSIVE_WRITE | SHARED_READ | REVIEW_ONLY`) diikat oleh `CapabilityToken` ber-*epoch* (`fenceEpoch`).
3. **Write Fencing (Celah 1):** `ExecutionModeController` dan lapis ACG (`src/capability/`) menolak setiap operasi mutasi (`write_file`, `edit_file`, `run_command`) jika `tokenId` atau `fenceEpoch` bot pengirim tidak cocok dengan pemegang sah di `moderator_state.json`.
4. **Antrean Intervensi Prioritas (`MasterInterventionQueue` — Celah 6):** Mengurutkan intervensi paralel ke `MASTER` secara ketat:
   `P0: PrMasterFailover & PrBotGlobal` $\rightarrow$ `P1: PrIterasi` $\rightarrow$ `P2: PrDE` $\rightarrow$ `P3: PrMEend & PrGate` $\rightarrow$ `P4: PrModerator & PrTransfer` $\rightarrow$ `P5: PrBot`.

### 2.3 Protokol 7 — `PrTransfer` (*Last Work Position Log & Capability Token Transfer*)
1. **Muatan Wajib `send_message` Tugas:** Setiap pengiriman pesan tugas (estafet normal, handover `PrIterasi`, maupun migrasi `PrMEend`) wajib membawa `PrTransferEnvelope` berisi:
   - **`LastWorkPositionLog`:** `taskId`, `lastCompletedStep`, `pendingNextStep`, daftar `touchedFiles[]` (`CLEAN | PARTIAL_WIP | NEEDS_REVERT` lengkap dengan `checkpointPath`), dan `progressDeltaScore`.
   - **Transfer `CapabilityToken`:** Perpindahan atomik kepemilikan token hak dari pengirim ke penerima disertai kenaikan `fenceEpoch + 1`, sehingga bot pengirim otomatis kehilangan hak `EXCLUSIVE_WRITE` pada tugas tersebut (Celah 1).
2. **Pre-Task File Checkpointing (Celah 2):** Sebelum bot menyentuh berkas, kernel membuat salinan bayangan di `sessions/<id>/protocol/checkpoints/<taskId>/`. Bila `PrIterasi` melihat status `NEEDS_REVERT`/`PARTIAL_WIP` yang rusak, `MASTER` memulihkan berkas bersih sebelum model baru bekerja.
3. **Deteksi Estafet Melingkar Tanpa Progres (Celah 3):** Bersama `PrDE`, `PrTransfer` menghitung estafet beruntun dengan `progressDeltaScore === 0`. Bila melampaui `--pr-no-progress` (default `5`), loop langsung dialihkan ke mediasi `MASTER` meski `threadId` berubah.

### 2.4 Penguatan `PrIterasi` & `PrBotGlobal` (Celah 4 & Celah 5)
1. **Bot Recycling / Auto-Reaping (`PrBotGlobal` — Celah 4):** Saat `PrIterasi` mengalihkan tugas ke model baru, secara default sistem melakukan **Hot-Swap Model in-place** pada slot pekerja atau mematikan (*reap*) proses bot lama sebelum membuka bot pengganti agar kuota `activeGlobalBotCount` dan jendela OS tidak bocor.
2. **Single-Model Pool Fallback (`PrIterasi` — Celah 5):** Bila `modelPool` hanya berisi 1 model aktif, `PrIterasi` memakai urutan fallback: (1) model berbeda di `modelPool`, (2) model lain yang terautentikasi di `ModelCatalog`, (3) *Clean-Context & Master-Hint Handover* dengan peringatan HITL.

### 2.5 Protokol 9 & 10 — `PrGate` & `PrReattach` (Celah 7 & Celah 8)
1. **`PrGate` (`PrObjectiveGateProtocol` — Celah 7):** Gerbang verifikasi fisik deterministik sebelum `MASTER` diizinkan mengesahkan `TASK_0` pada `PrMEend` menjadi `GOAL_ACHIEVED` (memastikan 100% item `GoalLedger` berstatus `DONE`/`CANCELLED` dan semua `targetFiles[]` ada di disk dengan ukuran `> 0` byte).
2. **`PrReattach` (`PrSessionReattachProtocol` — Celah 8):** Saat sesi di-resume, kernel mencocokkan PID OS dan *heartbeat* di `bots.json`: bot anak yang masih hidup langsung di-*reattach* tanpa spawn duplikat, dan bot yang mati saat `IN_PROGRESS` otomatis di-*respawn* / haknya ditransfer ulang melalui `PrTransfer`.

---

## 3. Consequences

### Positif
- Seluruh siklus kerja tersusun atas **10 unit kelas protokol atomic (`IProtocol`)** yang dapat diuji unit secara terpisah, diaudit per `protocolId`, dan dipakai ulang lintas versi.
- Tidak ada lagi *zombie overwrite*, kerusakan berkas setengah jadi, estafet melingkar tanpa progres, jendela terminal ganda pasca-restart, maupun halusinasi penyelesaian `Tugas 0`.
- Beban `MASTER` tetap skalabel di armada besar berkat kemampuan mendelegasikan peran `PrModerator` kepada bot Moderator khusus.

### Konsekuensi Implementasi
- `ExecutionModeController`, `CapabilityPolicyEngine`, dan `MessagingService` wajib mengintegrasikan validasi `CapabilityToken` dan `PrTransferEnvelope`.
- Penyimpanan snapshot ringan `checkpoints/` harus dibersihkan otomatis (*auto-prune*) setelah `taskId` berstatus `DONE` agar tidak membengkak di disk.
