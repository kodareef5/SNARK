// One server per save. A second SQLite file beside the save is held under an exclusive lock for as long as the store is
// open. The kernel frees that lock however the process dies, so a lock left by a crash never has to be cleared by hand.

import { Database } from "bun:sqlite";

export interface SaveLock {
  release(): void;
}

/** Throws if another server, or another store in this one, holds the save at `path`. */
export function holdSave(path: string): SaveLock {
  const db = new Database(`${path}.lock`, { create: true });
  try {
    // In this mode a connection keeps the locks it takes until it closes. Writing takes the exclusive one.
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("PRAGMA journal_mode = MEMORY");
    db.exec("BEGIN EXCLUSIVE");
    db.exec("CREATE TABLE IF NOT EXISTS held (pid INTEGER NOT NULL)");
    db.exec("DELETE FROM held");
    db.query("INSERT INTO held (pid) VALUES (?)").run(process.pid);
    db.exec("COMMIT");
  } catch (err) {
    db.close();
    if ((err as { code?: unknown } | null)?.code === "SQLITE_BUSY") throw new Error(`${path} is in use by another server`);
    throw err;
  }
  return { release: () => db.close() };
}
