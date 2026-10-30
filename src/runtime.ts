import { AgentRegistry } from "./registry.js";
import { HandoffService } from "./service.js";
import { HandoffStore } from "./store.js";
import { PostgresHandoffStore } from "./store-postgres.js";
import { FileNotificationSink } from "./notifications.js";

import type { AppConfig } from "./config.js";
import type { HandoffStoreAdapter } from "./store-adapter.js";

/** SQLite is the default; HANDOFF_STORE=postgres selects the experimental Postgres adapter. */
export function createStore(config: AppConfig): HandoffStoreAdapter {
  if (config.storeKind === "postgres" && config.postgresUrl) {
    return new PostgresHandoffStore({ connectionString: config.postgresUrl });
  }
  return new HandoffStore(config.databaseFile, config.registryFile);
}

export function createRuntime(config: AppConfig): {
  registry: AgentRegistry;
  store: HandoffStoreAdapter;
  service: HandoffService;
} {
  const registry = new AgentRegistry(config.registryFile);
  const store = createStore(config);
  const service = new HandoffService(registry, store, {
    maxMessageBytes: config.maxMessageBytes,
    maxHandoffDepth: config.maxHandoffDepth,
    ...(config.notificationFile ? { notificationSink: new FileNotificationSink(config.notificationFile) } : {}),
  });
  return { registry, store, service };
}
