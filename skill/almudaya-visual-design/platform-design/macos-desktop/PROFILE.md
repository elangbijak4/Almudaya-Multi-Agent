# macOS desktop — Platform Profile

## Native interaction characteristics
menu bar, windows, keyboard shortcuts, trackpad.

## Implementation targets (examples, not mandatory)
SwiftUI, AppKit, Qt, Electron.

## Verification priorities
macOS conventions; accessibility and reduced motion.

## Adaptation rules
- Preserve intent and semantic brand tokens, but adapt navigation, density, controls and gestures to this platform.
- Do not directly copy a web layout or mobile navigation to this platform.
- Respect device constraints, platform-specific accessibility APIs and system conventions.
- If safety-critical, require expert review and prohibit claiming compliance from a visual review alone.
