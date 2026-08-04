import { readFile } from "node:fs/promises";

import YAML from "yaml";
import { z } from "zod";

import { sensitivitySchema } from "./types.js";

import type { AgentDefinition, Sensitivity } from "./types.js";

const agentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/u);
const agentReferenceSchema = z.union([agentIdSchema, z.literal("*")]);
const agentSchema = z.object({
  id: agentIdSchema,
  display_name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  send_to: z.array(agentReferenceSchema).max(100).default([]),
  receive_from: z.array(agentReferenceSchema).max(100).default([]),
  disclosure_ceiling: sensitivitySchema.default("internal"),
  token_sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});
const registrySchema = z.object({ version: z.literal(1), agents: z.array(agentSchema).min(1).max(500) });

const sensitivityRank: Record<Sensitivity, number> = {
  "public-safe": 0,
  internal: 1,
  restricted: 2,
};

export function parseRegistry(source: string): AgentDefinition[] {
  const parsed = registrySchema.parse(YAML.parse(source));
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  const agents = parsed.agents.map((agent): AgentDefinition => {
    if (seenIds.has(agent.id)) throw new Error(`Duplicate agent id '${agent.id}'.`);
    if (agent.token_sha256 && seenHashes.has(agent.token_sha256)) {
      throw new Error("Duplicate token hash in agent registry.");
    }
    seenIds.add(agent.id);
    if (agent.token_sha256) seenHashes.add(agent.token_sha256);
    return {
      id: agent.id,
      displayName: agent.display_name,
      enabled: agent.enabled,
      sendTo: agent.send_to,
      receiveFrom: agent.receive_from,
      disclosureCeiling: agent.disclosure_ceiling,
      ...(agent.token_sha256 ? { tokenSha256: agent.token_sha256 } : {}),
      ...(agent.expires_at ? { expiresAt: Math.floor(new Date(agent.expires_at).getTime() / 1000) } : {}),
    };
  });

  for (const agent of agents) {
    for (const target of [...agent.sendTo, ...agent.receiveFrom]) {
      if (target !== "*" && !seenIds.has(target)) {
        throw new Error(`Agent '${agent.id}' references unknown agent '${target}'.`);
      }
    }
  }
  return agents;
}

export function permitsSensitivity(agent: AgentDefinition, sensitivity: Sensitivity): boolean {
  return sensitivityRank[sensitivity] <= sensitivityRank[agent.disclosureCeiling];
}

export class AgentRegistry {
  public constructor(private readonly registryFile: string) {}

  public async all(): Promise<AgentDefinition[]> {
    return parseRegistry(await readFile(this.registryFile, "utf8"));
  }

  public async get(agentId: string): Promise<AgentDefinition> {
    const agent = (await this.all()).find((candidate) => candidate.id === agentId);
    if (!agent || !agent.enabled) throw new Error(`Agent '${agentId}' is unknown or disabled.`);
    return agent;
  }

  public async assertCanSend(senderId: string, recipientId: string, sensitivity: Sensitivity): Promise<void> {
    if (senderId === recipientId) throw new Error("An agent may not hand off work to itself.");
    const [sender, recipient] = await Promise.all([this.get(senderId), this.get(recipientId)]);
    if (!sender.sendTo.includes("*") && !sender.sendTo.includes(recipientId)) {
      throw new Error(`Agent '${senderId}' may not send to '${recipientId}'.`);
    }
    if (!recipient.receiveFrom.includes("*") && !recipient.receiveFrom.includes(senderId)) {
      throw new Error(`Agent '${recipientId}' may not receive from '${senderId}'.`);
    }
    if (!permitsSensitivity(sender, sensitivity) || !permitsSensitivity(recipient, sensitivity)) {
      throw new Error(`Sensitivity '${sensitivity}' exceeds an agent disclosure ceiling.`);
    }
  }
}
