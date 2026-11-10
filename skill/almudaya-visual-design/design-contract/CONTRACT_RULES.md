# Design Contract Rules

## Canonical artifacts
- Design Brief: user, product, task, content, constraints, and success criteria.
- Style Resolution: selected style profile, influences, rationale, and exclusions.
- Platform Resolution: platform profiles, form factors, modalities, and capability constraints.
- Composition Plan: regions, navigation, hierarchy, adaptive variants, interaction mapping.
- Component Tree: semantic structure, component hints, state contracts, accessibility notes.
- Token Contract: semantic tokens and mappings to platform-native tokens.
- Implementation Manifest: code entry points, stack, component mapping, and known deviations.
- QA Report: coverage, evidence, findings, and release recommendation.

## Contract invariants
1. Every artifact has a stable ID, version, and status.
2. References point to existing artifacts or are explicitly marked unresolved.
3. A component ID must be unique within its tree.
4. Every critical region maps to at least one component node.
5. Every essential interaction has a modality, feedback, and accessible alternative where required.
6. Every adaptive variant identifies structural changes and preserved priorities.
7. Implementation agents must not silently reinterpret approved requirements.
8. Deviations must be recorded with rationale and impact.
9. QA findings must reference the relevant requirement/component when possible.
10. A changed upstream artifact triggers impact analysis of dependent artifacts.

## Status values
`draft`, `in_review`, `approved`, `implemented`, `verified`, `superseded`, `blocked`.

## Versioning
- Patch: wording or metadata correction with no design/behavior impact.
- Minor: additive compatible detail or new optional variant.
- Major: breaking structure, semantics, constraints, or approved behavior.
