import { Buffer } from "node:buffer";

import type { AgentRegistry } from "./registry.js";
import type { HandoffStore } from "./store.js";
import type { CreateHandoffInput, Handoff, HandoffStatus, Sensitivity } from "./types.js";

export interface ServiceOptions {
  maxMessageBytes: number;
  maxHandoffDepth: number;
}

export class HandoffService {
  public constructor(
    private readonly registry: AgentRegistry,
    private readonly store: HandoffStore,
    private readonly options: ServiceOptions,
  ) {}

  public async whoami(agentId: string): Promise<Record<string, unknown>> {
    const agent = await this.registry.get(agentId);
    return {
      agent_id: agent.id,
      display_name: agent.displayName,
      disclosure_ceiling: agent.disclosureCeiling,
      send_to: agent.sendTo,
      receive_from: agent.receiveFrom,
    };
  }

  public async send(agentId: string, input: CreateHandoffInput): Promise<Handoff> {
    this.assertMessageSize(input);
    await this.registry.assertCanSend(agentId, input.recipient, input.sensitivity);
    if (input.parentId) {
      const parent = this.store.get(input.parentId);
      this.assertParticipant(agentId, parent);
    }
    return this.store.create(agentId, input, this.options.maxHandoffDepth);
  }

  public inbox(agentId: string, statuses: HandoffStatus[], limit: number): Handoff[] {
    return this.store.inbox(agentId, statuses, limit);
  }

  public get(agentId: string, handoffId: string): { handoff: Handoff; events: unknown[] } {
    const handoff = this.store.get(handoffId);
    this.assertParticipant(agentId, handoff);
    return { handoff, events: this.store.events(handoffId) };
  }

  public acknowledge(agentId: string, handoffId: string, note?: string): Handoff {
    if (note) this.assertTextSize(note, "note");
    return this.store.transition(handoffId, agentId, "accepted", note);
  }

  public updateStatus(
    agentId: string,
    handoffId: string,
    status: "blocked" | "completed" | "cancelled",
    note?: string,
  ): Handoff {
    if (note) this.assertTextSize(note, "note");
    return this.store.transition(handoffId, agentId, status, note);
  }

  private assertParticipant(agentId: string, handoff: Handoff): void {
    if (handoff.sender !== agentId && handoff.recipient !== agentId) {
      throw new Error(`Agent '${agentId}' is not a participant in handoff '${handoff.id}'.`);
    }
  }

  private assertMessageSize(input: CreateHandoffInput): void {
    const serialized = JSON.stringify(input);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > this.options.maxMessageBytes) {
      throw new Error(`Handoff payload is ${bytes} bytes; maximum is ${this.options.maxMessageBytes}.`);
    }
  }

  private assertTextSize(value: string, field: string): void {
    if (Buffer.byteLength(value, "utf8") > 4_096) throw new Error(`${field} exceeds 4096 bytes.`);
  }
}

export function defaultStatuses(): HandoffStatus[] {
  return ["queued", "accepted", "blocked"];
}

export function normalizeSensitivity(value: Sensitivity): Sensitivity {
  return value;
}
