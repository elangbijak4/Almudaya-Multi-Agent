# ADR-370: Agentic Operation (`v0.3`) sebagai Engine Dynamic Swarm Manifold

**Status:** Approved & In Implementation  
**Tanggal:** 2026-11-28  
**Konteks:** Integrasi `#Operation` (`almudaya.operation/v0.3`) ke `Almudaya-Multi-Agent` (`v0.3.7`).

---

## 1. Masalah yang Dipecahkan
Pada `v0.3.6`, konfigurasi protokol (`PrBot`, `PrBotGlobal`, `PrIterasi`, `PrDE`, `PrMEend`, `PrModerator`, `PrTransfer`, `PrGate`), batas anggaran token, *capability presets*, dan *skill bindings* harus dirangkai manual per sesi lewat argumen CLI atau perintah `BOT000`. Sementara itu, spesifikasi `#Operation` (`v0.1`–`v0.2`) awalnya bersifat pasif (*non-executable scaffold*) dan belum memodelkan pembentukan serta pemusnahan agen secara *on-the-fly*.

## 2. Keputusan Arsitektur
1. **Dynamic Swarm Manifold Map ($\mu_t : R_{\text{active}}(t) \rightrightarrows B_t$):**  
   `manifold.roles` diperlakukan sebagai **Role Archetypes** yang direalisasikan saat runtime ketika peran dibutuhkan oleh `SpawnManager` dan dilepaskan (*apoptosis*) oleh `goal-tools.ts` saat tugas selesai.
2. **Kontinum $L=1 \leftrightarrow L>1$:**  
   `OperationInstanceState.status` bertransisi dinamis antara `running_l1` dan `running_swarm` berdasarkan jumlah bot unik yang sedang merealisasikan peran.
3. **Penegakan `anti_affinity` pada Daur Ulang Bot Idle:**  
   `OperationManifoldService` menyimpan `botRoleBindings` historis per sesi. Ketika `PrBotGlobal` menawarkan kandidat daur ulang bot `idle` (`recycleCandidateBotId`), `SpawnManager` memeriksa apakah kandidat tersebut pernah menjalankan peran yang bertentangan dengan aturan `strict_distinct_bot`. Jika bertentangan, `SpawnManager` memilih bot idle aman lainnya atau menumbuhkan proses bot baru yang terpisah konteksnya, sehingga isolasi audit (`developer` vs `reviewer`, `manuscript_writer` vs `quality_refiner`) tetap terjaga 100%.
4. **Zero-Dependency `yaml-lite` + Bundled Catalog (`operations/`):**  
   Alih-alih menambah dependensi parser YAML eksternal, diimplementasikan `src/operation/yaml-lite.ts` teruji penuh untuk mendukung JSON dan YAML 1.2 terindentasi secara deterministik.
5. **Logical Skill Bindings di `SkillService`:**  
   Peran dalam `#Operation` dapat mendeklarasikan *logical skills* (`task-decomposition`, `code-review`, dll.) selain paket AVDS penuh di `skill/`. Flag `allowLogicalSkill` pada `SkillService.enableSkill` mengizinkan pengikatan skill deklaratif masuk ke `skills.json` dan *system prompt* bot tanpa mewajibkan direktori `SKILL.md` fisik untuk setiap skill logis.

## 3. Konsekuensi
- Pengembang dan operator dapat memilih organisasi misi yang utuh dan tervalidasi cukup dengan `almudaya up --operation <id>` atau `/operation apply <id>`.
- Topologi swarm tetap adaptif (*on-the-fly* spawn/recycle/apoptosis, mutasi `GoalLedger`, serta sintesis + kristalisasi ad-hoc), namun tetap terikat pagar keselamatan 10 `IProtocol`, `ACG`, dan `PrModerator`.
