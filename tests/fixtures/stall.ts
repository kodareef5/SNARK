// A server run by its own loop (server/main.ts tickLoop) on virtual time, its ticks taking what a test says, beside pages
// whose frames take what a test says. A server in a tick, or a page in a frame, reads nothing until it ends, and what a
// tick sends leaves as it ends, as on one thread. Counts what a stall at either end costs.

import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { tickLoop } from "../../server/main.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader } from "../../shared/net/codec.ts";
import type { LinkOptions, LoopbackEnd } from "../../shared/net/loopback.ts";
import { C_INPUT, S_SNAPSHOT } from "../../shared/net/protocol.ts";
import type { Connection } from "../../shared/net/transport.ts";
import { Harness, type Pilot } from "./net.ts";

const TICK_MS = 1000 / TICK_RATE;
const FRAME_MS = 1000 / 60;

/** An end that reads and sends nothing while its side is busy, and does it all in order once it is free. */
class Busy implements Connection {
  onMessage: ((channel: number, data: Uint8Array) => void) | null = null;
  onClose: (() => void) | null = null;
  private readonly waiting: (() => void)[] = [];
  readonly inner: LoopbackEnd;
  private readonly clock: () => number;
  private readonly until: () => number;

  constructor(inner: LoopbackEnd, clock: () => number, until: () => number, heard?: (channel: number, data: Uint8Array) => void) {
    this.inner = inner;
    this.clock = clock;
    this.until = until;
    inner.onMessage = (channel, data) => this.later(() => (heard?.(channel, data), this.onMessage?.(channel, data)));
    inner.onClose = () => this.later(() => this.onClose?.());
  }

  get open(): boolean {
    return this.inner.open;
  }

  /** When what waits may go, Infinity while nothing waits. */
  get due(): number {
    return this.waiting.length > 0 ? this.until() : Infinity;
  }

  send(channel: number, data: Uint8Array): void {
    const copy = data.slice();
    this.later(() => this.inner.send(channel, copy));
  }

  close(): void {
    this.later(() => this.inner.close());
  }

  free(): void {
    for (const go of this.waiting.splice(0)) go();
  }

  private later(go: () => void): void {
    if (this.clock() < this.until() || this.waiting.length > 0) this.waiting.push(go);
    else go();
  }
}

export interface PageOptions {
  link?: LinkOptions;
  /** Milliseconds the frame begun at `at` takes; a 60 Hz frame by default. */
  frame?: (at: number) => number;
  /** Frames are not drawn while this says so, as in a hidden tab, but messages are read. */
  hidden?: (at: number) => boolean;
  /** The input at `at`. Stands still by default. */
  steer?: (at: number, p: Pilot) => void;
  /** Draws others each frame and counts how they move. */
  watch?: boolean;
}

/** What a page saw and sent, counted from `from` on. */
export interface PageCounts {
  jumps: number;
  /** Ticks the server stepped this page's body with an input this page sent too late for it. */
  thrown: number;
  /** Ticks the server stepped this page's body with no input of its own for it, those thrown away included. */
  guessed: number;
  corrections: number;
  /** Metres: the largest correction the prediction trace recorded. */
  largest: number;
  /** Snapshots that found the server at or past the prediction, which then took the server's body. */
  adopted: number;
  /** The longest the others this page draws stood still, ms; the drawn moment going back, how often and the most, in ticks. */
  still: number;
  rewinds: number;
  rewound: number;
  /** The most snapshots read in any 200 ms, and the most bytes of them. */
  burst: number;
  burstBytes: number;
  /** Ticks a shot of this page would be rewound at most, and the ticks on which it would be judged later than it saw. */
  rewind: number;
  clipped: number;
  margin: number;
}

interface Page {
  session: ClientSession;
  conn: Busy;
  until: number;
  next: number;
  frame: (at: number) => number;
  hidden: (at: number) => boolean;
  steer: (at: number, p: Pilot) => void;
  pilot: Pilot;
  watch: boolean;
  sample: RemoteSample;
  sent: Set<number>;
  missing: number[];
  snaps: number[];
  snapBytes: number[];
  drawn: number;
  stillFrom: number;
  base: { jumps: number; corrections: number; adopted: number };
  counts: PageCounts;
}

export class Rig {
  readonly h: Harness;
  readonly meter: TickMeter;
  /** Ticks the loop gave up, and what each tick cost. */
  dropped = 0;
  private busyUntil = 0;
  private turnAt = Infinity;
  private turn: (() => void) | null = null;
  private readonly ends: Busy[] = [];
  private readonly pages: Page[] = [];
  private k = 0;
  private from = Infinity;
  private readonly cost: (k: number, at: number) => number;
  private readonly stop: () => void;

