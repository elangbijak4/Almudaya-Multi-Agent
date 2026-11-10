# AVDS Agent Handoff Protocol

## Roles
Roles are logical responsibilities and may be performed by one agent or multiple agents:
- Design Analyst
- Style Curator
- Platform Specialist
- Composition Architect
- Implementation Engineer
- QA Auditor
- Release Coordinator

## Handoff states
`queued` → `accepted` → `in_progress` → `returned` → `reviewed`

Alternative terminal states: `blocked`, `rejected`, `cancelled`.

## Required behavior
- Receiver acknowledges the exact artifact versions.
- Receiver checks acceptance criteria before work.
- Receiver returns artifacts and a concise completion summary.
- Receiver lists deviations, assumptions, and missing evidence.
- Coordinator validates outputs before advancing the lifecycle.
- Agents must not overwrite another agent's artifacts without an explicit ownership transfer.

## Parallel work
Parallelize independent tasks only. Shared contract or component-tree edits require a single owner or explicit merge procedure. Avoid parallel agents independently changing global tokens, navigation, or shared component semantics.
