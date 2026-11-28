# Operation: Emergent Swarm Bug Hunt (`v0.3.0`)

**ID:** `almudaya.operation.emergent-bug-hunt` · **Regime:** `emergent` (`stigmergic`) · **Fallback:** `L=1 ↔ L>1`

Operation ini merepresentasikan pola **Pure Dynamic Swarm Manifold** tanpa `seed_stages` pradefinisi (`seed_stages: []`). `triage_lead` (`BOT000`) memulai eksekusi dan memutuskan secara *real-time*:
- Jika galat sederhana, manifold bertahan di **`L=1` (`running_l1`)** dengan *role coalescing*, di mana *anti-affinity* antara `patch_crafter` dan `regression_verifier` ditegakkan lewat *epoch/context reset* (`epoch_reset_required`).
- Jika reproduksi, perbaikan, atau verifikasi memerlukan isolasi penuh, *workers* (`reproducer`, `patch_crafter`, `regression_verifier`) dilahirkan *just-in-time* lewat `SpawnManager`, dilindungi token eksklusif `PrModerator`, dan mengalami *apoptosis* segera setelah `submit_task_handoff` tuntas.
- Jika konfigurasi swarm yang terbentuk di lapangan terbukti efektif, `crystallization_policy` mengizinkan hasil topologi dikristalisasikan menjadi `#Operation` baru di registry.
