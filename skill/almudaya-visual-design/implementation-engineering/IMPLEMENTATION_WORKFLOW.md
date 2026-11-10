# AVDS Platform & Interaction Implementation Workflow

## 1. Repository reconnaissance

Before changing code, identify:
- application framework and version;
- target OS/platform versions;
- current component library and design tokens;
- navigation/routing model;
- state management and data flow;
- build and test commands;
- existing accessibility conventions;
- device capabilities and permissions used.

Do not introduce a new UI framework or dependency until the current stack has been evaluated.

## 2. Platform contract

Create a platform contract containing:
- platform and minimum supported version;
- screen classes and orientation behavior;
- input modalities and priority;
- output modalities (visual, audio, haptic);
- system integrations (notifications, share sheet, file picker, permissions, windowing);
- offline/network assumptions;
- accessibility and localization needs;
- performance, battery, memory, and safety constraints.

## 3. Interaction contract

For every important control, define:
- purpose and user intent;
- input trigger;
- visible/aural/haptic feedback;
- focus and navigation behavior;
- loading, success, error, disabled, and empty states;
- cancellation, undo, and recovery behavior;
- keyboard, switch, screen-reader, and reduced-motion behavior where relevant.

Avoid interactions that require hover on touch-only devices or color-only status communication.

## 4. Component mapping

For each design component, choose one:
1. Native platform component.
2. Existing project component.
3. Custom component built with platform primitives.
4. Cross-platform abstraction with platform-specific renderers.

Record why the selected option is appropriate. A shared design token does not require a shared visual component.

## 5. Semantic token contract

Define semantic tokens independent of framework syntax. Map them to CSS variables, Flutter ThemeData/ColorScheme, SwiftUI assets/environment, Compose MaterialTheme, or the existing desktop toolkit.

Do not assume identical pixel values across platforms. Preserve semantic intent, hierarchy, and accessibility while respecting platform density and typography.

## 6. Implementation

- Follow platform navigation, focus, windowing, and system integration conventions.
- Use native scrolling, text input, selection, dialogs, menus, and permission flows where appropriate.
- Make adaptive layouts based on available space and interaction context, not device labels alone.
- Handle keyboard, pointer, touch, stylus, remote, voice, and assistive technology as applicable.
- Include localization, text scaling, right-to-left layout, and dynamic type where relevant.
- Respect reduced motion, high contrast, and system appearance preferences.
- Keep critical workflows resilient to interruptions and errors.

## 7. Verification

Run the project's available build, unit, integration, and UI tests. Inspect actual target sizes and rendered states when possible. Test on representative form factors and input modalities.

If physical devices or emulators are unavailable, state that verification is limited to code review or available simulator evidence.
