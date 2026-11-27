// Decision points for Cast, in grunt's shape (grunt/policy.ts, which the server may not import, D879): a narrow question
// with its candidates and the state it is about, answered by a policy, rules or a model alike, and written to a log
// (<save's folder>/cast/decisions-w<world>-<day>.jsonl) through the decider's line log, which never writes inside a tick.

import { LineLog } from "../decide/log.ts";

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

/** Keeps the last decisions in memory for the admin page and gives each to the line log (none, with no folder). */
export class DecisionLog {
  readonly kept: DecisionRecord[] = [];
  /** The host flushes it with the decider's own log (server/decide/decide.ts, `sinks`). */
  readonly lines: LineLog;

  constructor(dir: string | null, name = "decisions") {
    this.lines = new LineLog(dir, name);
  }

  write(d: DecisionRecord): void {
    this.kept.push(d);
    if (this.kept.length > 500) this.kept.shift();
    this.lines.add(JSON.stringify(d));
  }
}
