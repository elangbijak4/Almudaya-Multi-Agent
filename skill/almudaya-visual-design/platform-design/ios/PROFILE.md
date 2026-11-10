# iOS mobile — Platform Profile

## Native interaction characteristics
native navigation, gestures, safe areas, dynamic type.

## Implementation targets (examples, not mandatory)
SwiftUI, UIKit, Flutter.

## Verification priorities
Apple HIG; VoiceOver; Dynamic Type.

## Adaptation rules
- Preserve intent and semantic brand tokens, but adapt navigation, density, controls and gestures to this platform.
- Do not directly copy a web layout or mobile navigation to this platform.
- Respect device constraints, platform-specific accessibility APIs and system conventions.
- If safety-critical, require expert review and prohibit claiming compliance from a visual review alone.
