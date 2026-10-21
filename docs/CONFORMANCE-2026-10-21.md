# HTTP conformance findings, 21 October 2026

Tested source base: `28525bb11d44561c6dcb570641fb1d178bf09fd1`.
Node 22.22.1 on Windows. This change adds a test runner and does not migrate
the transport or change runtime authentication.

| Check | Result |
| --- | --- |
| Existing pinned Registry schema and package verification | Passed |
| curl POST without bearer token | HTTP 401 |
| curl POST with invalid synthetic bearer token | HTTP 401 |
| Inspector 2.11.0, legacy era, tools/list | All 6 expected tools |
| Inspector 2.11.0, legacy era, handoff_whoami | Fixture identity returned, no tool error |
| Conformance 0.2.0-alpha.12, requirements 2026-07-28 | Failed, exit 1 |

## Revision gap

The current `NodeStreamableHTTPServerTransport` rejects `2026-07-28` and
reports these supported revisions: `2025-11-25`, `2025-06-18`, `2025-03-26`,
`2024-11-05`, `2024-10-07`. An Inspector run pinned to its modern era also
refused to negotiate the newer revision. The runner therefore describes
the current HTTP target as 2025-11-25, independently of its 2026-07-28 gate.

The framework records failed MUST checks for the modern request metadata
and error envelope: it expects preserved JSON-RPC request IDs and modern
invalid-params responses; the older transport instead rejects the protocol
version with `-32000` and `id: null`. Its wire-schema check also reports the
null response ID. These are observations against the asserted newer revision,
not evidence that the older implementation violates its own target.

The full requirements set also includes example-server tools, resources,
prompts and optional extension scenarios. Agent Handoff has its 6 application
tools rather than that example API. Their failures are not 146 independent
product defects. The framework marks 13 extension/pending scenarios as
unscored. Review individual scenario checks and capability applicability
before accepting a migration or tightening a release gate.

## Evidence and follow-up

`npm run conformance` writes `summary.json`, `framework.txt`,
`framework-checks.json`, `registry.txt`, `inspector-list.txt` and
`inspector-call.txt`. Fixture credentials are redacted from logs; disposable
fixture files are removed after the checks. Existing registries and account
credentials are never read. No expected-failure baseline is supplied.

Regular `npm run check` passed all 54 tests. A separate `npm run test:e2e`
run passed all 10 existing application and recovery tests. Their success
does not override the failing newer-revision conformance check.

Next step: review the transport revision migration separately. Do not add
automatic fixes to this test runner or advertise 2026-07-28 conformance yet.

Primary references checked on 21 October 2026:

- [MCP 2026-07-28 Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Official conformance framework and revision requirements](https://github.com/modelcontextprotocol/conformance)
- [Official Inspector](https://github.com/modelcontextprotocol/inspector)
