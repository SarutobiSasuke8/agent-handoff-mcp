# Published 0.1.0 cold-install evidence, 2 November 2026

The public npm artifact `@sarutobi-sasuke/agent-handoff-mcp@0.1.0` was installed into a new project with a new empty npm cache and isolated home/config directories. Windows, Node 22.22.1, npm 11.19.0. No checkout build was substituted for the published server. Only synthetic identities and handoffs were used.

## Artifact and provenance

- Registry: https://registry.npmjs.org/.
- Integrity: `sha512-Q+nX0ZGJ2iMxmhpGFmwNoGVKrenWDBAXDhiM1IPtCVUgYW44MBsCiqBMi5Q3fi9LG5JUeGhRedSsu+B3UJbx5w==`.
- SHA-512: `43e9d7d19189da23319a1a46166c0da0654aade9d60c10170e188cd483ed095520616e38301b028aa04c8b94377e2f4b1b925478685179d4acbbe0775096f1e7`. Independently downloaded tarball matches registry integrity and attestation subject digest.
- [Attestations](https://registry.npmjs.org/-/npm/v1/attestations/@sarutobi-sasuke%2fagent-handoff-mcp@0.1.0): publish and SLSA provenance present.
- Source: `SarutobiSasuke8/agent-handoff-mcp`, commit `dad28ebd187f89bf84d9f583ec7934f6ec99164e`, `refs/tags/v0.1.0`.
- Workflow: `.github/workflows/release.yml`; [hosted publication run](https://github.com/SarutobiSasuke8/agent-handoff-mcp/actions/runs/40105322699/attempts/1).

## Verification

| Check | Actual result |
|---|---|
| Exact-version public install | Passed; 79 dependencies installed |
| `npm audit signatures` | Passed; 79 registry signatures and 14 attestations verified |
| Repository `cold-install-check.mjs` against public version | Passed all 8 checks: version, integrity, provenance, install, signatures, 5 declared binaries, CLI init and registry validate |
| Headless MCP client | Official TypeScript SDK client 2.4.0 over stdio, installed CLI entry point; initialization and listing all 6 tools passed |
| Repository `npm run check` | Typecheck, lint and 65 tests passed; 0 skipped |
| Lifecycle | Sender creates; recipient lists, accepts, completes; sender reads final event history. Passed |

The lifecycle uses two independent SDK clients and installed stdio server processes with a shared temporary SQLite database. Registry entries are synthetic, enabled, mutually allowlisted and carry no tokens. No HTTP endpoint or live agent registry is involved. `handoff_acknowledge` is the protocol's claim/accept operation; there is no separate tool named claim.

### Recorded synthetic tool calls and outputs

```json
[
  {
    "tool": "handoff_send",
    "arguments": {
      "recipient": "sample-beta",
      "title": "Synthetic published-artifact workflow",
      "summary": "No real user data",
      "request": "Accept and complete the synthetic handoff",
      "idempotency_key": "cold-install-20261102"
    },
    "result": {
      "handoff": {
        "id": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
        "threadId": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
        "depth": 0,
        "sender": "sample-alpha",
        "recipient": "sample-beta",
        "title": "Synthetic published-artifact workflow",
        "summary": "No real user data",
        "request": "Accept and complete the synthetic handoff",
        "contextRefs": [],
        "artifactRefs": [],
        "tags": [],
        "sensitivity": "internal",
        "priority": "normal",
        "status": "queued",
        "createdAt": "2026-11-02T11:26:59.860Z",
        "updatedAt": "2026-11-02T11:26:59.860Z",
        "idempotencyKey": "cold-install-20261102"
      }
    }
  },
  {
    "tool": "handoff_inbox",
    "arguments": {},
    "result": {
      "handoffs": [
        {
          "id": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
          "threadId": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
          "depth": 0,
          "sender": "sample-alpha",
          "recipient": "sample-beta",
          "title": "Synthetic published-artifact workflow",
          "summary": "No real user data",
          "request": "Accept and complete the synthetic handoff",
          "contextRefs": [],
          "artifactRefs": [],
          "tags": [],
          "sensitivity": "internal",
          "priority": "normal",
          "status": "queued",
          "createdAt": "2026-11-02T11:26:59.860Z",
          "updatedAt": "2026-11-02T11:26:59.860Z",
          "idempotencyKey": "cold-install-20261102"
        }
      ]
    }
  },
  {
    "tool": "handoff_acknowledge",
    "arguments": {
      "handoff_id": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
      "note": "Synthetic acceptance"
    },
    "result": {
      "handoff": {
        "id": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
        "threadId": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
        "depth": 0,
        "sender": "sample-alpha",
        "recipient": "sample-beta",
        "title": "Synthetic published-artifact workflow",
        "summary": "No real user data",
        "request": "Accept and complete the synthetic handoff",
        "contextRefs": [],
        "artifactRefs": [],
        "tags": [],
        "sensitivity": "internal",
        "priority": "normal",
        "status": "accepted",
        "createdAt": "2026-11-02T11:26:59.860Z",
        "updatedAt": "2026-11-02T11:27:55.501Z",
        "idempotencyKey": "cold-install-20261102"
      }
    }
  },
  {
    "tool": "handoff_update_status",
    "arguments": {
      "handoff_id": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
      "status": "completed",
      "note": "Synthetic completion"
    },
    "result": {
      "handoff": {
        "id": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
        "threadId": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
        "depth": 0,
        "sender": "sample-alpha",
        "recipient": "sample-beta",
        "title": "Synthetic published-artifact workflow",
        "summary": "No real user data",
        "request": "Accept and complete the synthetic handoff",
        "contextRefs": [],
        "artifactRefs": [],
        "tags": [],
        "sensitivity": "internal",
        "priority": "normal",
        "status": "completed",
        "createdAt": "2026-11-02T11:26:59.860Z",
        "updatedAt": "2026-11-02T11:27:55.521Z",
        "idempotencyKey": "cold-install-20261102"
      }
    }
  },
  {
    "tool": "handoff_get",
    "arguments": {
      "handoff_id": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04"
    },
    "result": {
      "handoff": {
        "id": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
        "threadId": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
        "depth": 0,
        "sender": "sample-alpha",
        "recipient": "sample-beta",
        "title": "Synthetic published-artifact workflow",
        "summary": "No real user data",
        "request": "Accept and complete the synthetic handoff",
        "contextRefs": [],
        "artifactRefs": [],
        "tags": [],
        "sensitivity": "internal",
        "priority": "normal",
        "status": "completed",
        "createdAt": "2026-11-02T11:26:59.860Z",
        "updatedAt": "2026-11-02T11:27:55.521Z",
        "idempotencyKey": "cold-install-20261102"
      },
      "events": [
        {
          "id": "6217bd18-dac2-48c6-b80c-39c6775fa854",
          "handoffId": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
          "actor": "sample-alpha",
          "eventType": "created",
          "toStatus": "queued",
          "createdAt": "2026-11-02T11:26:59.860Z"
        },
        {
          "id": "fc04aa70-829b-42ed-b554-131202d64a09",
          "handoffId": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
          "actor": "sample-beta",
          "eventType": "accepted",
          "fromStatus": "queued",
          "toStatus": "accepted",
          "note": "Synthetic acceptance",
          "createdAt": "2026-11-02T11:27:55.501Z"
        },
        {
          "id": "98236caf-f9f1-48b4-bf96-9d794fa4e41f",
          "handoffId": "19c680e0-d0c7-4bfe-8439-a04ceffe8f04",
          "actor": "sample-beta",
          "eventType": "completed",
          "fromStatus": "accepted",
          "toStatus": "completed",
          "note": "Synthetic completion",
          "createdAt": "2026-11-02T11:27:55.521Z"
        }
      ]
    }
  }
]
```

## Limits

The clean installed dependency tree reports 1 moderate audit finding. The repository development install reports 15 findings (12 moderate, 3 high). Signature verification establishes artifact origin, not absence of vulnerabilities. Dependencies were not changed as part of this evidence task.

Windows/Node 22 only. No Claude Desktop, ChatGPT connector, HTTP deployment or physical-machine recovery claim. The existing check script's install steps inherit the isolated environment supplied by this run; its own fresh home applies to the CLI smoke steps. No package publication, tag, release workflow, credential, auth implementation or deployment was changed. Beta promotion remains the owner's decision.
