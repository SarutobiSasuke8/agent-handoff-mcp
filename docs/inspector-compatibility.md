# MCP Inspector compatibility

After `npm ci && npm run build`, run:

```sh
node eval/inspector.mjs
```

This invokes the actual `@modelcontextprotocol/inspector@2.11.0` CLI with
`--cli --format json --quiet` over stdio. npm installs that exact test-tool
version in its cache on first use; it needs registry access for that install.
The server calls themselves use no network or real data. Inspector requires
Node >=22.19; this separate check uses current Node 22 in CI without changing
the engine's documented minimum or release configuration.

Each invocation reuses `eval/target.mjs`, which seeds the existing synthetic
golden workspace in a fresh OS temp directory and starts the built server.
For the status-update call only, `--accept-second` starts its second synthetic
handoff as accepted. All other fixtures retain their original queued state.
This allows each short-lived Inspector session to exercise a successful call.
The target cleans up when the child exits.

The runner checks exactly six tool names and their existing input schemas,
then compares text and structured results against the existing response
goldens. Dynamic IDs, timestamps and policy revision use the same exclusions
as the existing suite. The status-update expectation reuses the acknowledge
golden with only `status` changed to `completed`. Failures exit nonzero; each
CLI call has a 120-second process timeout and the workflow has a 10-minute
limit. There is no UI/proxy listener, live registry, token input or remote
handoff. The board's synthetic demo is described in [board/demo-workspace.md](board/demo-workspace.md).

Upstream CLI syntax: [MCP Inspector CLI documentation](https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md).
