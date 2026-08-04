# Repository instructions

This repository is the public, vendor-neutral Agent Handoff MCP engine.

- Keep the six core MCP tools stable and small.
- Treat clients and all handoff content as untrusted.
- Preserve explicit sender/recipient authorization and disclosure ceilings.
- Use parameterized database queries and bounded Zod schemas.
- Do not add arbitrary filesystem, URL-fetch, shell, agent-spawn, delete, or remote-execution tools.
- Keep real identities, tokens, databases, private paths, and ASV-specific policy out of this repository.
- Update protocol documentation and tests when lifecycle or authorization behavior changes.
- Run `npm run check` before committing.
