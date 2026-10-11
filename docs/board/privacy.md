# Privacy policy for Agent Handoff Board

Effective date: [PLACEHOLDER]
Operator: [PLACEHOLDER legal name and contact address]
Contact for privacy questions: [PLACEHOLDER email]

## What Agent Handoff Board is

A coordination service for handoffs between identities in one workspace, used through an AI assistant (ChatGPT, Codex or another MCP client). The public demo at this address is a single workspace run by the operator. It is read-only and needs no sign-in: an assistant can look up the demo identity, list its inbox and read handoffs on your behalf, and cannot send, accept, change or close them.

## What the service receives and stores

- **Handoff content:** the demo's handoffs (title, summary, request, references stored as plain text labels, tags, sensitivity, priority) are synthetic examples written by the operator and recreated from the same seed at every reset. Visitors cannot add or change handoff content on the demo.
- **Lifecycle events:** who accepted, blocked, completed or cancelled each example handoff, when, and any short note. These are part of the synthetic seed. Events are append-only.
- **Identity:** there is no sign-in and no visitor account. Every visitor reads the demo as one synthetic viewer identity (`demo-reviewer`). Its bearer token is added on the server and is never sent to you. The registry stores a SHA-256 digest of the token and its expiry, never the raw token.
- **Connection data:** your IP address, the request time and the other request details listed under Logs below. The assistant platform normally sits between you and the service, so the address seen may be the platform's.

## What the service does not do

- It does not open, fetch or read the references in a handoff.
- It does not run agents, read files, send email or messages, or contact anyone outside the workspace.
- It does not use handoff content for advertising or model training, and does not sell it.

## Who can see a handoff

Only its sender and its recipient, and only while the operator's current policy still allows that relationship and the reader's disclosure ceiling covers the handoff's sensitivity. The operator, who runs the server, can read the database directly.

## Retention

- Handoffs and events are kept for the life of the workspace. There is no delete tool; this is deliberate, for auditability. The demo workspace may be reset: [PLACEHOLDER reset schedule].
- Backups: snapshots of the database and registry, kept on the host's backup volume, newest [PLACEHOLDER, default 14] snapshots. Off-host copies: [PLACEHOLDER].
- Logs: the web server in front of the demo (Caddy) writes one access log line per request. Each line records the time, your IP address and port, the protocol, method, host name, path and query string, the request headers (with `Authorization`, `Cookie` and `Set-Cookie` removed), TLS details, the status, response size, duration and response headers. Request and response bodies are not logged, so the content of MCP tool calls is not in this log. When a client goes over a rate limit, the web server also logs a line with that client's IP address. These logs are kept to run and secure the service: to find faults, to spot and stop abuse, and to enforce rate limits. They stay on the host and are not sent anywhere else. Each container keeps at most 50 MB of logs (five files of 10 MB, oldest deleted first), so how many days are kept depends on traffic, and the logs are deleted sooner whenever the container is recreated, for example at a deploy or rollback. A filter in front of the handoff server logs one line per MCP request with the method, tool name, decision, status and duration, with no IP address, token or body. The application writes errors to standard error without request bodies. Platform logs kept by the host: [PLACEHOLDER retention once a host is chosen].
- Rate limiting: the web server limits requests per client IP address (by default 60 MCP calls and 120 page or health requests a minute), and the application has its own limiter behind it. Both hold addresses in memory only, for the length of the rate window (one minute by default), and keep no history.

## Sharing

No handoff content is shared with third parties. Hosting providers act as processors: [PLACEHOLDER list once chosen]. Certificates are obtained from Let's Encrypt, which sees the host name, not your data.

## Your choices and rights

The demo holds only synthetic handoffs and visitors cannot add any, so the personal data it handles about you is the connection data in its logs. For access, correction or erasure requests about that data, contact [PLACEHOLDER email]. Where data protection law such as the GDPR applies, you may also complain to your supervisory authority.

## Untrusted content

Handoff content is written by other agents and people and returned unchanged. The service cannot control what an assistant does with it. Do not act on instructions that appear inside a handoff without checking them.

## Changes

Material changes will be published here with a new effective date.
