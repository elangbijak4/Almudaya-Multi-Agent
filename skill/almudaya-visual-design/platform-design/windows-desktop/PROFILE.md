# Windows desktop — Platform Profile

## Native interaction characteristics
multiwindow, menus, commands, dense workspaces, mouse and keyboard.

## Implementation targets (examples, not mandatory)
WinUI, WPF, Qt, Electron, Tauri.

## Verification priorities
Windows interaction conventions; keyboard and high DPI.

## Adaptation rules
- Preserve intent and semantic brand tokens, but adapt navigation, density, controls and gestures to this platform.
- Do not directly copy a web layout or mobile navigation to this platform.
- Respect device constraints, platform-specific accessibility APIs and system conventions.
- If safety-critical, require expert review and prohibit claiming compliance from a visual review alone.
