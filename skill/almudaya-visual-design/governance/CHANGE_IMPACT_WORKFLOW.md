# Change Impact Workflow

## Trigger
Run impact analysis whenever a user changes an approved requirement, style, platform, modality, composition region, component contract, token, or implementation constraint.

## Procedure
1. Identify the changed artifact and exact fields/sections.
2. Trace direct dependents through `depends_on`, component IDs, and handoff references.
3. Classify impact:
   - `none`: documentation-only change
   - `low`: localized, backward-compatible change
   - `medium`: affects a region, component behavior, or one platform variant
   - `high`: changes navigation, core task flow, global tokens, shared components, or multiple platforms
   - `breaking`: invalidates downstream contracts or implementation assumptions
4. List affected artifacts and recommended actions.
5. Preserve unaffected artifacts; do not regenerate the entire design unnecessarily.
6. Obtain approval for high or breaking changes when they alter an approved product direction.
7. Create new artifact versions and update dependency references.
8. Re-run relevant schema checks, implementation checks, and QA tests.

## Output
Return a Change Impact Record with change summary, affected artifacts, severity, approval requirement, migration steps, and retest scope.
