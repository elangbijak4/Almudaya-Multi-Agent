# Linux desktop — Platform Profile

## Native interaction characteristics
window managers, keyboard workflows, variable display scaling.

## Implementation targets (examples, not mandatory)
GTK, Qt, Electron, Tauri.

## Verification priorities
desktop environment diversity; keyboard support.

## Adaptation rules
- Preserve intent and semantic brand tokens, but adapt navigation, density, controls and gestures to this platform.
- Do not directly copy a web layout or mobile navigation to this platform.
- Respect device constraints, platform-specific accessibility APIs and system conventions.
- If safety-critical, require expert review and prohibit claiming compliance from a visual review alone.
