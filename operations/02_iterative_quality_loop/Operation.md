# Operation: Iterative Software Quality Loop (`v0.3.0`)

**ID:** `almudaya.operation.looping` · **Regime:** `blueprint_seeded` (`hybrid`)

Operation ini menanamkan siklus kualitas perangkat lunak (`implement → test → review → evaluate`) ke dalam *Dynamic Swarm Manifold*:
- `workflow.seed_stages` menyemai kerangka `GoalLedger` awal, tetapi tetap mengizinkan mutasi tugas dinamis (`allow_dynamic_task_mutation: true`).
- `anti_affinity` bertipe `strict_distinct_bot` melarang `developer` dan `reviewer` digabung dalam satu proses/konteks bot (`l1_single_agent_fallback: false`).
- Seluruh predikat pengulangan (`implementation_feedback_cycle` & `task_retry`) dan penghentian menggunakan AST `PredicateExpr` deterministik di atas `gate.*`, `ledger.*`, `budget.*`, dan `error.*`.
