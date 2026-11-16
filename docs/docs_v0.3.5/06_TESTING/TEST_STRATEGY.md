# Test Strategy — Almudaya Multi-Agent v0.3.5

**Versi:** 0.3.5  
**Framework:** Vitest (`npm test`) — 100% Offline Deterministic Verification  

---

## 1. Tujuan Pengujian
Memastikan seluruh **10 Butir Protokol Atomic (`IProtocol`)** (`PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrMasterFailover`, `PrGate`, `PrReattach`), `MasterInterventionQueue`, Macro-Loop, dan Dual Spawn Mode teruji deterministik tanpa ketergantungan jaringan eksternal, sekaligus menjamin **nol regresi** pada `437` test `v0.3.4`.

---

## 2. Matriks Skenario Pengujian Baru (`TC-350-01` s/d `TC-350-20`)

| Test ID | Berkas Uji Target | Skenario Kunci yang Harus Diuji |
|---|---|---|
| **TC-350-01** | `tests/master/master-startup.test.ts` | Startup `almudaya up` langsung mendaftarkan `BOT000` (`MASTER`) + konsol HITL; proses gabung belakangan otomatis jadi `WORKER`. |
| **TC-350-02** | `tests/protocol/dynamic-rules.test.ts` | Penambahan, penonaktifan, & injeksi `dynamic_rules.json` ke prompt bot pada giliran berikutnya. |
| **TC-350-03** | `tests/protocol/spawn-manager.test.ts` | Pembentukan perintah OS mode `windows` (Win/Mac/Linux), streaming log berlabel `[BOT00X]` pada `multiplexed`, auto-switch `--max-windows`, & deteksi CI headless. |
| **TC-350-04** | `tests/protocol/pr-bot.test.ts` | Persetujuan otonom bot 1..N (`<= prBotLimit`), penahanan bot ke-(N+1) + dialog HITL, & custom CLI `--pr-bot 3`. |
| **TC-350-05** | `tests/protocol/pr-iterasi.test.ts` | Pemicuan `PrIterasi` oleh iterasi/timeout/`402`, pengalihan ke model berbeda A $\rightarrow$ B $\rightarrow$ C maks 3x lalu `BLOCKED_HITL`, serta **Single-Model Pool Fallback** ketika pool hanya berisi 1 model. |
| **TC-350-06** | `tests/e2e/macro-loop-lifecycle.test.ts` | **Simulasi End-to-End Penuh:** HITL $\rightarrow$ `MASTER` + Builder + Consistency Inspector + Critic dalam `multiplexed` $\rightarrow$ `PrModerator` terbitkan token $\rightarrow$ `PrTransfer` estafet + 1x `PrIterasi` handover + 1x `PrDE` + `PrGate` validasi fisik disk $\rightarrow$ `GOAL_ACHIEVED`. |
| **TC-350-07** | `tests/protocol/pr-de.test.ts` | Ping-pong `1..prDeLimit` berjalan bebas, pesan ke-(N+1) dicegat ke mediasi `MASTER`, dan eskalasi HITL setelah pemicuan ke-(prDeEscalationLimit+1). |
| **TC-350-08** | `tests/ai/master-failover.test.ts` | **`PrMasterFailover`:** `FailoverAIProvider` berpindah otomatis saat HTTP `402` atau timeout bagi `MASTER` maupun Moderator delegasi, dan status `PAUSED_MASTER_UNAVAILABLE` bila seluruh rantai gagal. |
| **TC-350-09** | `tests/cli/protocol-cli.test.ts` | Parsing seluruh flag CLI `almudaya up` (ke-10 protokol, `--moderator-bot`, `--pr-no-progress`, `--pr-gate`, `--pr-reattach`) dan perintah slash `/protocol`, `/blueprint`, `/rules`, `/bots`, `/spawn-mode`, `/moderator`. |
| **TC-350-10** | `tests/protocol/budget-tracker.test.ts` | Akumulasi `tokenBudget`, `taskTimeoutMs`, `threadTimeoutMs` memicu transisi protokol terkait. |
| **TC-350-11** | `tests/protocol/pr-me-end.test.ts` | `ccMaster: true` otomatis tanpa menambah counter `PrDE`; Lapis-1 0-token lolos pesan sah; penerima `UNKNOWN`/hilang memicu migrasi/spawn `MASTER`; `TASK_0` prematur ditolak. |
| **TC-350-12** | `tests/protocol/pr-bot-global.test.ts` | Plafon **`PrBotGlobal`** mengikat seluruh bot termasuk `MASTER` berdasarkan spek `HardwareAdvisor`, token budget, & waktu global; verifikasi `--global-timeout infinite`. |
| **TC-350-13** | `tests/protocol/pr-bot-global.test.ts` | **Bot Recycling / Auto-Reaping:** Pengalihan `PrIterasi` mendaur ulang slot/proses bot gagal tanpa menaikkan `activeGlobalBotCount` atau membuka jendela *zombie*. |
| **TC-350-14** | `tests/protocol/protocol-registry.test.ts` | **`IProtocol` Contract & Registry:** Ke-10 kelas protokol terdaftar, dapat di-`configure()`, `evaluate()`, `enforce()`, dan `getStateSnapshot()` secara mandiri & terisolasi. |
| **TC-350-15** | `tests/protocol/pr-moderator.test.ts` | **`CapabilityToken` Write Fencing:** Bot lama dengan `fenceEpoch` usang ditolak oleh `ExecutionModeController` saat mencoba `write_file`/`edit_file` (*no zombie overwrite*); uji delegasi `--moderator-bot` & `reclaim`. |
| **TC-350-16** | `tests/protocol/pr-moderator.test.ts` | **`MasterInterventionQueue` Priority Order:** Event paralel `P5` (`PrBot`), `P3` (`PrMEend`), `P1` (`PrIterasi`), dan `P0` (`PrBotGlobal`) diproses berurutan ketat `P0 -> P1 -> P3 -> P5`. |
| **TC-350-17** | `tests/protocol/pr-transfer.test.ts` | **Mandatory `PrTransferEnvelope` & Checkpoint Revert:** Estafet pesan tugas tanpa `LastWorkPositionLog` / token transfer ditolak; pemindahan token menaikkan `fenceEpoch + 1`; status `NEEDS_REVERT` memulihkan snapshot dari `checkpoints/`. |
| **TC-350-18** | `tests/protocol/pr-transfer.test.ts` | **Zero-Progress Circular Relay Detection:** Estafet melingkar `A -> B -> C -> A` (ganti `threadId`) dengan `progressDeltaScore === 0` sebanyak `--pr-no-progress` berturut-turut dicegat ke mediasi `PrDE`. |
| **TC-350-19** | `tests/protocol/pr-gate.test.ts` | **`PrGate` Objective Gate:** Klaim `TASK_0` ditolak secara deterministik jika ada file di `GoalLedger.targetFiles[]` yang belum ada di disk atau `0` byte, dan lolos hanya jika seluruh berkas & tugas `DONE`. |
| **TC-350-20** | `tests/protocol/pr-reattach.test.ts` | **`PrReattach` Recovery:** Simulasi restart sesi dengan PID aktif dan PID mati: proses hidup di-*reattach* tanpa spawn duplikat; tugas `IN_PROGRESS` dari PID mati di-*respawn* aman. |

---

## 3. Kriteria Kelulusan (*Exit Criteria Verification*)
1. `npm run build` (`tsc`) lulus tanpa error atau warning strict mode.
2. `npm test` (`vitest run`) lulus 100% (`437` test regresi `v0.3.4` + seluruh skenario `TC-350-01`..`TC-350-20`).
3. Uji asap CLI nyata (`node dist/cli/bin.js up --help`) menampilkan seluruh flag ke-10 protokol dan default `--spawn-mode windows`.
