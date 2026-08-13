import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { RegistryValidationError, snapshotFromSource } from "./registry.js";

/**
 * Validate a registry file without opening the database or reading any raw
 * token material. Prints field-specific, redacted findings and returns a
 * process exit code.
 */
export async function runValidate(registryPath: string): Promise<number> {
  let source: string;
  try {
    source = await readFile(registryPath, "utf8");
  } catch (error) {
    process.stderr.write(`Cannot read registry file: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return 1;
  }
  try {
    const snapshot = snapshotFromSource(source);
    const agents = snapshot.all();
    const enabled = agents.filter((agent) => agent.enabled).length;
    process.stdout.write(
      `Registry valid: ${agents.length} agent(s), ${enabled} enabled, revision ${snapshot.revision}.\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof RegistryValidationError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`Registry validation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    }
    return 1;
  }
}

export async function validateMain(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { registry: { type: "string" } },
    strict: true,
  });
  if (!values.registry) {
    process.stderr.write("Usage: agent-handoff-validate --registry <path>\n");
    return 2;
  }
  return runValidate(values.registry);
}
