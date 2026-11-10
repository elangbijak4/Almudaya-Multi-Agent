# Industrial HMI — Platform Profile

## Native interaction characteristics
alarm prioritization, physical controls, continuous monitoring.

## Implementation targets (examples, not mandatory)
Qt, embedded Linux, web HMI.

## Verification priorities
safety-critical review; alarm semantics; fail-safe behavior.

## Adaptation rules
- Preserve intent and semantic brand tokens, but adapt navigation, density, controls and gestures to this platform.
- Do not directly copy a web layout or mobile navigation to this platform.
- Respect device constraints, platform-specific accessibility APIs and system conventions.
- If safety-critical, require expert review and prohibit claiming compliance from a visual review alone.
