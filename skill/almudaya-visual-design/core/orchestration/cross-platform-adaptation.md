# Cross-Platform Adaptation Protocol

1. Identify product intent, users, tasks, environmental constraints, risk, and available input/output hardware.
2. Choose visual style independently of the target platform; use `styles/STYLE_INDEX.md`.
3. Select exactly one primary platform profile from `platform-design/` and any supported secondary targets.
4. Select applicable interaction skills from `interaction-design/`; do not infer hardware support.
5. Resolve conflicts in this order: safety and legal constraints > accessibility > task completion > platform conventions > brand identity > stylistic preference > visual novelty.
6. Produce a platform-specific UI specification with navigation, content hierarchy, state transitions, modality mapping, responsive/adaptive breakpoints, tokens, and verification plan.
7. Implement via host-specific engineering tools; AVDS is a design/skill framework, not a cross-platform compiler.
8. Audit each target independently. A passed web audit does not imply a passed mobile, automotive, or XR audit.

## Consistency model
Preserve semantic identity (brand meaning, typography intent, color roles, tone, information semantics) while allowing platform-specific navigation, density, control placement, motion, and interaction.
