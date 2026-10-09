import { AgentRegistry } from "./registry.js";
import { HandoffService } from "./service.js";
import { HandoffStore } from "./store.js";

import type { AppConfig } from "./config.js";

export function createRuntime(config: AppConfig): {
  registry: AgentRegistry;
  store: HandoffStore;
  service: HandoffService;
} {
  const registry = new AgentRegistry(config.registryFile);
  const store = new HandoffStore(config.databaseFile, config.registryFile);
  const service = new HandoffService(registry, store, {
    maxMessageBytes: config.maxMessageBytes,
    maxHandoffDepth: config.maxHandoffDepth,
  });
  return { registry, store, service };
}
