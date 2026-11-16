// Bounded rotorcraft work on the real terrain/structure adapter. No browser, renderer or server scheduling is included.
// `bun tools/bench/helicopter.ts`; `bun` and `node tools/bench/helicopter.ts --hash` must print the same replay hash.
import { cpus, loadavg } from "node:os";
import { HELICOPTER, HELICOPTER_VEHICLE } from "../../content/vehicles/helicopter.ts";
import { hashBytes } from "../../shared/hash.ts";
import { createHelicopter, stepHelicopter, type HelicopterInput, type HelicopterState } from "../../shared/sim/helicopter.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StaticHelicopterWorld } from "../../shared/world/helicopter.ts";
import { StructureStore } from "../../shared/world/structures.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;
const idle: HelicopterInput = { right: 0, forward: 0, yaw: 0, climb: 0, brake: false, cruise: false, direct: false, pilot: true };
function scene(count: number, nearby: boolean) {
  const dims = { chunksX: 8, chunksZ: 8 }, hf = new Heightfield(dims, 2, -16, 1 / 256); hf.heights.fill(4096);
  const structs = new StructureStore(dims, new Float32Array([0, .12]), new Float32Array([0, 1.2]), new Float32Array([0, .12]));
  const states: HelicopterState[] = [];
  for (let i = 0; i < count; i++) {
    const x = 40 + (i % 8) * 56, z = 40 + Math.floor(i / 8) * 56, y = 12;
    const state = createHelicopter(HELICOPTER, x, y, z);
    Object.assign(state, { grounded: false, engineOn: true, rotorRpm: HELICOPTER.rotorRpm, collective: HELICOPTER.mass / HELICOPTER.liftMass });
    states.push(state);
    // These pillars overlap the rotor's broadphase rectangle but clear its round disc: real narrowphase work, no impact.
    if (nearby) for (const sx of [-1, 1]) for (const sz of [-1, 1]) structs.add(1, x + sx * 4.25, y + 3.15, z - .3 + sz * 4.25, 0, 0, 100);
  }
  return { states, world: new StaticHelicopterWorld({ hf, structs }) };
}
const percentile = (times: number[], q: number) => times.sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!;
export function benchHelicopters(section: Section, record: Row): void {
  section("Rotorcraft: 16 airborne helicopters through native terrain and convex collision");
  for (const nearby of [false, true]) {
    const { states, world } = scene(16, nearby), times: number[] = [];
    for (let tick = 0; tick < 720; tick++) {
      const start = performance.now();
      for (const state of states) stepHelicopter(state, idle, HELICOPTER_VEHICLE, world);
      if (tick >= 120) times.push(performance.now() - start);
    }
    const name = nearby ? "near 64 solid pillars" : "open air";
    record(`${name}: 16 steps, median`, percentile(times, .5), "ms", 2);
    record(`${name}: 16 steps, p99`, percentile(times, .99), "ms", 5);
    record(`${name}: per helicopter, median`, percentile(times, .5) * 1000 / states.length, "us");
  }
}

/** Every future-controlling field and collision result is hashed at every tick, including full inversions and water. */
export function helicopterHash(): string {
  const { states, world } = scene(6, true);
  world.world.hf.seaLevel = 3;
  for (const s of states) s.y = 150;
  const fields = Object.keys(states[0]!) as (keyof HelicopterState)[];
  const numbers = new Float32Array(fields.length + 3), bytes = new Uint8Array(numbers.buffer);
  let hash = 0x811c9dc5;
  for (let tick = 0; tick < 1800; tick++) for (let index = 0; index < states.length; index++) {
    const s = states[index]!, age = (tick + index * 17) % 360;
    const input: HelicopterInput = { ...idle,
      direct: age >= 60 && age < 200, forward: age < 60 ? .6 : age < 155 ? -.8 : 0,
      right: age >= 155 && age < 200 ? .9 : 0, yaw: age >= 240 && age < 280 ? .35 : 0,
      brake: age >= 200 && age < 300, climb: age < 45 ? .6 : age >= 300 ? -.4 : 0,
    };
    if (tick === 1200 && index % 2 === 0) s.fuel = 0;
    const result = stepHelicopter(s, input, HELICOPTER_VEHICLE, world);
    for (let i = 0; i < fields.length; i++) numbers[i] = Number(s[fields[i]!]);
    numbers[fields.length] = result.impactSpeed; numbers[fields.length + 1] = Number(result.rotorHit); numbers[fields.length + 2] = Number(result.water);
    hash = hashBytes(bytes, hash);
  }
  return hash.toString(16).padStart(8, "0");
}
if (import.meta.main) {
  if (process.argv.includes("--hash")) console.log(helicopterHash());
  else {
    console.log(`${cpus()[0]?.model}; ${cpus().length} logical CPUs; load ${loadavg().map(n => n.toFixed(2)).join("/")}`);
    benchHelicopters(console.log, (name, value, unit, budget) => console.log(`${name}: ${value.toFixed(3)} ${unit}${budget ? ` (budget ${budget})` : ""}`));
  }
}
