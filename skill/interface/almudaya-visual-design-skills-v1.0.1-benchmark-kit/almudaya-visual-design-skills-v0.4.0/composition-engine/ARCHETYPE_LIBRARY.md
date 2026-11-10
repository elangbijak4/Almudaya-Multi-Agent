# Page Archetype & Composition Pattern Library

Archetypes are reusable structural hypotheses. Adapt, combine, or reject them based on task evidence.

## Core archetypes
1. **Focused Task** — one dominant task with minimal surrounding chrome; suitable for forms, setup, and single-purpose tools.
2. **Workspace** — persistent work surface with optional navigation and contextual inspector; suitable for authoring and professional tools.
3. **Dashboard / Monitoring** — prioritized status and actionable summaries; use only when users need to monitor multiple signals.
4. **Editorial / Reading** — typographic hierarchy and linear or branched reading flow; suitable for articles, reports, and learning content.
5. **Catalog / Discovery** — browse, filter, compare, and inspect collections.
6. **Transactional Flow** — staged process with progress, validation, review, and confirmation.
7. **Map-Centric** — spatial canvas with layers, legend, filters, and feature inspection.
8. **Timeline / Sequence** — temporal ordering, event inspection, and playback or history controls.
9. **Command Surface** — keyboard/search-driven command invocation with discoverable alternatives.
10. **Conversation / Agent** — dialogue, tool activity, context, and user control; avoid hiding consequential actions in chat.
11. **Data Exploration** — dataset selection, transformation, visualization, and evidence inspection.
12. **Control Room** — operational status, alerts, procedures, and safe control actions.
13. **Presentation / Story** — guided narrative with deliberate progression and optional exploration.
14. **Hybrid** — explicit combination of two or more archetypes where user tasks require it.

## Pattern selection checklist
- Is the primary task obvious within the first meaningful view?
- Does the structure match task frequency and complexity?
- Are navigation and contextual controls located where users expect them?
- Is density appropriate for expertise and workflow?
- Does the archetype support empty, loading, error, and recovery states?
- Can it adapt without losing semantic priority?

## Anti-patterns
- Dashboard by default.
- Sidebar by default.
- Everything in cards.
- Hero section on task-critical screens.
- Excessive nested panels.
- Decorative charts without decisions attached.
- Chat interface used to conceal complex navigation or state.
