# AVDS Semantic Token Contract

Semantic tokens describe intent. Platform adapters map them to platform-native implementation.

## Required token groups

```yaml
color:
  canvas: {}
  surface: {}
  surface_raised: {}
  text_primary: {}
  text_secondary: {}
  border_subtle: {}
  action_primary: {}
  action_on_primary: {}
  focus: {}
  success: {}
  warning: {}
  danger: {}
typography:
  display: {}
  title: {}
  body: {}
  label: {}
  caption: {}
  data: {}
spacing:
  compact: {}
  comfortable: {}
  spacious: {}
shape:
  control: {}
  container: {}
  overlay: {}
elevation:
  level_0: {}
  level_1: {}
  level_2: {}
motion:
  duration_short: {}
  duration_standard: {}
  duration_long: {}
  easing_standard: {}
interaction:
  minimum_target: {}
  focus_indicator: {}
  reduced_motion: {}
```

## Rules

- Tokens must express semantic roles, not names such as `blue-500` alone.
- Include light/dark or system appearance mappings where supported.
- Define state tokens for hover, focus, pressed, selected, disabled, error, and loading.
- Do not encode status using color alone; pair with text, icon, shape, or another perceivable cue.
- Typography must support platform scaling and localization.
- Spacing and target sizes must be adapted to platform conventions and actual input modality.
- The same semantic token may map to different concrete values on different platforms.
