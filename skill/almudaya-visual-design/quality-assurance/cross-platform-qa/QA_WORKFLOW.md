# Cross-Platform QA Workflow

## 1. Establish the test matrix
For each target platform, list:
- platform profile and OS/version where known
- form factor and viewport/physical size class
- input modalities
- critical journeys
- supported browsers/runtime versions
- assistive technology scope
- expected visual and behavioral variations

## 2. Traceability
Map each requirement to:
- composition region
- component/tree node
- design token or style rule
- interaction action/state
- test case
- evidence artifact

A requirement without a test or inspection method is an explicit coverage gap.

## 3. Review layers
- **Structure**: information architecture, semantic order, hierarchy, region responsibility.
- **Visual**: typography, color, spacing, alignment, density, imagery, consistency.
- **Behavior**: state transitions, validation, navigation, feedback, error recovery.
- **Adaptivity**: reflow, resizing, orientation, content pressure, panel transformations.
- **Accessibility**: keyboard, focus, screen reader semantics, contrast, target size, motion, captions and alternatives.
- **Platform**: native navigation, system bars, menus, window behavior, input conventions.
- **Reliability**: loading, empty, error, offline, interruption, persistence, recovery.

## 4. Finding format
Every confirmed finding must include:
- stable finding ID
- severity and affected platform(s)
- location/component
- expected behavior or design requirement
- observed evidence
- user impact
- reproducible steps when applicable
- recommended remediation
- retest status

## 5. Release gate
A release recommendation must account for:
- open blockers and major findings
- critical journey coverage
- platform coverage
- accessibility evidence
- unresolved risks
- limitations of the inspection environment

Use `pass_with_conditions` when material risks remain but are explicitly accepted. Use `not_assessed` when evidence is insufficient.
