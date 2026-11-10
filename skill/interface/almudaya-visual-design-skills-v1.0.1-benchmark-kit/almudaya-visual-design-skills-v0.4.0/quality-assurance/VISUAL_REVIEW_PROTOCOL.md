# Visual Review Protocol

## Review setup
Capture consistent states at documented viewport sizes, device scale, theme, locale, and data conditions. Use the same content and interaction state when comparing versions.

## Review dimensions
1. **Hierarchy** — primary task and next action are immediately recognizable.
2. **Composition** — regions, alignment, density, and whitespace support task flow.
3. **Typography** — readable scale, line length, hierarchy, and text behavior.
4. **Color** — semantic meaning, contrast, state differentiation, and non-color cues.
5. **Components** — consistency, state coverage, affordance, and platform adaptation.
6. **Responsive behavior** — no clipping, overlap, inaccessible controls, or priority inversion.
7. **Content integrity** — no truncation of critical data, labels, units, or warnings.
8. **Brand/style fidelity** — visual identity is coherent without overriding usability.

## Comparison modes
- Requirement-based inspection is primary.
- Side-by-side comparison may identify regressions.
- Pixel-diff is diagnostic only; it can flag harmless rendering differences and miss semantic defects.

## Evidence
For each observation, record the screenshot or recording identifier, platform, viewport, state, and relevant component. Do not fabricate measurements from an uncalibrated screenshot.
