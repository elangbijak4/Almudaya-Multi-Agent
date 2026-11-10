# Android mobile — Platform Profile

## Native interaction characteristics
touch-first navigation, system back, permissions, adaptive windows.

## Implementation targets (examples, not mandatory)
Jetpack Compose, Android Views, Flutter.

## Verification priorities
Material guidance; accessibility; system bars.

## Adaptation rules
- Preserve intent and semantic brand tokens, but adapt navigation, density, controls and gestures to this platform.
- Do not directly copy a web layout or mobile navigation to this platform.
- Respect device constraints, platform-specific accessibility APIs and system conventions.
- If safety-critical, require expert review and prohibit claiming compliance from a visual review alone.
