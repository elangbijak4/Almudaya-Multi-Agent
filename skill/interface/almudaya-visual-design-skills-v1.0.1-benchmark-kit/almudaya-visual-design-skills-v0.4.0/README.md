# Almudaya Visual Design Skills (AVDS)

**Version:** 1.0.1 — Unified Adaptive UI/UX Framework & Integration Benchmark Kit

AVDS is a cross-platform adaptive UI/UX design skill library for AI coding agents. It separates visual identity, platform conventions, and interaction modality so the same product design intent can be expressed appropriately across web, desktop, mobile, embedded, automotive, wearable, TV, voice, and spatial interfaces.

## v0.4.0 additions

- Platform implementation engineering workflow.
- Native component and interaction mapping.
- Cross-platform semantic token contract.
- Implementation guidance for React, Flutter, SwiftUI, Jetpack Compose, and desktop UI stacks.
- Platform capability and fallback matrix.
- Interaction state and accessibility contracts.
- Example implementation briefs and mapping templates.

## Install

Copy the complete repository into the coding agent's supported skill directory. For compatible project-level Agent Skills hosts, an example is:

```text
<project-root>/.agents/skills/almudaya-visual-design/
```

Preserve relative resource paths. Verify the installed host's skill discovery rules.

## Use

Ask the agent:

> Use AVDS v0.4.0. Inspect the target platform and existing codebase. Select the visual style, platform profile, and interaction modalities independently. Produce an implementation mapping and semantic token contract before coding. Use native platform conventions rather than forcing a web-style interface onto every device. Implement, test, and report any unverified assumptions.

## Important scope notes

AVDS is a design and implementation guidance library, not a UI framework or automatic cross-compiler. The examples are implementation patterns and must be adapted to the actual project, SDK version, platform guidelines, and accessibility requirements. Do not claim native compliance or successful device testing unless it was actually verified.

## Roadmap

- 0.1.x: core architecture.
- 0.2.x: 40 visual style profiles.
- 0.3.x: cross-platform design architecture and platform profiles.
- 0.4.x: platform and interaction engineering.
- 0.5.x: UI composition engine and reusable composition patterns.
- 0.6.x: cross-platform QA and validation harness.
- 1.0.0: stable cross-agent release.

## v0.5.0 — UI Composition Engine
AVDS now plans interface structure before code generation. The engine combines user tasks, information architecture, platform capabilities, interaction modalities, and visual identity to produce a Composition Plan and semantic Component Tree. It includes 14 adaptable archetypes, a layout grammar, adaptive composition rules, audit criteria, and worked examples for web GIS, mobile learning, and a desktop quantum lab.

**Important:** v0.5.0 provides structured design intelligence and planning artifacts, not an executable layout-generation runtime.

## v0.6.0 — Cross-Platform QA Engine
AVDS now includes a structured quality-assurance layer for reviewing implemented interfaces against the approved design brief and composition plan. It covers visual hierarchy, interaction behavior, responsive/adaptive layouts, accessibility, platform conventions, state completeness, traceability, and release gates.

The QA Engine is evidence-driven: it distinguishes confirmed defects from missing evidence and requires `not_assessed` where the relevant environment or artifact was not inspected. It provides review protocols, test case catalogs, finding templates, JSON schemas, and a sample report.

**Scope note:** This release supplies QA intelligence and workflows, not an automatic browser/device testing runtime.

## v1.0.0 — Unified Adaptive UI/UX Framework
AVDS v1.0.0 unifies the specialist design, composition, implementation, and QA skills under a single lifecycle orchestrator. The Design-to-Code Contract provides versioned artifact references, dependency tracking, implementation manifests, and explicit approval/status states. Agent handoffs are standardized, and change-impact governance helps regenerate only affected downstream artifacts.

### Core lifecycle
Intake → Design Brief → Style & Platform Resolution → Composition Plan → Contract Validation → Implementation → Evidence-Based QA → Delivery.

### Agent compatibility
The framework includes adapters for Antigravity, Codex, and generic coding agents. The core remains agent-independent.

### Scope and limitations
AVDS v1.0.0 is a modular, instruction-driven framework with schemas and workflow contracts. It does not claim to provide a fully autonomous execution runtime, automatic design-to-code compiler, or built-in browser/device automation. Agents and external tools perform execution; AVDS defines how work is planned, handed off, validated, and governed.

## v1.0.1 — Integration & Benchmark Kit
This companion release adds a controlled evaluation protocol to test whether AVDS improves real coding-agent output. It includes three representative product scenarios, paired baseline/AVDS prompts, a ten-dimension scoring rubric, operational metrics, report templates, and a machine-readable benchmark-run schema.

This package defines how to conduct the benchmark; it does not claim that the benchmark has already been executed.
