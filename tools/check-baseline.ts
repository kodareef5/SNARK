// What the fast tier costs on this machine, as the check last measured it here: each machine its own baseline, in place
// of one budget for every machine (D794). CPU-seconds are a property of the machine as much as of the tests: the same
// commit took 826 on eight Ryzen cores, 1264 on all 24 of its threads and about 260 on the Mac the old budget was set on.
// So the baseline lives with the machine, outside the repository, and nobody commits a number for another to meet.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, homedir } from "node:os";
import { dirname, join } from "node:path";

/** Passing runs kept for each machine and worker count; the baseline is their median. */
export const RUNS_KEPT = 5;
/** Runs needed before a run is compared: one run alone may have shared the machine with anything. */
export const RUNS_NEEDED = 3;
/** A run over the baseline by more than this share is said to be, with what grew. */
export const OVER = 0.3;

/** One passing run of the fast tier: its CPU-seconds and each file's. */
export interface Run {
  cpu: number;
  files: Record<string, number>;
}

interface Store {
  version: 1;
  machines: Record<string, Run[]>;
}

/** Where this machine keeps its runs: SNARK_BASELINE, else the user's cache, shared by every checkout and worktree here. */
export function baselineFile(): string {
  return process.env.SNARK_BASELINE || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "snark", "check-baseline.json");
}

/** Runs compare only on the same processor, cores and workers: more workers than cores slow each other down. */
export function machineKey(workers: number): string {
  return `${cpus()[0]?.model.trim() ?? "unknown"} | ${availableParallelism()} cores | ${workers} workers`;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** What `now` cost beside the runs before it: the baseline (null while too few), whether it is over, what grew most. */
export function compare(history: readonly Run[], now: Run): { baseline: number | null; over: boolean; grew: { file: string; was: number; now: number }[] } {
  if (history.length < RUNS_NEEDED) return { baseline: null, over: false, grew: [] };
  const baseline = median(history.map((r) => r.cpu));
  const grew = Object.entries(now.files)
    .map(([file, seconds]) => {
      const seen = history.map((r) => r.files[file]).filter((s): s is number => s !== undefined);
      return { file, was: seen.length > 0 ? median(seen) : 0, now: seconds };
    })
    .filter((g) => g.now > g.was)
    .sort((a, b) => b.now - b.was - (a.now - a.was) || (a.file < b.file ? -1 : 1))
    .slice(0, 5);
  return { baseline, over: now.cpu > baseline * (1 + OVER), grew };
}

function read(file: string): Store {
  try {
    const store = JSON.parse(readFileSync(file, "utf8")) as Store;
    if (store.version === 1 && typeof store.machines === "object") return store;
  } catch {
    // None yet, or unreadable: this machine starts again.
  }
  return { version: 1, machines: {} };
}

/** The runs kept for `key`, oldest first. */
export function history(key: string, file = baselineFile()): Run[] {
  return read(file).machines[key] ?? [];
}

/** Keeps a passing run for `key`, dropping the oldest past RUNS_KEPT. Two checks at once may lose one run, not the file. */
export function remember(key: string, run: Run, file = baselineFile()): void {
  const store = read(file);
  store.machines[key] = [...(store.machines[key] ?? []), run].slice(-RUNS_KEPT);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.${process.pid}`, JSON.stringify(store));
  renameSync(`${file}.${process.pid}`, file);
}
