#!/usr/bin/env node
const base = process.env.HANDOFF_DEMO_URL ?? "http://127.0.0.1:3220";
const checks = [
  ["healthz", `${base}/healthz`, 200],
  ["readyz", `${base}/readyz`, 200],
  ["mcp requires bearer", `${base}/mcp`, 401],
];
for (const [name, url, expected] of checks) {
  const response = await fetch(url);
  if (response.status !== expected) throw new Error(`${name}: expected ${expected}, got ${response.status}`);
  process.stdout.write(`PASS ${name}\n`);
}
