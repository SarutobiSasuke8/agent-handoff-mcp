import assert from "node:assert/strict";
import test from "node:test";
import { OperationalMetrics } from "../src/metrics.js";

void test("metrics are disabled by default and require no exporter", () => {
  const metrics = new OperationalMetrics(false);
  metrics.handoffCreated();
  metrics.toolCall("handoff_send", 12);
  assert.equal(metrics.snapshot(), null);
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