  /** `cost` gives the milliseconds the k-th tick takes, begun at `at`. */
  constructor(cost: (k: number, at: number) => number = () => 0, seed = 1) {
    this.h = new Harness({}, seed);
    this.cost = cost;
    const net = this.h.net;
    const accept = net.onConnection!;
    net.onConnection = (end) => {
      const busy = new Busy(end as LoopbackEnd, () => net.now, () => this.busyUntil);
      this.ends.push(busy);
      accept(busy);
    };
    this.meter = new TickMeter(() => ({ online: 0, bodies: 0, rss: 0, heap: 0, commits: 0 }), (clock) => clock, 0);
    const now = (): number => Math.max(net.now, this.busyUntil);
    this.stop = tickLoop(
      {
        tick: (due: number, behind?: number) => {
          const began = now();
          this.busyUntil = began + this.cost(this.k++, began);
          this.step(behind ?? 0);
          this.meter.tick(due, began, this.busyUntil);
        },
        idle: () => this.h.host.idle(),
        drop: (ticks, at) => {
          this.meter.drop(ticks, at);
          this.dropped += ticks;
          this.h.server.replication.giveUp(ticks);
        },
      },
      now,
      (go, ms) => {
        this.turn = go;
        this.turnAt = now() + ms;
        return () => ((this.turn = null), (this.turnAt = Infinity));
      },
    );
  }

  get now(): number {
    return this.h.net.now;
  }

  join(name: string, o: PageOptions = {}): ClientSession {
    const net = this.h.net;
    const end = net.connect(o.link ?? {});
    this.h.gate(end.peer);
    const server = this.ends[this.ends.length - 1]!;
    const sent = new Set<number>();
    const snaps: number[] = [];
    const snapBytes: number[] = [];
    const r = new BitReader();
    let page: Page | null = null;
    const conn = new Busy(
      end,
      () => net.now,
      () => page?.until ?? 0,
      (_channel, data) => {
        if (data[0] === S_SNAPSHOT) (snaps.push(net.now), snapBytes.push(data.length));
      },
    );
    const send = conn.send.bind(conn);
    conn.send = (channel, data) => (noteInputs(data, sent, r), send(channel, data));
    const session = this.h.adopt(name, conn, end, server, { manual: true });
    page = {
      session, conn, until: 0, next: net.now, sent, snaps, snapBytes, missing: [],
      frame: o.frame ?? (() => FRAME_MS), hidden: o.hidden ?? (() => false), steer: o.steer ?? (() => {}),
      pilot: { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 }, watch: o.watch ?? false, sample: new RemoteSample(),
      drawn: -1, stillFrom: -1, base: { jumps: 0, corrections: 0, adopted: 0 },
      counts: { jumps: 0, thrown: 0, guessed: 0, corrections: 0, largest: 0, adopted: 0, still: 0, rewinds: 0, rewound: 0, burst: 0, burstBytes: 0, rewind: 0, clipped: 0, margin: 0 },
    };
    session.prediction.enabled = true;
    this.pages.push(page);
    return session;
  }

  /** Counts from now on. */
  watch(): void {
    this.from = this.now;
    for (const p of this.pages) {
      const s = p.session;
      p.base = { jumps: s.stats.clockJumps, corrections: s.stats.corrections, adopted: s.prediction.adopted };
      s.prediction.differences.length = 0;
    }
  }

  run(ms: number): void {
    const net = this.h.net;
    const end = net.now + ms;
    for (;;) {
      let t = Math.min(end, this.turnAt);
      for (const e of this.ends) t = Math.min(t, e.due);
      for (const p of this.pages) t = Math.min(t, p.conn.due, p.next);
      net.advance(t);
      for (const e of this.ends) if (e.due <= t) e.free();
      for (const p of this.pages) if (p.conn.due <= t) p.conn.free();
      if (this.turnAt <= t && this.turn) {
        const go = this.turn;
        this.turnAt = Infinity;
        go();
      }
      for (const p of this.pages) if (p.next <= t) this.frame(p);
      if (t >= end) break;
    }
  }

