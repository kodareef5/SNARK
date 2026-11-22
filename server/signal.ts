// How one system tells others that something happened, or asks whether any of them minds, without knowing who they
// are. Any number may listen, and they are called in the order they were added. Nothing is allocated at a call: both
// kinds pass their arguments by place, at most six of them.
//
// A question with one answer that exactly one system gives (a view, a result code) is not for these: it stays a plain
// function field on the system that asks.

/** At most six arguments, so that none is gathered into an array. */
type Args = readonly unknown[] & { readonly length: 0 | 1 | 2 | 3 | 4 | 5 | 6 };
type Six<R> = (a?: unknown, b?: unknown, c?: unknown, d?: unknown, e?: unknown, f?: unknown) => R;

/** Something that happened. `emit` tells every listener. */
export class Signal<A extends Args = []> {
  private readonly fns: ((...args: A) => void)[] = [];
  readonly emit: (...args: A) => void;

  constructor() {
    const fns = this.fns as unknown as Six<void>[];
    const emit: Six<void> = (a, b, c, d, e, f) => {
      for (let i = 0; i < fns.length; i++) fns[i]!(a, b, c, d, e, f);
    };
    this.emit = emit as unknown as (...args: A) => void;
  }

  get size(): number {
    return this.fns.length;
  }

  on(fn: (...args: A) => void): void {
    this.fns.push(fn);
  }

  /** Forgets every listener, for a test that stands in for them. */
  clear(): void {
    this.fns.length = 0;
  }
}

/**
 * A question any listener may refuse. `ask` gives the first answer that is not `yes`, and asks nobody after it; `yes`
 * where every listener gave it, and where nobody listens.
 */
export class Veto<A extends Args, R = boolean> {
  private readonly fns: ((...args: A) => R)[] = [];
  readonly ask: (...args: A) => R;

  constructor(yes: R) {
    const fns = this.fns as unknown as Six<R>[];
    const ask: Six<R> = (a, b, c, d, e, f) => {
      for (let i = 0; i < fns.length; i++) {
        const answer = fns[i]!(a, b, c, d, e, f);
        if (answer !== yes) return answer;
      }
      return yes;
    };
    this.ask = ask as unknown as (...args: A) => R;
  }

  get size(): number {
    return this.fns.length;
  }

  on(fn: (...args: A) => R): void {
    this.fns.push(fn);
  }
}
