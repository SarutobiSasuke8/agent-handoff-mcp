import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

import type { ChildProcess } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function npm(args: string[], cwd: string): string {
  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitFor(url: string, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // Server not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become healthy at ${url}.`);
}

interface ToolOutcome {
  ok: boolean;
  text: string;
  value?: Record<string, unknown>;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((item) => (typeof item === "object" && item !== null && "text" in item ? String((item as { text: unknown }).text) : ""))
    .join("\n");
  const ok = result.isError !== true;
  return { ok, text, ...(ok ? { value: JSON.parse(text) as Record<string, unknown> } : {}) };
}

// Clean-room conformance: pack the tarball, install it into an empty
// directory, provision a registry with the shipped CLI, and drive the
// installed stdio and HTTP servers with a real MCP client. This is the
// executable form of docs/QUICKSTART.md.
void test("packed tarball installs and serves both transports from a clean directory", { timeout: 600_000 }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "handoff-pack-"));
  t.after(async () => rm(temp, { recursive: true, force: true }).catch(() => undefined));

  // 1. Pack from the repository.
  npm(["pack", "--pack-destination", temp], repoRoot);
  const tarball = (await readdir(temp)).find((file) => file.endsWith(".tgz"));
  assert.ok(tarball, "npm pack must produce a tarball");

  // 2. Install into a clean operator directory.
  const install = path.join(temp, "operator");
  await writeFile(path.join(temp, ".keep"), "", "utf8");
  npm(["install", "--prefix", install, "--no-audit", "--no-fund", path.join(temp, tarball)], temp);

  // 3. The default bin matches the unscoped package name, so npx-style
  //    selection resolves (the audit probe failed with "could not determine
  //    executable to run").
  const binDir = path.join(install, "node_modules", ".bin");
  const binNames = await readdir(binDir);
  assert.ok(binNames.some((name) => name.startsWith("agent-handoff-mcp")), "default dispatcher bin must be installed");
  const helpOutput = npm(["exec", "--no", "--prefix", install, "agent-handoff-mcp", "help"], install);
  assert.match(helpOutput, /Usage: agent-handoff-mcp/u);

  // 4. Provision a registry with the shipped commands, using synthetic
  //    identities and operator-owned absolute paths.
  const registry = path.join(install, "agents.yaml");
  const database = path.join(install, "handoffs.sqlite");
  const cli = (args: string[]): string => npm(["exec", "--no", "--prefix", install, "agent-handoff-mcp", "--", ...args], install);
  cli(["init", "--registry", registry]);
  const alphaToken = /Raw token for 'example-alpha' \(shown once, never stored\): (\S+)/u.exec(
    cli(["issue", "--registry", registry, "--agent", "example-alpha", "--expires", "2100-01-01T00:00:00Z", "--allow-insecure"]),
  )?.[1];
  const betaToken = /Raw token for 'example-beta' \(shown once, never stored\): (\S+)/u.exec(
    cli(["issue", "--registry", registry, "--agent", "example-beta", "--expires", "2100-01-01T00:00:00Z", "--allow-insecure"]),
  )?.[1];
  assert.ok(alphaToken && betaToken, "issue must print each raw token once");
  cli(["enable", "--registry", registry, "--agent", "example-alpha"]);
  cli(["enable", "--registry", registry, "--agent", "example-beta"]);
  assert.match(cli(["validate", "--registry", registry]), /Registry valid: 2 agent\(s\), 2 enabled/u);
  const registrySource = await readFile(registry, "utf8");
  assert.ok(!registrySource.includes(alphaToken), "raw tokens must never be persisted");

  const packageDir = path.join(install, "node_modules", "@sarutobi-sasuke", "agent-handoff-mcp");
  const cliEntry = path.join(packageDir, "dist", "src", "cli.js");

  // 5. Installed stdio server: initialize, list tools, one allowed call.
  const stdioClient = new Client({ name: "pack-stdio", version: "0.0.0" });
  const stdioTransport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntry, "stdio"],
    env: {
      ...getDefaultEnvironment(),
      HANDOFF_AGENT_ID: "example-alpha",
      HANDOFF_MCP_DB: database,
      HANDOFF_MCP_REGISTRY: registry,
    },
    stderr: "pipe",
  });
  await stdioClient.connect(stdioTransport);
  const stdioTools = await stdioClient.listTools();
  assert.equal(stdioTools.tools.length, 6);
  const whoami = await callTool(stdioClient, "handoff_whoami", {});
  assert.ok(whoami.ok, whoami.text);
  assert.equal(whoami.value?.agent_id, "example-alpha");
  await stdioClient.close();

  // 6. Installed HTTP server: health, readiness, allowed lifecycle, denied
  //    read, persistence across restart, shutdown.
  const port = 3220 + Math.floor(Math.random() * 2000);
  const httpEnv = {
    ...process.env,
    HANDOFF_MCP_PORT: String(port),
    HANDOFF_MCP_DB: database,
    HANDOFF_MCP_REGISTRY: registry,
  };
  const startServer = (): ChildProcess => spawn(process.execPath, [cliEntry, "http"], { env: httpEnv, stdio: "ignore" });
  const stopServer = async (child: ChildProcess): Promise<void> => {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(forceTimer);
  };

  let server = startServer();
  try {
    await waitFor(`http://127.0.0.1:${port}/healthz`);
    await waitFor(`http://127.0.0.1:${port}/readyz`);

    const connect = async (token: string): Promise<Client> => {
      const client = new Client({ name: "pack-http", version: "0.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }));
      return client;
    };

    const alpha = await connect(alphaToken);
    const beta = await connect(betaToken);
    const sent = await callTool(alpha, "handoff_send", {
      recipient: "example-beta",
      title: "Clean-room check",
      summary: "Round trip through the packed artifact.",
      request: "Acknowledge and complete.",
      idempotency_key: "pack-e2e-1",
    });
    assert.ok(sent.ok, sent.text);
    const handoffId = (sent.value?.handoff as { id: string }).id;

    // Denied read: the sender may not acknowledge its own handoff, and an
    // unauthenticated request is rejected outright.
    const deniedTransition = await callTool(alpha, "handoff_acknowledge", { handoff_id: handoffId });
    assert.ok(!deniedTransition.ok, "sender must not acknowledge its own handoff");
    const unauthenticated = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.equal(unauthenticated.status, 401);
    await unauthenticated.arrayBuffer();

    const acknowledged = await callTool(beta, "handoff_acknowledge", { handoff_id: handoffId, note: "On it." });
    assert.ok(acknowledged.ok, acknowledged.text);
    await alpha.close();
    await beta.close();

    // Restart persistence.
    await stopServer(server);
    server = startServer();
    await waitFor(`http://127.0.0.1:${port}/healthz`);
    const betaAgain = await connect(betaToken);
    const inbox = await callTool(betaAgain, "handoff_inbox", {});
    assert.ok(inbox.ok, inbox.text);
    const items = inbox.value?.handoffs as { id: string; status: string }[];
    assert.equal(items.length, 1);
    assert.equal(items[0]?.status, "accepted");
    await betaAgain.close();
  } finally {
    await stopServer(server);
  }
});
