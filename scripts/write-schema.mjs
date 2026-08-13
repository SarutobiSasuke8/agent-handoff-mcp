#!/usr/bin/env node
// Regenerates the published JSON Schema from the runtime Zod schema.
// Run `npm run build` first; a unit test asserts the two stay in sync.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registryJsonSchema } from "../dist/src/registry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "schema"), { recursive: true });
const target = path.join(root, "schema", "agent-registry.schema.v1.json");
writeFileSync(target, `${JSON.stringify(registryJsonSchema(), null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${target}\n`);
