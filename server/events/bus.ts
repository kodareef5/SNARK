// Carries events from the server's systems to modules. A site that raises an event first asks `bus.n` whether anybody
// listens, so an event nobody hears costs one array read.
// A "before" event runs its handlers at once, highest priority first, and the first refusal ends it. An "after" event is
// queued and delivered once a tick, before the commit, so that no handler runs in the middle of the thing it is told of.

import type { EventData, HandlerOptions, ModuleEvent } from "../api/module.ts";
import { EVENTS, eventIndex } from "./catalog.ts";

/** A handler that throws this many times running is switched off. */
const THROWS_MOST = 8;
/** A call longer than this, in milliseconds, is logged. */
const SLOW_MS = 1;

interface Listener {
  module: string;
  event: number;
  fn: (e: ModuleEvent) => void;
  priority: number;
  refuseOnError: boolean;
  throws: number;
  off: boolean;
  calls: number;
  ms: number;
  worst: number;
}

export interface HandlerStats {
  module: string;
  event: string;
  calls: number;
  ms: number;
  worst: number;
  off: boolean;
}

const MODULE_FAILED = eventIndex("module.failed");

export class Bus {
  /** Listeners of each event, by its index in `EVENTS`. */
  readonly n = new Uint8Array(EVENTS.length);
  /** The module that refused the last "before" event that was refused. */
  refusedBy = "";
  /** A clock for timing handlers, in milliseconds. The server's process gives it one. Without it nothing is timed. */
  now: (() => number) | null = null;
  log: (line: string) => void = () => {};

  private readonly listeners: Listener[][] = EVENTS.map(() => []);
  private readonly queue: { event: number; data: EventData }[] = [];
  private refusal = "";
  private open = true;
  // One event object for every call. A handler may not keep it.
  private readonly event: { name: string; data: EventData; refuse(reason: string): void };

  constructor() {
    this.event = {
      name: "",
      data: {},
      refuse: (reason) => {
        if (this.refusal === "") this.refusal = reason === "" ? "refused" : reason;
      },
    };
  }

  /** Throws for an event that does not exist, and once the server has started. */
  on(module: string, name: string, fn: (e: ModuleEvent) => void, o: HandlerOptions = {}): void {
    if (!this.open) throw new Error(`${module}: handlers are added in setup, not later`);
    const event = eventIndex(name);
    if (event < 0) throw new Error(`${module}: there is no event "${name}"`);
    const list = this.listeners[event]!;
    list.push({ module, event, fn, priority: o.priority ?? 0, refuseOnError: o.onError === "refuse", throws: 0, off: false, calls: 0, ms: 0, worst: 0 });
    // Highest priority first. Among equals, the order they were added in.
    list.sort((a, b) => b.priority - a.priority);
    this.n[event] = Math.min(255, list.length);
  }

  /** No handler may be added after this. */
  close(): void {
    this.open = false;
  }

  /**
   * Raises a "before" event. Returns "" if it may go ahead, and `data` may then have been changed. Otherwise returns the
   * reason, and `refusedBy` names the module.
   */
  before(event: number, data: EventData): string {
    const list = this.listeners[event]!;
    this.refusal = "";
    for (const l of list) {
      if (l.off) continue;
      if (!this.call(l, data) && l.refuseOnError) this.refusal = `${l.module} could not decide`;
      if (this.refusal !== "") {
        this.refusedBy = l.module;
        return this.refusal;
      }
    }
    return "";
  }

  /** Queues an "after" event. `data` is kept until it is delivered, so it must not be reused by the caller. */
  after(event: number, data: EventData): void {
    if (this.n[event] !== 0) this.queue.push({ event, data });
  }

  /** Delivers what was queued, in the order it was raised. What handlers raise in turn is delivered next time. */
  flush(): void {
    const n = this.queue.length;
    for (let i = 0; i < n; i++) {
      const q = this.queue[i]!;
      for (const l of this.listeners[q.event]!) if (!l.off) this.call(l, q.data);
    }
    this.queue.splice(0, n);
  }

  /** Every handler, for the `modules` command. */
  stats(): HandlerStats[] {
    return this.listeners.flat().map((l) => ({ module: l.module, event: EVENTS[l.event]!.name, calls: l.calls, ms: l.ms, worst: l.worst, off: l.off }));
  }

  /** Returns false if the handler threw. */
  private call(l: Listener, data: EventData): boolean {
    const e = this.event;
    e.name = EVENTS[l.event]!.name;
    e.data = data;
    const t0 = this.now ? this.now() : 0;
    let ok = true;
    try {
      l.fn(e);
      l.throws = 0;
    } catch (err) {
      ok = false;
      this.log(`module ${l.module} threw in ${e.name}: ${err instanceof Error ? err.message : String(err)}`);
      if (++l.throws >= THROWS_MOST) {
        l.off = true;
        this.log(`module ${l.module} no longer hears ${e.name}`);
        if (l.event !== MODULE_FAILED) this.after(MODULE_FAILED, { name: l.module, event: e.name });
      }
    }
    l.calls++;
    if (this.now) {
      const took = this.now() - t0;
      l.ms += took;
      if (took > l.worst) l.worst = took;
      if (took > SLOW_MS) this.log(`module ${l.module} took ${took.toFixed(1)} ms in ${e.name}`);
    }
    return ok;
  }
}
