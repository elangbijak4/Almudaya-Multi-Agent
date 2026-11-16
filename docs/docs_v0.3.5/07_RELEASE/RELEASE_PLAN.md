# Release Plan — Almudaya Multi-Agent v0.3.5

**Target Version:** `0.3.5`  
**Code Name:** *Autonomous Master Governance & Protocol-Oriented Macro-Loop Engine*  
**Tanggal Target Rilis:** TBA (Setelah Phase A–F Implementasi & Pengujian Lulus)  

---

## 1. Artefak Rilis Wajib
- Paket kode `src/protocol/` (`contracts.ts`, `registry.ts`, `checkpoint.ts`, serta 10 kelas protokol atomic di `src/protocol/protocols/`).
- Pembaruan `src/execution/controller.ts`, `src/capability/policy-engine.ts`, `src/bot/`, `src/ai/`, `src/messaging/`, `src/tools/`, dan `src/cli/commands/up.ts`.
- Bump versi ke `0.3.5` pada `package.json`, `src/core/version.ts`, dan `tests/cli.test.ts`.
- Pembaruan `README.md`, `USER_MANUAL.md`, `USER_GUIDE.md`, dan `USER_TUTORIAL.md` agar mencakup `almudaya up`, `MASTER` + HITL Console, ke-10 butir protokol atomic (`PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrMasterFailover`, `PrGate`, `PrReattach`), delegasi Moderator, serta mode `--spawn-mode windows|multiplexed`.

---

## 2. Release Go / No-Go Checklist

| No | Kriteria Kesiapan Rilis | Wajib Lulus |
|---:|---|:---:|
| 1 | `MASTER` (`BOT000`) aktif otomatis saat `almudaya up` pada `t = 0` dan menyatu dengan konsol HITL | ✅ |
| 2 | Mode spawn default `windows` membuka CLI terpisah per bot, `multiplexed` menyatukan log, & `PrReattach` mencegah duplikasi saat restart | ✅ |
| 3 | Seluruh 10 kelas protokol mengimplementasikan antarmuka atomic `IProtocol` & teruji unit mandiri (`TC-350-01`..`TC-350-20`) | ✅ |
| 4 | `PrModerator` (`CapabilityToken` + `fenceEpoch` + antrean `P0..P5` + delegasi) & `PrTransfer` (`LastWorkPositionLog` + *checkpoints* + transfer token) mencegah *zombie overwrite* & estafet tanpa progres | ✅ |
| 5 | `PrGate` memverifikasi berkas target fisik di disk sebelum `Tugas 0` (`PrMEend`) mengakhiri Macro-Loop | ✅ |
| 6 | Seluruh batas protokol (termasuk `--global-timeout infinite`, spek hardware laptop, `--pr-no-progress`, `--moderator-bot`) dapat dikustomisasi via CLI | ✅ |
| 7 | Nol regresi terhadap `v0.3.4` (`437` tests, ACG Sandbox, PKU-First Reading, Auto-Compaction, Multi-Provider AI) & `npm run build` / `npm test` lulus 100% | ✅ |
