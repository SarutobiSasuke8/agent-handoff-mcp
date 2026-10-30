import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import { RegistryTokenVerifier } from "./auth.js";
import { createRuntime } from "./runtime.js";
import { createHandoffMcpServer } from "./server.js";

import type { ErrorRequestHandler, Express, RequestHandler } from "express";
import type { AppConfig } from "./config.js";
import type { AgentRegistry } from "./registry.js";
import type { HandoffService } from "./service.js";
import type { HandoffStoreAdapter } from "./store-adapter.js";

export interface HttpApp {
  app: Express;
  registry: AgentRegistry;
  store: HandoffStoreAdapter;
  service: HandoffService;
  close: () => Promise<void>;
}

export async function buildHttpApp(config: AppConfig): Promise<HttpApp> {
  const { registry, store, service } = createRuntime(config);
  try { await store.ready(); await registry.current(); }
  catch (error) { await store.close(); throw error; }

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

  // RFC 6750 section 2: credentials go in the Authorization header only. A
  // request that also (or only) carries access_token in a JSON or form body is
  // rejected with invalid_request before any token check. Form bodies are
  // parsed here solely to find that field; MCP itself still requires JSON.
  const rejectBodyCredentials: RequestHandler = (request, response, next) => {
    const body: unknown = request.body;
    if (body && typeof body === "object" && Object.hasOwn(body, "access_token")) {
      response
        .status(400)
        .set("WWW-Authenticate", 'Bearer error="invalid_request", error_description="Send the bearer token in the Authorization header only"')
        .json({ error: "invalid_request", error_description: "Send the bearer token in the Authorization header only" });
      return;
    }
    next();
  };

  app.all(
    "/mcp",
    limiter,
    express.urlencoded({ extended: false, limit: "16kb" }),
    rejectBodyCredentials,
    requireBearerAuth({ verifier, requiredScopes: ["handoff"] }),
    async (request, response) => {
      // Stateless Streamable HTTP. Since SDK 2.3.0 a stateless transport serves
      // exactly one request and a server serves one connection at a time, so
      // both are built per request and closed when the response ends. The
      // runtime (registry, store, service) stays shared across requests.
      const mcpServer = createHandoffMcpServer(service);
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      response.on("close", () => {
        void mcpServer.close();
      });
      await mcpServer.connect(transport);
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
    registry,
    store,
    service,
    close: async () => {
      await store.close();
    },
  };
}
