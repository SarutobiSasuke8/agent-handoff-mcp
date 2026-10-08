# Demo workspace seed

`node scripts/seed-demo.mjs` creates the synthetic three-identity workspace used by the walkthrough and test cases. It writes an explicit bearer-token registry and a local token file. The seed is repeatable only when pointed at a new directory, because it intentionally replaces the registry file and token file at the requested paths.

The identities are `chatgpt-demo`, `codex-demo` and `operator-demo`. They are not real identities and must never be used for production access. The generated token file is mode 0600 where supported and is excluded from package contents.
