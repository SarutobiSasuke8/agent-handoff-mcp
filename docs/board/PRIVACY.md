# Privacy policy for the demo

The service stores the handoff content, lifecycle events, idempotency keys and the registry policy required to deliver the board. It stores bearer-token SHA-256 digests, not raw tokens. It does not require an OAuth identity provider and should not receive special-category or production-sensitive data in this demo.

The operator controls the SQLite database, registry, backups, TLS certificates and access logs. The operator must restrict filesystem access, rotate or revoke tokens, set a retention policy and delete demo data when the evaluation ends. Nginx and the application may record operational request metadata. Do not put secrets in titles, summaries, notes or references.

The service is single-tenant. There is no claim of tenant isolation, data residency, availability, deletion automation or production compliance in this recipe. Contact the operator through the Astraeus implementation link for deployment questions. This document is review material, not legal advice.
