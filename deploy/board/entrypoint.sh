#!/bin/sh
set -eu
if [ ! -f "$HANDOFF_MCP_REGISTRY" ]; then
  HANDOFF_DEMO_HOME=/var/lib/agent-handoff \
  HANDOFF_DEMO_TOKENS=/etc/agent-handoff/demo-tokens.env \
  HANDOFF_MCP_REGISTRY="$HANDOFF_MCP_REGISTRY" \
  node /app/scripts/seed-demo.mjs
fi
exec node /app/dist/src/http.js
