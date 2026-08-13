# Clean-room quickstart

Two complete flows for standing up Agent Handoff MCP in an empty directory with synthetic identities. Substitute your own absolute paths; the examples use an operator-owned directory outside any source checkout. Requirements: Node.js 22.13 or newer.

Both flows are executed automatically against the packed tarball by the end-to-end suite (`npm run test:e2e`), on Windows and Linux in CI.

Until the package is published to npm, replace the `npx -y @sarutobi-sasuke/agent-handoff-mcp` prefix in the commands below with a source checkout equivalent: clone the repository, run `npm ci && npm run build`, then use `node dist/src/cli.js` in its place.

## PowerShell (Windows)

```powershell
# 1. Operator-owned working directory.
$HandoffHome = "C:\Handoff"
New-Item -ItemType Directory -Force $HandoffHome | Out-Null
Set-Location $HandoffHome

# 2. Create a registry with disabled synthetic identities.
npx -y @sarutobi-sasuke/agent-handoff-mcp init --registry "$HandoffHome\agents.yaml"

# 3. Issue one expiring token per identity. Each raw token is printed once and
#    never stored; copy it to the client's configuration immediately.
npx -y @sarutobi-sasuke/agent-handoff-mcp issue --registry "$HandoffHome\agents.yaml" --agent example-alpha --expires 2027-01-01T00:00:00Z
npx -y @sarutobi-sasuke/agent-handoff-mcp issue --registry "$HandoffHome\agents.yaml" --agent example-beta --expires 2027-01-01T00:00:00Z

# 4. Enable the identities, then validate.
npx -y @sarutobi-sasuke/agent-handoff-mcp enable --registry "$HandoffHome\agents.yaml" --agent example-alpha
npx -y @sarutobi-sasuke/agent-handoff-mcp enable --registry "$HandoffHome\agents.yaml" --agent example-beta
npx -y @sarutobi-sasuke/agent-handoff-mcp validate --registry "$HandoffHome\agents.yaml"

# 5. Start the shared HTTP server.
$env:HANDOFF_MCP_REGISTRY = "$HandoffHome\agents.yaml"
$env:HANDOFF_MCP_DB = "$HandoffHome\handoffs.sqlite"
npx -y @sarutobi-sasuke/agent-handoff-mcp http
```

Verify from a second terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3220/healthz
Invoke-RestMethod http://127.0.0.1:3220/readyz
```

## POSIX shell (Linux and macOS)

```bash
# 1. Operator-owned working directory.
HANDOFF_HOME="$HOME/handoff"
mkdir -p "$HANDOFF_HOME" && cd "$HANDOFF_HOME"

# 2. Create a registry with disabled synthetic identities. The file is
#    created owner-readable only; provisioning refuses group/other-readable
#    registries.
npx -y @sarutobi-sasuke/agent-handoff-mcp init --registry "$HANDOFF_HOME/agents.yaml"

# 3. Issue one expiring token per identity (printed once, never stored).
npx -y @sarutobi-sasuke/agent-handoff-mcp issue --registry "$HANDOFF_HOME/agents.yaml" --agent example-alpha --expires 2027-01-01T00:00:00Z
npx -y @sarutobi-sasuke/agent-handoff-mcp issue --registry "$HANDOFF_HOME/agents.yaml" --agent example-beta --expires 2027-01-01T00:00:00Z

# 4. Enable the identities, then validate.
npx -y @sarutobi-sasuke/agent-handoff-mcp enable --registry "$HANDOFF_HOME/agents.yaml" --agent example-alpha
npx -y @sarutobi-sasuke/agent-handoff-mcp enable --registry "$HANDOFF_HOME/agents.yaml" --agent example-beta
npx -y @sarutobi-sasuke/agent-handoff-mcp validate --registry "$HANDOFF_HOME/agents.yaml"

# 5. Start the shared HTTP server.
export HANDOFF_MCP_REGISTRY="$HANDOFF_HOME/agents.yaml"
export HANDOFF_MCP_DB="$HANDOFF_HOME/handoffs.sqlite"
npx -y @sarutobi-sasuke/agent-handoff-mcp http
```

Verify from a second terminal:

```bash
curl -s http://127.0.0.1:3220/healthz
curl -s http://127.0.0.1:3220/readyz
```

## Connecting an MCP client

HTTP clients send the issued token as a bearer credential:

```text
POST http://127.0.0.1:3220/mcp
Authorization: Bearer handoff_<token issued above>
```

Stdio clients receive a fixed identity through their own process environment:

```json
{
  "command": "npx",
  "args": ["-y", "@sarutobi-sasuke/agent-handoff-mcp", "stdio"],
  "env": {
    "HANDOFF_AGENT_ID": "example-alpha",
    "HANDOFF_MCP_DB": "/absolute/operator-owned/handoffs.sqlite",
    "HANDOFF_MCP_REGISTRY": "/absolute/operator-owned/agents.yaml"
  }
}
```

## Credential lifecycle

```bash
# Replace a token; the previous token stops working immediately.
agent-handoff-mcp rotate  --registry <path> --agent example-alpha --expires 2027-06-01T00:00:00Z
# Disable an identity across every transport, without deleting history.
agent-handoff-mcp disable --registry <path> --agent example-alpha
# Remove a token binding entirely.
agent-handoff-mcp revoke  --registry <path> --agent example-alpha
```

Policy changes are picked up by running servers without a restart: the registry file is re-checked on every operation, and a broken registry write leaves the previous valid policy active while `/readyz` reports the degraded state.
