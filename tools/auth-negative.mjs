import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createFixture, startHttpHarness } from "../dist/test/e2e/harness.js";

// Only disposable loopback fixtures are accepted. No endpoint/token override.
const results = [];
const errors = new Set(["invalid_request", "invalid_token", "insufficient_scope"]);
const evidence = path.resolve("release-evidence/auth-negative/results.json");
const fixture = await createFixture([{ id: "auth-negative-fixture" }, {
  id: "expired-fixture", expiresAt: "2000-01-01T00:00:00Z",
}]);
let http;
const requestBody = { jsonrpc: "2.0", id: 1, method: "tools/list" };

async function probe(name, init, check, suffix = "") {
  // Do not retain raw requests, responses, URLs, credentials or error stacks.
  let observed;
  try {
    const response = await globalThis.fetch(`${http.url}${suffix}`, {
      method: "POST",
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(10_000),
      ...init,
    });
    const challenge = response.headers.get("www-authenticate") ?? "";
    const headerError = /\berror="([a-z_]+)"/u.exec(challenge)?.[1];
    const text = await response.text();
    let bodyError;
    let toolCount = null;
    try {
      const body = JSON.parse(text);
      bodyError = body.error;
      if (Array.isArray(body.result?.tools)) toolCount = body.result.tools.length;
    } catch { /* May be non-JSON. */ }
    observed = {
      status: response.status,
      bearerChallenge: /^Bearer(?:\s|$)/iu.test(challenge),
      challengeError: errors.has(headerError) ? headerError : null,
      bodyError: errors.has(bodyError) ? bodyError : null,
      rpcErrorCode: typeof bodyError?.code === "number" ? bodyError.code : null,
      toolCount,
    };
    check(observed);
    results.push({ name, ok: true, observed });
    process.stdout.write(`PASS ${name}: HTTP ${observed.status}\n`);
  } catch {
    results.push({ name, ok: false, ...(observed ? { observed } : {}),
      finding: observed ? "Response did not meet the documented expectation" : "Probe could not complete" });
    process.stdout.write(`FAIL ${name}${observed ? `: HTTP ${observed.status}` : ": probe could not complete"}\n`);
  }
}

const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const bearerRejection = (r) => {
  assert.ok([400, 401].includes(r.status));
  assert.ok(r.bearerChallenge);
  if (r.status === 400) assert.ok(r.challengeError === "invalid_request" || r.bodyError === "invalid_request");
};
const duplicateRejection = (r) => {
  assert.equal(r.status, 400);
  assert.ok(r.challengeError === "invalid_request" || r.bodyError === "invalid_request");
};

try {
  http = await startHttpHarness(fixture);
  assert.equal(new globalThis.URL(http.url).hostname, "127.0.0.1");
  const token = fixture.tokens.get("auth-negative-fixture").token;
  const validHeaders = { ...headers, Authorization: `Bearer ${token}` };
  await probe("control-valid-header", { headers: validHeaders, body: JSON.stringify(requestBody) }, (r) => {
    assert.equal(r.status, 200);
    assert.equal(r.toolCount, 6);
  });
  await probe("1-missing-header", { headers, body: JSON.stringify(requestBody) }, (r) => {
    assert.equal(r.status, 401);
    assert.ok(r.bearerChallenge);
  });
  await probe("2-garbage-token", { headers: { ...headers, Authorization: "Bearer intentionally-invalid-fixture" }, body: JSON.stringify(requestBody) }, (r) => {
    assert.equal(r.status, 401);
    assert.ok(r.bearerChallenge);
    assert.equal(r.challengeError, "invalid_token");
  });
  await probe("3-expired-static-token", { headers: { ...headers, Authorization: `Bearer ${fixture.tokens.get("expired-fixture").token}` }, body: JSON.stringify(requestBody) }, (r) => {
    assert.equal(r.status, 401);
    assert.ok(r.bearerChallenge);
    assert.equal(r.challengeError, "invalid_token");
  });
  await probe("5-query-token-only", { headers, body: JSON.stringify(requestBody) }, bearerRejection, `?access_token=${encodeURIComponent(token)}`);
  await probe("6-header-and-json-body-token", { headers: validHeaders, body: JSON.stringify({ ...requestBody, access_token: token }) }, duplicateRejection);
  await probe("6-header-and-form-body-token", {
    headers: { ...validHeaders, "Content-Type": "application/x-www-form-urlencoded" },
    body: new globalThis.URLSearchParams({ access_token: token }).toString(),
  }, duplicateRejection);
  for (const [name, value] of [
    ["wrong-scheme", "Basic intentionally-invalid-fixture"],
    ["missing-space", "Bearerintentionally-invalid-fixture"],
    ["empty-bearer", "Bearer"],
  ]) {
    await probe(`7-${name}`, { headers: { ...headers, Authorization: value }, body: JSON.stringify(requestBody) }, bearerRejection);
  }
} finally {
  try { await http?.close(); } finally { await fixture.dispose(); }
}

await mkdir(path.dirname(evidence), { recursive: true });
await writeFile(evidence, `${JSON.stringify({ results, passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length }, null, 2)}\n`);
process.stdout.write(`Sanitised evidence: release-evidence/auth-negative/results.json\n`);
if (results.some((r) => !r.ok)) process.exitCode = 1;
