FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HANDOFF_MCP_HOST=0.0.0.0 \
    HANDOFF_MCP_PORT=3220 \
    HANDOFF_MCP_DB=/var/lib/agent-handoff/handoffs.sqlite \
    HANDOFF_MCP_REGISTRY=/etc/agent-handoff/agents.yaml
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY dist/src ./dist/src
COPY scripts/generate-token.mjs scripts/seed-demo.mjs ./scripts/
COPY deploy/board/entrypoint.sh ./scripts/board-entrypoint.sh
COPY schema ./schema
COPY docs ./docs
RUN mkdir -p /var/lib/agent-handoff /etc/agent-handoff && chmod +x /app/scripts/board-entrypoint.sh && chown -R node:node /app /var/lib/agent-handoff /etc/agent-handoff
USER node
EXPOSE 3220
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD node -e "fetch('http://127.0.0.1:3220/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["/app/scripts/board-entrypoint.sh"]
