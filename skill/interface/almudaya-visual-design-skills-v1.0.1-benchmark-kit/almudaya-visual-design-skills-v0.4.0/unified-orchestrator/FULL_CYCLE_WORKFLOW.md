# AVDS Full-Cycle Workflow

```text
User Request
   |
   v
Intake & Design Brief
   |
   v
Style + Platform Resolution
   |
   v
Composition Plan + Component Tree
   |
   v
Contract Validation -----> Resolve errors / assumptions
   |
   v
User Approval Gate (when required)
   |
   v
Implementation Engineering
   |
   v
Implementation Evidence
   |
   v
Cross-Platform QA
   |
   +---- Blockers/Majors ----> Remediation ----> Retest
   |
   v
Delivery Package + QA Report + Decision Log
```

## Phase outputs
1. Intake: normalized requirements and assumptions.
2. Design: Design Brief, style choice, platform/modalities.
3. Composition: Composition Plan and Component Tree.
4. Contract: validated references and compatibility checks.
5. Implementation: code/build references and implementation notes.
6. QA: report, findings, evidence, and coverage.
7. Delivery: versioned artifacts and unresolved risks.

The workflow may start at a later phase when valid upstream artifacts already exist. Verify their versions and compatibility before reuse.
