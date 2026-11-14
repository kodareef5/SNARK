// Rows for clients on one WebSocket, which is TCP: at each loss and round trip, how often other bodies freeze, inputs
// that came too late, the input delay that is kept to avoid them, corrections, and whether the clock settles.
// `bun tools/bench/transport.ts` runs these alone, on the proving ground.

import type { ClientSession } from "../../client/core/session.ts";
import type { GameOptions } from "../../server/game.ts";
import type { LinkOptions, LoopbackEnd } from "../../shared/net/loopback.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { Rng } from "../../shared/rng.ts";
import { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

export interface Lossy {
  /** Milliseconds from the server to a client and back. */
  rtt: number;
  loss: number;
  /** Mean length of a spell of losses, 0 for losses one by one. */
  burstMs?: number;
  /** Datagrams in place of one stream. */
  datagrams?: boolean;
  clients: number;
  herd: number;
  /** Seconds before the watch, and the seconds watched. */
  settle: number;
  seconds: number;
  link?: LinkOptions;
  /** Every client's line goes down for `ms`, `at` seconds into the watch. */
  outage?: { at: number; ms: number };
  game?: Partial<GameOptions>;
  seed?: number;
}

export interface Lossless {
  /** Percent of frames in which a client had no snapshot newer than the moment it draws others at, so they stood still. */
  frozen: number;
  /** Ticks behind its render clock a client drew others, on average. */
  drawn: number;
  /** Times a minute a client's others began to stand still, and the longest they did, in ms. */
  freezes: number;
  longest: number;
  /** Ticks a minute, per client, the server had no input for and went on with the one before, and the runs of them. */
  held: number;
  lateRuns: number;
  /** Milliseconds from a client sampling an input to the server stepping it, beyond the trip there. */
  delay: number;
  /** Percent of ticks on which the moment a client says it saw would be judged later than it saw, for want of rewind. */
  clipped: number;
  /** Snapshots a minute, per client, that moved its predicted body. */
  corrections: number;
  /** Clock jumps a minute, per client. */
  jumps: number;
  /** Ticks between the 5th and 95th percentile of how far a client's clock is ahead of the server's. */
  spread: number;
  /** After an outage, milliseconds until a client reads a snapshot no older than its trip there and 100 ms, on average. */
  recovered: number;
  /** Milliseconds between the server sending a snapshot and the client reading it: median and 99th percentile. */
  age: number;
  age99: number;
  /** Bytes a second sent to a client, and on its wire with headers and resent segments. */
  bytes: number;
  wire: number;
  /** The median tick, in ms. */
  tick: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

/** Survivors walking in circles among a walking herd, each on a link of its own with the same faults. */
export function lossy(o: Lossy): Lossless {
  const h = new Harness(o.game ?? {}, o.seed ?? 3, 60, { dev: true });
  const link: LinkOptions = { latencyMs: o.rtt / 2, loss: o.loss, burstMs: o.burstMs ?? 0, tcp: !o.datagrams, ...o.link };
  const sessions: ClientSession[] = [];
  for (let i = 0; i < o.clients; i++) sessions.push(h.join(`l${i}`, link));
  h.run(1500);
  const ents = h.world.ents;
  const hf = h.world.hf;
  const rng = new Rng(41);
  const [cx, cz] = [PROVING_SPAWN.x, PROVING_SPAWN.z + 40];
  for (const s of sessions) {
    const [x, z] = [cx + rng.range(-10, 10), cz + rng.range(-10, 10)];
    ents.setPosition(h.ent(s), x, hf.heightAt(x, z), z);
  }
  for (let tries = 0, n = 0; n < o.herd && tries < o.herd * 50; tries++) if (h.host.spawnCreature("core:grazer", cx + rng.range(-40, 40), cz + rng.range(-40, 40), 1 + rng.int(30)) >= 0) n++;

  const n = o.clients;
  const steer = sessions.map((_, i) => new Rng(100 + i));
  const turn = new Float32Array(n).fill(1);
  const sampled = new Float64Array(n * 128);
  const lastSim = new Int32Array(n);
  const lastSnap = new Int32Array(n);
  const frozenSince = new Float64Array(n).fill(-1);
  const leads: number[][] = sessions.map(() => []);
  const ages: number[] = [];
  const times: number[] = [];
  let watching = false;
  let frames = 0;
  let frozen = 0;
  let drawn = 0;
  let freezes = 0;
  let longest = 0;
  let delays = 0;
  let delayed = 0;
  let held = 0;
  let lateRuns = 0;
  let clipped = 0;
  let judged = 0;
  const wasHeld = new Uint8Array(n);
  let prevNow = h.now;
  let watchFrom = 0;
  let back = -1;
  const recovered = new Float64Array(n).fill(-1);
  const sentAt = new Float64Array(1 << 16);
  const tick = h.server.tick.bind(h.server);
  h.server.tick = () => {
    const T = h.world.tick + 1;
    sentAt[T & 0xffff] = h.now;
    for (let c = 0; watching && c < n; c++) {
      const missing = h.client(sessions[c]!)!.inputs.has(T) ? 0 : 1;
      held += missing;
      if (missing > wasHeld[c]!) lateRuns++;
      wasHeld[c] = missing;
    }
    const t = performance.now();
    tick();
    if (!watching) return;
    times.push(performance.now() - t);
    for (let c = 0; c < n; c++) {
      const client = h.client(sessions[c]!)!;
      if (!client.inputs.has(T)) continue;
      judged++;
      if (h.host.combat.viewTick(client) > client.inputs.view[T & client.inputs.mask]! + 0.01) clipped++;
    }
    // When the server steps tick T, each client's input for it is used or guessed.
    for (let c = 0; c < n; c++) {
      const at = sampled[c * 128 + (T & 127)]!;
      if (at <= 0 || h.now - at > 4000) continue;
      delays += h.now - at - o.rtt / 2;
      delayed++;
    }
  };
  const frame = (now: number): void => {
    for (let c = 0; c < n; c++) {
      const s = sessions[c]!;
      const p = h.pilots[c]!;
      // Each walks forward turning, now and then the other way, so that every tick's input differs from the one before.
      if (steer[c]!.int(90) === 0) turn[c] = -turn[c]!;
      p.moveZ = 1;
      p.yaw += turn[c]! * 0.012;
      for (let T = lastSim[c]! + 1; T <= s.simTick; T++) sampled[c * 128 + (T & 127)] = prevNow;
      lastSim[c] = s.simTick;
      if (!watching) continue;
      if (s.latestSnapshot !== lastSnap[c]) {
        const age = now - sentAt[s.latestSnapshot & 0xffff]!;
        ages.push(age);
        lastSnap[c] = s.latestSnapshot;
        if (back >= 0 && now > back && recovered[c]! < 0 && age <= o.rtt / 2 + 100) recovered[c] = now - back;
      }
      frames++;
      drawn += s.remoteDelay;
      const still = s.renderClock - s.remoteDelay >= s.latestSnapshot;
      if (still) {
        frozen++;
        if (frozenSince[c]! < 0) {
          freezes++;
          frozenSince[c] = now;
        }
      } else if (frozenSince[c]! >= 0) {
        longest = Math.max(longest, now - frozenSince[c]!);
        frozenSince[c] = -1;
      }
      leads[c]!.push(s.simTick - h.world.tick);
    }
    if (o.outage && watching && back < 0 && now >= watchFrom + o.outage.at * 1000) {
      for (const e of h.ends) h.net.outage(e, o.outage.ms);
      back = now + o.outage.ms;
    }
    prevNow = now;
  };
  h.run(o.settle * 1000, frame);
  for (let c = 0; c < n; c++) lastSnap[c] = sessions[c]!.latestSnapshot;
  const ends = sessions.map((s) => h.client(s)!.conn as LoopbackEnd);
  const sent = ends.map((e) => e.bytesSent);
  const wire = ends.map((e) => e.wire.bytes);
  const before = sessions.map((s) => ({ ...s.stats }));
  watching = true;
  watchFrom = h.now;
  h.run(o.seconds * 1000, frame);
  h.server.tick = tick;
  const minutes = o.seconds / 60;
  times.sort((a, b) => a - b);
  ages.sort((a, b) => a - b);
  let spread = 0;
  for (const l of leads) {
    l.sort((a, b) => a - b);
    spread += percentile(l, 0.95) - percentile(l, 0.05);
  }
  return {
    frozen: (100 * frozen) / Math.max(1, frames),
    drawn: drawn / Math.max(1, frames),
    freezes: freezes / n / minutes,
    longest,
    held: held / n / minutes,
    clipped: (100 * clipped) / Math.max(1, judged),
    recovered: recovered.reduce((sum, r) => sum + (r < 0 ? o.seconds * 1000 : r), 0) / n,
    lateRuns: lateRuns / n / minutes,
    delay: delays / Math.max(1, delayed),
    corrections: sessions.reduce((sum, s, i) => sum + s.stats.corrections - before[i]!.corrections, 0) / n / minutes,
    jumps: sessions.reduce((sum, s, i) => sum + s.stats.clockJumps - before[i]!.clockJumps, 0) / n / minutes,
    spread: spread / n,
    age: percentile(ages, 0.5),
    age99: percentile(ages, 0.99),
    bytes: ends.reduce((sum, e, i) => sum + e.bytesSent - sent[i]!, 0) / n / o.seconds,
    wire: ends.reduce((sum, e, i) => sum + e.wire.bytes - wire[i]!, 0) / n / o.seconds,
    tick: percentile(times, 0.5),
  };
}

export function benchTransport(section: Section, record: Row): void {
  const clients = 8;
  section(`Transport: ${clients} survivors walking among 200 walking creatures, each on a WebSocket (TCP) with losses one by one`);
  for (const rtt of [50, 100, 180]) {
    for (const loss of [0, 0.01, 0.02]) {
      const r = lossy({ rtt, loss, clients, herd: 200, settle: 5, seconds: 60 });
      const name = (what: string): string => `${rtt} ms, ${loss * 100}%: ${what}`;
      record(name("time others stand still"), r.frozen, "%");
      record(name("times others stop, a minute"), r.freezes, "");
      record(name("longest they stood still"), r.longest, "ms");
      record(name("inputs the server had to guess, a minute"), r.held, "");
      record(name("runs of them, a minute"), r.lateRuns, "");
      record(name("input delay beyond the trip there"), r.delay, "ms");
      record(name("corrections a minute"), r.corrections, "");
      record(name("clock jumps a minute"), r.jumps, "");
      record(name("clock lead, 5th to 95th percentile"), r.spread, "ticks");
      record(name("snapshot age on arrival, median"), r.age, "ms");
      record(name("snapshot age on arrival, 99th percentile"), r.age99, "ms");
    }
  }
}

if (import.meta.main) {
  benchTransport(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
