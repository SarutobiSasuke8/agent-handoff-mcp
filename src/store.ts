import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CreateHandoffInput, Handoff, HandoffEvent, HandoffStatus } from "./types.js";

interface HandoffRow {
  id: string;
  thread_id: string;
  parent_id: string | null;
  depth: number;
  sender: string;
  recipient: string;
  title: string;
  summary: string;
  request: string;
  context_refs_json: string;
  artifact_refs_json: string;
  tags_json: string;
  sensitivity: Handoff["sensitivity"];
  priority: Handoff["priority"];
  status: HandoffStatus;
  created_at: string;
  updated_at: string;
  idempotency_key: string | null;
}

interface EventRow {
  id: string;
  handoff_id: string;
  actor: string;
  event_type: HandoffEvent["eventType"];
  from_status: HandoffStatus | null;
  to_status: HandoffStatus;
  note: string | null;
  created_at: string;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Stored handoff metadata is invalid.");
  }
  return parsed;
}

function toHandoff(row: HandoffRow): Handoff {
  return {
    id: row.id,
    threadId: row.thread_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    depth: row.depth,
    sender: row.sender,
    recipient: row.recipient,
    title: row.title,
    summary: row.summary,
    request: row.request,
    contextRefs: parseStringArray(row.context_refs_json),
    artifactRefs: parseStringArray(row.artifact_refs_json),
    tags: parseStringArray(row.tags_json),
    sensitivity: row.sensitivity,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
  };
}

function toEvent(row: EventRow): HandoffEvent {
  return {
    id: row.id,
    handoffId: row.handoff_id,
    actor: row.actor,
    eventType: row.event_type,
    ...(row.from_status ? { fromStatus: row.from_status } : {}),
    toStatus: row.to_status,
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
  };
}

export class HandoffStore {
  private readonly db: DatabaseSync;

  public constructor(databaseFile: string) {
    if (databaseFile !== ":memory:") mkdirSync(path.dirname(databaseFile), { recursive: true });
    this.db = new DatabaseSync(databaseFile);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        parent_id TEXT REFERENCES handoffs(id),
        depth INTEGER NOT NULL CHECK(depth >= 0),
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        request TEXT NOT NULL,
        context_refs_json TEXT NOT NULL,
        artifact_refs_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public-safe','internal','restricted')),
        priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
        status TEXT NOT NULL CHECK(status IN ('queued','accepted','blocked','completed','cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        idempotency_key TEXT,
        UNIQUE(sender, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_handoffs_recipient_status ON handoffs(recipient, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_handoffs_thread ON handoffs(thread_id, created_at);
      CREATE TABLE IF NOT EXISTS handoff_events (
        id TEXT PRIMARY KEY,
        handoff_id TEXT NOT NULL REFERENCES handoffs(id),
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_handoff ON handoff_events(handoff_id, created_at);
    `);
  }

  public create(sender: string, input: CreateHandoffInput, maxDepth: number): Handoff {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (input.idempotencyKey) {
        const existing = this.db.prepare(
          "SELECT * FROM handoffs WHERE sender = ? AND idempotency_key = ?",
        ).get(sender, input.idempotencyKey) as HandoffRow | undefined;
        if (existing) {
          this.db.exec("COMMIT");
          return toHandoff(existing);
        }
      }

      const parent = input.parentId ? this.get(input.parentId) : undefined;
      const depth = parent ? parent.depth + 1 : 0;
      if (depth > maxDepth) throw new Error(`Maximum handoff depth of ${maxDepth} exceeded.`);

      const id = randomUUID();
      const threadId = parent?.threadId ?? id;
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO handoffs (
          id, thread_id, parent_id, depth, sender, recipient, title, summary, request,
          context_refs_json, artifact_refs_json, tags_json, sensitivity, priority, status,
          created_at, updated_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
      `).run(
        id,
        threadId,
        input.parentId ?? null,
        depth,
        sender,
        input.recipient,
        input.title,
        input.summary,
        input.request,
        JSON.stringify(input.contextRefs),
        JSON.stringify(input.artifactRefs),
        JSON.stringify(input.tags),
        input.sensitivity,
        input.priority,
        now,
        now,
        input.idempotencyKey ?? null,
      );
      this.insertEvent(id, sender, "created", undefined, "queued", undefined, now);
      const created = this.get(id);
      this.db.exec("COMMIT");
      return created;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public get(id: string): Handoff {
    const handoff = this.find(id);
    if (!handoff) throw new Error(`Handoff '${id}' was not found.`);
    return handoff;
  }

  public find(id: string): Handoff | undefined {
    const row = this.db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as HandoffRow | undefined;
    return row ? toHandoff(row) : undefined;
  }

  public inbox(recipient: string, statuses: HandoffStatus[], limit: number): Handoff[] {
    const placeholders = statuses.map(() => "?").join(",");
    const rows = this.db.prepare(
      `SELECT * FROM handoffs WHERE recipient = ? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
    ).all(recipient, ...statuses, limit) as unknown as HandoffRow[];
    return rows.map(toHandoff);
  }

  public events(handoffId: string): HandoffEvent[] {
    const rows = this.db.prepare(
      "SELECT * FROM handoff_events WHERE handoff_id = ? ORDER BY created_at, rowid",
    ).all(handoffId) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  public transition(
    handoffId: string,
    actor: string,
    toStatus: Exclude<HandoffStatus, "queued">,
    note?: string,
  ): Handoff {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(handoffId);
      const allowed = this.allowedTransition(current, actor, toStatus);
      if (!allowed) {
        throw new Error(`Agent '${actor}' may not move '${current.status}' to '${toStatus}'.`);
      }
      const now = new Date().toISOString();
      this.db.prepare("UPDATE handoffs SET status = ?, updated_at = ? WHERE id = ?").run(toStatus, now, handoffId);
      this.insertEvent(handoffId, actor, toStatus, current.status, toStatus, note, now);
      const updated = this.get(handoffId);
      this.db.exec("COMMIT");
      return updated;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public close(): void {
    this.db.close();
  }

  private allowedTransition(handoff: Handoff, actor: string, next: Exclude<HandoffStatus, "queued">): boolean {
    if (next === "cancelled") return actor === handoff.sender && handoff.status === "queued";
    if (actor !== handoff.recipient) return false;
    if (next === "accepted") return handoff.status === "queued" || handoff.status === "blocked";
    if (next === "blocked") return handoff.status === "queued" || handoff.status === "accepted";
    if (next === "completed") return handoff.status === "accepted" || handoff.status === "blocked";
    return false;
  }

  private insertEvent(
    handoffId: string,
    actor: string,
    eventType: HandoffEvent["eventType"],
    fromStatus: HandoffStatus | undefined,
    toStatus: HandoffStatus,
    note: string | undefined,
    createdAt: string,
  ): void {
    this.db.prepare(`
      INSERT INTO handoff_events (id, handoff_id, actor, event_type, from_status, to_status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), handoffId, actor, eventType, fromStatus ?? null, toStatus, note ?? null, createdAt);
  }
}
