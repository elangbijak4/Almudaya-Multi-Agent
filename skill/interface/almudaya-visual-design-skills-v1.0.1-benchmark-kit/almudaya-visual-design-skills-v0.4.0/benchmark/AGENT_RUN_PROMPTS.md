# Agent Run Prompts

Use the exact same scenario prompt for baseline and AVDS-assisted conditions. The AVDS condition may additionally load the AVDS repository and its orchestrator.

## Shared instruction
Build a polished, runnable interface for the supplied scenario. Inspect the starter repository and use its existing stack. Do not invent backend services; use clearly labeled mock data when no backend is provided. Include responsive behavior, realistic component states, and a concise README explaining how to run the project. Report what was implemented and what was not tested.

## Baseline condition
Use only the shared instruction and scenario file. Do not load AVDS skills or AVDS-specific planning artifacts.

## AVDS-assisted condition
Use the same shared instruction and scenario file. Follow AVDS v1.0.0:
1. Create/normalize a Design Brief.
2. Resolve visual style and platform profiles.
3. Produce Composition Plan and Component Tree.
4. Validate the Design-to-Code Contract.
5. Implement from approved artifacts.
6. Produce an Implementation Manifest.
7. Run the QA workflow and report only checks supported by actual evidence.

## Run record
Record agent/model/version, date, repository commit, stack, elapsed time, tool availability, prompt hash if available, and any deviations from the protocol.
