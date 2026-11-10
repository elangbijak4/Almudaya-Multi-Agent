# AVDS Unified Orchestrator — v1.0.0

## Mission
Coordinate the complete AVDS lifecycle from a user request to a validated interface delivery. The orchestrator routes work to specialist skills while preserving one coherent design contract.

## Entry points
- `design`: create or revise a Design Brief and design direction.
- `compose`: create a platform-aware Composition Plan and semantic Component Tree.
- `implement`: hand approved plans to Implementation Engineering.
- `audit`: evaluate an existing implementation with the Cross-Platform QA Engine.
- `full-cycle`: execute the complete lifecycle with explicit approval gates.
- `change`: assess the impact of a design or requirement change before modifying artifacts.

If the user does not specify an entry point, infer the smallest workflow that safely fulfills the request. Do not run unrelated phases.

## Lifecycle
1. **Intake** — normalize product goal, users, tasks, content, constraints, platforms, modalities, and evidence.
2. **Design brief** — create or update the canonical brief.
3. **Style resolution** — select one primary visual style and at most two compatible influences.
4. **Platform resolution** — resolve platform profiles and supported input modalities independently from visual identity.
5. **Composition** — create the Composition Plan and semantic Component Tree.
6. **Design contract validation** — validate schemas, references, IDs, constraints, and unresolved assumptions.
7. **Implementation handoff** — pass only approved, versioned artifacts and platform-specific guidance to implementation agents.
8. **Implementation review** — inspect source/build evidence and record implementation deviations.
9. **Cross-platform QA** — run evidence-based review and create a QA report.
10. **Delivery** — summarize artifacts, decisions, limitations, open findings, and next actions.

## Approval gates
- Gate A: confirm or clearly state assumptions before committing to a design direction when requirements are materially ambiguous.
- Gate B: obtain user approval before major changes to product information architecture or visual identity when operating on an existing product.
- Gate C: approve Composition Plan before implementation when the workflow is staged or when implementation cost is material.
- Gate D: resolve blockers or explicitly document accepted risks before recommending release.

Do not ask for approval at every trivial step. Batch related decisions and preserve user-approved constraints.

## Routing table
| Need | Specialist |
|---|---|
| Normalize requirements | `core/SKILL.md` and design brief resources |
| Select visual identity | `core/orchestration/style-selection.md` and style registry |
| Adapt to target platform | `platform-design/` and interaction design resources |
| Plan interface structure | `composition-engine/SKILL.md` |
| Implement | `implementation-engineering/` |
| Audit | `quality-assurance/cross-platform-qa/SKILL.md` |
| Audit composition | `quality-assurance/composition-audit/SKILL.md` |
| Track change impact | `governance/CHANGE_IMPACT_WORKFLOW.md` |

## Conflict resolution
Apply this priority order:
1. User-approved requirements and constraints
2. Safety, accessibility, and legal/platform requirements
3. Primary task completion and information integrity
4. Platform conventions and modality constraints
5. Approved composition plan
6. Visual style profile
7. Decorative preferences

When constraints conflict, document the conflict and select the least harmful valid option. Never silently discard a higher-priority requirement.

## State and memory
Treat repository artifacts—not conversational assumptions—as the source of truth for project state. Record decisions in the design contract and decision log. Do not infer approval from silence.

## Completion criteria
A phase is complete only when its required artifact exists, validates against its schema where applicable, and its limitations are stated. A full-cycle delivery is not “QA passed” unless evidence supports that result.
