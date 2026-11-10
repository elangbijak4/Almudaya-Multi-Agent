# AVDS QA Release Gate

## Block release when
- A blocker remains open.
- A critical journey is broken or unverified where the release claim requires it.
- A material safety or security interaction defect remains unresolved.
- Essential accessibility barriers are confirmed and no acceptable mitigation exists.
- Platform behavior contradicts declared product support.

## Conditional release
Use `pass_with_conditions` only when:
- no blocker remains,
- accepted major risks are documented with owner/mitigation,
- the untested scope is explicitly stated,
- the release audience understands the limitations.

## Not assessed
Use `not_assessed` when implementation evidence or required test environments are missing. Absence of evidence is not a pass.
