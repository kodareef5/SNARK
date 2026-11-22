// Decision points for Cast, in grunt's shape (grunt/policy.ts, which the server may not import, D879): a narrow question
// with its candidates and the state it is about, answered by a policy, rules or a model alike, and written to a log
// (var/cast/decisions-<day>.jsonl) a decision model can later be fitted to. The two may become one shared module.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

/** Writes decisions a line each to a file per day, or keeps them in memory (tests, or no folder given). */
export class DecisionLog {
  readonly kept: DecisionRecord[] = [];
  private readonly dir: string | null;

  constructor(dir: string | null) {
    this.dir = dir;
  }

  write(d: DecisionRecord): void {
    this.kept.push(d);
    if (this.kept.length > 500) this.kept.shift();
    if (!this.dir) return;
    const file = `${this.dir}/decisions-${new Date().toISOString().slice(0, 10)}.jsonl`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(d) + "\n");
    } catch {
      // A log that cannot be written loses its lines, never the game's tick.
    }
  }
}
