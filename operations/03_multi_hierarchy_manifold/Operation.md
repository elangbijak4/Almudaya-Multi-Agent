# Operation: Multi-Hierarchical Research & Delivery Manifold (`v0.3.0`)

**ID:** `almudaya.operation.multi-hierarchy` · **Regime:** `blueprint_seeded` (`sub_manifold`)

Parent Operation ini membentuk *hierarchical sub-manifold* yang mendelegasikan kursi `PrModerator` (`delegate_moderator: true`) serta mempartisi total anggaran (`30%` + `35%` + `25%`, sisanya `10%` cadangan parent) ke tiga child Operation konkret:
1. [`almudaya.operation.research-branch`](./sub_operations/research_branch/operation.yaml) (`v1.0.0`)
2. [`almudaya.operation.technical-assessment`](./sub_operations/technical_assessment/operation.yaml) (`v1.0.0`)
3. [`almudaya.operation.integration-quality-gate`](./sub_operations/integration_quality_gate/operation.yaml) (`v1.0.0`)

Setiap pertukaran data antar parent dan child diverifikasi secara statis maupun runtime menggunakan kontrak `input_mapping`, `output_mapping`, `schemas/input.schema.json`, dan `schemas/output.schema.json`.
