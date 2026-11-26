// Rows for map events (planning/workstreams/map-events.md): what eight craft in the sky add to a firefight's tick, high
// over the map and hanging over the fight itself; what a shot pays each craft; the engine's own tick with eight live;
// the feed's bytes; and the one-off cost of a call, a preview and a fall.
// `bun tools/bench/mapevent.ts` runs these alone, on the firefight's small world.

import ufo from "../../modules/ufo.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { contentFor, createHost } from "../../server/host.ts";
import { Rules } from "../../server/settings/rules.ts";
import { createWorld } from "../../server/world.ts";
import { HumanAnim } from "../../shared/anim/pose.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { MAPEVENT_BYTES, writeMapEvents } from "../../shared/mapevent/wire.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { LoopbackNet } from "../../shared/net/loopback.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { target } from "../../tests/fixtures/event-kinds.ts";
import { buildCorePack } from "../pack/build.ts";
import { Bot } from "./bot.ts";
import { ASSAULT_RIFLE, benchFirefight } from "./firefight.ts";

type Row = (name: string, value: number, unit: string, budget?: number | null) => void;
const FIGHTERS = 50;
const median = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const high = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.99))] ?? 0;

/** Eight craft that hang over the fight, 25 m up: every shot is tested against each in full. */
function hovering(centre: readonly [number, number], ground: number): ModuleDef {
  const one = target({ x: centre[0] + 46, z: centre[1], y: ground + 25, seconds: 300, speed: 1, shield: true, health: 1e7 });
  return { ...one, name: "hover", setup: (m) => one.setup({ ...m, mapEvent: (def) => m.mapEvent({ ...def, id: "hover" }) }) };
}

