# Stack-Specific Implementation Guides

Use the guide matching the existing project. These are design-to-code conventions, not complete starter applications.

## React / Web

- Use semantic HTML first: `button`, `nav`, `main`, `form`, `label`, `dialog`, and correct heading order.
- Use CSS custom properties for semantic AVDS tokens.
- Use responsive CSS based on content breakpoints and container constraints.
- Use accessible routing and preserve browser history behavior.
- Manage focus for dialogs, route transitions, and dynamic updates.
- Test keyboard-only flows, screen-reader semantics, zoom, and reduced motion.

Example token mapping:

```css
:root {
  --avds-color-canvas: #f7f6f2;
  --avds-color-surface: #ffffff;
  --avds-color-text-primary: #202522;
  --avds-color-action-primary: #245b45;
  --avds-space-comfortable: 1rem;
  --avds-radius-control: 0.5rem;
}
```

## Flutter

- Map semantic colors and typography into `ThemeData` and `ColorScheme`.
- Use Material or Cupertino widgets according to product/platform requirements; do not mix them arbitrarily.
- Use layout constraints and adaptive navigation rather than hard-coded device checks alone.
- Expose semantics for custom-painted or custom-gesture controls.
- Test text scaling, focus traversal, platform back behavior, and touch targets.

Conceptual mapping: semantic action token → `ColorScheme.primary`; body typography → `TextTheme.bodyMedium`; navigation intent → platform-appropriate NavigationBar, NavigationRail, or native-style navigation.

## SwiftUI

- Use semantic assets and environment-aware color/typography.
- Prefer platform-native controls and navigation containers.
- Support Dynamic Type, VoiceOver, keyboard/focus where applicable, and system appearance.
- Use size classes and available space to adapt composition.
- Avoid fixed frame assumptions for localized or scaled text.

Conceptual mapping: semantic colors → asset catalog / dynamic Color; typography → system text styles; focus and accessibility → native modifiers and accessibility labels/traits.

## Jetpack Compose

- Map semantic tokens into `MaterialTheme` or a project-defined theme.
- Use adaptive navigation components according to window size and task model.
- Use semantics modifiers for custom controls.
- Support font scaling, TalkBack, keyboard, switch access, and predictive/back navigation behavior.
- Keep composables state-driven and preview relevant window sizes.

Conceptual mapping: semantic colors → `ColorScheme`; typography → `Typography`; shapes → `Shapes`; interaction states → state-driven composables and semantics.

## Desktop UI (Windows/macOS/Linux)

- Select the existing native toolkit: WinUI/WPF, AppKit/SwiftUI, Qt, GTK, or project framework.
- Respect window chrome, menus, keyboard shortcuts, focus, multi-window behavior, file dialogs, and drag/drop conventions.
- Support resizable windows, high-DPI displays, system text scaling, and keyboard navigation.
- Use virtualization for large tables/lists and avoid unnecessarily dense panels.
- Provide command discoverability and undo/recovery for destructive operations.

Do not prescribe a toolkit before inspecting the repository and deployment target.
