# Contributing

Run `npm run check` before opening a pull request. Changes to lifecycle states, authorization, disclosure handling, identity binding, or storage migrations require tests and an update to `docs/PROTOCOL.md`.

Never add tools that execute handoff content, accept arbitrary SQL, fetch arbitrary references, or expose the host filesystem. Propose optional capabilities as bounded modules with explicit authority and audit behavior.
