import { readFileSync } from "node:fs";

// Support compiled dist/src and the source-mode development command.
const packageVersion = (() => {
  for (const relative of ["../package.json", "../../package.json"]) {
    try {
      const metadata = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8")) as { name?: string; version?: string };
      if (metadata.name === "@sarutobi-sasuke/agent-handoff-mcp" && metadata.version) return metadata.version;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Agent Handoff package version is unavailable.");
})();

/** In-process OTLP JSON-shaped metrics. No exporter, network call or content labels. */
export const toolNames = [
  "handoff_whoami", "handoff_send", "handoff_inbox", "handoff_get",
  "handoff_acknowledge", "handoff_update_status",
] as const;
export type ToolName = typeof toolNames[number];

const bounds = [5, 10, 25, 50, 100, 250, 500, 1_000, 5_000];
type Histogram = { count: number; sum: number; buckets: number[] };
const nano = (milliseconds: number) => String(Math.floor(milliseconds * 1_000_000));

export class OperationalMetrics {
  private readonly startedAt = nano(Date.now());
  private readonly counters = { created: 0, claimed: 0, expired: 0, storeErrors: 0 };
  private readonly calls = new Map<ToolName, Histogram>();

  constructor(public readonly enabled: boolean) {}

  handoffCreated(): void { if (this.enabled) this.counters.created += 1; }
  handoffClaimed(): void { if (this.enabled) this.counters.claimed += 1; }
  /** Reserved for a future handoff-expiry transition; no such transition exists today. */
  handoffExpired(): void { if (this.enabled) this.counters.expired += 1; }
  storeError(): void { if (this.enabled) this.counters.storeErrors += 1; }

  toolCall(name: ToolName, durationMs: number): void {
    if (!this.enabled) return;
    const current = this.calls.get(name) ?? { count: 0, sum: 0, buckets: Array(bounds.length + 1).fill(0) as number[] };
    current.count += 1;
    current.sum += Math.max(0, durationMs);
    const bucket = bounds.findIndex((bound) => durationMs <= bound);
    const index = bucket < 0 ? bounds.length : bucket;
    current.buckets[index] = (current.buckets[index] ?? 0) + 1;
    this.calls.set(name, current);
  }

  snapshot(): Record<string, unknown> | null {
    if (!this.enabled) return null;
    const timeUnixNano = nano(Date.now());
    const counter = (name: string, value: number) => ({
      name, unit: "{handoff}", sum: { aggregationTemporality: 2, isMonotonic: true,
        dataPoints: [{ attributes: [], startTimeUnixNano: this.startedAt, timeUnixNano, asInt: String(value) }] },
    });
    const metrics = [
      counter("handoff.created", this.counters.created),
      counter("handoff.claimed", this.counters.claimed),
      counter("handoff.expired", this.counters.expired),
      counter("handoff.store.errors", this.counters.storeErrors),
      { name: "mcp.tool.call.duration", unit: "ms", histogram: {
        aggregationTemporality: 2,
        dataPoints: toolNames.filter((name) => this.calls.has(name)).map((name) => {
          const value = this.calls.get(name)!;
          return { attributes: [{ key: "tool", value: { stringValue: name } }],
            startTimeUnixNano: this.startedAt, timeUnixNano, count: String(value.count),
            sum: value.sum, explicitBounds: bounds, bucketCounts: value.buckets.map(String) };
        }),
      } },
    ];
    return { resourceMetrics: [{ resource: { attributes: [] },
      scopeMetrics: [{ scope: { name: "agent-handoff-mcp", version: packageVersion }, metrics }] }] };
  }
}

export const operationalMetrics = new OperationalMetrics(process.env.HANDOFF_MCP_METRICS === "1");

/** Local server stderr only; stdout remains reserved for the stdio protocol. */
export function startMetricsLogging(
  metrics = operationalMetrics,
  write: (line: string) => void = (line) => { process.stderr.write(line); },
  intervalMs = 60_000,
): () => void {
  if (!metrics.enabled) return () => {};
  const emit = () => { write(`${JSON.stringify(metrics.snapshot())}\n`); };
  emit();
  const timer = setInterval(emit, intervalMs);
  timer.unref();
  return () => { clearInterval(timer); emit(); };
}
