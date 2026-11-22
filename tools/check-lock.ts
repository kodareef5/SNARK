// One full check at a time on a machine, and how many test workers it runs. Several agents each ran the whole check at
// once and every one took twice as long; now the second waits for the first. The lock is a file beside the art the
// machine shares (SNARK_CACHE, else ~/.cache/snark), holding who took it. Runs of an area or the smoke set take none.

import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { freemem, homedir, totalmem } from "node:os";
import { dirname, join } from "node:path";

/** Who holds the lock: its process, when that started, its checkout, and when it took the lock (ms since 1970). */
export interface Holder {
  pid: number;
  born: string;
  checkout: string;
  since: number;
}

export function lockFile(): string {
  return join(process.env.SNARK_CACHE || join(homedir(), ".cache/snark"), "check.lock");
}

/** When process `pid` started, as `ps` words it, or "" if there is none. A number alone may be another's after a restart. */
export function born(pid: number): string {
  try {
    return Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
  } catch {
    return "";
  }
}

/** Whether the process that took the lock is still that process. */
export function alive(holder: Holder, bornOf: (pid: number) => string = born): boolean {
  try {
    process.kill(holder.pid, 0);
  } catch (e) {
    // EPERM: it is there, and another user's.
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  return bornOf(holder.pid) === holder.born;
}

/** The holder written in `file`; null if what is there is not one; undefined if there is no file. */
function read(file: string): Holder | null | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    const h = JSON.parse(text) as Holder;
    return typeof h.pid === "number" && typeof h.born === "string" && typeof h.checkout === "string" && typeof h.since === "number" ? h : null;
  } catch {
    return null;
  }
}

/**
 * Takes the lock at `file` for `me` and returns null, or returns who holds it. A lock whose process is gone, killed or
 * lost to a restart, is taken over, and `gone` is told whose it was. Two that take over one dead lock in the same instant
 * both run: rare, and only slower.
 */
export function take(file: string, me: Holder, bornOf: (pid: number) => string = born, gone: (was: Holder | null) => void = () => {}): Holder | null {
  mkdirSync(dirname(file), { recursive: true });
  const mine = `${file}.${me.pid}`;
  writeFileSync(mine, JSON.stringify(me));
  try {
    for (;;) {
      try {
        // A link is made whole or not at all, and never over another's.
        linkSync(mine, file);
        return null;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      const holder = read(file);
      // Released as this one looked.
      if (holder === undefined) continue;
      if (holder && alive(holder, bornOf)) return holder;
      gone(holder);
      renameSync(mine, file);
      return null;
    }
  } finally {
    rmSync(mine, { force: true });
  }
}

/** Lets go of the lock at `file`, if `pid` still holds it: one taken over from a check thought dead is the taker's. */
export function release(file: string, pid: number): void {
  if (read(file)?.pid === pid) rmSync(file, { force: true });
}

/** What a test worker held at its peak, averaged over a measured run of the fast tier (0.55 GB), with a margin. */
export const WORKER_BYTES = 0.6e9;
/** More JS heaps than this contend for cache and memory on a machine of many threads, and time out files fast alone. */
export const MOST_WORKERS = 16;

/**
 * Memory the workers may take, in bytes. Linux counts what it can give back. macOS counts only the pages nothing holds,
 * which is little on a Mac with memory to spare, so there no less than half the machine's is taken as free.
 */
export function freeMemory(platform: string = process.platform, free: number = freemem(), total: number = totalmem()): number {
  return platform === "darwin" ? Math.max(free, total / 2) : free;
}

/** Test workers for the whole check: two cores left for the rest of the machine, and no more than memory has room for. */
export function workersFor(cores: number, free: number): number {
  return Math.max(1, Math.min(MOST_WORKERS, cores - 2, Math.floor(free / WORKER_BYTES)));
}
