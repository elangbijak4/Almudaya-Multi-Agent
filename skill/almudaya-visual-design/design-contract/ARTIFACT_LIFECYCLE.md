# Artifact Lifecycle

| State | Meaning | Allowed next states |
|---|---|---|
| draft | Being authored | in_review, blocked |
| in_review | Awaiting validation/approval | approved, draft, blocked |
| approved | Accepted as implementation input | implemented, superseded |
| implemented | Reflected in implementation | verified, superseded |
| verified | Checked against evidence | superseded |
| blocked | Cannot proceed due to missing input or conflict | draft, in_review |
| superseded | Replaced by a newer artifact | terminal |

Do not edit an approved artifact in place without recording a new version. Keep prior versions available for traceability.
