// Decision points for Cast, in grunt's shape (grunt/policy.ts, which the server may not import, D879): a narrow question
// with its candidates and the state it is about, answered by a policy, rules or a model alike, and written to a log a
// decision model can later be fitted to. The two may become one shared module.
//
// The log is a folder of the world's own, `<db>.cast/decisions-<day>.jsonl`, a line a decision. Lines wait in memory and
// go to the disk every few seconds by a write the tick does not wait for, one at a time. A disk that cannot keep up
// loses lines, which are counted, and never the game's tick. The folder keeps under its megabytes by dropping whole days.

import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface DecisionInput {
  /** Which question: `story.plan`, `person.life`, ... */
  point: string;
  candidates: string[];
  state: Record<string, unknown>;
}

export interface Choice {
  choice: string;
  why?: string;
}

/** One decision as the log keeps it: the question, what was chosen, by which policy, and what it cost. */
export interface DecisionRecord extends DecisionInput, Choice {
  t: number;
  policy: string;
  ms?: number;
  tokens?: { in: number; out: number };
  cost?: number;
}

/** Lines that may wait for the disk. One more drops the oldest. */
export const PENDING_MOST = 2000;
const DAY_FILE = /^decisions-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface DecisionLogOptions {
  /** Appends `text` to `file`; the default is the file system's, off the calling thread. */
  append?: (file: string, text: string) => Promise<void>;
  /** Wall clock, milliseconds: the day a file is named for. */
  now?: () => number;
}

/** Keeps the last decisions in memory, and with a folder writes them a line each to a file per day. */
export class DecisionLog {
  readonly kept: DecisionRecord[] = [];
  /** Lines the disk never took: dropped while it was slow or full, or in a write that failed. */
  lost = 0;
  /** The most the folder's files may take, in bytes. None writes nothing. */
  cap = 256 * 2 ** 20;
  private readonly dir: string | null;
  private readonly append: (file: string, text: string) => Promise<void>;
  private readonly now: () => number;
  private pending: string[] = [];
  private writing: Promise<void> | null = null;
  /** The day whose file alone has reached the cap, so no more is written that day. */
  private full = "";

  constructor(dir: string | null, opts: DecisionLogOptions = {}) {
    this.dir = dir;
    this.append = opts.append ?? ((file, text) => appendFile(file, text));
    this.now = opts.now ?? Date.now;
  }

  write(d: DecisionRecord): void {
    this.kept.push(d);
    if (this.kept.length > 500) this.kept.shift();
    if (!this.dir || this.cap <= 0) return;
    if (this.pending.length >= PENDING_MOST) {
      this.pending.shift();
      this.lost++;
    }
    this.pending.push(JSON.stringify(d) + "\n");
  }

  /** How many lines wait for the disk. */
  get waiting(): number {
    return this.pending.length;
  }

  /**
   * Starts writing what waits, unless a write is still under way: then the lines wait for the next call. The promise is
   * the write's, for a test or a stop to wait on; it never rejects.
   */
  flush(): Promise<void> {
    if (this.writing) return this.writing;
    const dir = this.dir;
    if (!dir || this.pending.length === 0) return Promise.resolve();
    const lines = this.pending;
    this.pending = [];
    const day = this.day();
    if (this.cap <= 0 || this.full === day) {
      this.lost += lines.length;
      return Promise.resolve();
    }
    const write = async (): Promise<void> => {
      try {
        await mkdir(dir, { recursive: true });
        await this.append(join(dir, `decisions-${day}.jsonl`), lines.join(""));
        this.prune(dir, day);
      } catch {
        this.lost += lines.length;
      } finally {
        this.writing = null;
      }
    };
    return (this.writing = write());
  }

  /** At a stop: what waits goes to its file before the process ends. */
  close(): void {
    const dir = this.dir;
    if (!dir || this.pending.length === 0) return;
    const lines = this.pending;
    this.pending = [];
    const day = this.day();
    if (this.cap <= 0 || this.full === day) return void (this.lost += lines.length);
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `decisions-${day}.jsonl`), lines.join(""));
    } catch {
      this.lost += lines.length;
    }
  }

  private day(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  /** Drops the oldest days while the files take more than the cap. Today's is never dropped: once it alone is over, it is written no more. */
  private prune(dir: string, today: string): void {
    const files = readdirSync(dir).filter((n) => DAY_FILE.test(n)).sort();
    const sizes = files.map((n) => statSync(join(dir, n)).size);
    let bytes = sizes.reduce((a, b) => a + b, 0);
    for (let i = 0; i < files.length && bytes > this.cap; i++) {
      if (files[i] === `decisions-${today}.jsonl`) continue;
      rmSync(join(dir, files[i]!), { force: true });
      bytes -= sizes[i]!;
    }
    this.full = bytes > this.cap ? today : "";
  }
}
