# Runtime State Machine `Operation Instance` (`v0.3`)

## Siklus Hidup Instans & Transisi Legal

`OI(t) = (OD, Θ, E(t), Σ(t), K(t))` berevolusi melalui himpunan status berikut (selaras dengan `ProtocolRuntimeStateSchema.macroLoopStatus` di `almudaya-multiagent` serta siklus hidup kontrak Operation):

```text
draft ──▶ validated ──▶ resolving ──▶ ready
                                       │
          ┌────────────────────────────┴────────────────────────────┐
          ▼ (L=1 fallback / single bot)                             ▼ (swarm expanded)
     running_l1 ◀────────── scale-out / coalesce ──────────▶ running_swarm
          │                                                         │
          ├──── HITL gate / approval ──▶ paused_hitl ◀──────────────┤
          ├──── Master 402/429/5xx ────▶ paused_master_unavailable ─┤
          │                                                         │
          ▼                                                         ▼
   succeeded | partial | failed | cancelled | expired | terminated_by_guard
          │
          ├── (crystallization_policy.crystallize_on_success) ──▶ crystallized
          ▼
       archived
```

## Semantik Transisi Kunci
1. **`running_l1 ↔ running_swarm`**: Transisi elastis *Dynamic Swarm Manifold*. Ketika bot awal (`BOT000` atau worker tunggal) memicu `request_spawn_bot` atau `GoalLedger` menumbuhkan tugas baru dengan `anti_affinity`, status bertransisi ke `running_swarm`. Sebaliknya, ketika *worker* mengalami *apoptosis* dan tugas tersisa ditangani oleh satu agen tunggal tanpa pelanggaran `anti_affinity`, manifold menyusut tanpa *restart* sesi.
2. **`paused_hitl` & `paused_master_unavailable`**: Keduanya memetakan ke status `PAUSED_HITL` dan `PAUSED_MASTER_UNAVAILABLE` di `ProtocolRuntimeStateSchema`, menjaga seluruh `CapabilityToken`, `fenceEpoch`, dan `TaskCheckpoint` tetap utuh hingga operator atau *failover chain* memulihkan eksekusi.
3. **`terminated_by_guard`**: Dipicu ketika batas `PrBotGlobal` (memori/CPU/`tokenBudget`/`globalTimeoutMs`), `max_iterations`, `no_progress_limit`, atau pelanggaran aturan `HARD_STOP` tercapai.
4. **`crystallized`**: Status opsional khusus bagi `#Operation` yang dirakit secara *on-the-fly* dan berhasil lulus `PrGate`, menandakan definisi baru telah diekstrak ke Registry untuk dipakai ulang di masa depan.
