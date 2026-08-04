import path from "node:path";

import { z } from "zod";

const envSchema = z.object({
  HANDOFF_MCP_HOST: z.string().default("127.0.0.1"),
  HANDOFF_MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3220),
  HANDOFF_MCP_DB: z.string().default("./data/handoffs.sqlite"),
  HANDOFF_MCP_REGISTRY: z.string().default("./config/agents.yaml"),
  HANDOFF_MCP_ALLOWED_HOSTS: z.string().optional(),
  HANDOFF_MCP_ALLOWED_ORIGINS: z.string().optional(),
  HANDOFF_MCP_MAX_MESSAGE_BYTES: z.coerce.number().int().min(1024).max(262_144).default(32_768),
  HANDOFF_MCP_MAX_HANDOFF_DEPTH: z.coerce.number().int().min(1).max(32).default(8),
  HANDOFF_MCP_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(120),
  HANDOFF_MCP_RATE_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  HANDOFF_MCP_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  HANDOFF_AGENT_ID: z.string().min(1).optional(),
});

function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

export interface AppConfig {
  host: string;
  port: number;
  databaseFile: string;
  registryFile: string;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  maxMessageBytes: number;
  maxHandoffDepth: number;
  rateLimit: number;
  rateWindowMs: number;
  trustProxyHops: number;
  stdioAgentId?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const allowedHosts = csv(parsed.HANDOFF_MCP_ALLOWED_HOSTS);
  const allowedOrigins = csv(parsed.HANDOFF_MCP_ALLOWED_ORIGINS);
  return {
    host: parsed.HANDOFF_MCP_HOST,
    port: parsed.HANDOFF_MCP_PORT,
    databaseFile: path.resolve(parsed.HANDOFF_MCP_DB),
    registryFile: path.resolve(parsed.HANDOFF_MCP_REGISTRY),
    ...(allowedHosts ? { allowedHosts } : {}),
    ...(allowedOrigins ? { allowedOrigins } : {}),
    maxMessageBytes: parsed.HANDOFF_MCP_MAX_MESSAGE_BYTES,
    maxHandoffDepth: parsed.HANDOFF_MCP_MAX_HANDOFF_DEPTH,
    rateLimit: parsed.HANDOFF_MCP_RATE_LIMIT,
    rateWindowMs: parsed.HANDOFF_MCP_RATE_WINDOW_MS,
    trustProxyHops: parsed.HANDOFF_MCP_TRUST_PROXY_HOPS,
    ...(parsed.HANDOFF_AGENT_ID ? { stdioAgentId: parsed.HANDOFF_AGENT_ID } : {}),
  };
}
