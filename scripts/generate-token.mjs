#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";

const token = `handoff_${randomBytes(32).toString("base64url")}`;
const digest = createHash("sha256").update(token, "utf8").digest("hex");
process.stdout.write(`Raw token (show once): ${token}\nSHA-256 for registry: ${digest}\n`);
