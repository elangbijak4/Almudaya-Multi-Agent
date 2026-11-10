# Routing and Handoff Protocol

## Handoff envelope
Every specialist handoff should include:
- `project_id`
- `workflow_id`
- `phase`
- `artifact_version`
- `input_artifacts` with paths and checksums where available
- `approved_constraints`
- `open_assumptions`
- `requested_output`
- `acceptance_criteria`
- `return_artifacts`
- `status`

## Rules
- Pass references to canonical artifacts rather than duplicating large content.
- Preserve stable IDs across revisions when the underlying entity remains the same.
- A changed requirement must trigger impact analysis before dependent artifacts are regenerated.
- A receiving agent must report missing or incompatible inputs instead of fabricating them.
- Handoff completion requires a returned artifact or an explicit blocked status.
- Keep agent roles replaceable; AVDS does not depend on a specific coding agent or vendor.
