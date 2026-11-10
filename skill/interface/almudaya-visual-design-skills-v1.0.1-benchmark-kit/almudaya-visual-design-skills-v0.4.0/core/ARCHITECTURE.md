# AVDS Cross-Platform Architecture v0.3

## Separation of concerns
- **Design Intelligence Core:** product analysis, task model, constraints, decisions.
- **Visual Style Engine:** 40 portable style profiles (from v0.2).
- **Interaction Design Engine:** modality-specific skills and accessibility fallbacks.
- **Platform Adaptation Engine:** platform-native navigation, layout, and engineering rules.
- **Quality Assurance:** evidence-based per-platform verification.

## Decision flow
Product intent → user tasks → constraints → visual style selection → platform/modality selection → composition and conflict resolution → platform-specific design briefs → implementation → per-target audit.

## Important distinction
AVDS provides agent-readable design instructions and specifications. It does not automatically generate working native apps, verify safety certification, or provide a universal rendering runtime.


## v0.4 Platform Implementation Engineering

Platform profiles and modality definitions are design inputs. `implementation-engineering/` converts them into platform-specific component mappings, semantic token contracts, implementation guidance, and verification plans. The visual style remains independent from the target platform and input modality.
