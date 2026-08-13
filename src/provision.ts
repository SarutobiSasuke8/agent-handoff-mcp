import { createHash, randomBytes } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";

import YAML from "yaml";

import { parseRegistry } from "./registry.js";

export interface IssuedToken {
  token: string;
  digest: string;
}

export function newToken(): IssuedToken {
  const token = `handoff_${randomBytes(32).toString("base64url")}`;
  const digest = createHash("sha256").update(token, "utf8").digest("hex");
  return { token, digest };
}

const REGISTRY_TEMPLATE = `# Agent Handoff MCP registry.
# Every field below is required for each identity; there are no permissive
# defaults. Identities start disabled: issue a token, then set enabled: true.
version: 1
agents:
  - id: example-alpha
    display_name: Example Alpha
    enabled: false
    send_to: [example-beta]
    receive_from: [example-beta]
    disclosure_ceiling: internal
  - id: example-beta
    display_name: Example Beta
    enabled: false
    send_to: [example-alpha]
    receive_from: [example-alpha]
    disclosure_ceiling: internal
`;

export async function initRegistry(file: string): Promise<void> {
  parseRegistry(REGISTRY_TEMPLATE);
  await writeFile(file, REGISTRY_TEMPLATE, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function assertPrivateFile(file: string, allowInsecure: boolean): Promise<void> {
  if (process.platform === "win32" || allowInsecure) return;
  const stats = await stat(file);
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(
      `Registry file permissions are too open (mode ${(stats.mode & 0o777).toString(8)}). ` +
      "Restrict it to the owner (chmod 600) or pass --allow-insecure.",
    );
  }
}

interface RegistryEdit {
  document: YAML.Document;
  agentNode: YAML.YAMLMap;
}

async function openRegistryAgent(file: string, agentId: string): Promise<RegistryEdit> {
  const source = await readFile(file, "utf8");
  parseRegistry(source);
  const document = YAML.parseDocument(source);
  const agents = document.get("agents");
  if (!YAML.isSeq(agents)) throw new Error("Registry has no agents list.");
  for (const item of agents.items) {
    if (YAML.isMap(item) && item.get("id") === agentId) {
      return { document, agentNode: item };
    }
  }
  throw new Error(`Agent '${agentId}' is not defined in the registry.`);
}

async function saveRegistry(file: string, document: YAML.Document): Promise<void> {
  const output = document.toString();
  parseRegistry(output);
  await writeFile(file, output, "utf8");
}

export interface IssueOptions {
  requireExistingToken?: boolean;
  allowInsecure?: boolean;
}

/**
 * Issue (or rotate) an expiring token for one agent. The raw token is
 * returned to the caller for one-time display and is never written to disk;
 * only its SHA-256 digest enters the registry.
 */
export async function issueToken(
  file: string,
  agentId: string,
  expiresAt: string,
  options: IssueOptions = {},
): Promise<IssuedToken> {
  const expiry = new Date(expiresAt);
  if (!/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$/u.test(expiresAt) || Number.isNaN(expiry.getTime())) {
    throw new Error("Expiry must be an ISO 8601 datetime with timezone offset, for example 2027-01-01T00:00:00Z.");
  }
  if (expiry.getTime() <= Date.now()) throw new Error("Expiry must be in the future.");
  await assertPrivateFile(file, options.allowInsecure ?? false);
  const { document, agentNode } = await openRegistryAgent(file, agentId);
  if (options.requireExistingToken && !agentNode.has("token_sha256")) {
    throw new Error(`Agent '${agentId}' has no token to rotate. Use 'issue' to create one.`);
  }
  const issued = newToken();
  agentNode.set("token_sha256", issued.digest);
  agentNode.set("expires_at", expiresAt);
  await saveRegistry(file, document);
  return issued;
}

export async function disableAgent(file: string, agentId: string): Promise<void> {
  const { document, agentNode } = await openRegistryAgent(file, agentId);
  agentNode.set("enabled", false);
  await saveRegistry(file, document);
}

export async function enableAgent(file: string, agentId: string): Promise<void> {
  const { document, agentNode } = await openRegistryAgent(file, agentId);
  agentNode.set("enabled", true);
  await saveRegistry(file, document);
}

export async function revokeToken(file: string, agentId: string): Promise<void> {
  const { document, agentNode } = await openRegistryAgent(file, agentId);
  agentNode.delete("token_sha256");
  agentNode.delete("expires_at");
  await saveRegistry(file, document);
}
