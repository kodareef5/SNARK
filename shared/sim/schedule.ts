// A heap of (tick, kind, a, b). Entries are never cancelled. A handler checks that its deadline is still current and ignores a stale one.
// Deadlines are derived state, rebuilt from records on load and never saved.

/** What a kind's due entry is given: its a and b, and the tick it was due at. */
export type Due = (a: number, b: number, tick: number) => void;

export class DeadlineHeap {
  size = 0;
  private readonly names: string[] = [];
  private readonly handlers: Due[] = [];
  private tick: Float64Array;
  private order: Uint32Array;
  private kinds: Uint16Array;
  private a: Float64Array;
  private b: Float64Array;
  private seq = 0;

  constructor(capacity = 1024) {
    this.tick = new Float64Array(capacity);
    this.order = new Uint32Array(capacity);
    this.kinds = new Uint16Array(capacity);
    this.a = new Float64Array(capacity);
    this.b = new Float64Array(capacity);
  }

  /**
   * A new kind, whose due entries `run` gives to `fn`. The system that pushes a kind asks for it here, once. The number is
   * the order of asking: it is in no save, so it need not be the same at the next start.
   */
  kind(name: string, fn: Due): number {
    if (this.names.includes(name)) throw new Error(`there is already a deadline kind "${name}"`);
    this.names.push(name);
    this.handlers.push(fn);
    return this.names.length - 1;
  }

  /** Infinity when empty. */
  get nextTick(): number {
    return this.size > 0 ? this.tick[0]! : Infinity;
  }

  push(tick: number, kind: number, a: number, b: number): void {
    if (!(kind < this.handlers.length)) throw new Error(`deadline kind ${kind} was not asked for`);
    if (this.size === this.tick.length) this.grow();
    const order = this.seq++;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.tick[p]! < tick || (this.tick[p] === tick && this.order[p]! < order)) break;
      this.move(p, i);
      i = p;
    }
    this.tick[i] = tick;
    this.order[i] = order;
    this.kinds[i] = kind;
    this.a[i] = a;
    this.b[i] = b;
  }

  /**
   * Runs every deadline due at or before `now`, earliest first, ties in the order they were scheduled, each by its kind's
   * handler. Deadlines a handler schedules for `now` or earlier run in the same call. Stops after `limit` so a storm cannot
   * stall a tick. Returns how many ran.
   */
  run(now: number, limit = 100000): number {
    let ran = 0;
    while (this.size > 0 && this.tick[0]! <= now && ran < limit) {
      const tick = this.tick[0]!;
      const kind = this.kinds[0]!;
      const a = this.a[0]!;
      const b = this.b[0]!;
      this.pop();
      this.handlers[kind]!(a, b, tick);
      ran++;
    }
    return ran;
  }

  private pop(): void {
    const n = --this.size;
    if (n === 0) return;
    const tick = this.tick[n]!;
    const order = this.order[n]!;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && (this.tick[c + 1]! < this.tick[c]! || (this.tick[c + 1] === this.tick[c] && this.order[c + 1]! < this.order[c]!))) c++;
      if (tick < this.tick[c]! || (tick === this.tick[c] && order < this.order[c]!)) break;
      this.move(c, i);
      i = c;
    }
    this.move(n, i);
  }

  private move(from: number, to: number): void {
    this.tick[to] = this.tick[from]!;
    this.order[to] = this.order[from]!;
    this.kinds[to] = this.kinds[from]!;
    this.a[to] = this.a[from]!;
    this.b[to] = this.b[from]!;
  }

  private grow(): void {
    const cap = this.tick.length * 2;
    const f64 = (old: Float64Array): Float64Array => {
      const next = new Float64Array(cap);
      next.set(old);
      return next;
    };
    this.tick = f64(this.tick);
    this.a = f64(this.a);
    this.b = f64(this.b);
    const order = new Uint32Array(cap);
    order.set(this.order);
    this.order = order;
    const kinds = new Uint16Array(cap);
    kinds.set(this.kinds);
    this.kinds = kinds;
  }
}
