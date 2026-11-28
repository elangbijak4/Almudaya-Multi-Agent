# Operation: Research Pipeline (`v0.3.0`)

**ID:** `almudaya.operation.research-pipeline` · **Alias:** `#Operation-researchPipeline` · **Regime:** `stage_gated` (`hybrid` / `composite`)

Konversi deklaratif *PaperOrchestra* ke dalam standar **`almudaya.operation/v0.3`**:
- 8 *Role Archetypes* dengan proses *ephemeral* per tahap (`stage_activated → stage_completed`) dan pemisahan ketat (`anti_affinity: strict_distinct_bot`) antara `manuscript_writer` melawan `citation_verifier` dan `quality_refiner`.
- Pemisahan tegas antara sumber umpan balik berjenis `role` (`quality_refiner`) dan `resource_evaluator` (`visual_critic`, `manuscript_evaluator`).
- Aturan penerimaan dan *rollback* revisi naskah dinyatakan melalui AST `PredicateExpr` formal di atas `candidate.overall_score`, `accepted.overall_score`, dan `candidate.net_subscore_delta`.
- Seluruh 10 *deliverables* tersinkronkan penuh dengan `schemas/output.schema.json`.
