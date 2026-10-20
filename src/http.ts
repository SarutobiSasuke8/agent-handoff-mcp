#!/usr/bin/env node
import { buildHttpApp } from "./app.js";
import { loadConfig } from "./config.js";
import { startMetricsLogging } from "./metrics.js";

const config = loadConfig();
const { app, close } = await buildHttpApp(config);
const stopMetricsLogging = startMetricsLogging();

const httpServer = app.listen(config.port, config.host, () => {
  process.stdout.write(`Agent Handoff MCP listening on http://${config.host}:${config.port}/mcp\n`);
});
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 35_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.maxRequestsPerSocket = 1_000;

async function shutdown(): Promise<void> {
  httpServer.close();
  await close();
  stopMetricsLogging();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
