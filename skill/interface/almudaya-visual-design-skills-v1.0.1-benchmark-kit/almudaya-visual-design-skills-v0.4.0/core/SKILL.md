---
name: almudaya-visual-design
description: Adaptive visual design orchestrator for cross-platform UI/UX design, application creation, redesign, and substantial interface changes. Analyze product context, select compatible visual styles, synthesize a design system, guide implementation, and audit the result.
---

# Almudaya Visual Design Orchestrator

## Mission
Create distinctive, context-aware, usable interfaces across web, desktop, mobile, embedded, and emerging platforms. Avoid defaulting to generic SaaS dashboards, sidebars, card grids, blue-purple palettes, or rounded-card aesthetics.

## Required workflow
1. **Understand:** identify product purpose, audience, user journeys, domain, brand rules, accessibility needs, devices, framework, and performance constraints. Reuse known project context; ask only if a critical detail is missing.
2. **Inspect:** examine the existing framework, routes, styling, components, assets, and design tokens. Preserve working functionality and established brand rules.
3. **Discover:** read `styles/STYLE_INDEX.md`; shortlist 3–5 candidates; inspect only relevant `styles/<id>/profile.yaml` files.
4. **Decide:** choose one primary style and zero to two bounded secondary influences. Score using `core/orchestration/style-selection.md`. Diversity is a tie-breaker, never a reason to sacrifice usability.
5. **Brief:** produce `docs/AVDS_DESIGN_BRIEF.md` before substantial implementation. Include rationale, information architecture, composition, palette direction, typography, spacing, components, motion, responsive rules, accessibility, and anti-patterns.
6. **Synthesize:** follow `skills/design-token-synthesis/SKILL.md`; create semantic tokens in the project's native format.
7. **Implement:** follow `skills/frontend-implementation/SKILL.md`; design around tasks rather than templates.
8. **Audit:** follow `skills/visual-quality-audit/SKILL.md`; distinguish source-code review from rendered visual inspection.
9. **Register:** update a project-specific design registry when one exists. Do not store private user data.

## Mandatory rules
- Never assume a dashboard or sidebar is the default.
- Visual diversity means changes in composition, hierarchy, typography, layout, component language, and interaction—not just colors.
- Never sacrifice contrast, readability, accessibility, or task completion for decoration.
- Never silently override explicit brand requirements.
- Do not add dependencies without checking the existing stack.
- Do not claim a visual audit passed unless checks were actually performed.

## Cross-platform extension (v0.3.0)
When the target is not exclusively web, read `core/ARCHITECTURE.md`, `core/orchestration/cross-platform-adaptation.md`, `platform-design/PLATFORM_INDEX.md`, and `interaction-design/MODALITY_INDEX.md`. Load only relevant platform profiles and interaction skills. Produce separate platform-target specifications and validate each independently. For automotive, industrial, and other safety-critical contexts, request specialist validation.
