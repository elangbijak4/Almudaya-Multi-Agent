# User Guide — Draft

This guide is completed as CLI commands become available.

## Concepts

- A Session is the shared collaboration boundary.
- Each Bot has a stable Bot ID and editable display name.
- Each bot runs as an independent process.
- Session Blackboard stores shared information.
- Individual Blackboard stores messages addressed to one bot.

## Planned operator workflow

1. Install the package locally or globally after release.
2. Create a Session.
3. Start the first bot.
4. Start additional bots in separate terminals using the same Session ID.
5. Inspect bot registry and shared context.
6. Use broadcast and direct messaging commands.
7. Stop processes and restart later; persistent state should remain.

## Important limitation

v0.1.0 is infrastructure-first. It does not provide real LLM inference, autonomous orchestration, GUI, MCP, or RAG.
