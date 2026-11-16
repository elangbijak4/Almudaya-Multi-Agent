# Data Flows & Protocol State Machines — Almudaya Multi-Agent v0.3.5

Dokumen ini memvisualisasikan alur data dan transisi status untuk Startup `MASTER`, Macro-Loop, serta interaksi ke-10 Butir Protokol Atomic (`PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrMasterFailover`, `PrGate`, `PrReattach`).

---

## 1. Alur Startup & Peluncuran Bot Anak (`t = 0` + `PrReattach`)

```mermaid
sequenceDiagram
    actor HITL as Programmer (HITL)
    participant CLI as almudaya up CLI
    participant REAT as PrReattach
    participant MASTER as MASTER Bot (BOT000)
    participant BB as Session Blackboard
    participant SPAWN as SpawnManager

    HITL->>CLI: almudaya up -s S01 -w D:\Project --pr-bot 10 --spawn-mode windows
    CLI->>REAT: Cek apakah sesi S01 sudah ada & ada PID bot hidup
    alt Sesi Baru
        CLI->>BB: Simpan protocol/config.json, moderator_state.json, & BOT000 (MASTER)
    else Resume Sesi Pasca-Restart
        REAT->>BB: Audit PID & heartbeat di bots.json
        REAT-->>SPAWN: Reattach proses hidup (tanpa spawn ganda) & respawn task IN_PROGRESS yang mati
    end
    CLI->>MASTER: Aktifkan Master AI Brain + PrMasterFailover
    CLI-->>HITL: Tampilkan Unified Console Prompt: "HITL [MASTER]>"

    HITL->>MASTER: Kirim Peta Pekerjaan (Blueprint + targetFiles)
    MASTER->>BB: Tulis goal_ledger.json & dynamic_rules.json
    MASTER->>SPAWN: Spawn BOT001 (Builder), BOT002 (Consistency/QA) + Terbitkan CapabilityToken (PrModerator)
    alt spawnMode === "windows" (Default)
        SPAWN-->>HITL: Buka Jendela Terminal OS Baru untuk BOT001 & BOT002
    else spawnMode === "multiplexed"
        SPAWN-->>MASTER: Jalankan proses child dengan log terlabel di Konsol Utama
    end
```

---

## 2. Alur Protokol 1 — `PrBot` (Approval Pembuatan Bot Baru + `PrBotGlobal`)

```mermaid
flowchart TD
    W["Worker Bot memanggil tool:<br/>request_spawn_bot(name, role, reason)"] --> CHK1["Evaluasi PrBotGlobal:<br/>Cek Spek HardwareAdvisor, Token Budget, Waktu Global"]
    CHK1 -->|Melanggar Plafon Global| HITL["⏸️ PrBotGlobal Breach -> Eskalasi HITL"]
    CHK1 -->|Lolos Plafon Global| CHK2{"totalSpawnedBots < prBotLimit ?<br/>(Default: < 10)"}
    CHK2 -->|Tidak: >= prBotLimit| HITL2["⏸️ Eskalasi ke HITL:<br/>Batas PrBot Terlampaui (10/10)<br/>Pilih: Setujui(+N) / Tolak / Recycle Bot Idle"]
    CHK2 -->|Ya| EVAL["👑 MASTER Evaluasi Kelayakan & Pilih Model"]
    EVAL -->|Ditolak Master| REJ["Kembalikan Alasan Penolakan ke Worker Bot"]
    EVAL -->|Disetujui Master| INC["Counter PrBot += 1<br/>PrModerator terbitkan CapabilityToken awal<br/>Catat di protocol/events.jsonl"]
    INC --> LAUNCH["SpawnManager: Jalankan Bot Baru<br/>(Mode 'windows' atau 'multiplexed')"]
    HITL2 -->|HITL Menyetujui| INC
    HITL2 -->|HITL Menolak| REJ
```

---

## 3. Alur Protokol 2 — `PrIterasi` (Cross-Model Handover + Write Fencing + Checkpoint)

