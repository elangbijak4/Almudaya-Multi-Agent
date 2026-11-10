---
name: almudaya-visual-design
description: Cross-platform adaptive UI/UX design and implementation orchestrator. Selects visual styles, platform conventions, interaction modalities, semantic tokens, and implementation patterns for web, desktop, mobile, embedded, and spatial interfaces.
---

# Almudaya Visual Design Skills (AVDS)

Use AVDS when creating, redesigning, or substantially modifying any user-facing interface.

## Mandatory sequence

1. Read `core/ARCHITECTURE.md` and `core/SKILL.md`.
2. Analyze product intent, user roles, tasks, risk, content, and brand constraints.
3. Identify target platform(s), device capabilities, input/output modalities, and implementation stack.
4. Select one primary visual style and at most two bounded visual influences from `styles/STYLE_INDEX.md`.
5. Read the relevant platform profile(s) from `platform-design/PLATFORM_INDEX.md`.
6. Read relevant modality guidance from `interaction-design/MODALITY_INDEX.md`.
7. Follow `implementation-engineering/IMPLEMENTATION_WORKFLOW.md`.
8. Produce the platform implementation mapping and semantic token contract before substantial implementation.
9. Implement using native platform conventions and the existing project stack.
10. Test primary journeys, interaction states, accessibility, and target-device behavior where tools/devices are available.
11. Report verified results separately from assumptions and untested areas.

## Non-negotiable principles

- Visual identity, platform behavior, and input modality are independent design dimensions.
- Do not impose web navigation patterns on native platforms without a reason.
- Prefer native controls when they improve expected behavior, accessibility, platform consistency, or system integration.
- Use custom controls only when the product requires them and their interaction/accessibility behavior is specified.
- Preserve brand identity and existing working functionality.
- Never claim device testing, accessibility compliance, or native guideline compliance without evidence.

## UI Composition Engine (v0.5.0)
Before implementation, invoke `composition-engine/SKILL.md` to transform the normalized Design Brief into:
- a platform-aware Composition Plan (`schemas/composition-plan.schema.json`),
- a semantic Component Tree (`schemas/component-tree.schema.json`),
- adaptive variants and interaction mappings.

Use `composition-engine/ARCHETYPE_LIBRARY.md` as a pattern library, never as a rigid template. Audit the result with `quality-assurance/composition-audit/SKILL.md`. Then pass the approved plan to `implementation-engineering/IMPLEMENTATION_WORKFLOW.md`.

The Composition Engine is currently instruction-driven; do not claim that AVDS automatically generates or renders executable layouts.

## Cross-Platform QA Engine (v0.6.0)
After implementation, invoke `quality-assurance/cross-platform-qa/SKILL.md` using the approved Design Brief, Composition Plan, Component Tree, style tokens, platform profiles, and actual implementation evidence. Produce a traceable QA report using `schemas/qa-report.schema.json`.

Use the visual, interaction, accessibility, and platform protocols in `quality-assurance/`. Mark checks `not_assessed` when evidence is unavailable. Never claim runtime, device, browser, or accessibility testing that was not performed.

## AVDS Unified Orchestrator (v1.0.0)
For complete lifecycle coordination, begin with `unified-orchestrator/SKILL.md`. It routes intake, style/platform resolution, composition, contract validation, implementation, QA, and delivery. Use `design-contract/` as the canonical design-to-code contract, `agent-handoff/` for specialist handoffs, and `governance/` for change impact and decision traceability.

### v1.0.0 governance requirements
- Validate contract and handoff artifacts before advancing phases.
- Preserve approved constraints and stable component IDs.
- Record implementation deviations.
- Re-run only the downstream phases affected by a change.
- Base QA and release recommendations on actual evidence.

## AVDS Integration & Benchmark Kit
Use `benchmark/` to evaluate AVDS against a controlled baseline. Keep the agent/model, prompt, stack, tool access, and evaluation environment constant. Run the Academy, Quantum Lab, and Geospatial Fire Intelligence scenarios, capture implementation evidence, and score outputs with the benchmark rubric. Do not claim benchmark results until real agent runs and reviews have been completed.
