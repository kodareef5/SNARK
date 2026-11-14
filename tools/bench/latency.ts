// Rows for clients with a real round trip: a snapshot's acknowledgement reaches the server ticks after it was sent, so a
// snapshot is written against an old baseline while the client already shows newer ones. The other rows acknowledge at once.
// `bun tools/bench/latency.ts` runs these alone, on the proving ground.

import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import type { GameOptions } from "../../server/game.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import { POS_UNITS } from "../../shared/net/view.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { Rng } from "../../shared/rng.ts";
import { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** Ticks of each body's true places kept, to tell how old the place a client shows is. */
const KEPT = 64;
/** A body that is gone from a client and back within this many ticks was in view all along. */
const BLINK = 15;

export interface Watch {
  /** Milliseconds from the server to a client and back. */
  rtt: number;
  clients: number;
  species: string;
  herd: number;
  /** Seconds from the creatures appearing to the start of the watch, and the seconds watched. */
  settle: number;
  seconds: number;
  game?: Partial<GameOptions>;
}

export interface Watched {
  /** Seconds from the creatures appearing until the slowest client shows nearly all of them. */
  filled: number;
  /** Bodies a client shows, on average. */
  shown: number;
  /** Times a client showed a creature somewhere new, and the times that place was an older one than the last. */
  moves: number;
  back: number;
  /** Times a creature was gone from a client and back within half a second. */
  blinks: number;
  /** Ticks between a creature standing somewhere and a client showing it there, on average. */
  late: number;
  /** Bytes a second sent to a client. */
  bytes: number;
  /** The median tick, in ms. */
  tick: number;
  undecodable: number;
}

/** Survivors in one place with a herd around them, each client a round trip from the server, and what each is shown of the herd. */
export function watch(o: Watch): Watched {
  const h = new Harness(o.game ?? {}, 3, 60, { dev: true });
  const sessions: ClientSession[] = [];
  for (let i = 0; i < o.clients; i++) sessions.push(h.join(`w${i}`, { latencyMs: o.rtt / 2 }));
  h.run(1500);
  const ents = h.world.ents;
  const hf = h.world.hf;
  const rng = new Rng(41);
  const [cx, cz] = [PROVING_SPAWN.x, PROVING_SPAWN.z + 40];
  for (const s of sessions) {
    const [x, z] = [cx + rng.range(-6, 6), cz + rng.range(-6, 6)];
    ents.setPosition(h.ent(s), x, hf.heightAt(x, z), z);
  }
  h.run(1500);
  const index: number[] = [];
  /** Where in `index` each watched creature is, by entity index. */
  const slot = new Map<number, number>();
  for (let tries = 0; index.length < o.herd && tries < o.herd * 50; tries++) {
    const e = h.host.spawnCreature(o.species, cx + rng.range(-40, 40), cz + rng.range(-40, 40), 1 + rng.int(30));
    if (e < 0) continue;
    slot.set(e, index.length);
    index.push(e);
  }
  const n = index.length;
  const trueX = new Int32Array(KEPT * n);
  const trueZ = new Int32Array(KEPT * n);
  /** For each client and creature: the tick its shown place was true at, the place, and when it was last shown or went missing. */
  const at = new Int32Array(o.clients * n);
  const wasX = new Float32Array(o.clients * n);
  const wasZ = new Float32Array(o.clients * n);
  const seen = new Uint8Array(o.clients * n);
  const goneAt = new Int32Array(o.clients * n);
  const latest = new Int32Array(o.clients);
  const filledAt = new Int32Array(o.clients);
  const sample = new RemoteSample();
  const plain = new RemoteSample();
  const present = new Uint8Array(n);
  const out: Watched = { filled: 0, shown: 0, moves: 0, back: 0, blinks: 0, late: 0, bytes: 0, tick: 0, undecodable: 0 };
  const times: number[] = [];
  const tick = h.server.tick.bind(h.server);
  h.server.tick = () => {
    const t = performance.now();
    tick();
    times.push(performance.now() - t);
  };
  let recorded = 0;
  let samples = 0;
  let placed = 0;
  let frames = 0;
  const appeared = h.world.tick;
  const frame = (): void => {
    const T = h.world.tick;
    if (T !== recorded) {
      recorded = T;
      const row = (T % KEPT) * n;
      for (let k = 0; k < n; k++) {
        trueX[row + k] = Math.round(ents.x[index[k]!]! * POS_UNITS);
        trueZ[row + k] = Math.round(ents.z[index[k]!]! * POS_UNITS);
      }
    }
    frames++;
    const oldest = Math.max(1, T - KEPT + 2);
    for (let c = 0; c < o.clients; c++) {
      const s = sessions[c]!;
      if (s.latestSnapshot === latest[c]) continue;
      latest[c] = s.latestSnapshot;
      // The newest view as it came, then the usual sample again so that what the client reports as on screen is unchanged.
      s.sampleRemote(sample, -KEPT);
      s.sampleRemote(plain);
      samples++;
      out.shown += sample.count;
      present.fill(0);
      for (let i = 0; i < sample.count; i++) {
        const k = slot.get(sample.id[i]!);
        if (k === undefined) continue;
        present[k] = 1;
        const p = c * n + k;
        const [qx, qz] = [Math.round(sample.x[i]! * POS_UNITS), Math.round(sample.z[i]! * POS_UNITS)];
        // The newest tick at which the body truly stood where the client shows it. A body can stand in one place twice, so
        // the place shown is taken to be from the first such tick since the last place shown, and is older only if there is none.
        let newest = -1;
        for (let t = T; t >= oldest && newest < 0; t--) if (trueX[(t % KEPT) * n + k] === qx && trueZ[(t % KEPT) * n + k] === qz) newest = t;
        let when = newest;
        for (let t = seen[p] === 1 ? Math.max(oldest, at[p]!) : oldest; t < when; t++) if (trueX[(t % KEPT) * n + k] === qx && trueZ[(t % KEPT) * n + k] === qz) when = t;
        if (seen[p] === 0 && goneAt[p] !== 0 && frames - goneAt[p]! <= BLINK * 2) out.blinks++;
        if (seen[p] === 1 && when >= 0 && (sample.x[i] !== wasX[p] || sample.z[i] !== wasZ[p])) {
          out.moves++;
          if (when < at[p]!) out.back++;
        }
        if (when >= 0) {
          at[p] = when;
          out.late += T - newest;
          placed++;
        }
        wasX[p] = sample.x[i]!;
        wasZ[p] = sample.z[i]!;
        seen[p] = 1;
      }
      let have = 0;
      for (let k = 0; k < n; k++) {
        const p = c * n + k;
        have += present[k]!;
        if (present[k] === 1 || seen[p] === 0) continue;
        seen[p] = 0;
        goneAt[p] = frames;
      }
      if (filledAt[c] === 0 && have >= n * 0.98) filledAt[c] = T;
    }
  };
  h.run(o.settle * 1000, frame);
  const sent = sessions.map((s) => (h.client(s)!.conn as LoopbackEnd).bytesSent);
  times.length = 0;
  out.shown = out.moves = out.back = out.blinks = out.late = samples = placed = 0;
  h.run(o.seconds * 1000, frame);
  h.server.tick = tick;
  times.sort((a, b) => a - b);
  out.filled = filledAt.reduce((most, T) => Math.max(most, T === 0 ? o.settle + o.seconds : (T - appeared) / TICK_RATE), 0);
  out.late /= Math.max(1, placed);
  out.shown /= Math.max(1, samples);
  out.bytes = sessions.reduce((sum, s, i) => sum + (h.client(s)!.conn as LoopbackEnd).bytesSent - sent[i]!, 0) / o.clients / o.seconds;
  out.tick = times[times.length >> 1]!;
  out.undecodable = sessions.reduce((sum, s) => sum + s.stats.undecodable, 0);
  return out;
}

export function benchLatency(section: Section, record: Row): void {
  const clients = 16;
  section(`Latency: ${clients} survivors among 300 walking creatures, more than a snapshot carries, each client a round trip from the server`);
  for (const rtt of [0, 100, 200]) {
    const r = watch({ rtt, clients, species: "core:grazer", herd: 300, settle: 0, seconds: 20 });
    const name = (what: string): string => `${rtt} ms: ${what}`;
    record(name("seconds until every client shows the creatures"), r.filled, "s", 1);
    record(name("bodies a client shows"), r.shown, "");
    record(name("moves a client saw that went backwards"), (100 * r.back) / Math.max(1, r.moves), "%", 0);
    record(name("bodies gone and back within half a second, a client"), r.blinks / clients, "", 0);
    record(name("ticks a shown place is behind the server"), r.late, "");
    record(name("downstream per client"), r.bytes / 1024, "KB/s", 36);
    record(name("tick time, median"), r.tick, "ms", 8);
    record(name("snapshots a client could not decode"), r.undecodable, "", 0);
  }
  section(`Latency at rest: ${clients} survivors among 300 creatures that stand still`);
  for (const rtt of [0, 200]) {
    const r = watch({ rtt, clients, species: "core:dummy", herd: 300, settle: 10, seconds: 10 });
    record(`${rtt} ms: bodies a client shows`, r.shown, "");
    record(`${rtt} ms: downstream per client`, r.bytes / 1024, "KB/s", 2);
  }
}

if (import.meta.main) {
  benchLatency(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
