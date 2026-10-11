import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

// Resolve existing ancestors too, so aliases cannot bypass a server lease.
export function recoveryPath(file: string): string {
  let parent = path.resolve(file);
  const parts: string[] = [];
  while (!existsSync(parent)) {
    parts.unshift(path.basename(parent));
    const next = path.dirname(parent);
    if (next === parent) throw new Error("Cannot resolve recovery path.");
    parent = next;
  }
  const resolved = path.join(realpathSync(parent), ...parts);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function withRecoveryGuard<T>(files: string[], action: () => T): T {
  const guards = [...new Set(files.map((file) => `${recoveryPath(file)}.handoff-guard`))].sort();
  const held: string[] = [];
  try {
    for (const guard of guards) {
      mkdirSync(path.dirname(guard), { recursive: true });
      try { mkdirSync(guard, { mode: 0o700 }); }
      catch { throw new Error("Recovery/startup is already in progress; inspect the handoff guard before retrying."); }
      held.push(guard);
    }
    return action();
  } finally {
    for (const guard of held.reverse()) rmdirSync(guard);
  }
}

export function assertNoServers(file: string): void {
  const folder = `${recoveryPath(file)}.handoff-servers`;
  if (!existsSync(folder)) return;
  for (const name of readdirSync(folder)) {
    const pid = Number(/^(\d+)-/u.exec(name)?.[1]);
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Unknown server lease; stop and inspect it before restore.");
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") continue;
      throw new Error("Cannot establish whether a server is running; restore refused.", { cause: error });
    }
    throw new Error("A server is still running; stop all HTTP and stdio servers before restore, even with --force.");
  }
}

export function registerServer(database: string, registry: string): () => void {
  if (database === ":memory:") return () => undefined;
  const files = [...new Set([database, registry].map(recoveryPath))];
  const leases: string[] = [];
  withRecoveryGuard(files, () => {
    if (files.some((file) => existsSync(`${file}.handoff-restore-pending`))) {
      throw new Error("An interrupted restore needs operator recovery before server startup.");
    }
    try {
      for (const file of files) {
        const folder = `${file}.handoff-servers`;
        mkdirSync(folder, { recursive: true, mode: 0o700 });
        const lease = path.join(folder, `${process.pid}-${randomUUID()}`);
        writeFileSync(lease, "", { flag: "wx", mode: 0o600 });
        leases.push(lease);
      }
    } catch (error) {
      for (const lease of leases) unlinkSync(lease);
      throw error;
    }
  });
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const lease of leases) unlinkSync(lease);
    process.removeListener("exit", release);
  };
  process.once("exit", release);
  return release;
}
