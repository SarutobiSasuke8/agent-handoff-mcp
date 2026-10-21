// Test-client adapter only: the upstream framework has no bearer-header flag.
// Inject the ephemeral fixture credential only into requests to this exact URL.
import process from "node:process";

const endpoint = process.env.HANDOFF_CONFORMANCE_URL;
const token = process.env.HANDOFF_CONFORMANCE_TOKEN;
if (!endpoint || !token || !endpoint.startsWith("http://127.0.0.1:")) {
  throw new Error("Conformance auth requires an isolated loopback fixture");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url ?? input.href;
  if (url !== endpoint) return originalFetch(input, init);
  const headers = new globalThis.Headers(init?.headers ?? input.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return originalFetch(input, { ...init, headers });
};
