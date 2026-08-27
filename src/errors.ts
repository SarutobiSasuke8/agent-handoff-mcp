/**
 * Deliberate domain and policy errors whose messages are safe to surface to
 * MCP clients. Anything else that escapes a tool handler is treated as an
 * internal fault and replaced with a generic message.
 */
export class DomainError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
