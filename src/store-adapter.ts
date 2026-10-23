import type { CreateHandoffInput, Handoff, HandoffEvent, HandoffStatus } from "./types.js";

/** A value an adapter may return directly (SQLite) or asynchronously (Postgres). */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The persistence boundary used by `HandoffService`.
 *
 * Every adapter must give the same observable behaviour: identical handoff and
 * event shapes, the same idempotency rule for (sender, idempotency_key), the
 * lifecycle rules in `allowedTransition`, one audit event per state change
 * written in the same transaction as the change, and the same DomainError
 * messages. The SQLite adapter (`HandoffStore`) is synchronous and the default;
 * the Postgres adapter (`PostgresHandoffStore`, experimental) returns promises.
 * Callers must `await` every result. See docs/STORE-POSTGRES.md.
 */
export interface HandoffStoreAdapter {
  /** Resolves once the store is open and migrated. Errors surface here at startup. */
  ready(): MaybePromise<void>;
  create(sender: string, input: CreateHandoffInput, maxDepth: number): MaybePromise<Handoff>;
  get(id: string): MaybePromise<Handoff>;
  find(id: string): MaybePromise<Handoff | undefined>;
  inbox(recipient: string, statuses: HandoffStatus[], limit: number): MaybePromise<Handoff[]>;
  events(handoffId: string): MaybePromise<HandoffEvent[]>;
  transition(
    handoffId: string,
    actor: string,
    toStatus: Exclude<HandoffStatus, "queued">,
    note?: string,
  ): MaybePromise<Handoff>;
  close(): MaybePromise<void>;
}

/** Lifecycle rules shared by every adapter. Evaluated against the locked, current row. */
export function allowedTransition(handoff: Handoff, actor: string, next: Exclude<HandoffStatus, "queued">): boolean {
  if (next === "cancelled") return actor === handoff.sender && handoff.status === "queued";
  if (actor !== handoff.recipient) return false;
  if (next === "accepted") return handoff.status === "queued" || handoff.status === "blocked";
  if (next === "blocked") return handoff.status === "queued" || handoff.status === "accepted";
  if (next === "completed") return handoff.status === "accepted" || handoff.status === "blocked";
  return false;
}