```mermaid
sequenceDiagram
    participant B1 as BOT001 (Model A)
    participant MOD as PrModerator
    participant TRF as PrTransfer
    participant K as PrIterasi
    participant M as MASTER (BOT000)
    participant B2 as BOT_NEXT (Model B != A / Recycled)
    actor HITL as Programmer (HITL)

    loop ReAct Micro-Loop (Task T-01)
        B1->>K: Cek iterasi, taskTimeoutMs, tokenBudget, status HTTP (402/429)
    end

    Note over B1,K: Terpicu! iteration >= prIterasiLimit (10) ATAU timeout ATAU kuota/402
    K->>MOD: Naikkan fenceEpoch (+1) & cabut CapabilityToken B1 (cegah zombie overwrite)
    K->>M: Masuk MasterInterventionQueue [Priority P1: PR_ITERASI_TRIGGERED]

    alt handoverCount < prIterasiHandoverLimit (Default: < 3)
        M->>TRF: Baca LastWorkPositionLog & status checkpoint T-01
        opt Berkas rusak parsial (NEEDS_REVERT)
            TRF->>TRF: Pulihkan file dari checkpoints/T-01/
        end
        M->>M: Pilih Model B (pool berbeda -> katalog -> single-model fallback)
        M->>K: handoverCount += 1; triedModels.push(B); Bot Recycling pada slot B1
        M->>TRF: Transfer T-01 + CapabilityToken (epoch baru) ke B2 via PrTransferEnvelope
    else handoverCount >= prIterasiHandoverLimit (Sudah 3x Gagal)
        M->>K: Set Task T-01 = BLOCKED_HITL
        M-->>HITL: Eskalasi Interaktif: "T-01 gagal setelah 3 percobaan. Putuskan aksi!"
    end
```

---

## 4. Alur Macro-Loop & Protokol 3 — `PrDE` (Ping-Pong & Circular Relay Detection)

```mermaid
flowchart TD
    MSG["Bot A mengirim pesan ke Bot B<br/>(threadId, exchangeCount, PrTransferEnvelope)"] --> INC["exchangeCount += 1<br/>Cek progressDeltaScore (PrTransfer)"]
    INC --> CIR{"noProgressHandoffCount >= prNoProgressLimit ?<br/>(Circular Relay A->B->C->A, Default: 5)"}
    CIR -->|Ya: Estafet Muter Tanpa Progres| HOLD
    CIR -->|Tidak| CHECK{"exchangeCount <= prDeLimit ?<br/>(Default: <= 10)<br/>& Thread Timeout/Token OK ?"}
    CHECK -->|Ya| DELIVER["Kirim ke Inbox Bot B<br/>(Macro-Loop Berlanjut)"]
    CHECK -->|Tidak: > 10 atau Timeout/Token| HOLD["Kernel Tahan Pesan -> Antrean P2 PrModerator<br/>prDeTriggerCount += 1"]
    HOLD --> CAP{"prDeTriggerCount <= prDeEscalationLimit ?<br/>(Default: <= 10)"}
    CAP -->|Tidak: > 10 kali PrDE| HITL["⏸️ Eskalasi ke HITL:<br/>Jalan Buntu Berulang (>10x PrDE)"]
    CAP -->|Ya| JUDGE["👑 MASTER Evaluasi Transkrip & LastWorkPositionLog"]
    JUDGE -->|Putusan 1| ACT1["STOP_THREAD:<br/>Hentikan diskusi & kunci rule di dynamic_rules.json"]
    JUDGE -->|Putusan 2| ACT2["REASSIGN_TASK:<br/>Alihkan tugas via PrTransfer ke Bot lain"]
    JUDGE -->|Putusan 3| ACT3["SPAWN_SPECIALIST:<br/>Lahirkan Bot penengah baru via PrBot + PrBotGlobal"]
```

---

## 5. Siklus Hidup Status Tugas di Goal Ledger (Macro-Loop + `PrGate`)

```mermaid
stateDiagram-v2
    [*] --> PENDING: MASTER mengurai Peta Pekerjaan (Blueprint)
    PENDING --> IN_PROGRESS: Ditugaskan + PrModerator terbitkan CapabilityToken + Snapshot Checkpoint
    IN_PROGRESS --> HANDOVER_WAIT: Terpicu PrIterasi (< 3x), fenceEpoch naik
    HANDOVER_WAIT --> IN_PROGRESS: PrTransfer + Model AI berbeda (atau Checkpoint Revert)
    IN_PROGRESS --> PEER_REVIEW: Estafet PrTransfer ke Consistency/QA Bot
    PEER_REVIEW --> REVISION: Ditemukan inkonsistensi / peluang perbaikan
    REVISION --> IN_PROGRESS: Perbaikan berdasarkan LastWorkPositionLog & PKU
    PEER_REVIEW --> DONE: Lolos Konsistensi & Acceptance Criteria
    IN_PROGRESS --> BLOCKED_HITL: PrIterasi >= 3x gagal / PrBot / PrBotGlobal / PrDE >= 10x
    BLOCKED_HITL --> IN_PROGRESS: HITL memberi arahan / reset kuota
    BLOCKED_HITL --> CANCELLED: HITL membatalkan sub-tugas
    DONE --> GOAL_ACHIEVED: PrMEend Tugas 0 lolos verifikasi fisik PrGate 100%
```

---

## 6. Alur Protokol `PrMEend`, `PrTransfer`, & Gerbang Objektif `PrGate`

