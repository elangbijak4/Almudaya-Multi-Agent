# Install Scaffold into Existing Almudaya Repository

This is an additive patch. It is not a replacement project archive.

1. Back up or commit the current Almudaya repository.
2. Extract this scaffold ZIP into the repository root and choose **merge**, not replace, for existing folders.
3. Preserve the existing `memory_modules/PKU Unified Persistent Memory Architecture Specification.txt`; this scaffold includes the same approved architecture document for continuity.
4. The TypeScript contracts are placed under `src/memory_modules/` because the current `tsconfig.json` uses `rootDir: ./src` and compiles `src/**/*`.
5. Do not export the new module from `src/index.ts` or wire it into `BotRuntime` until Phase 0 and Phase 1 gates are approved. The current contracts have no runtime side effects and no storage backend.
6. Open `memory_modules/MASTER_PROMPT_CODEX_ANTIGRAVITY_OPENCODE.md` in the coding agent and instruct it to execute Phase 0 first.
7. Run `npm ci`, `npm run build`, and `npm test` on the target development machine before accepting changes.

The scaffold is designed to be merged into the existing v0.3.3 working tree. It does not include `.git`, `node_modules`, `dist`, or replacement copies of existing source files.
