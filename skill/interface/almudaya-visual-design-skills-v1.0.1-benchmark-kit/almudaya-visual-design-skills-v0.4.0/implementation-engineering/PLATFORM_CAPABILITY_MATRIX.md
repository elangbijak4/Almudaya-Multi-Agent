# Platform Capability & Fallback Matrix

| Capability | Typical targets | Design/engineering consideration | Fallback |
|---|---|---|---|
| Touch | phones, tablets, kiosks | target size, gestures, reachability | visible buttons and alternate controls |
| Pointer | desktop, web | hover is supplementary; preserve click/tap | focus and pressed states |
| Keyboard | desktop, web, accessibility | logical tab order, shortcuts, focus visibility | visible command alternatives |
| Stylus | tablets, creative devices | precision, palm rejection, pressure only when useful | touch/pointer controls |
| Voice | assistants, hands-free | confirmation, ambiguity handling, privacy | visual/manual interaction |
| Gaze | XR, accessibility | dwell ambiguity and accidental activation | controller/hand/voice confirmation |
| Haptic | mobile, wearable, controllers | configurable and non-essential feedback | visual/audio feedback |
| Remote | TV, set-top box | directional focus and focus restoration | simplified navigation |
| Spatial hand/controller | XR | comfort, reach, motion sickness, safe boundaries | 2D panel or controller fallback |
| Screen reader/switch | assistive technology | semantic labels, roles, states, predictable order | accessible alternate workflow |

Capability availability must be detected or configured for the actual target. Do not assume a device supports a capability because it belongs to a platform category.
