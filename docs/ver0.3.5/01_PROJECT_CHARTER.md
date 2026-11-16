# Project Charter — Almudaya Multi-Agent v0.3.5

**Project:** Almudaya Multi-Agent  
**Target Version:** 0.3.5  
**Package:** `almudaya-multiagent`  
**Baseline Codebase:** `v0.3.4` (commit `eacdb73`)  
**Status:** APPROVED DESIGN BASELINE (Ready for Implementation & Refactoring)  
**Date:** 2026-11-15  

---

## 1. Visi (Vision)

Mengangkat Almudaya Multi-Agent dari kerangka orkestrasi reaktif berbasis *prompt* menjadi **Mesin Pengembangan Perangkat Lunak Otonom Berdaulat (*Protocol-Oriented Autonomous Macro-Loop Engine*)** dengan kendali bawaan **Master Bot** dan **10 Butir Protokol Atomic (`IProtocol`)**: **`PrBot`**, **`PrBotGlobal`**, **`PrIterasi`**, **`PrDE`**, **`PrMEend`**, **`PrModerator`**, **`PrTransfer`**, **`PrMasterFailover`**, **`PrGate`**, dan **`PrReattach`**. Dengan visi ini, programmer cukup menyusun **Peta Pekerjaan (*Blueprint / Goal Ledger*)** beserta ambang batas protokol via baris perintah (CLI), lalu membiarkan ekosistem bot membangun, memindahkan hak kerja beserta log posisi terakhir secara aman, memeriksa konsistensi, memverifikasi hasil secara objektif, dan bereskcalasi ke manusia (*Human-in-the-Loop*) secara terstruktur bila batas tercapai.

---

## 2. Sasaran (Objectives)

1. **Aktivasi Master Bot Sejak Detik Pertama (`t = 0`):** Menyediakan entry-point terpadu (`almudaya up` / `start` / `master`) yang menyatukan konsol **Human-in-the-Loop (HITL)** dan **Master Bot (`BOT000`)** beserta rantai failover **`PrMasterFailover`**.
2. **Arsitektur Berbasis Butir Protokol Atomic (`IProtocol`):** Merealisasikan setiap pengaman dan tata kelola siklus kerja sebagai **kelas/antarmuka atomik (`IProtocol`)** di `src/protocol/protocols/` agar setiap protokol dapat dikonfigurasi, diuji unit, diaudit, dan digunakan ulang secara mandiri.
3. **Dukungan Mode Terminal Anak Ganda (`windows` Default vs `multiplexed`):** Membukakan **jendela terminal CLI baru** secara default bagi setiap bot pekerja (`--spawn-mode windows`), sekaligus menyediakan `--spawn-mode multiplexed`, `--max-windows`, serta pemulihan proses anak pasca-restart lewat **`PrReattach`**.
4. **Tata Kelola Bot & Plafon Global Berdaulat (`PrBot` & `PrBotGlobal`):** Mengatur persetujuan bot pekerja (default `10` via `PrBot`) sekaligus mengikat kapasitas global **termasuk Master Bot** berdasarkan spek laptop (`HardwareAdvisor`), anggaran token, batas waktu (`ms | infinite`), dan *Bot Recycling* agar slot aktif tidak bocor (`PrBotGlobal`).
5. **Arbitrase Hak Kerja & Transfer Tugas Berkelanjutan (`PrModerator` & `PrTransfer`):** Menjamin seluruh operasi workspace/komponen tunduk pada **Token Hak (`CapabilityToken` + `fenceEpoch`)** yang dikelola Penengah (**`PrModerator`**, dapat dipegang `MASTER` atau didelegasikan ke bot Moderator), serta mewajibkan setiap pengiriman pesan tugas (`send_message`) menyertakan **`LastWorkPositionLog`** dan **Transfer Token Hak** via **`PrTransfer`**.
6. **Ketahanan Kebuntuan, Anti-Deadlock & Gerbang Objektif (`PrIterasi`, `PrDE`, `PrMEend`, `PrGate`):** Mengalihkan bot macet lintas model (dengan *checkpoint* & *single-model fallback*), memediasi *ping-pong* maupun estafet melingkar tanpa progres, memigrasi pesan buntu, dan menjaga agar `Tugas 0` hanya disahkan setelah **`PrGate`** memverifikasi keterwujudan fisik file target di disk.
7. **Kedaulatan Konfigurasi CLI & Pemutus Sirkuit Biaya:** Memungkinkan programmer menyetel seluruh parameter ke-10 butir protokol, timeout, dan anggaran token langsung dari CLI dan slash commands.

