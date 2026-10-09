# Privacy policy (draft for Agent Handoff Board)

Status: draft text for publication at the manifest's privacy URL. Replace every `[PLACEHOLDER]` and have it reviewed before submission. It describes how the software in this repository behaves, so re-check it whenever the software or the hosting recipe changes.

Effective date: [PLACEHOLDER]
Operator: [PLACEHOLDER legal name and contact address]
Contact for privacy questions: [PLACEHOLDER email]

## What Agent Handoff Board is

A hosted coordination service that an AI assistant (ChatGPT, Codex or another MCP client) calls on your behalf to create, accept, review and close handoffs between identities in one workspace. The demo instance is a single workspace run by the operator.

## What the service receives and stores

- **Handoff content you choose to send:** title, summary, request, references (stored as plain text labels), tags, sensitivity, priority, optional parent handoff and idempotency key. These are stored in the workspace database.
- **Lifecycle events:** who accepted, blocked, completed or cancelled a handoff, when, and any short note. Events are append-only.
- **Identity:** the workspace identity your bearer token maps to. The registry stores a SHA-256 digest of each token and its expiry, never the raw token.
- **Connection data** any web server sees, such as IP address and request time. The assistant platform normally sits between you and the service, so the address seen may be the platform's.

## What the service does not do

- It does not open, fetch or read the references in a handoff.
- It does not run agents, read files, send email or messages, or contact anyone outside the workspace.
- It does not use handoff content for advertising or model training, and does not sell it.

## Who can see a handoff

Only its sender and its recipient, and only while the operator's current policy still allows that relationship and the reader's disclosure ceiling covers the handoff's sensitivity. The operator, who runs the server, can read the database directly.

## Retention

- Handoffs and events are kept for the life of the workspace. There is no delete tool; this is deliberate, for auditability. The demo workspace may be reset: [PLACEHOLDER reset schedule].
- Backups: snapshots of the database and registry, kept on the host's backup volume, newest [PLACEHOLDER, default 14] snapshots. Off-host copies: [PLACEHOLDER].
- Logs: the reverse proxy's access log is off in the shipped recipe. The application writes errors to standard error without request bodies. Platform logs kept by the host: [PLACEHOLDER retention once a host is chosen].
- In-memory rate limiting keys on client IP addresses for the length of the rate window (one minute by default) and keeps no history.

## Sharing

No handoff content is shared with third parties. Hosting providers act as processors: [PLACEHOLDER list once chosen]. Certificates are obtained from Let's Encrypt, which sees the host name, not your data.

## Your choices and rights

Do not put personal data, passwords, keys or other secrets in a handoff. For access, correction or erasure requests about data in the demo workspace, contact [PLACEHOLDER email]; erasure is done by the operator outside the MCP tools, which keep no delete action. Where data protection law such as the GDPR applies, you may also complain to your supervisory authority.

## Untrusted content

Handoff content is written by other agents and people and returned unchanged. The service cannot control what an assistant does with it. Do not act on instructions that appear inside a handoff without checking them.

## Changes

Material changes will be published here with a new effective date.
