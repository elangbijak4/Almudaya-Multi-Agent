# Platform Conformance Matrix

Use this matrix as a prompt for platform-specific checks; adapt it to the actual product and supported OS versions.

| Platform family | Areas to inspect |
|---|---|
| Web | Browser navigation, responsive layout, semantic HTML, browser zoom, keyboard, history, form behavior |
| Windows desktop | Window resizing, system menus, keyboard accelerators, focus, high contrast, DPI scaling |
| macOS desktop | Menu bar, keyboard conventions, window behavior, VoiceOver, system appearance |
| Linux desktop | Toolkit conventions, window manager behavior, keyboard, scaling, theme variability |
| Android | System bars, back navigation, permissions, touch targets, TalkBack, dynamic sizing |
| iOS/iPadOS | Safe areas, navigation gestures, system controls, Dynamic Type, VoiceOver |
| Tablet | Split view, orientation, pointer/touch coexistence, adaptive navigation |
| TV | Directional focus, viewing distance, overscan-safe content, remote control |
| Wearable | Glanceability, brief interaction, haptics, small-screen legibility |
| Automotive | Driver distraction, glance time, voice, safety restrictions, context-aware availability |
| Industrial HMI | Alarm hierarchy, operator feedback, gloves/touch, environmental constraints, safe control states |
| Spatial XR | Comfort, reach, depth, locomotion, gaze/hand alternatives, spatial accessibility |
| Voice/conversational | Turn-taking, confirmation, ambiguity, interruption, recovery, privacy cues |

Do not require every platform family for every product. Test only the declared support matrix and record exclusions.
