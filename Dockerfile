# Agent Handoff MCP, Streamable HTTP server image for the Agent Handoff Board hosted demo.
# Single tenant. Local build only until an operator deploys it; see docs/board/hosting.md.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
# Skip the `prepare` build hook until the sources are present.
RUN npm ci --ignore-scripts
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev --ignore-scripts

FROM node:22-slim
ENV NODE_ENV=production \
    HANDOFF_MCP_HOST=0.0.0.0 \
    HANDOFF_MCP_PORT=3220 \
    HANDOFF_MCP_DB=/var/lib/agent-handoff/handoffs.sqlite \
    HANDOFF_MCP_REGISTRY=/var/lib/agent-handoff/agents.yaml \
    HANDOFF_MCP_ALLOWED_HOSTS=localhost,127.0.0.1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY scripts/board-demo-seed.mjs scripts/board-backup.mjs scripts/generate-token.mjs ./scripts/
# The state directory is a volume mount point; create it owned by the unprivileged user so
# a fresh named volume inherits that ownership.
RUN mkdir -p /var/lib/agent-handoff /var/backups/agent-handoff \
  && chown node:node /var/lib/agent-handoff /var/backups/agent-handoff \
  && chmod 700 /var/lib/agent-handoff /var/backups/agent-handoff
USER node
EXPOSE 3220
VOLUME ["/var/lib/agent-handoff"]
# Healthy only when the process answers /healthz and /readyz reports a valid policy (200).
# The server refuses to start without a valid registry, so seed the volume before `up`
# (docs/board/hosting.md). A registry that later fails validation turns /readyz into 503.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "const b='http://127.0.0.1:'+(process.env.HANDOFF_MCP_PORT||3220);Promise.all([fetch(b+'/healthz'),fetch(b+'/readyz')]).then(([h,r])=>process.exit(h.ok&&r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/cli.js", "http"]