  /** What `session`'s page saw and sent since `watch`. */
  counts(session: ClientSession): PageCounts {
    const p = this.pages.find((q) => q.session === session)!;
    const s = p.session;
    const c = p.counts;
    c.jumps = s.stats.clockJumps - p.base.jumps;
    c.corrections = s.stats.corrections - p.base.corrections;
    c.adopted = s.prediction.adopted - p.base.adopted;
    c.largest = s.prediction.differences.reduce((m, d) => Math.max(m, d.distance), 0);
    c.guessed = p.missing.length;
    c.thrown = p.missing.filter((t) => p.sent.has(t)).length;
    c.margin = s.stats.margin;
    let burst = 0;
    let bytes = 0;
    for (let i = 0, j = 0, sum = 0; i < p.snaps.length; i++) {
      sum += p.snapBytes[i]!;
      while (p.snaps[i]! - p.snaps[j]! >= 200) sum -= p.snapBytes[j++]!;
      if (p.snaps[i]! >= this.from) (burst = Math.max(burst, i - j + 1), (bytes = Math.max(bytes, sum)));
    }
    c.burst = burst;
    c.burstBytes = bytes;
    return { ...c };
  }

  close(): void {
    this.stop();
    this.h.host.shutdown();
  }

  private step(behind: number): void {
    const T = this.h.world.tick + 1;
    const watching = this.now >= this.from;
    const clients = this.pages.map((p) => this.h.client(p.session));
    if (watching) this.pages.forEach((p, i) => {
      const c = clients[i];
      if (c && p.session.state === "active" && !c.inputs.has(T)) p.missing.push(T);
    });
    this.h.server.replication.behind = behind;
    this.h.server.tick();
    if (!watching) return;
    this.pages.forEach((p, i) => {
      const c = clients[i];
      if (!c || !c.inputs.has(T)) return;
      const judged = this.h.host.combat.viewTick(c);
      p.counts.rewind = Math.max(p.counts.rewind, T - judged);
      if (judged > c.inputs.view[T & c.inputs.mask]! + 0.01) p.counts.clipped++;
    });
  }

  private frame(p: Page): void {
    const at = this.now;
    const s = p.session;
    p.steer(at, p.pilot);
    if (!p.hidden(at)) {
      s.update(at, p.pilot.moveX, p.pilot.moveZ, p.pilot.yaw, p.pilot.pitch, p.pilot.buttons);
      if (p.watch && s.state === "active") this.look(p, at);
    }
    const ms = p.frame(at);
    p.until = ms > FRAME_MS + 1 ? at + ms : at;
    p.next = at + ms;
  }

  /** How the others a page draws move: standing still while the drawn moment holds, a rewind when it goes back. */
  private look(p: Page, at: number): void {
    p.session.sampleRemote(p.sample);
    if (p.sample.count === 0) return;
    const drawn = p.sample.tick;
    if (at >= this.from && p.drawn >= 0) {
      if (drawn < p.drawn - 1e-6) {
        p.counts.rewinds++;
        p.counts.rewound = Math.max(p.counts.rewound, p.drawn - drawn);
      }
      if (drawn > p.drawn + 1e-6) {
        if (p.stillFrom >= 0) p.counts.still = Math.max(p.counts.still, at - p.stillFrom);
        p.stillFrom = -1;
      } else if (p.stillFrom < 0) p.stillFrom = at;
    }
    p.drawn = drawn;
  }
}

/** Adds to `sent` the ticks an input message `data` carries; any other message adds nothing. */
export function noteInputs(data: Uint8Array, sent: Set<number>, r = new BitReader()): void {
  r.reset(data);
  if (r.bits(4) !== C_INPUT) return;
  r.u32();
  r.u8();
  const newest = r.u32();
  const count = r.bits(3) + 1;
  for (let t = newest - count + 1; t <= newest; t++) sent.add(t);
}

/** Ticks of 7 ms, the server's median with one player, but for the long ones `bursts` puts at a tick: each its list of costs in ms, a long one every `gap` ticks. */
export function bursts(at: Record<number, readonly number[]>, gap = 6, base = 7): (k: number) => number {
  const long = new Map<number, number>();
  for (const [k, list] of Object.entries(at)) list.forEach((ms, i) => long.set(Number(k) + i * gap, ms));
  return (k) => long.get(k) ?? base;
}

/** Walks forward on a path that turns one way and the other, so every tick's input differs from the one before. */
export function turning(at: number, p: Pilot): void {
  p.moveZ = 1;
  p.yaw = 1.2 * Math.sin(at / 1700) + 0.4 * Math.sin(at / 430);
}

/** A frame of 60 Hz but for those `long` begins at a time: each a start in ms and its length. */
export function frames(long: readonly (readonly [number, number])[]): (at: number) => number {
  return (at) => {
    for (const [start, ms] of long) if (at >= start && at < start + FRAME_MS) return ms;
    return FRAME_MS;
  };
}

export { TICK_MS };
