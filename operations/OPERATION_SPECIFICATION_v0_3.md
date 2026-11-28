# Spesifikasi Agentic Operation v0.3 (`almudaya.operation/v0.3`) — Dynamic Swarm Manifold Edition

## 1. Filosofi Dasar: `#Operation` sebagai *Dynamic Swarm Manifold*

Dalam arsitektur **Almudaya Multi-Agent (`v0.3.6+`)**, agen tidak diasumsikan sebagai daftar proses statis yang menyala sejak awal hingga akhir misi. Sebaliknya, agen pekerja dibentuk dan dimusnahkan secara *real-time* (*on-the-fly*), disinkronkan melalui `GoalLedger` dan *Session Blackboard*, serta dikendalikan oleh 10 kelas protokol atomik (`IProtocol`) dan *Agent Capability Governance* (ACG).

Oleh karena itu, **`#Operation` (`almudaya.operation/v0.3`)** didefinisikan sebagai **generator medan topologi dinamis (*Dynamic Swarm Manifold*)**:

- **`#Skill`**: Paket kapabilitas prosedural untuk agen tunggal (*bagaimana satu agen melakukan suatu tugas*).
- **`#Operation`**: Spesifikasi deklaratif, berversi, dan *governed* atas **potensi peran (*Role Archetypes*)**, batas interaksi, kontrak sumber daya, aturan perilaku (*OBS*), dan kriteria keberhasilan misi yang **membentuk topologi *swarm* secara dinamis saat *runtime*** tanpa mengunci sistem pada *predefined pipeline* yang kaku.

---

## 2. Model Formal & Reduksi Kontinum $L=1 \leftrightarrow L>1$

### 2.1 *Operation Definition* (`OD`) dan *Dynamic Operation Instance* (`OI(t)`)

Satu spesifikasi statis berversi dinyatakan sebagai tupel 10 komponen ortogonal (menghilangkan duplikasi antara slot agen statis dan peran):

$$OD = (I, M, R, T, C, W, B, Q, G, X)$$

| Simbol | Seksi Skema `v0.3` | Makna Konseptual |
|---|---|---|
| $I$ | `identity` | Identitas terregistrasi (`id`, `name`, `version`, `alias`, `tags`). |
| $M$ | `mission` | Objektif, ruang lingkup, *deliverables*, `acceptance_criteria`, serta kontrak `input_schema` dan `output_schema`. |
| $R$ | `manifold.roles` & `anti_affinity` | Himpunan *Role Archetypes* (bukan proses tetap), *Skill bindings*, hak akses tulis, ACG capabilities, kebijakan siklus hidup *ephemeral*, serta aturan pemisahan tugas (`anti_affinity`). |
| $T$ | `manifold.orchestration_regime`, `topology_shape`, `sub_operations`, `continuity`, `crystallization_policy` | Rezim pembentukan topologi (*emergent*, *blueprint_seeded*, *stage_gated*), relasi sub-manifold, aturan *role coalescing* ($L=1 \leftrightarrow L>1$), serta kristalisasi *on-the-fly*. |
| $C$ | `communication` | Protokol pesan (`almudaya.operation-message.v1`), saluran *Session Blackboard*, mekanisme *dead-end routing* (`PrMEend` & `PrDE`), dan *Blackboard ACL* baca/tulis per peran. |
| $W$ | `workflow` | Tahapan benih opsional (`seed_stages`, boleh kosong pada mode `emergent`) serta izin mutasi graf tugas secara dinamis (`allow_dynamic_task_mutation`). |
| $B$ | `behavior` | *Operational Behavior Specification* (OBS): `execution_mode`, pengikatan 10 parameter `IProtocol` (`protocol_bindings`), 4 cakupan *bounded loop* berpredikat DSL terstruktur (`PredicateExpr`), predikat terminasi, serta kebijakan *recovery* & *reassignment*. |
| $Q$ | `resources` | Kontrak sumber daya (`model`, `mcp_server`, `builtin_tool`, `storage`, `memory_service`, `external_api`), kebijakan *write-fencing* (`PrModerator`), isolasi *secrets*, serta batas `HardwareAdvisor`. |
| $G$ | `governance` | Prinsip *least privilege*, audit wajib, `dynamic_rules` (`DynamicRulesStore`), `hitl_gates`, tindakan terlarang, serta batas keamanan hierarki (`max_nesting_depth`, deteksi siklus). |
| $X$ | `integrations` (+ `observability`) | Adapter ke layanan platform nyata: `Session Blackboard`, `PKU` (*PKU-First*), `ACG`, `GoalLedger`, dan `MCP`. |