```mermaid
flowchart TD
    DONE["Bot menyelesaikan giliran / tugas<br/>Kirim Pesan Lanjutan + CC: MASTER"] --> TRF{"PrTransfer Validation:<br/>Ada LastWorkPositionLog & Transfer CapabilityToken?"}
    TRF -->|Tidak Lengkap saat Task Handoff| REJ_TRF["Tolak & Minta Bot Lengkapi LastWorkPositionLog / Hak"]
    TRF -->|Lengkap| EX["Eksekusi Perpindahan Token (fenceEpoch + 1) & Simpan Checkpoint"]
    EX --> S1{"Inspeksi Lapis-1 PrMEend (Nol Token)<br/>1. Penerima valid & aktif?<br/>2. BUKAN TASK_0?<br/>3. Bukan Circular Relay Tanpa Progres?"}
    S1 -->|Lolos Semua| PASS["Teruskan normal ke Inbox penerima"]
    S1 -->|Tidak ada pesan / Recipient UNKNOWN| S2A["Antrean P3 -> Bangunkan MASTER (Lapis-2):<br/>Evaluasi Konteks & Daftar Bot"]
    S1 -->|Pesan bertanda TASK_0| GATE["Jalankan PrGate (Verifikasi Fisik Disk):<br/>1. Semua GoalLedger = DONE?<br/>2. Semua targetFiles[] ada & > 0 byte?"]
    GATE -->|Gagal PrGate| REJ_G["Tolak TASK_0 Otomatis! Kembalikan daftar file/tugas kurang ke MASTER"]
    GATE -->|Lulus PrGate| S2B["MASTER Konfirmasi Akhir (Lapis-2 AI):<br/>Tetapkan GOAL_ACHIEVED & Hentikan Macro-Loop"]
    S2A -->|Ada bot cocok| MIG["Migrasi Tugas + PrTransferEnvelope ke Bot tepat"]
    S2A -->|Belum ada spesialis| SPW["Spawn Bot Baru (Cek PrBot + PrBotGlobal)"]
```

---

## 7. Alur Protokol `PrBotGlobal` (Membatasi Semua Bot Termasuk `MASTER`)

```mermaid
flowchart TD
    REQ["Upaya Kelahiran Bot Baru<br/>(Worker via PrBot ATAU MASTER via PrIterasi/PrDE/PrMEend)"] --> REC{"Apakah dari Handover PrIterasi &<br/>bisa Hot-Swap / Bot Recycling in-place?"}
    REC -->|Ya & Diizinkan| REUSE["♻️ Daur Ulang Slot Bot Gagal (Nol Kenaikan Active Bot & Jendela)"]
    REC -->|Tidak / Perlu Bot Baru| G1{"1. Cek Spek Laptop/Hardware (HardwareAdvisor)<br/>ActiveBots < hardwareMax & RAM Bebas >= Min?"}
    G1 -->|Melebihi Kapasitas| HITL["⏸️ Antrean P0 PrBotGlobal Breach!<br/>Tahan Kelahiran Bot & Lapor HITL"]
    G1 -->|Aman| G2{"2. Cek Anggaran Token Sesi<br/>tokenUsed < tokenBudget ?"}
    G2 -->|Habis / Kritis| HITL
    G2 -->|Aman| G3{"3. Cek Batas Waktu Global<br/>globalTimeoutMs === 'infinite' OR elapsed <= globalTimeoutMs ?"}
    G3 -->|Waktu Habis| HITL
    G3 -->|Aman| OK["✅ Lolos Plafon PrBotGlobal -> Lanjutkan SpawnManager"]
```

---

## 8. Alur Protokol `PrModerator` — Antrean Prioritas P0–P5 & Delegasi Penengah

```mermaid
flowchart LR
    subgraph PARALEL["Event Paralel dari Jendela Anak (BOT001..BOT00N)"]
        E0["PrMasterFailover / PrBotGlobal"]
        E1["PrIterasi Triggered"]
        E2["PrDE DeadEnd"]
        E3["PrMEend / PrGate"]
        E4["PrModerator / PrTransfer Token"]
        E5["PrBot Spawn Proposal"]
    end

    PARALEL --> Q["MasterInterventionQueue (Serialized Priority Queue)<br/>Urutan Eksekusi: P0 -> P1 -> P2 -> P3 -> P4 -> P5"]

    subgraph MOD["Jabatan PrModerator"]
        M1["Default: MASTER (BOT000)"]
        M2["Delegasi Opsional: BOT_MOD (--moderator-bot)"]
    end

    Q --> MOD
    MOD -->|Terbitkan / Naikkan fenceEpoch| CAP["moderator_state.json<br/>(CapabilityToken Registry)"]
    CAP --> CHK["ExecutionModeController & ACG Policy Engine:<br/>Validasi tokenId + fenceEpoch setiap write_file/edit_file/run_command"]
```
