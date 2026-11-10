# AVDS Cross-Platform QA Engine

## Purpose
Evaluate an implemented interface against its approved Design Brief, Composition Plan, semantic Component Tree, platform profile, interaction modalities, and design tokens. Produce evidence-based findings and actionable corrections.

This skill distinguishes **design intent**, **implementation inspection**, and **runtime verification**. Never report a check as passed unless the required evidence was actually inspected.

## Required inputs
- Approved Design Brief
- Composition Plan and Component Tree
- Visual style profile and semantic tokens
- Platform and interaction modality profiles
- Implementation source or accessible build
- Target viewport/device matrix
- Available test evidence (screenshots, recordings, accessibility tree, test logs)

If some inputs are unavailable, mark the corresponding check `not_assessed` and explain what evidence is missing.

## QA pipeline
1. Establish scope, target platforms, supported form factors, and critical user journeys.
2. Map requirements to components and test cases.
3. Run static/design-system checks where source is available.
4. Inspect visual hierarchy, layout, typography, spacing, color, and component states.
5. Inspect responsive/adaptive transformations at agreed size classes.
6. Inspect interaction behavior for each supported modality.
7. Evaluate accessibility and semantic structure.
8. Evaluate platform conventions and native behavior.
9. Test critical states: loading, empty, error, success, disabled, offline, and recovery as applicable.
10. Record severity, evidence, impact, remediation, and retest status.
11. Produce a release recommendation with explicit limitations.

## Non-negotiable rules
- Do not infer runtime behavior from source code alone.
- Do not claim accessibility conformance from a visual screenshot alone.
- Do not claim cross-browser/device testing unless those environments were actually tested.
- Do not treat pixel similarity as the sole quality measure.
- Do not require identical layouts across platforms; require coherent identity and appropriate platform adaptation.
- Do not penalize intentional style differences that are documented and improve task performance.
- Flag missing evidence separately from confirmed defects.
- Prioritize task completion, safety, accessibility, and platform correctness over decorative polish.

## Output
Produce a QA report conforming to `schemas/qa-report.schema.json`. Include a traceability matrix, findings, coverage, evidence, retest status, and release recommendation.