Saat dijalankan pada waktu $t$, sebuah *Operation Instance* dimodelkan sebagai konfigurasi dinamis:

$$OI(t) = \bigl(OD, \Theta, E(t), \Sigma(t), K(t)\bigr)$$

di mana $\Theta$ adalah parameter input tervalidasi, $E(t)$ lingkungan eksekusi saat $t$ (termasuk populasi bot hidup $B_t$ dan peta realisasi peran $\mu_t$), $\Sigma(t)$ adalah *state* eksekusi, dan $K(t)$ adalah *checkpoint* pemulihan (`TaskCheckpointManager` + `LastWorkPositionLog`).

### 2.2 Peta Realisasi Dinamis (*Dynamic Manifold Realization Map*)

Berbeda dari *v0.2* yang memperlakukan peran sebagai daftar agen statis, *runtime* memelihara pemetaan himpunan-bernilai (*set-valued dynamic map*) pada setiap langkah $t$:

$$\mu_t : R_{\text{active}}(t) \rightrightarrows B_t$$

di mana $R_{\text{active}}(t) \subseteq R$ adalah peran yang sedang dibutuhkan oleh tugas aktif di `GoalLedger` dan $B_t$ adalah himpunan proses bot aktif dalam sesi (`BOT000`, worker aktif, dsb.).

#### Proposisi 1 — Reduksi Degeneratif $L=1 \leftrightarrow L>1$ ke `#Skill`
Apabila `manifold.continuity.l1_single_agent_fallback = true`, tanpa pasangan `anti_affinity` bertipe `strict_distinct_bot` di antara peran wajib, serta tekanan tugas/perangkat keras tidak menuntut paralelisasi, maka untuk populasi minimal $|B_t| = 1$:

$$\mu_t(r) = \{b_0\} \quad \forall r \in R_{\text{active}}(t)$$

Dalam keadaan batas tersebut:
1. Seluruh `#Skill` aktif dikonsolidasikan pada satu bot $b_0$ (*Role Coalescing*).
2. Pesan antar-peran $C$ dan *write-fencing* tereduksi menjadi transisi internal dan pemeriksaan `PrGate` satu siklus ($L=1$).
3. Dengan demikian, eksekusi satu agen ber-`#Skill` merupakan **kasus khusus (*degenerate case*)** yang terhubung secara kontinu dengan *swarm* multi-agen ($L>1$). Saat kompleksitas atau kebutuhan independensi meningkat, manifold berekspansi secara *on-the-fly* ($|B_{t+1}| > 1$) melalui `SpawnManager`.

#### Invarian Pemisahan Tugas (*Anti-Affinity*)
Untuk setiap aturan $(r_i, r_j) \in \text{anti\_affinity}$:
- Jika `enforcement = "strict_distinct_bot"`, wajib berlaku $\mu_t(r_i) \cap \mu_t(r_j) = \emptyset$ (contoh: `developer` dan `reviewer`, atau `manuscript_writer` dan `citation_verifier` tidak boleh dijalankan oleh proses/konteks bot yang sama).
- Jika `enforcement = "epoch_reset_required"`, satu bot boleh berganti peran antara $r_i$ dan $r_j$ pada mode $L=1$ **hanya** setelah pembersihan konteks / pergantian `fenceEpoch` dan verifikasi ulang independen.

