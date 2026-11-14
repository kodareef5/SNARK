// The keeper's worker thread (keeper.ts). It holds its own connection to the save and never writes to it.

import { Database } from "bun:sqlite";
import { takeBackup } from "./backup.ts";
import { checkpoint, type KeeperReply, type KeeperRequest } from "./keeper.ts";

declare const self: { onmessage: ((e: { data: KeeperRequest }) => void) | null; postMessage(m: KeeperReply): void };

let db: Database | null = null;
let path = "";
let closed: Int32Array | null = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.op === "open") {
    path = m.path;
    closed = m.closed;
    db = new Database(path);
    // A checkpoint or a backup may wait for the tick thread's commit. The tick thread never waits for this.
    db.exec("PRAGMA busy_timeout = 5000");
  } else if (m.op === "close") {
    db?.close();
    db = null;
    if (closed) {
      Atomics.store(closed, 0, 1);
      Atomics.notify(closed, 0);
    }
  } else if (!db) return;
  else if (m.op === "checkpoint") {
    const t0 = performance.now();
    let pages = 0;
    try {
      pages = checkpoint(db);
    } catch {
      // The next one will do it.
    }
    self.postMessage({ op: "checkpoint", ms: performance.now() - t0, pages });
  } else if (m.op === "backup") self.postMessage({ op: "backup", report: takeBackup(db, path, new Date()) });
};
