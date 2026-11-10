# Layout Grammar

A composition is a semantic structure, not a pile of visual containers.

## Structural primitives
- **Shell**: persistent application frame, if needed.
- **Navigation region**: global, local, contextual, or task navigation.
- **Work region**: primary task surface.
- **Context region**: details, filters, inspector, metadata, or supporting explanation.
- **Utility region**: search, command access, account, system status.
- **Feedback region**: validation, progress, alerts, confirmations, empty/error states.
- **Overlay layer**: dialogs, menus, popovers, sheets, and transient tools.
- **Content sequence**: ordered editorial, instructional, or transactional content.

## Composition operators
- `sequence`: ordered regions or steps.
- `parallel`: regions visible together.
- `contain`: semantic parent-child grouping.
- `overlay`: temporary surface above a base region.
- `switch`: mutually exclusive views or modes.
- `repeat`: data-driven repeated items.
- `anchor`: persistent region relative to a viewport or work surface.
- `flow`: content wraps or reflows according to available space.

## Constraints
- Use `parallel` only when simultaneous visibility materially helps the task.
- Use `overlay` for temporary focus, not as a substitute for missing information architecture.
- Use `switch` when users need alternate representations of the same task/data.
- Use `anchor` sparingly; persistent controls must not obscure content or focus.
- Use `repeat` with clear grouping, ordering, and empty/loading/error states.
- Preserve reading and keyboard order independently of visual placement.
