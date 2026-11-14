// Work on the save that can take longer than a tick: the checkpoint, whose disk sync is the slow part, and backups.
// The server gives it to a worker with a database connection of its own. Tests and tools use the inline keeper, which
// does the same work on the calling thread.

import { Database } from "bun:sqlite";
import { takeBackup, type BackupReport } from "./backup.ts";

export interface Keeper {
  /** Copies committed pages from the write-ahead log into the file. Never waits for a reader. */
  checkpoint(): void;
  /** Starts a backup. `onBackup` is called with what came of it. */
  backup(): void;
  close(): void;
  onBackup: ((r: BackupReport) => void) | null;
  /** Milliseconds the last checkpoint took, and the pages still in the log after it. */
  readonly last: { ms: number; pages: number };
}

export type KeeperRequest = { op: "open"; path: string; closed: Int32Array } | { op: "checkpoint" } | { op: "backup" } | { op: "close" };
export type KeeperReply = { op: "checkpoint"; ms: number; pages: number } | { op: "backup"; report: BackupReport };

/** One checkpoint on `db`. Returns the pages left in the log. */
export function checkpoint(db: Database): number {
  const row = db.query("PRAGMA wal_checkpoint(PASSIVE)").get() as { log: number; checkpointed: number } | null;
  return row ? Math.max(0, row.log - row.checkpointed) : 0;
}

/** Does the work at once, on the connection it is given. */
export function inlineKeeper(db: Database, path: string): Keeper {
  const keeper: Keeper = {
    onBackup: null,
    last: { ms: 0, pages: 0 },
    checkpoint() {
      const t0 = performance.now();
      keeper.last.pages = checkpoint(db);
      keeper.last.ms = performance.now() - t0;
    },
    backup() {
      keeper.onBackup?.(takeBackup(db, path, new Date()));
    },
    close() {},
  };
  return keeper;
}

/** Does the work in a worker thread, on a connection of its own to the save at `path`. Replies arrive between ticks. */
export function workerKeeper(path: string): Keeper {
  const worker = new Worker(new URL("./keeper-worker.ts", import.meta.url).href);
  // The worker writes 1 here once its connection is closed, so close() can wait for it without a turn of the event loop.
  const closed = new Int32Array(new SharedArrayBuffer(4));
  const send = (m: KeeperRequest): void => worker.postMessage(m);
  const keeper: Keeper = {
    onBackup: null,
    last: { ms: 0, pages: 0 },
    checkpoint: () => send({ op: "checkpoint" }),
    backup: () => send({ op: "backup" }),
    close() {
      send({ op: "close" });
      Atomics.wait(closed, 0, 0, 5000);
      worker.terminate();
    },
  };
  worker.onmessage = (e: MessageEvent<KeeperReply>) => {
    const m = e.data;
    if (m.op === "checkpoint") {
      keeper.last.ms = m.ms;
      keeper.last.pages = m.pages;
    } else keeper.onBackup?.(m.report);
  };
  // The server may exit while the worker is idle.
  worker.unref();
  send({ op: "open", path, closed });
  return keeper;
}
