---
name: avds-platform-implementation-audit
description: Review a UI implementation for correct platform adaptation, native interaction behavior, semantic token mapping, accessibility, and verified device coverage.
---

# Platform Implementation Audit

Review:
1. Platform profile alignment and minimum OS/version assumptions.
2. Navigation, focus, back behavior, windowing, and system integrations.
3. Input modality support and alternatives.
4. Semantic token mapping and text scaling.
5. Native controls versus custom controls and justification.
6. Accessibility semantics, keyboard/switch/screen reader behavior.
7. Responsive/adaptive layouts across actual form factors.
8. Performance, battery, offline, and safety constraints where relevant.
9. Build, test, emulator, and physical-device evidence.

Report each issue with severity, platform, component, evidence, and remediation. Clearly label untested device/OS combinations. Do not equate a successful build with a successful UX audit.
