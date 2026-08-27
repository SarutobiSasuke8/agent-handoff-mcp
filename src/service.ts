import { Buffer } from "node:buffer";

import { DomainError } from "./errors.js";
import { permitsSensitivity } from "./registry.js";

import type { AgentRegistry, PolicySnapshot } from "./registry.js";
import type { HandoffStore } from "./store.js";
import type { AgentDefinition, CreateHandoffInput, Handoff, HandoffStatus } from "./types.js";

export interface ServiceOptions {
  maxMessageBytes: number;
  maxHandoffDepth: number;
}

interface Principal {
  snapshot: PolicySnapshot;
  agent: AgentDefinition;
}

function inaccessible(handoffId: string): Error {
  // One error shape for "does not exist" and "exists but is not accessible",
  // so a revoked or unrelated principal gains no existence oracle.
  return new DomainError(`Handoff '${handoffId}' was not found or is not accessible to this identity.`);
}

export class HandoffService {
  public constructor(
    private readonly registry: AgentRegistry,
    private readonly store: HandoffStore,
    private readonly options: ServiceOptions,
  ) {}

  public async whoami(agentId: string): Promise<Record<string, unknown>> {
    const { snapshot, agent } = await this.principal(agentId);
    return {
      agent_id: agent.id,
      display_name: agent.displayName,
      disclosure_ceiling: agent.disclosureCeiling,
      send_to: agent.sendTo,
      receive_from: agent.receiveFrom,
      policy_revision: snapshot.revision,
    };
  }

  public async send(agentId: string, input: CreateHandoffInput): Promise<Handoff> {
    this.assertMessageSize(input);
    const principal = await this.principal(agentId);
    principal.snapshot.assertCanSend(agentId, input.recipient, input.sensitivity);
    if (input.parentId) {
      const parent = this.store.find(input.parentId);
      if (!parent || !this.canAccess(principal, parent)) throw inaccessible(input.parentId);
    }
    return this.store.create(agentId, input, this.options.maxHandoffDepth);
  }

  public async inbox(agentId: string, statuses: HandoffStatus[], limit: number): Promise<Handoff[]> {
    const principal = await this.principal(agentId);
    return this.store.inbox(agentId, statuses, limit).filter((handoff) => this.canAccess(principal, handoff));
  }

  public async get(agentId: string, handoffId: string): Promise<{ handoff: Handoff; events: unknown[] }> {
    const principal = await this.principal(agentId);
    const handoff = this.store.find(handoffId);
    if (!handoff || !this.canAccess(principal, handoff)) throw inaccessible(handoffId);
    return { handoff, events: this.store.events(handoffId) };
  }

  public async acknowledge(agentId: string, handoffId: string, note?: string): Promise<Handoff> {
    return this.transition(agentId, handoffId, "accepted", note);
  }

  public async updateStatus(
    agentId: string,
    handoffId: string,
    status: "blocked" | "completed" | "cancelled",
    note?: string,
  ): Promise<Handoff> {
    return this.transition(agentId, handoffId, status, note);
  }

  private async transition(
    agentId: string,
    handoffId: string,
    status: Exclude<HandoffStatus, "queued">,
    note?: string,
  ): Promise<Handoff> {
    if (note) this.assertTextSize(note, "note");
    const principal = await this.principal(agentId);
    const handoff = this.store.find(handoffId);
    if (!handoff || !this.canAccess(principal, handoff)) throw inaccessible(handoffId);
    return this.store.transition(handoffId, agentId, status, note);
  }

  /**
   * Resolve the request-scoped principal against one current policy snapshot.
   * Enabled state and expiry are rechecked on every operation, so registry
   * changes revoke access mid-session on both transports without a restart.
   */
  private async principal(agentId: string): Promise<Principal> {
    const snapshot = await this.registry.current();
    return { snapshot, agent: snapshot.resolveActive(agentId) };
  }

  /**
   * Current-policy access check for stored handoffs. Historical reads are
   * denied by default once the sender-to-recipient relationship is removed or
   * the principal's disclosure ceiling drops below the handoff's sensitivity.
   */
  private canAccess(principal: Principal, handoff: Handoff): boolean {
    if (handoff.sender !== principal.agent.id && handoff.recipient !== principal.agent.id) return false;
    if (!permitsSensitivity(principal.agent, handoff.sensitivity)) return false;
    return principal.snapshot.relationshipAllowed(handoff.sender, handoff.recipient);
  }

  private assertMessageSize(input: CreateHandoffInput): void {
    const serialized = JSON.stringify(input);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > this.options.maxMessageBytes) {
      throw new DomainError(`Handoff payload is ${bytes} bytes; maximum is ${this.options.maxMessageBytes}.`);
    }
  }

  private assertTextSize(value: string, field: string): void {
    if (Buffer.byteLength(value, "utf8") > 4_096) throw new DomainError(`${field} exceeds 4096 bytes.`);
  }
}

export function defaultStatuses(): HandoffStatus[] {
  return ["queued", "accepted", "blocked"];
}
