# Board review cases

Run these against a fresh seeded workspace with `chatgpt-demo`, `codex-demo` and `operator-demo` tokens. The exact MCP calls use the existing six-tool protocol.

## Positive cases

1. **Create**: ChatGPT calls `handoff_send` to Codex with a title, summary, request and unique idempotency key. Expect a queued handoff and an event.
2. **Accept**: Codex calls `handoff_acknowledge` for that ID with a short note. Expect status `accepted`.
3. **Review inbox**: Codex calls `handoff_inbox`. Expect the handoff, but no unrelated item.
4. **Read history**: Codex calls `handoff_get` for the ID. Expect bounded content and lifecycle events within its disclosure ceiling.
5. **Close**: Codex calls `handoff_update_status` with `completed` and a note. Expect status `completed` and a final event.

## Negative cases

1. **Unauthorised recipient**: ChatGPT sends to an identity absent from its `send_to` list. Expect an authorisation error and no handoff.
2. **Unauthorised read**: ChatGPT calls `handoff_get` for a handoff addressed to an unrelated identity. Expect an authorisation error and no disclosed content.
3. **Idempotency conflict**: Reuse an existing sender/idempotency key with changed content. Expect an idempotency conflict and the original handoff unchanged.

The server remains the source of truth for authorisation and disclosure. These cases do not add an `annotate` tool.
