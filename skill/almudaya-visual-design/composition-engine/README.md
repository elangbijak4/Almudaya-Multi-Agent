# UI Composition Engine

The UI Composition Engine translates a Design Brief into a platform-aware composition plan before implementation. It selects and arranges interface regions, page archetypes, navigation structures, component relationships, and responsive/adaptive behaviors.

## Pipeline
1. Normalize user goals, tasks, content, data, and constraints.
2. Resolve visual identity, platform profile, and interaction modalities independently.
3. Select a page archetype as a starting hypothesis—not a fixed template.
4. Compose regions and component groups using layout grammar and constraints.
5. Produce a semantic component tree and responsive variants.
6. Validate task flow, hierarchy, accessibility, and platform conventions.
7. Hand the plan to Implementation Engineering.

This release is instruction-driven. It defines planning rules, schemas, patterns, and examples; it does **not** ship an executable layout-generation runtime.
