import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { OperationalMetrics, startMetricsLogging } from "../src/metrics.js";

void test("metrics are disabled by default and require no exporter", () => {
  const metrics = new OperationalMetrics(false);
  metrics.handoffCreated();
  metrics.toolCall("handoff_send", 12);
  assert.equal(metrics.snapshot(), null);
});

void test("enabled server logging emits readable snapshots; disabled logging is silent", async () => {
  const lines: string[] = [];
  startMetricsLogging(new OperationalMetrics(false), (line) => lines.push(line))();
  assert.equal(lines.length, 0);
  const metrics = new OperationalMetrics(true);
  const stop = startMetricsLogging(metrics, (line) => lines.push(line), 5);
  metrics.handoffCreated();
  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();
  assert.ok(lines.length >= 3);
  const last = JSON.parse(lines.at(-1)!) as { resourceMetrics: Array<{ scopeMetrics: Array<{ scope: { version: string }; metrics: Array<{ name: string; sum?: { dataPoints: Array<{ asInt: string }> } }> }> }> };
  const scope = last.resourceMetrics[0]!.scopeMetrics[0]!;
  const metadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(scope.scope.version, metadata.version);
  assert.equal(scope.metrics.find((metric) => metric.name === "handoff.created")!.sum!.dataPoints[0]!.asInt, "1");
});

void test("blocked to accepted does not record a second claim", () => {
  const script = `
    import { HandoffStore } from './dist/src/store.js';
    import { operationalMetrics } from './dist/src/metrics.js';
    const store = new HandoffStore(':memory:');
    const h = store.create('sender', { recipient: 'recipient', title: 'Synthetic', summary: 'Synthetic', request: 'Synthetic', contextRefs: [], artifactRefs: [], tags: [], sensitivity: 'internal', priority: 'normal' }, 8);
    store.transition(h.id, 'recipient', 'accepted');
    store.transition(h.id, 'recipient', 'blocked');
    store.transition(h.id, 'recipient', 'accepted');
    console.log(JSON.stringify(operationalMetrics.snapshot()));
    store.close();
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, HANDOFF_MCP_METRICS: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const snapshot = JSON.parse(output) as { resourceMetrics: Array<{ scopeMetrics: Array<{ metrics: Array<{ name: string; sum?: { dataPoints: Array<{ asInt: string }> } }> }> }> };
  const claimed = snapshot.resourceMetrics[0]!.scopeMetrics[0]!.metrics.find((metric) => metric.name === "handoff.claimed");
  assert.equal(claimed!.sum!.dataPoints[0]!.asInt, "1");
});

void test("OTLP-shaped metrics contain only fixed names, counts and timings", () => {
  const metrics = new OperationalMetrics(true);
  metrics.handoffCreated();
  metrics.handoffClaimed();
  metrics.storeError();
  metrics.toolCall("handoff_send", 12);
  const snapshot = JSON.stringify(metrics.snapshot());
  for (const name of ["handoff.created", "handoff.claimed", "handoff.expired",
    "handoff.store.errors", "mcp.tool.call.duration", "handoff_send"]) {
    assert.ok(snapshot.includes(name), `missing ${name}`);
  }
  assert.ok(snapshot.includes('"asInt":"1"'));
  assert.ok(snapshot.includes('"unit":"ms"'));
  const parsed = JSON.parse(snapshot) as { resourceMetrics: Array<{ scopeMetrics: Array<{
    metrics: Array<{ histogram?: { dataPoints: Array<{ attributes: Array<{ key: string }> }> } }>
  }> }> };
  const labels = parsed.resourceMetrics.flatMap((resource) => resource.scopeMetrics
    .flatMap((scope) => scope.metrics.flatMap((metric) => metric.histogram?.dataPoints
      .flatMap((point) => point.attributes.map((attribute) => attribute.key)) ?? [])));
  assert.deepEqual(labels, ["tool"]);
  assert.ok(!snapshot.includes("title") && !snapshot.includes("token") &&
    !snapshot.includes("agentId") && !snapshot.includes("recipient"));
});
