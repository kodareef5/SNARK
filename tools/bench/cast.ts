// Cast where it is busiest: a beach of 200 of its people about four survivors, against the same world with Cast off. Rows:
// the server's tick (median and 99th) and the bytes a second each survivor is sent, with and without, and how many of
// Cast's bodies were in the world. Run alone: bun tools/bench/cast.ts (a few minutes: the crowd walks in from out of
// sight first). Record results with the machine in planning/quality/performance.md.

import { cpus } from "node:os";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import type { Story } from "../../shared/cast/state.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";

const WARM_S = 240, MEASURE_S = 60, CROWD = 200;
const quantile = (v: number[], q: number) => v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * q))]!;

function run(withCast: boolean): { median: number; p99: number; down: number; bodies: number; entered: number } {
  const h = new Harness({}, 3, 30, {
    cast: withCast ? { activity: 3, crowdMax: CROWD, maxBodies: CROWD + 60, maxPerPlayer: CROWD + 60, hostility: 0, model: "" } : { enabled: false },
    map: writeMap(flatMap(16)),
  });
  const sessions = ["a", "b", "c", "d"].map((n) => h.join(n));
  h.run(2000);
  const cast = h.host.cast;
  if (withCast) {
    const c = h.client(sessions[0]!)!;
    const x = c.body.x + 30, z = c.body.z + 30;
    const region = cast.cast.spots.regionAt(x, z);
    cast.cast.regions.get(region, h.world.tick).heat = 4;
    const spot = cast.cast.spots.add({ x, z, tags: ["beach"], cap: CROWD });
    const s: Story = { id: "beach", scene: "cast:beach_crowd", spot, x, z, region, phase: "planned", parts: [], choices: { vibe: "lazy" }, slots: {}, for: [], engaged: [], importance: 0, made: 0, since: 0, planned: 0, history: [] };
    cast.cast.stories.set(s.id, s);
    cast.cast.wake(s, h.world.tick, cast.cast.world.players());
  }
  h.run(WARM_S * 1000);
  const times: number[] = [];
  const tick = h.server.tick.bind(h.server);
  h.server.tick = () => {
    const t = performance.now();
    tick();
    times.push(performance.now() - t);
  };
  const before = h.server.clients.map((c) => (c ? (c.conn as LoopbackEnd).bytesSent : 0));
  let bodies = 0;
  h.run(MEASURE_S * 1000, () => (bodies = Math.max(bodies, cast.stage.count)));
  const down = h.server.clients.map((c, i) => (c ? ((c.conn as LoopbackEnd).bytesSent - before[i]!) / MEASURE_S : 0)).filter((v) => v > 0);
  const out = { median: quantile(times, 0.5), p99: quantile(times, 0.99), down: down.reduce((a, b) => a + b, 0) / Math.max(1, down.length), bodies, entered: cast.stage.counts.entered };
  h.host.shutdown();
  return out;
}

console.log(`Cast bench on ${cpus()[0]?.model ?? "?"} x${cpus().length}, ${TICK_RATE} Hz, ${MEASURE_S} s measured after ${WARM_S} s`);
const off = run(false), on = run(true);
const row = (name: string, a: number, b: number, unit: string) => console.log(`${name.padEnd(36)} ${a.toFixed(2).padStart(9)} ${b.toFixed(2).padStart(9)} ${unit}`);
console.log(`${"".padEnd(36)} ${"Cast off".padStart(9)} ${"Cast on".padStart(9)}`);
row("Tick, median", off.median, on.median, "ms");
row("Tick, 99th", off.p99, on.p99, "ms");
row("Sent to each survivor", off.down / 1024, on.down / 1024, "KB/s");
row("Cast's bodies in the world, most", off.bodies, on.bodies, "");
row("Cast's bodies brought in", off.entered, on.entered, "");