---

## 3. Ukuran Keberhasilan (Success Measures)

1. `almudaya up -s S01 -w <dir>` otomatis menginisialisasi `BOT000` (`MASTER`) dan antarmuka HITL pada `t = 0`.
2. Mode `windows` membuka jendela CLI OS baru untuk bot anak, mode `multiplexed` mengalirkan log `[BOT00X]` ke konsol utama, dan `PrReattach` mencegah duplikasi jendela saat sesi dihidupkan ulang.
3. Setiap butir protokol dapat diinspeksi dan diuji unit secara terisolasi melalui antarmuka `IProtocol` (`10/10` protokol terdaftar di `ProtocolRegistry`).
4. Operasi tulis bot yang haknya telah dicabut (`fenceEpoch` usang) ditolak secara deterministik oleh kernel setelah `PrTransfer` atau handover `PrIterasi` (nol *zombie overwrite*).
5. `PrBot` (>10 bot), `PrBotGlobal` (RAM/token/waktu), `PrIterasi` (3x lintas-model + *fallback* + *checkpoint*), `PrDE` (10x ping-pong & *no-progress circular relay*), `PrMEend`, dan `PrGate` (tolak `Tugas 0` palsu) berjalan deterministik sesuai parameter CLI.
6. Seluruh pengujian *regression* `v0.3.4` (`437` tests) tetap lulus 100% ditambah suite protokol baru `v0.3.5`.

---

## 4. Prinsip Desain (Design Principles)

- **Atomic Protocol-First Architecture (`IProtocol`):** Setiap solusi siklus kerja dimodelkan sebagai kelas protokol atomic mandiri, bukan logika *if-else* ad-hoc yang tersebar.
- **Capability Token & Explicit Work Handoff:** Hak menyentuh file/komponen tidak bersifat bebas liar, melainkan dipegang lewat `CapabilityToken` dari `PrModerator` dan diestafetkan bersama `LastWorkPositionLog` lewat `PrTransfer`.
- **Kernel-Enforced Safety, AI-Driven Execution:** AI bebas berkolaborasi di dalam *Macro-Loop*, sementara batas jumlah bot, hak tulis, timeout, anggaran token, dan gerbang fisik `PrGate` ditegakkan TypeScript secara *fail-closed*.
- **Preserve v0.3.4 Foundations:** ACG Sandboxing (`src/capability/`), `ExecutionModeController` (`src/execution/`), PKU-First Reading, Secret Redaction, dan Auto-Compaction Outbox dipertahankan penuh dan diperkuat.

---

## 5. Batasan Cakupan v0.3.5 (Scope Boundaries)

### Dalam Cakupan (In Scope):
- Kontrak `IProtocol`, `ProtocolRegistry`, `MasterInterventionQueue`, dan **10 kelas protokol atomic** di `src/protocol/protocols/`.
- Unified Entrypoint `almudaya up` / `start` & `MasterHITLConsole`.
- `PrModerator` (`CapabilityToken`, *write fencing*, delegasi ke bot Moderator via `--moderator-bot`) dan integrasi dengan `src/execution/controller.ts` + `src/capability/`.
- `PrTransfer` (`PrTransferEnvelope`, `LastWorkPositionLog`, transfer `CapabilityToken`, pre-task `checkpoints/`, dan deteksi *no-progress circular relay*).
- `PrGate` (verifikasi fisik `targetFiles[]` & `GoalLedger`), `PrReattach` (rekonsiliasi PID saat resume), `PrBotGlobal` (hardware/token/waktu + *bot recycling*), `PrIterasi` (*cross-model* + *single-model fallback*), `PrDE`, `PrMEend`, dan `PrMasterFailover`.
- Tool baru (`request_spawn_bot`, `update_goal_task`, `submit_task_handoff`, `manage_dynamic_rule`, `delegate_moderator_role`, `issue_capability_token`, `migrate_stalled_message`, `mark_goal_achieved`).
- Flag CLI dan perintah slash `/protocol`, `/blueprint`, `/rules`, `/bots`, `/spawn-mode`, `/moderator`.

### Di Luar Cakupan (Out of Scope):
- GUI Web Dashboard / Electron Desktop App (tetap berbasis CLI/terminal).
- Eksekusi terdistribusi lintas jaringan TCP/gRPC antar mesin fisik berbeda (tetap multi-process lokal melalui Blackboard).
