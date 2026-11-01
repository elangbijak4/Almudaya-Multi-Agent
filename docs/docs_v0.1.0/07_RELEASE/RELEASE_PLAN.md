# Release Plan — v0.1.0

## 1. Release objective

Deliver a local, persistent, multi-process collaboration foundation with CLI, shared Session Blackboard, per-bot inbox, and basic shared project context.

## 2. Pre-release checks

- [ ] All Must requirements verified.
- [ ] Full test suite passes.
- [ ] Cross-platform assumptions documented and tested where available.
- [ ] README includes install/use instructions and limitations.
- [ ] Changelog updated.
- [ ] License selected by project owner and included.
- [ ] Package metadata and executable mapping verified.
- [ ] `npm pack --dry-run` reviewed.
- [ ] No secrets or local workspace data included.
- [ ] Package name availability checked immediately before publication.
- [ ] Version number confirmed.
- [ ] No publication without explicit authorization.

## 3. Proposed CLI smoke sequence

The exact command grammar is finalized during implementation:

```bash
almudaya --help
almudaya --version
almudaya session create research-app
almudaya bot start --session S001 --bot BOT001
almudaya bot start --session S001 --bot BOT002
```

## 4. Release notes must include

- Features delivered.
- Supported Node.js versions and operating systems tested.
- Installation and quick start.
- Workspace location/configuration.
- Persistence and concurrency behavior.
- Known limitations.
- Security considerations.
- Deferred features.
