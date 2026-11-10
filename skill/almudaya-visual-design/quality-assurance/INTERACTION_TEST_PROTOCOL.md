# Interaction Test Protocol

Test each critical action using its intended modality and a practical alternative where needed.

## Core checks
- Discoverability and affordance
- Input acceptance and validation
- Focus order and visible focus
- State transition and feedback
- Cancellation, undo, and recovery
- Keyboard and assistive technology access
- Touch/gesture target and alternative
- Voice confirmation and disambiguation where supported
- Haptic feedback consistency where applicable
- Error prevention for consequential actions

## State coverage
At minimum consider: idle, hover (where applicable), focus, pressed/active, selected, disabled, loading, success, error, empty, and interrupted. Include only states relevant to the component.

## Safety-sensitive controls
For destructive, financial, administrative, or physical-control actions, verify confirmation, clear scope, authorization, reversibility, and visible outcome. Do not infer safety from appearance.
