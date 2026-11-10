# AVDS Benchmark Scoring Rubric

Score each dimension from 1 to 5. Provide evidence and a short rationale for every score.

| Score | Anchor |
|---|---|
| 1 | Unacceptable: major task, usability, or implementation failures |
| 2 | Weak: substantial gaps; requires significant redesign |
| 3 | Adequate: core tasks work; notable shortcomings remain |
| 4 | Strong: coherent, task-appropriate, with only limited issues |
| 5 | Excellent: highly effective, polished, accessible, and well adapted |

## Dimensions
1. **Task fit** — hierarchy and flow support the actual user goals.
2. **Visual distinction** — design has a deliberate visual identity and avoids generic template repetition.
3. **Composition quality** — information architecture, regions, and component relationships are appropriate.
4. **Platform adaptation** — structure and interaction conventions fit each target platform.
5. **Responsive/adaptive behavior** — content and controls reflow without loss of priority or function.
6. **Interaction quality** — affordances, feedback, states, and recovery are clear.
7. **Accessibility** — semantics, keyboard/focus, contrast, text scaling, and alternatives are considered and tested.
8. **Design consistency** — tokens and semantic patterns remain coherent without flattening platform differences.
9. **Implementation quality** — code structure, component mapping, maintainability, and runtime behavior.
10. **Contract fidelity** — implementation follows approved brief, composition, and component tree; deviations are recorded.

## Separate operational metrics
- time to first runnable build
- total implementation time
- number of major rework cycles
- build/test pass rate
- number of unresolved blocker/major findings
- agent token/cost estimate (if available)
- number of documented assumptions and deviations

## Interpretation
- Report median and range across repeated runs.
- Do not interpret a one-point difference as statistically significant without sufficient sample size.
- Report each dimension; an overall mean is supplementary only.
- A high visual score cannot compensate for a broken critical task or serious accessibility defect.
