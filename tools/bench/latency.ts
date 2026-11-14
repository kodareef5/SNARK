// Rows for clients with a real round trip: a snapshot's acknowledgement reaches the server ticks after it was sent, so a
// snapshot is written against an old baseline while the client already shows newer ones. The other rows acknowledge at once.
// `bun tools/bench/latency.ts` runs these alone, on the proving ground.

import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import { POS_UNITS } from "../../shared/net/view.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { Rng } from "../../shared/rng.ts";
import { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const CLIENTS = 16;
/** Ticks of each body's true places kept, to tell how old the place a client shows is. */
const KEPT = 64;
/** A body that is gone from a client and back within this many ticks was in view all along. */
const BLINK = 15;

interface Result {
  /** Seconds from the creatures appearing until the slowest client shows nearly all of them. */
  filled: number;
  shown: number;
  moves: number;
  back: number;
  metres: number;
  blinks: number;
  late: number;
  bytes: number;
  tick: number;
  undecodable: number;
}

/**
 * Sixteen survivors in one place with `herd` creatures of `species` around them, each client `rtt` ms from the server and
 * back, watched for `seconds` from `settle` seconds after the creatures appear.
 */
function watch(rtt: number, species: string, herd: number, settle: number, seconds: number): Result {
  const h = new Harness({}, 3, 60, { dev: true });
  const sessions: ClientSession[] = [];
  for (let i = 0; i < CLIENTS; i++) sessions.push(h.join(`w${i}`, { latencyMs: rtt / 2 }));
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
  /** Slot of each watched creature by entity index, plus one. */
  const slot = new Int32Array(ents.x.length);
  const index: number[] = [];
  for (let tries = 0; index.length < herd && tries < herd * 50; tries++) {
    const e = h.host.spawnCreature(species, cx + rng.range(-40, 40), cz + rng.range(-40, 40), 1 + rng.int(30));
    if (e < 0) continue;
    index.push(e);
    slot[e] = index.length;
  }
  const n = index.length;
  const trueX = new Int32Array(KEPT * n);
  const trueZ = new Int32Array(KEPT * n);
  /** For each client and creature: the tick its shown place was true at, the place, and when it was last shown or went missing. */
  const at = new Int32Array(CLIENTS * n);
  const wasX = new Float32Array(CLIENTS * n);
  const wasZ = new Float32Array(CLIENTS * n);
  const seen = new Uint8Array(CLIENTS * n);
  const goneAt = new Int32Array(CLIENTS * n);
  const latest = new Int32Array(CLIENTS);
  const sample = new RemoteSample();
  const plain = new RemoteSample();
  const present = new Uint8Array(n);
  const out: Result = { filled: 0, shown: 0, moves: 0, back: 0, metres: 0, blinks: 0, late: 0, bytes: 0, tick: 0, undecodable: 0 };
  const times: number[] = [];
  const tick = h.server.tick.bind(h.server);
  h.server.tick = () => {
    const t = performance.now();
    tick();
    times.push(performance.now() - t);
  };
  let recorded = 0;
  let samples = 0;
  let frames = 0;
  const filledAt = new Int32Array(CLIENTS);
  const appeared = h.world.tick;
  h.run(settle * 1000);
  const sent = sessions.map((s) => (h.client(s)!.conn as LoopbackEnd).bytesSent);
  times.length = 0;
  h.run(seconds * 1000, () => {
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
    for (let c = 0; c < CLIENTS; c++) {
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
        const k = slot[sample.id[i]!]! - 1;
        if (k < 0) continue;
        present[k] = 1;
        const o = c * n + k;
        const [qx, qz] = [Math.round(sample.x[i]! * POS_UNITS), Math.round(sample.z[i]! * POS_UNITS)];
        // The newest tick at which the body truly stood where the client shows it.
        let when = -1;
        for (let back = 0; back < KEPT - 1 && back < T; back++) {
          const row = ((T - back) % KEPT) * n;
          if (trueX[row + k] === qx && trueZ[row + k] === qz) {
            when = T - back;
            break;
          }
        }
        if (seen[o] === 0 && goneAt[o] !== 0 && frames - goneAt[o]! <= BLINK * 2) out.blinks++;
        if (seen[o] === 1 && when >= 0 && (sample.x[i] !== wasX[o] || sample.z[i] !== wasZ[o])) {
          out.moves++;
          if (when < at[o]!) {
            out.back++;
            out.metres += Math.hypot(sample.x[i]! - wasX[o]!, sample.z[i]! - wasZ[o]!);
          }
        }
        if (when >= 0) {
          at[o] = when;
          out.late += T - when;
        }
        wasX[o] = sample.x[i]!;
        wasZ[o] = sample.z[i]!;
        seen[o] = 1;
      }
      let have = 0;
      for (let k = 0; k < n; k++) {
        const o = c * n + k;
        have += present[k]!;
        if (present[k] === 1 || seen[o] === 0) continue;
        seen[o] = 0;
        goneAt[o] = frames;
      }
      if (filledAt[c] === 0 && have >= n * 0.98) filledAt[c] = T;
    }
  });
  h.server.tick = tick;
  times.sort((a, b) => a - b);
  out.filled = filledAt.reduce((most, T) => Math.max(most, T === 0 ? settle + seconds : (T - appeared) / TICK_RATE), 0);
  out.late /= Math.max(1, out.shown);
  out.shown /= Math.max(1, samples);
  out.metres /= Math.max(1, out.back);
  out.bytes = sessions.reduce((sum, s, i) => sum + (h.client(s)!.conn as LoopbackEnd).bytesSent - sent[i]!, 0) / CLIENTS / seconds;
  out.tick = times[times.length >> 1]!;
  out.undecodable = sessions.reduce((sum, s) => sum + s.stats.undecodable, 0);
  return out;
}

export function benchLatency(section: Section, record: Row): void {
  section(`Latency: ${CLIENTS} survivors among 300 walking creatures, more than a snapshot carries, each client a round trip from the server`);
  for (const rtt of [0, 100, 200]) {
    const r = watch(rtt, "core:grazer", 300, 0, 20);
    const name = (what: string): string => `${rtt} ms: ${what}`;
    record(name("seconds until every client shows the creatures"), r.filled, "s");
    record(name("bodies a client shows"), r.shown, "");
    record(name("moves a client saw, of which went backwards"), (100 * r.back) / Math.max(1, r.moves), "%");
    record(name("metres such a step went back"), r.metres, "m");
    record(name("bodies gone and back within half a second, a client"), r.blinks / CLIENTS, "");
    record(name("ticks a shown place is behind the server"), r.late, "");
    record(name("downstream per client"), r.bytes / 1024, "KB/s", 36);
    record(name("tick time, median"), r.tick, "ms", 8);
    record(name("snapshots a client could not decode"), r.undecodable, "", 0);
  }
  section(`Latency at rest: ${CLIENTS} survivors among 300 creatures that stand still`);
  for (const rtt of [0, 200]) {
    const r = watch(rtt, "core:dummy", 300, 10, 10);
    record(`${rtt} ms: bodies a client shows`, r.shown, "");
    record(`${rtt} ms: downstream per client`, r.bytes / 1024, "KB/s", 4);
  }
}

if (import.meta.main) {
  benchLatency(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
