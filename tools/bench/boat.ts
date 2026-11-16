// Native deterministic hull/water workload. Run Bun and Node with --hash to compare every future-controlling field.
import { cpus, loadavg } from "node:os";
import { BOAT } from "../../content/vehicles/boat-spec.ts";
import { hashBytes, hashString } from "../../shared/hash.ts";
import { boatRestY, createBoat, stepBoat, type BoatInput, type BoatState } from "../../shared/sim/boat.ts";
import type { BoatVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { StaticBoatWorld } from "../../shared/world/boat.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";

const definition: BoatVehicleDefinition = { id: "core:boat", movement: "boat", spec: BOAT, seats: [], doors: [], wheels: [], actionTicks: 24, beltline: 1.36 };
const idle: BoatInput = { throttle: 0, steer: 0, neutral: false, pilot: true };
function scene(count: number, nearby: boolean) {
  const dims = { chunksX: 8, chunksZ: 8 }, hf = new Heightfield(dims, 2, -32, 1 / 256); hf.heights.fill(4096); hf.seaLevel = 0;
  const structs = new StructureStore(dims, new Float32Array([0, .10]), new Float32Array([0, 1.5]), new Float32Array([0, .10]));
  const states: BoatState[] = [];
  for (let i = 0; i < count; i++) {
    const x = 40 + (i % 8) * 56, z = 40 + Math.floor(i / 8) * 56, payload = i % 3 * 250;
    const s = createBoat(BOAT, x, boatRestY(BOAT, 0, payload), z); s.payloadMass = payload; states.push(s);
    // Pillars in the empty upper cockpit exercise broadphase and part SAT without filling that empty space.
    if (nearby) for (const dx of [-.8, .8]) structs.add(1, x + dx, 2.3, z - 1, 0, 0, 100);
  }
  return { states, world: new StaticBoatWorld({ hf, structs }) };
}
const percentile = (times: number[], q: number): number => times.sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!;
export function benchBoats(section: (title: string) => void, record: (name: string, value: number, unit: string, budget?: number | null) => void): void {
  section("Boats: 16 floating rigid hulls through native water, terrain and convex collision");
  for (const nearby of [false, true]) {
    const { states, world } = scene(16, nearby), times: number[] = [];
    for (let tick = 0; tick < 720; tick++) {
      const start = performance.now();
      for (const state of states) stepBoat(state, idle, definition, world);
      if (tick >= 120) times.push(performance.now() - start);
    }
    const name = nearby ? "near 32 solid dock posts" : "open water";
    record(`${name}: 16 steps, median`, percentile(times, .5), "ms", 2);
    record(`${name}: 16 steps, p99`, percentile(times, .99), "ms", 5);
    record(`${name}: per boat, median`, percentile(times, .5) * 1000 / states.length, "us");
  }
}
/** Gear changes, fuel exhaustion, cargo, full capsize, gradual flooding and native collision enter the same replay. */
export function boatHash(): string {
  const { states, world } = scene(6, true);
  const fields = Object.keys(states[0]!) as (keyof BoatState)[];
  const numbers = new Float32Array(fields.length + 6), bytes = new Uint8Array(numbers.buffer);
  let hash = 0x811c9dc5;
  for (let tick = 0; tick < 1800; tick++) for (let index = 0; index < states.length; index++) {
    const s = states[index]!, age = (tick + index * 23) % 360;
    const input = { ...idle, throttle: age < 150 ? .8 : age < 220 ? -.6 : .2, steer: age < 90 ? .3 : age < 180 ? -.5 : 0, neutral: age >= 220 && age < 270 };
    if (tick === 600 && index === 0) { s.qx = 1; s.qy = s.qz = s.qw = 0; s.y = .4; }
    if (tick === 800 && index === 1) s.payloadMass = 4200;
    if (tick === 1000 && index === 2) s.hullCondition = .1;
    if (tick === 1200 && index === 3) s.fuel = 0;
    const r = stepBoat(s, input, definition, world);
    for (let i = 0; i < fields.length; i++) numbers[i] = Number(s[fields[i]!]);
    numbers.set([r.impactSpeed, Number(r.propHit), Number(r.capsized), r.immersion, r.propellerImmersion, r.planing], fields.length);
    hash = hashString(r.blocked ?? "", hashBytes(bytes, hash));
  }
  return hash.toString(16).padStart(8, "0");
}
if (import.meta.main) {
  if (process.argv.includes("--hash")) console.log(boatHash());
  else {
    console.log(`${cpus()[0]?.model}; ${cpus().length} logical CPUs; load ${loadavg().map(n => n.toFixed(2)).join("/")}`);
    benchBoats(console.log, (name, value, unit, budget) => console.log(`${name}: ${value.toFixed(3)} ${unit}${budget ? ` (budget ${budget})` : ""}`));
  }
}
