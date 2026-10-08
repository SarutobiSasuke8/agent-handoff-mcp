# Hosted demo walkthrough

1. **Prepare**: copy `.env.example`, install TLS certificates, and review the single-tenant storage and backup paths.
2. **Seed**: run `node scripts/seed-demo.mjs` in an operator-only directory. Store the printed token file outside the repository and share each token only with its intended client.
3. **Start**: run `docker compose -f deploy/board/compose.yml up -d --build`. The proxy waits for the application healthcheck.
4. **Check**: request `/healthz` and `/readyz` through TLS. A non-200 readiness response means do not connect clients.
5. **Connect**: configure ChatGPT and Codex with the streamable HTTP URL and their own bearer token. Use the skills in the plugin package to create, accept, review and close a handoff.
6. **Review**: execute the five positive cases, then the three negative cases. Record only pass/fail and synthetic IDs in review notes.
7. **Operate**: rotate or revoke tokens with the existing operator CLI. Take dated backups with the #19 backup command. Never restore over a live server.
8. **Close**: stop the stack, retain or delete the SQLite volume according to the operator retention decision, and revoke all demo tokens.

Astraeus implementation support is linked in the package metadata. There is no pricing or purchase flow in the chat experience.
