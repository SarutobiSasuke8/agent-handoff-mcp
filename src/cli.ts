#!/usr/bin/env node
import { parseArgs } from "node:util";

import { disableAgent, enableAgent, initRegistry, issueToken, newToken, revokeToken } from "./provision.js";
import { validateMain } from "./validate.js";

const USAGE = `Usage: agent-handoff-mcp <command> [options]

Server commands:
  http                                 Start the shared Streamable HTTP server.
  stdio                                Start a stdio server (requires HANDOFF_AGENT_ID).

Registry commands:
  init     --registry <path>           Create a starter registry with disabled synthetic identities.
  validate --registry <path>           Validate a registry file (no tokens or database are read).
  issue    --registry <path> --agent <id> --expires <iso8601>
                                       Issue an expiring token; the raw token is printed once to stdout.
  rotate   --registry <path> --agent <id> --expires <iso8601>
                                       Replace an existing token; the old token stops working immediately.
  disable  --registry <path> --agent <id>   Disable an identity across all transports.
  enable   --registry <path> --agent <id>   Re-enable an identity.
  revoke   --registry <path> --agent <id>   Remove an identity's token binding entirely.

Token command:
  token                                Generate a token and SHA-256 digest without touching a registry.
`;

function requireOption(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required option --${name}. Run 'agent-handoff-mcp' for usage.`);
  return value;
}

function registryOptions(argv: string[]): { registry: string; agent?: string; expires?: string; allowInsecure: boolean } {
  const { values } = parseArgs({
    args: argv,
    options: {
      registry: { type: "string" },
      agent: { type: "string" },
      expires: { type: "string" },
      "allow-insecure": { type: "boolean" },
    },
    strict: true,
  });
  return {
    registry: requireOption(values.registry, "registry"),
    ...(values.agent ? { agent: values.agent } : {}),
    ...(values.expires ? { expires: values.expires } : {}),
    allowInsecure: values["allow-insecure"] ?? false,
  };
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "http":
      await import("./http.js");
      return 0;
    case "stdio":
      await import("./stdio.js");
      return 0;
    case "validate":
      return validateMain(rest);
    case "token": {
      const issued = newToken();
      process.stdout.write(`Raw token (show once): ${issued.token}\nSHA-256 for registry: ${issued.digest}\n`);
      return 0;
    }
    case "init": {
      const options = registryOptions(rest);
      await initRegistry(options.registry);
      process.stdout.write(
        `Created ${options.registry} with disabled synthetic identities.\n` +
        "Issue tokens with 'agent-handoff-mcp issue', then set enabled: true per identity.\n",
      );
      return 0;
    }
    case "issue":
    case "rotate": {
      const options = registryOptions(rest);
      const issued = await issueToken(
        options.registry,
        requireOption(options.agent, "agent"),
        requireOption(options.expires, "expires"),
        { requireExistingToken: command === "rotate", allowInsecure: options.allowInsecure },
      );
      process.stdout.write(
        `Raw token for '${options.agent}' (shown once, never stored): ${issued.token}\n` +
        `Registry updated with its SHA-256 digest; expires ${options.expires}.\n`,
      );
      return 0;
    }
    case "disable": {
      const options = registryOptions(rest);
      await disableAgent(options.registry, requireOption(options.agent, "agent"));
      process.stdout.write(`Agent '${options.agent}' is now disabled for all transports.\n`);
      return 0;
    }
    case "enable": {
      const options = registryOptions(rest);
      await enableAgent(options.registry, requireOption(options.agent, "agent"));
      process.stdout.write(`Agent '${options.agent}' is now enabled.\n`);
      return 0;
    }
    case "revoke": {
      const options = registryOptions(rest);
      await revokeToken(options.registry, requireOption(options.agent, "agent"));
      process.stdout.write(`Token binding removed for '${options.agent}'.\n`);
      return 0;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return command === undefined ? 2 : 0;
    default:
      process.stderr.write(`Unknown command '${command}'.\n\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exitCode = 1;
}