### 2.3 Siklus Hidup Agen *Ephemeral*
Setiap `RoleArchetype` memiliki blok `lifecycle`:
- `spawn_trigger`: kapan bot fisik untuk peran tersebut dilahirkan (`session_start`, `stage_activated`, `task_assigned`, `worker_request`, `gate_failure`).
- `recycle_eligible`: apakah *worker* yang menganggur dapat didaur ulang (`Action: RECYCLED` oleh `PrBotGlobal`) alih-alih meluncurkan proses OS baru.
- `dissolve_on`: kapan proses pekerja dimusnahkan atau dihentikan (*apoptosis*: `task_completed`, `stage_completed`, `idle_timeout`, `session_end`).
- `coalescable`: apakah peran boleh digabung ke bot lain saat *role coalescing* aktif (kecuali dilarang oleh `anti_affinity`).

---

## 3. Tiga Rezim Orkestrasi & Kristalisasi *On-the-Fly*

1. **`emergent` (*Pure Stigmergic Swarm*)**:
   - `workflow.seed_stages` boleh kosong (`[]`) dan `allow_dynamic_task_mutation = true`.
   - `#Operation` hanya menyediakan kompas misi, *role archetypes*, batas 10 protokol, `dynamic_rules`, dan gerbang `PrGate`. `BOT000` beserta *worker* membentuk sub-tugas secara adaptif dan memanggil `request_spawn_bot` hanya ketika spesialisasi dibutuhkan.
2. **`blueprint_seeded` (*Adaptive Manifold*)**:
   - `workflow.seed_stages` menyemai kerangka awal ke `GoalLedger` (`create_goal_blueprint`), tetapi graf tugas dan jumlah *worker* boleh bermutasi secara *real-time* ketika ditemukan hambatan (`PrIterasi`, `PrDE`, `PrMEend`).
3. **`stage_gated` (*Governed Phase Manifold*)**:
   - Tahap pada `seed_stages` bertindak sebagai gerbang fase yang diaudit ketat (misalnya pada *Research Pipeline*), sementara proses *worker* di dalam tiap tahap tetap *ephemeral* (lahir saat fase aktif, gugur saat fase usai).

**Sintesis & Kristalisasi *On-the-Fly*** (`crystallization_policy`): Ketika `allow_on_the_fly_synthesis = true`, `BOT000` dapat menyusun konfigurasi `#Operation` sementara di memori/sesi untuk misi baru yang belum terdefinisi, dan jika `crystallize_on_success = true` serta misi lulus `PrGate`, topologi beserta *role bindings* yang berhasil diekstrak menjadi definisi `almudaya.operation/v0.3` berversi baru di registry.

---

## 4. Spesifikasi Perilaku Operasional (OBS) Berbasis `PredicateExpr`

Untuk menghapus ilusi deklaratif dari predikat *string* bebas pada `v0.2`, seluruh kondisi `continuation_predicate`, `acceptance_predicate`, `rollback_predicate`, dan `termination.*` pada `v0.3` wajib menggunakan **AST `PredicateExpr`** ber-tipe di atas *namespace* state yang terdefinisi:

- **Operator Logika**: `all: [...]` (AND), `any: [...]` (OR), `not: <expr>`.
- **Atom Perbandingan (`PredicateAtom`)**:
  - `op`: `eq | neq | gt | gte | lt | lte | in`
  - `var`: jalur bertitik pada namespace tervalidasi (`ledger.*`, `protocol.*`, `budget.*`, `gate.*`, `artifact.*`, `candidate.*`, `accepted.*`, `error.*`, `child.*`)
  - Operand pembanding: tepat satu dari `value` (konstanta literal) atau `ref` (referensi ke jalur state lain, mis. `candidate.overall_score > accepted.overall_score`).

Setiap `LoopSpec` memisahkan secara tegas sumber umpan balik (`feedback_sources`) berdasarkan `kind: "role"` vs `kind: "resource_evaluator"`, sehingga ID *resource* (seperti VLM atau evaluator model) tidak lagi tertukar dengan ID *role* agen.

---

## 5. Keterikatan ke Primitif Nyata `Almudaya-Multi-Agent` (`v0.3.6`)

Rincian pemetaan kontrak ke *source code* di `src/protocol/`, `src/capability/`, `src/skills/`, `src/mcp/`, dan `src/memory_modules/` dijelaskan lengkap pada [shared/manifold-protocol-mapping.md](./shared/manifold-protocol-mapping.md) dan [shared/runtime-state-machine.md](./shared/runtime-state-machine.md).
