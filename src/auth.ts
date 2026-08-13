import { createHash, timingSafeEqual } from "node:crypto";

import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { AgentRegistry } from "./registry.js";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class RegistryTokenVerifier implements OAuthTokenVerifier {
  public constructor(private readonly registry: AgentRegistry) {}

  public async verifyAccessToken(token: string): Promise<AuthInfo> {
    const digest = sha256(token);
    const now = Math.floor(Date.now() / 1000);
    const snapshot = await this.registry.current();
    const agent = snapshot.all().find(
      (candidate) => candidate.enabled && candidate.tokenSha256 && hashEquals(digest, candidate.tokenSha256),
    );
    if (!agent || !agent.expiresAt || agent.expiresAt <= now) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown, disabled, or expired access token.");
    }
    return {
      token: `sha256:${digest}`,
      clientId: agent.id,
      scopes: ["handoff"],
      expiresAt: agent.expiresAt,
    };
  }
}
