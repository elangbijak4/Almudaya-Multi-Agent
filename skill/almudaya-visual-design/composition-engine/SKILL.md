# AVDS UI Composition Engine Skill

## Purpose
Create a structured, implementation-ready interface composition plan from a Design Brief. Do not jump directly from a style name to code.

## Required inputs
- User goals and primary tasks
- Content and data entities
- Target platform(s) and form factors
- Interaction modalities and input constraints
- Selected visual style and design tokens (if available)
- Accessibility, performance, localization, and technical constraints

If critical information is missing, state assumptions explicitly. Do not invent product requirements.

## Composition procedure
1. **Task decomposition** — identify primary, secondary, and exceptional user journeys.
2. **Information architecture** — group content by user mental model and task frequency.
3. **Archetype selection** — choose one dominant archetype or a justified hybrid.
4. **Region planning** — define global shell, navigation, workspace, content, contextual tools, and feedback regions as needed.
5. **Hierarchy planning** — assign visual and interaction priority to each region.
6. **Component graph** — create a semantic parent-child tree with stable IDs and explicit responsibilities.
7. **Responsive/adaptive planning** — define behavior at relevant size classes and platform transitions; do not merely scale the desktop canvas.
8. **Interaction mapping** — map actions to the appropriate modality and provide alternatives for essential actions.
9. **Style integration** — apply visual style as a presentation layer without allowing decoration to override task clarity.
10. **Validation** — check completeness, consistency, accessibility, and platform fit.

## Hard constraints
- No archetype is a mandatory template.
- Do not force a sidebar, top bar, dashboard cards, or hero section into every product.
- Do not use cards as the default container for all content.
- Prefer task-oriented composition over decorative symmetry.
- Preserve semantic order when visual layout changes.
- Every interactive component must have a purpose, state model, and feedback behavior.
- Avoid modality-only essential actions; provide an accessible alternative.
- Record trade-offs and assumptions.

## Output
Return a Composition Plan conforming to `schemas/composition-plan.schema.json`, plus a component tree conforming to `schemas/component-tree.schema.json`. Include concise rationale for major structural decisions.
