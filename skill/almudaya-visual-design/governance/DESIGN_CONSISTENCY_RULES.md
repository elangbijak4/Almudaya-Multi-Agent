# Design Consistency Governance

## Consistency dimensions
- Semantic consistency: same meaning, naming, and interaction contract.
- Visual consistency: shared tokens, typography roles, and component language.
- Behavioral consistency: predictable state transitions and feedback.
- Platform consistency: appropriate native conventions within each platform.
- Brand consistency: coherent identity without forcing identical layouts.

## Rules
- Reuse semantic tokens; avoid arbitrary per-component values where a token exists.
- Document intentional exceptions.
- Do not force desktop navigation onto mobile or vice versa.
- Preserve semantic meaning across platform-specific component implementations.
- Audit shared components after global token or interaction changes.
