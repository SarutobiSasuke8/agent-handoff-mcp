import { z } from "zod";

export const sensitivitySchema = z.enum(["public-safe", "internal", "restricted"]);
export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const handoffStatusSchema = z.enum(["queued", "accepted", "blocked", "completed", "cancelled"]);

export type Sensitivity = z.infer<typeof sensitivitySchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type HandoffStatus = z.infer<typeof handoffStatusSchema>;

export interface AgentDefinition {
  id: string;
  displayName: string;
  enabled: boolean;
  sendTo: string[];
  receiveFrom: string[];
  disclosureCeiling: Sensitivity;
  tokenSha256?: string;
  expiresAt?: number;
}

export interface Handoff {
  id: string;
  threadId: string;
  parentId?: string;
  depth: number;
  sender: string;
  recipient: string;
  title: string;
  summary: string;
  request: string;
  contextRefs: string[];
  artifactRefs: string[];
  tags: string[];
  sensitivity: Sensitivity;
  priority: Priority;
  status: HandoffStatus;
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
}

export interface HandoffEvent {
  id: string;
  handoffId: string;
  actor: string;
  eventType: "created" | "accepted" | "blocked" | "completed" | "cancelled";
  fromStatus?: HandoffStatus;
  toStatus: HandoffStatus;
  note?: string;
  createdAt: string;
}

export interface CreateHandoffInput {
  recipient: string;
  title: string;
  summary: string;
  request: string;
  contextRefs: string[];
  artifactRefs: string[];
  tags: string[];
  sensitivity: Sensitivity;
  priority: Priority;
  parentId?: string;
  idempotencyKey?: string;
}
