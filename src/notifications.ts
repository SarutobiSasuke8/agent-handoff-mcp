import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { Handoff } from "./types.js";

export interface NotificationSink {
  record(handoff: Handoff): void;
}

/** An opt-in, local JSONL sink. Build a new object to exclude handoff content. */
export class FileNotificationSink implements NotificationSink {
  public constructor(private readonly file: string) {}

  public record(handoff: Handoff): void {
    const notice = {
      handoffId: handoff.id,
      senderId: handoff.sender,
      recipientId: handoff.recipient,
      status: handoff.status,
      timestamp: handoff.createdAt,
    };
    mkdirSync(path.dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(notice)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
