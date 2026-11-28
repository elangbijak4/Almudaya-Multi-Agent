# Project Charter — Almudaya Multi-Agent v0.3.7 (Agentic Operation & Dynamic Swarm Manifold Engine)

**Versi Target:** `0.3.7`  
**Tanggal:** 2026-11-28  
**Metodologi:** Waterfall dengan Phase Gates eksplisit (`docs/docs_v0.3.7/`)

---

## 1. Misi
Menanamkan abstraksi **`#Operation` (`almudaya.operation/v0.3` — Dynamic Swarm Manifold Edition)** langsung ke mesin kolaborasi multi-proses **Almudaya Multi-Agent** sehingga pemilihan suatu `#Operation` mengonfigurasi 10 protokol atomik `IProtocol`, aturan dinamis (`DynamicRulesService`), hak kapabilitas (`ACG`), `SkillService`, `GoalLedger`, serta topologi *ephemeral* `SpawnManager` secara deklaratif dan *on-the-fly*.

## 2. Invarian Arsitektural
1. **Dynamic Swarm Manifold ($\mu_t : R_{\text{active}}(t) \rightrightarrows B_t$):** Peran di dalam `#Operation` adalah *Role Archetypes* yang direalisasikan secara dinamis (*just-in-time spawn*, *idle recycling*, *role coalescing*, dan *apoptosis*), bukan daftar proses bot statis.
2. **Kontinum $L=1 \leftrightarrow L>1$:** Apabila `l1_single_agent_fallback = true` tanpa pelanggaran `anti_affinity` bertipe `strict_distinct_bot`, satu bot (`BOT000` atau worker tunggal) dapat mengeksekusi misi dalam siklus tunggal dan berekspansi ke multi-bot swarm secara elastis jika beban/spesialisasi meningkat.
3. **Pemisahan Tugas (*Anti-Affinity*) & *Write-Fencing*:** Pasangan peran `strict_distinct_bot` (mis. `developer` vs `reviewer`) tidak pernah boleh digabung atau didaur ulang ke `bot_id` yang sama; penulisan berkas tetap dikunci oleh `PrModerator` `CapabilityToken` ber-`fenceEpoch` monotonik.
4. **Zero New Runtime Dependencies:** Modul `src/operation/` wajib berjalan murni menggunakan pustaka standar Node.js (`>=22.12.0`), `zod`, dan `commander` yang sudah terpasang.
5. **Kompatibilitas Penuh `v0.3.6`:** Sesi tanpa `#Operation` aktif tetap berjalan 100% identik dengan perilaku `v0.3.6`.

## 3. Ruang Lingkup `v0.3.7`
- Bundling katalog kanonik `operations/` (`almudaya.operation/v0.3`, 7 definisi tervalidasi termasuk 3 *sub-operations* hierarkis dan *PaperOrchestra Research Pipeline*).
- Implementasi paket inti `src/operation/` (`yaml-lite`, `schema`, `predicates`, `validator`, `registry`, `manifold-engine`).
- Integrasi dengan `SpawnManager`, `SkillService`, `goal-tools`, `master-tools`, `prompts`, `AutonomousAgentLoop`, CLI `almudaya operation` & `almudaya up --operation`, serta REPL `/operation`.
