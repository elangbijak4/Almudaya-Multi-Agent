# PKU Memory Modules — Integration Scaffold

**Target repository:** Almudaya Multi-Agent v0.3.3  
**Architecture:** PKU Unified Persistent Memory  
**Status:** Scaffold only — contracts and migration plan prepared; no production persistence path has been redirected.

## Read order for coding agents

1. `AUDIT_BASELINE.md` — findings from the supplied source snapshot.
2. `PKU Unified Persistent Memory Architecture Specification.txt` — approved architecture v0.2.
3. `MIGRATION/EXISTING_SYSTEM_INVENTORY.md` — actual existing storage and runtime integration points.
4. `MIGRATION/COMPATIBILITY_MATRIX.md` — legacy APIs and data that must remain compatible.
5. `MIGRATION/PHASED_MIGRATION_PLAN.md` — safe implementation sequence and gates.
6. `contracts/` and `src/memory_modules/` — initial TypeScript contracts.
7. `prompts/MASTER_PROMPT_CODEX_ANTIGRAVITY_OPENCODE.md` — execution prompt for an engineering agent.

## Architectural rule

PKU is the persistent memory foundation. Blackboard remains the existing global operational register; ACMA is the intended individual operational register. Both must be backed by PKU through adapters and incremental migration. **Do not rewrite or bypass existing Blackboard, messaging, bot runtime, or session services.**

## Important audit qualification

In the supplied v0.3.3 source snapshot, the existing per-bot persistent state is represented by bot registry records, per-bot inboxes, and per-bot broadcast cursors. Session-wide work history is persisted in `work_log.jsonl`. A separate, fully implemented ACMA subsystem with working/semantic/episodic/procedural/prospective stores and checkpoint manager was not found under `src/`. Preserve the existing per-bot state and treat the full ACMA capability as a planned integration target until any additional implementation outside this archive is supplied and audited.

## Scaffold layout

- `src/memory_modules/`: compile-targeted TypeScript contracts under the existing `src` root.
- `memory_modules/`: architecture, migration, adapter, lifecycle, testing, and agent execution guidance.
- Existing `src/blackboard`, `src/bot`, `src/messaging`, `src/session`, and `src/shared` remain in place.

## Current implementation status

| Capability | Status |
|---|---|
| PKU canonical contracts | Initial scaffold |
| Project Memory Universe | Contract/design only |
| Tree + graph model | Contract/design only |
| KOE | Specification and port definitions only |
| Global Register bridge | Compatibility mapping documented; not wired |
| Individual Register / ACMA | Existing state inventory documented; full ACMA not present in supplied `src/` |
| Messaging knowledge references | Contract only; existing messaging unchanged |
| Lifecycle / retention / purge | Policy and operation contracts only |
| External adapters | Adapter contract only |
| Data migration | Plan and validation gates only |

Nothing in this scaffold should be represented as an active PKU persistence service until implemented and tested.
