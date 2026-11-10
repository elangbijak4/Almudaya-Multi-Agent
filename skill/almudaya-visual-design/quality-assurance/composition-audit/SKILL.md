# AVDS Composition Audit Skill

Review a Composition Plan and component tree before implementation.

## Audit dimensions
1. **Task alignment** — primary task is dominant; secondary tasks do not compete.
2. **Information architecture** — grouping and navigation match user mental models.
3. **Archetype fit** — selected structure is justified; no default-template bias.
4. **Region necessity** — every region has a clear responsibility.
5. **Hierarchy** — visual and interaction priorities are explicit.
6. **Adaptivity** — structural changes are defined for relevant size classes.
7. **Platform fit** — navigation, focus, input, and system conventions are respected.
8. **Accessibility** — semantic order, keyboard/screen-reader support, contrast, target size, and alternatives are considered.
9. **State completeness** — loading, empty, error, success, offline, and recovery states are addressed where relevant.
10. **Implementation readiness** — IDs, responsibilities, component hints, and state contracts are sufficiently clear.

## Severity
- **Blocker**: prevents primary task or creates serious accessibility/safety risk.
- **Major**: substantial friction, missing state, or platform mismatch.
- **Minor**: localized inconsistency or polish issue.
- **Note**: optional improvement.

Return findings with evidence, impact, and a concrete correction. Do not claim visual testing unless a rendered implementation was actually inspected.
