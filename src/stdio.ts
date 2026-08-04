#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { createHandoffMcpServer } from "./server.js";

const config = loadConfig();
if (!config.stdioAgentId) throw new Error("HANDOFF_AGENT_ID is required for stdio transport.");

const { registry, store, service } = createRuntime(config);
await registry.get(config.stdioAgentId);
const mcpServer = createHandoffMcpServer(service, config.stdioAgentId);
const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: config.maxMessageBytes + 65_536 });
await mcpServer.connect(transport);

async function shutdown(): Promise<void> {
  await mcpServer.close();
  store.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
