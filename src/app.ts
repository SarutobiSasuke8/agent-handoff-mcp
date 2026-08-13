import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import { RegistryTokenVerifier } from "./auth.js";
import { createRuntime } from "./runtime.js";
import { createHandoffMcpServer } from "./server.js";

import type { McpServer } from "@modelcontextprotocol/server";
import type { ErrorRequestHandler, Express } from "express";
import type { AppConfig } from "./config.js";
import type { AgentRegistry } from "./registry.js";
import type { HandoffService } from "./service.js";
import type { HandoffStore } from "./store.js";

export interface HttpApp {
  app: Express;
  mcpServer: McpServer;
  registry: AgentRegistry;
  store: HandoffStore;
  service: HandoffService;
  close: () => Promise<void>;
}

export async function buildHttpApp(config: AppConfig): Promise<HttpApp> {
  const { registry, store, service } = createRuntime(config);
  await registry.current();

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
  // Helmet defaults, including a restrictive Content-Security-Policy. The
  // server only emits JSON and SSE, so the default CSP costs nothing and the
  // headers protect any browser that is pointed at an endpoint directly.
  app.use(helmet());

  const verifier = new RegistryTokenVerifier(registry);
  const limiter = rateLimit({
    windowMs: config.rateWindowMs,
    limit: config.rateLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "rate_limit_exceeded" },
  });

  app.get("/healthz", async (_request, response) => {
    await registry.current().catch(() => undefined);
    response.json({ status: "ok", service: "agent-handoff-mcp", policy: registry.state() });
  });

  app.get("/readyz", async (_request, response) => {
    await registry.current().catch(() => undefined);
    const policy = registry.state();
    response.status(policy.status === "ok" ? 200 : 503).json({ status: policy.status, policy });
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

  return {
    app,
    mcpServer,
    registry,
    store,
    service,
    close: async () => {
      await mcpServer.close();
      store.close();
    },
  };
}
