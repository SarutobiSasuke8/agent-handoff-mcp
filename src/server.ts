import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { defaultStatuses } from "./service.js";
import { handoffStatusSchema, prioritySchema, sensitivitySchema } from "./types.js";

import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { HandoffService } from "./service.js";

interface ToolContext {
  http?: { authInfo?: AuthInfo };
}

function jsonResult(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  return { isError: true, content: [{ type: "text", text: message }] };
}

function resolveAgentId(context: ToolContext, fixedAgentId?: string): string {
  const agentId = fixedAgentId ?? context.http?.authInfo?.clientId;
  if (!agentId) throw new Error("Authenticated agent identity is missing.");
  return agentId;
}

async function runTool(
  context: ToolContext,
  fixedAgentId: string | undefined,
  operation: (agentId: string) => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    return jsonResult(await operation(resolveAgentId(context, fixedAgentId)));
  } catch (error) {
    return errorResult(error);
  }
}

const agentId = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/u);
const shortText = z.string().trim().min(1).max(500);
const reference = z.string().trim().min(1).max(500);

export function createHandoffMcpServer(service: HandoffService, fixedAgentId?: string): McpServer {
  const server = new McpServer({ name: "agent-handoff-mcp", version: "0.1.0" });

  server.registerTool(
    "handoff_whoami",
    {
      title: "Show handoff identity",
      description: "Show the authenticated agent identity and communication boundaries.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (context) => runTool(context, fixedAgentId, (id) => service.whoami(id)),
  );

  server.registerTool(
    "handoff_send",
    {
      title: "Send an agent handoff",
      description: "Create a bounded handoff for another authorized agent. References are stored, never dereferenced.",
      inputSchema: z.object({
        recipient: agentId,
        title: z.string().trim().min(1).max(160),
        summary: z.string().trim().min(1).max(2_000),
        request: z.string().trim().min(1).max(8_000),
        context_refs: z.array(reference).max(20).default([]),
        artifact_refs: z.array(reference).max(20).default([]),
        tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
        sensitivity: sensitivitySchema.default("internal"),
        priority: prioritySchema.default("normal"),
        parent_id: z.uuid().optional(),
        idempotency_key: z.string().trim().min(8).max(128).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input, context) => runTool(context, fixedAgentId, async (id) => ({
      handoff: await service.send(id, {
        recipient: input.recipient,
        title: input.title,
        summary: input.summary,
        request: input.request,
        contextRefs: input.context_refs,
        artifactRefs: input.artifact_refs,
        tags: input.tags,
        sensitivity: input.sensitivity,
        priority: input.priority,
        ...(input.parent_id ? { parentId: input.parent_id } : {}),
        ...(input.idempotency_key ? { idempotencyKey: input.idempotency_key } : {}),
      }),
    })),
  );

  server.registerTool(
    "handoff_inbox",
    {
      title: "List agent inbox",
      description: "List handoffs addressed to the authenticated agent.",
      inputSchema: z.object({
        statuses: z.array(handoffStatusSchema).min(1).max(5).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ statuses, limit }, context) => runTool(context, fixedAgentId, (id) => ({
      handoffs: service.inbox(id, statuses ?? defaultStatuses(), limit),
    })),
  );

  server.registerTool(
    "handoff_get",
    {
      title: "Read a handoff",
      description: "Read one handoff and its event history. Only its sender and recipient may read it.",
      inputSchema: z.object({ handoff_id: z.uuid() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ handoff_id }, context) => runTool(context, fixedAgentId, (id) => service.get(id, handoff_id)),
  );

  server.registerTool(
    "handoff_acknowledge",
    {
      title: "Acknowledge a handoff",
      description: "Accept a queued or blocked handoff addressed to the authenticated agent.",
      inputSchema: z.object({ handoff_id: z.uuid(), note: shortText.optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ handoff_id, note }, context) => runTool(context, fixedAgentId, (id) => ({
      handoff: service.acknowledge(id, handoff_id, note),
    })),
  );

  server.registerTool(
    "handoff_update_status",
    {
      title: "Update handoff status",
      description: "Mark an accepted handoff blocked or completed, or let its sender cancel it while queued.",
      inputSchema: z.object({
        handoff_id: z.uuid(),
        status: z.enum(["blocked", "completed", "cancelled"]),
        note: shortText.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ handoff_id, status, note }, context) => runTool(context, fixedAgentId, (id) => ({
      handoff: service.updateStatus(id, handoff_id, status, note),
    })),
  );

  return server;
}
