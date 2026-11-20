// The trace: every observation acted on, signal, decision, control, outcome and task change, as one record a line,
// in order. It is the debugger, the replay and the dataset small policies are trained on.

export interface TraceRecord {
  /** Wall-clock milliseconds when grunt wrote it, and the game's clock it was about. */
  at: number;
  t: number;
  kind: string;
  [field: string]: unknown;
}

export class Trace {
  readonly records: TraceRecord[] = [];
  private readonly sink: ((line: string) => void) | null;
  private readonly keep: number;
  gameTime: () => number = () => 0;

  /** `sink` takes each record as a JSON line (a file in Pi); `keep` bounds what is held in memory. */
  constructor(sink: ((line: string) => void) | null = null, keep = 20000) {
    this.sink = sink;
    this.keep = keep;
  }

  record(kind: string, data: Record<string, unknown>): void {
    const r: TraceRecord = { at: Date.now(), t: this.gameTime(), kind, ...data };
    this.records.push(r);
    if (this.records.length > this.keep) this.records.splice(0, this.records.length - this.keep);
    this.sink?.(JSON.stringify(r));
  }

  of(kind: string): TraceRecord[] {
    return this.records.filter((r) => r.kind === kind);
  }
}
