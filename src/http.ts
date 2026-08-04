#!/usr/bin/env node
import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import { RegistryTokenVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { createHandoffMcpServer } from "./server.js";

import type { ErrorRequestHandler } from "express";

const config = loadConfig();
const { registry, store, service } = createRuntime(config);
await registry.all();

const mcpServer = createHandoffMcpServer(service);
const transport = new NodeStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});
await mcpServer.connect(transport);

const app = createMcpExpressApp({
  host: config.host,
  jsonLimit: `${config.maxMessageBytes + 16_384}b`,
  ...(config.allowedHosts ? { allowedHosts: config.allowedHosts } : {}),
  ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
});
app.disable("x-powered-by");
if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);
app.use(helmet({ strictTransportSecurity: false, contentSecurityPolicy: false }));

const verifier = new RegistryTokenVerifier(registry);
const limiter = rateLimit({
  windowMs: config.rateWindowMs,
  limit: config.rateLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" },
});

app.get("/healthz", (_request, response) => {
  response.json({ status: "ok", service: "agent-handoff-mcp" });
});

app.all(
  "/mcp",
  limiter,
  requireBearerAuth({ verifier, requiredScopes: ["handoff"] }),
  async (request, response) => {
    await transport.handleRequest(request, response, request.body);
  },
);

app.use((_request, response) => {
  response.status(404).json({ error: "not_found" });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;
  process.stderr.write(`Request failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  if (!response.headersSent) response.status(500).json({ error: "internal_server_error" });
};
app.use(errorHandler);

const httpServer = app.listen(config.port, config.host, () => {
  process.stdout.write(`Agent Handoff MCP listening on http://${config.host}:${config.port}/mcp\n`);
});
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 35_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.maxRequestsPerSocket = 1_000;

async function shutdown(): Promise<void> {
  httpServer.close();
  await mcpServer.close();
  store.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
