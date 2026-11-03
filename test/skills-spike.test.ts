import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";

import { AgentRegistry } from "../src/registry.js";
import { createHandoffMcpServer } from "../src/server.js";
import { HandoffService } from "../src/service.js";
import { HandoffStore } from "../src/store.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedTools = ["handoff_whoami", "handoff_send", "handoff_inbox", "handoff_get", "handoff_acknowledge", "handoff_update_status"].sort();

for (const protocolVersion of ["2025-11-25"]) {
  void test(`static skills discovery and verified reads on ${protocolVersion}`, async () => {
    const store = new HandoffStore(":memory:");
    const service = new HandoffService(new AgentRegistry(`${root}/config/agents.example.yaml`), store, {
      maxMessageBytes: 32_768, maxHandoffDepth: 8,
    });
    const server = createHandoffMcpServer(service, "example-worker");
    const catalog = await loadSkills(`${root}/skills`, { strict: true });
    catalog.attach(server);
    const client = new Client({ name: "skills-spike-test", version: "0.0.0" }, { supportedProtocolVersions: [protocolVersion] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), expectedTools);
      const skills = new SkillsClient(client);
      const listing = await skills.list();
      assert.deepEqual(listing.skills.map(skill => skill.frontmatter.name).sort(), ["bounded-task-handoff", "review-and-close-handoff"]);
      for (const entry of listing.skills) {
        const manifest = await skills.read(entry);
        assert.equal(manifest.verified, true);
        assert.match(manifest.body ?? "", /handoff_/u);
        assert.equal((await skills.get(entry.uri)).skill.uri, entry.uri);
      }
      await assert.rejects(skills.get("skill://missing/SKILL.md"));
    } finally {
      await client.close(); await server.close(); store.close();
    }
  });
}
