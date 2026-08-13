import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import YAML from "yaml";
import { z } from "zod";

import { sensitivitySchema } from "./types.js";

import type { AgentDefinition, Sensitivity } from "./types.js";

export const SUPPORTED_REGISTRY_VERSIONS = [1] as const;

const agentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/u);
const agentReferenceSchema = z.union([agentIdSchema, z.literal("*")]);

const agentSchema = z.strictObject({
  id: agentIdSchema,
  display_name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  send_to: z.array(agentReferenceSchema).max(100),
  receive_from: z.array(agentReferenceSchema).max(100),
  disclosure_ceiling: sensitivitySchema,
  token_sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});

const registrySchema = z.strictObject({
  version: z.literal(1),
  agents: z.array(agentSchema).min(1).max(500),
});

const sensitivityRank: Record<Sensitivity, number> = {
  "public-safe": 0,
  internal: 1,
  restricted: 2,
};

export class RegistryValidationError extends Error {
  public readonly issues: string[];

  public constructor(issues: string[]) {
    super(`Registry validation failed:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "RegistryValidationError";
    this.issues = issues;
  }
}

function issuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "registry";
  return path
    .map((part) => (typeof part === "number" ? `[${part}]` : String(part)))
    .join(".")
    .replaceAll(".[", "[");
}

/**
 * Convert a Zod issue to a field-specific message that never echoes input
 * values, so token material or secrets in a malformed registry cannot leak
 * through error output.
 */
function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issuePath(issue.path);
  if (issue.path[0] === "version") {
    return `version: unsupported registry schema version (supported: ${SUPPORTED_REGISTRY_VERSIONS.join(", ")})`;
  }
  switch (issue.code) {
    case "unrecognized_keys":
      return `${path}: unknown key(s): ${issue.keys.map((key) => `'${key.slice(0, 64)}'`).join(", ")}`;
    case "invalid_type":
      return `${path}: expected ${issue.expected}`;
    case "invalid_value":
      return `${path}: must be one of ${issue.values.map((value) => JSON.stringify(value)).join(", ")}`;
    case "invalid_format":
      if (issue.path.at(-1) === "token_sha256") return `${path}: value is not a lowercase hex SHA-256 digest`;
      if (issue.path.at(-1) === "expires_at") return `${path}: value is not an ISO 8601 datetime with timezone offset`;
      return `${path}: value does not match the required format`;
    case "too_small":
    case "too_big":
      return `${path}: value is outside the permitted size`;
    case "invalid_union":
      return `${path}: value is not a valid agent id or '*'`;
    default:
      return `${path}: invalid value`;
  }
}

function fail(issues: string[]): never {
  throw new RegistryValidationError(issues);
}

function checkReferenceList(agentId: string, field: string, list: string[], issues: string[]): void {
  const seen = new Set<string>();
  for (const target of list) {
    if (seen.has(target)) issues.push(`agent '${agentId}' ${field}: duplicate entry '${target}'`);
    seen.add(target);
  }
  if (list.includes("*") && list.length > 1) {
    issues.push(`agent '${agentId}' ${field}: '*' must be the only entry when present`);
  }
}

export function parseRegistry(source: string): AgentDefinition[] {
  let raw: unknown;
  try {
    raw = YAML.parse(source);
  } catch {
    fail(["registry: file is not valid YAML"]);
  }
  const parsed = registrySchema.safeParse(raw);
  if (!parsed.success) fail(parsed.error.issues.map(describeIssue));

  const issues: string[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  for (const agent of parsed.data.agents) {
    if (seenIds.has(agent.id)) issues.push(`agents: duplicate agent id '${agent.id}'`);
    seenIds.add(agent.id);
    if (agent.token_sha256) {
      if (seenHashes.has(agent.token_sha256)) issues.push(`agent '${agent.id}': duplicate token hash (value redacted)`);
      seenHashes.add(agent.token_sha256);
    }
    if (agent.expires_at && Number.isNaN(new Date(agent.expires_at).getTime())) {
      issues.push(`agent '${agent.id}' expires_at: value is not a valid datetime`);
    }
    checkReferenceList(agent.id, "send_to", agent.send_to, issues);
    checkReferenceList(agent.id, "receive_from", agent.receive_from, issues);
  }
  for (const agent of parsed.data.agents) {
    for (const [field, list] of [["send_to", agent.send_to], ["receive_from", agent.receive_from]] as const) {
      for (const target of list) {
        if (target !== "*" && !seenIds.has(target)) {
          issues.push(`agent '${agent.id}' ${field}: references unknown agent '${target}'`);
        }
      }
    }
  }
  if (issues.length > 0) fail(issues);

  return parsed.data.agents.map((agent): AgentDefinition => Object.freeze({
    id: agent.id,
    displayName: agent.display_name,
    enabled: agent.enabled,
    sendTo: Object.freeze([...agent.send_to]) as string[],
    receiveFrom: Object.freeze([...agent.receive_from]) as string[],
    disclosureCeiling: agent.disclosure_ceiling,
    ...(agent.token_sha256 ? { tokenSha256: agent.token_sha256 } : {}),
    ...(agent.expires_at ? { expiresAt: Math.floor(new Date(agent.expires_at).getTime() / 1000) } : {}),
  }));
}

export function registryJsonSchema(): Record<string, unknown> {
  return {
    $id: "https://raw.githubusercontent.com/SarutobiSasuke8/agent-handoff-mcp/main/schema/agent-registry.schema.v1.json",
    title: "Agent Handoff MCP agent registry (schema version 1)",
    ...(z.toJSONSchema(registrySchema) as Record<string, unknown>),
  };
}

export function permitsSensitivity(agent: AgentDefinition, sensitivity: Sensitivity): boolean {
  return sensitivityRank[sensitivity] <= sensitivityRank[agent.disclosureCeiling];
}

function permitsTarget(list: readonly string[], target: string): boolean {
  return list.includes("*") || list.includes(target);
}

/**
 * One immutable, validated view of the operator policy. Every operation
 * validates against exactly one snapshot, so a mid-operation registry write
 * can never produce a half-applied policy decision.
 */
export class PolicySnapshot {
  public constructor(
    public readonly revision: string,
    public readonly loadedAt: string,
    private readonly agents: ReadonlyMap<string, AgentDefinition>,
  ) {}

  public all(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  public find(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  /** Resolve an id to an enabled, unexpired principal or throw. */
  public resolveActive(agentId: string, nowSeconds = Math.floor(Date.now() / 1000)): AgentDefinition {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.enabled || (agent.expiresAt !== undefined && agent.expiresAt <= nowSeconds)) {
      throw new Error(`Agent '${agentId}' is not authorised under the current policy.`);
    }
    return agent;
  }

  /** True while the sender-to-recipient relationship is still authorised by this snapshot. */
  public relationshipAllowed(senderId: string, recipientId: string): boolean {
    const sender = this.agents.get(senderId);
    const recipient = this.agents.get(recipientId);
    if (!sender || !recipient) return false;
    return permitsTarget(sender.sendTo, recipientId) && permitsTarget(recipient.receiveFrom, senderId);
  }

  public assertCanSend(senderId: string, recipientId: string, sensitivity: Sensitivity): void {
    if (senderId === recipientId) throw new Error("An agent may not hand off work to itself.");
    const sender = this.resolveActive(senderId);
    const recipient = this.resolveActive(recipientId);
    if (!permitsTarget(sender.sendTo, recipientId)) {
      throw new Error(`Agent '${senderId}' may not send to '${recipientId}'.`);
    }
    if (!permitsTarget(recipient.receiveFrom, senderId)) {
      throw new Error(`Agent '${recipientId}' may not receive from '${senderId}'.`);
    }
    if (!permitsSensitivity(sender, sensitivity) || !permitsSensitivity(recipient, sensitivity)) {
      throw new Error(`Sensitivity '${sensitivity}' exceeds an agent disclosure ceiling.`);
    }
  }
}

export function snapshotFromSource(source: string, loadedAt = new Date().toISOString()): PolicySnapshot {
  const agents = parseRegistry(source);
  const revision = createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16);
  return new PolicySnapshot(revision, loadedAt, new Map(agents.map((agent) => [agent.id, agent])));
}

export interface PolicyState {
  status: "ok" | "degraded";
  revision?: string;
  loadedAt?: string;
  reason?: string;
}

/**
 * Loads and caches policy snapshots from the registry file. The file is
 * re-checked on every request (by mtime and size), so disabling an identity or
 * narrowing a relationship takes effect without a restart on both transports.
 * A failed reload keeps the last valid snapshot active and marks the provider
 * degraded; the degraded state is surfaced through health and readiness.
 */
export class AgentRegistry {
  private snapshot: PolicySnapshot | undefined;
  private snapshotMtimeMs = -1;
  private snapshotSize = -1;
  private degradedReason: string | undefined;

  public constructor(private readonly registryFile: string) {}

  public async current(): Promise<PolicySnapshot> {
    let mtimeMs: number;
    let size: number;
    try {
      const stats = await stat(this.registryFile);
      mtimeMs = stats.mtimeMs;
      size = stats.size;
    } catch (error) {
      return this.reloadFailed(`registry file is not readable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    if (this.snapshot && mtimeMs === this.snapshotMtimeMs && size === this.snapshotSize) {
      return this.snapshot;
    }
    try {
      const source = await readFile(this.registryFile, "utf8");
      const snapshot = snapshotFromSource(source);
      this.snapshot = snapshot;
      this.snapshotMtimeMs = mtimeMs;
      this.snapshotSize = size;
      this.degradedReason = undefined;
      return snapshot;
    } catch (error) {
      return this.reloadFailed(error instanceof RegistryValidationError
        ? error.message
        : `registry reload failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  public state(): PolicyState {
    if (!this.snapshot) return { status: "degraded", ...(this.degradedReason ? { reason: this.degradedReason } : {}) };
    return {
      status: this.degradedReason ? "degraded" : "ok",
      revision: this.snapshot.revision,
      loadedAt: this.snapshot.loadedAt,
      ...(this.degradedReason ? { reason: this.degradedReason } : {}),
    };
  }

  public async all(): Promise<AgentDefinition[]> {
    return (await this.current()).all();
  }

  public async get(agentId: string): Promise<AgentDefinition> {
    return (await this.current()).resolveActive(agentId);
  }

  private reloadFailed(reason: string): PolicySnapshot {
    this.degradedReason = reason;
    if (this.snapshot) return this.snapshot;
    throw new RegistryValidationError([reason]);
  }
}
