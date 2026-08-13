import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

import { buildHttpApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { newToken } from "../../src/provision.js";

import type { Server } from "node:http";
import type { HttpApp } from "../../src/app.js";
import type { IssuedToken } from "../../src/provision.js";

export const TOOL_NAMES = [
  "handoff_whoami",
  "handoff_send",
  "handoff_inbox",
  "handoff_get",
  "handoff_acknowledge",
  "handoff_update_status",
];

export interface AgentSpec {
  id: string;
  enabled?: boolean;
  sendTo?: string[];
  receiveFrom?: string[];
  ceiling?: "public-safe" | "internal" | "restricted";
  expiresAt?: string;
}

export interface Fixture {
  dir: string;
  registryFile: string;
  databaseFile: string;
  tokens: Map<string, IssuedToken>;
  writeRegistry: (agents: AgentSpec[]) => Promise<void>;
  dispose: () => Promise<void>;
}

let mtimeTick = 0;

export function renderRegistry(agents: AgentSpec[], tokens: Map<string, IssuedToken>): string {
  const lines = ["version: 1", "agents:"];
  for (const agent of agents) {
    const token = tokens.get(agent.id);
    lines.push(
      `  - id: ${agent.id}`,
      `    display_name: Agent ${agent.id}`,
      `    enabled: ${agent.enabled ?? true}`,
      `    send_to: [${(agent.sendTo ?? []).join(", ")}]`,
      `    receive_from: [${(agent.receiveFrom ?? []).join(", ")}]`,
      `    disclosure_ceiling: ${agent.ceiling ?? "internal"}`,
    );
    if (token) {
      lines.push(`    token_sha256: ${token.digest}`);
      lines.push(`    expires_at: ${agent.expiresAt ?? "2100-01-01T00:00:00Z"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function createFixture(agents: AgentSpec[]): Promise<Fixture> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "handoff-e2e-"));
  const registryFile = path.join(dir, "agents.yaml");
  const databaseFile = path.join(dir, "handoffs.sqlite");
  const tokens = new Map<string, IssuedToken>(agents.map((agent) => [agent.id, newToken()]));
  const writeRegistry = async (next: AgentSpec[]): Promise<void> => {
    await writeFile(registryFile, renderRegistry(next, tokens), "utf8");
    mtimeTick += 1;
    const when = new Date(Date.now() - 120_000 + mtimeTick * 1000);
    await utimes(registryFile, when, when);
  };
  await writeRegistry(agents);
  return {
    dir,
    registryFile,
    databaseFile,
    tokens,
    writeRegistry,
    dispose: async () => rm(dir, { recursive: true, force: true }),
  };
}

export interface ToolOutcome {
  ok: boolean;
  text: string;
  value?: Record<string, unknown>;
}

export interface Session {
  client: Client;
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolOutcome>;
  close: () => Promise<void>;
}

async function openSession(client: Client, transport: Parameters<Client["connect"]>[0]): Promise<Session> {
  await client.connect(transport);
  return {
    client,
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const isError = result.isError === true;
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((item) => (typeof item === "object" && item !== null && "text" in item ? String((item as { text: unknown }).text) : ""))
        .join("\n");
      return {
        ok: !isError,
        text,
        ...(isError ? {} : { value: (result.structuredContent ?? JSON.parse(text)) as Record<string, unknown> }),
      };
    },
    close: async () => client.close(),
  };
}

export interface HttpHarness {
  url: string;
  app: HttpApp;
  server: Server;
  connect: (rawToken: string) => Promise<Session>;
  close: () => Promise<void>;
}

export async function startHttpHarness(fixture: Fixture, extraEnv: Record<string, string> = {}): Promise<HttpHarness> {
  const config = loadConfig({
    HANDOFF_MCP_HOST: "127.0.0.1",
    HANDOFF_MCP_DB: fixture.databaseFile,
    HANDOFF_MCP_REGISTRY: fixture.registryFile,
    ...extraEnv,
  });
  const app = await buildHttpApp(config);
  const server = await new Promise<Server>((resolve) => {
    const listener = app.app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No listening address.");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  return {
    url,
    app,
    server,
    connect: async (rawToken: string) => {
      const client = new Client({ name: "e2e-http-client", version: "0.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${rawToken}` } },
      });
      return openSession(client, transport);
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await app.close();
    },
  };
}

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/cli.js");

export async function startStdioSession(fixture: Fixture, agentId: string): Promise<Session> {
  const client = new Client({ name: "e2e-stdio-client", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, "stdio"],
    env: {
      ...getDefaultEnvironment(),
      HANDOFF_AGENT_ID: agentId,
      HANDOFF_MCP_DB: fixture.databaseFile,
      HANDOFF_MCP_REGISTRY: fixture.registryFile,
    },
    stderr: "pipe",
  });
  return openSession(client, transport);
}