const dims = { chunksX: 16, chunksZ: 16 };
const rules = new Rules();
const reg = contentFor(compileContent(CORE_CONTENT).registry!, rules);
const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.heights[j * hf.nx + i] = Math.round((40 + 6 * Math.sin((i * hf.cell) / 90) * Math.cos((j * hf.cell) / 70) + 32) * 64);
hf.tint.fill(12);
const world = createWorld(reg, dims, hf, "bench:fight", hashBytes(new Uint8Array(hf.heights.buffer, 0, 4096)), { x: 512, z: 512, yaw: 0 }, 16384);
const centre = [480, 512] as const;
const host = createHost(reg, { world, config: rules, game: { maxClients: 64 }, modules: [ufo, hovering(centre, hf.heightAt(centre[0] + 46, centre[1]))] });
const pack = parsePack(buildCorePack());
const net = new LoopbackNet(7);
host.game.sessions.listen(net);
const stood = new Rng(12);
const places = new Map<string, { x: number; y: number; z: number; yaw: number }>();
for (let i = 0; i < FIGHTERS; i++) {
  const x = centre[0] + 26 + stood.range(0, 40);
  const z = centre[1] + stood.range(-20, 20);
  places.set(`bot${i}`, { x, y: hf.heightAt(x, z), z, yaw: 0 });
}
host.game.sessions.savedPosition = (name) => places.get(name) ?? null;
const bots: Bot[] = [];
for (let i = 0; i < FIGHTERS; i++) bots.push(new Bot(net, `bot${i}`, reg.baseHash, 100 + i));
let now = 0;
const run = (ticks: number, times: number[] | null): void => {
  for (let i = 0; i < ticks; i++) {
    now += 1000 / TICK_RATE;
    net.advance(now);
    const t = performance.now();
    host.game.tick();
    times?.push(performance.now() - t);
    for (const b of bots) b.update(world.tick);
  }
};
let misses = 0;
const record: Row = (name, value, unit, budget = null) => {
  const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
  if (budget !== null && value > budget) misses++;
  console.log(`  ${name.padEnd(62)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
};
const section = (title: string): void => console.log(`\n${title}`);
run(300, null);
world.anim = new HumanAnim(pack.clips);

/** The fight's own rows, kept by name, and its tick's median with the rifle. */
function fight(label: string): Map<string, number> {
  const kept = new Map<string, number>();
  benchFirefight((t) => section(`${t}: ${label}`), (name, value, unit, budget) => (kept.set(name, value), record(name, value, unit, budget)), host, centre, run, [ASSAULT_RIFLE]);
  return kept;
}
const calls = (kind: string, n: number): void => {
  for (let k = 0; k < n; k++) {
    const made = host.mapEvents.call(kind, { source: "bench", notice: 0, seed: 1000 + k });
    if (typeof made === "string") throw new Error(made);
  }
  run(3, null);
};
const live = (): number => host.mapEvents.events.filter((e) => e.state === 1).length;

const quiet = fight("nothing in the sky");
calls("ufo", 8);
const far = fight(`${live()} UFOs crossing the map high`);
for (const e of [...host.mapEvents.events]) host.mapEvents.cancel(e);
run(20 * TICK_RATE, null);
calls("hover", 8);
const near = fight(`${live()} craft hanging over the fight`);

// The fight's whole tick swings with what else the machine runs; these are told, and the shot's own cost below is held.
section("Map events: the firefight's tick with eight craft, beside none (the rifle, 500 shots a second; not held: it swings with the machine)");
const tick = "assault rifle: tick and its shots, median";
record("tick median, eight high: more than with none", (far.get(tick) ?? NaN) - (quiet.get(tick) ?? NaN), "ms");
record("tick median, eight over the fight: more than with none", (near.get(tick) ?? NaN) - (quiet.get(tick) ?? NaN), "ms");

section("Map events: a shot, a tick, the feed, and the one-off costs");
const sky = host.combat.sky;
/** Microseconds a shot's sky test takes, from 20 m west of the fight's craft at head height, aimed `up` metres over the ground there. */
const rays = (n: number, up: number): number => {
  const ox = centre[0] + 26, oz = centre[1], oy = hf.heightAt(ox, oz) + 1.6;
  const tx = centre[0] + 46, ty = hf.heightAt(tx, oz) + up;
  const l = Math.hypot(tx - ox, ty - oy);
  const [dx, dy] = [(tx - ox) / l, (ty - oy) / l];
  const t = performance.now();
  for (let k = 0; k < n; k++) sky.ray(ox, oy, oz, dx, dy, 0, 600, world.tick);
  return ((performance.now() - t) / n) * 1000;
};
rays(2000, 25);
const nearShot = rays(20000, 25);
record(`a shot's sky test, eight hanging near (each in full)`, nearShot, "µs", 20);
record("its cost a tick at 500 shots a second, eight hanging near", (nearShot * 500) / TICK_RATE / 1000, "ms", 0.1);
for (const e of [...host.mapEvents.events]) host.mapEvents.cancel(e);
run(20 * TICK_RATE, null);
calls("ufo", 8);
const farShot = rays(20000, 25);
record(`a shot's sky test, eight high over the map (box rejects)`, farShot, "µs", 4);
record("its cost a tick at 500 shots a second, eight high", (farShot * 500) / TICK_RATE / 1000, "ms", 0.1);
const steps: number[] = [];
const step = host.mapEvents.step.bind(host.mapEvents);
host.mapEvents.step = () => {
  const t = performance.now();
  step();
  steps.push(performance.now() - t);
};
run(600, null);
host.mapEvents.step = step;
record("the engine's row, eight live, median", median(steps), "ms", 0.02);
record("the engine's row, eight live, 99th percentile", high(steps), "ms", 0.1);
const w = new BitWriter(MAPEVENT_BYTES);
const enc: number[] = [];
for (let k = 0; k < 200; k++) {
  const t = performance.now();
  w.reset();
  writeMapEvents(w, host.mapEvents.feed());
  enc.push(performance.now() - t);
}
record("the feed with eight UFOs, bytes", w.byteLength, "B", 2048);
record("the feed made and written once, median", median(enc), "ms", 0.5);
let cold = performance.now();
host.mapEvents.preview("ufo", 4999);
cold = performance.now() - cold;
const previews: number[] = [];
for (let k = 0; k < 40; k++) {
  const t = performance.now();
  host.mapEvents.preview("ufo", 5000 + k);
  previews.push(performance.now() - t);
}
record("a UFO's start (a preview), median", median(previews), "ms", 1.5);
record("a UFO's start (a preview), 90th percentile", previews.slice().sort((a, b) => a - b)[36]!, "ms", 4);
record("a UFO's start (a preview), most, a GC or a busy machine among them", Math.max(...previews), "ms");
record("the first after the others above (warm by now: a server's first is colder)", cold, "ms");
const falls: number[] = [];
for (const e of host.mapEvents.events.filter((x) => x.state === 1)) {
  const t = performance.now();
  host.mapEvents.downAll(e);
  falls.push(performance.now() - t);
}
record("a craft brought down, its fall traced, most", Math.max(0, ...falls), "ms", 4);
host.shutdown();
console.log(misses === 0 ? "\nevery row within its budget" : `\n${misses} rows over budget`);
process.exit(misses === 0 ? 0 : 1);
