# Integration Map for Engineering Agents

## Current integration points

```text
BotRuntime.start()
  └─ bot registration / activation
     └─ future: create bot register context after canonical botId exists

BotRuntime.pollCycle()
  ├─ MessagingService.readBroadcasts()
  ├─ onBroadcast callback
  ├─ advanceBroadcastCursor() after callback success
  ├─ recoverExpiredLeases()
  ├─ claimNextMessage()
  ├─ onMessage callback
  └─ completeMessage() / failMessage()

AutonomousAgentLoop.handleMessage()
  ├─ BotService.getBot/listBots()
  ├─ SharedContextService.listProjectRoots()
  ├─ WorkLogService.getRecentSummaryMarkdown()
  ├─ buildDynamicSystemPrompt()
  └─ bounded ReAct loop

FilesystemSessionStorage
  └─ IBlackboardStorage (single existing persistence abstraction)
```

## Recommended insertion strategy

- Add `MemoryRuntime` as an optional service assembled by a future composition root; do not instantiate a database in every bot.
- Pass a `MemoryClient`/scoped facade to each bot after bot identity is known.
- Add optional hooks around existing runtime and work-log events. Hooks must not change success/failure semantics of the legacy operation.
- Add KOE as a context provider behind an interface; existing `buildDynamicSystemPrompt` context remains fallback.
- Add message knowledge references as optional metadata first; do not change delivery payload semantics.
- Do not add direct PKU calls throughout `agent-loop.ts`; centralize through ports/adapters.
