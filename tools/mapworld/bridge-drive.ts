// A reproducible native compact course at the recorded dry entrance nearest a map coordinate.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CORE_CONTENT } from "../../content/core.ts";
import { ASPHALT, COMPACT } from "../../content/vehicles/compact.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { createVehicle, stepVehicle } from "../../shared/sim/vehicle.ts";
import { mapHeightfield, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import type { EntranceReport } from "./bridge-entrances.ts";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2), allowPositionals: true,
  options: { steer: { type: "boolean", default: false }, way: { type: "string" } },
});
const [file, wantedX, wantedZ] = positionals, steered = values.steer;
const way = values.way === undefined ? undefined : Number(values.way);
if (positionals.length !== 3 || !file || !Number.isFinite(Number(wantedX)) || !Number.isFinite(Number(wantedZ)) ||
    (way !== undefined && (!Number.isSafeInteger(way) || way <= 0))) {
  throw new Error("Usage: bun tools/mapworld/bridge-drive.ts <file.snmap> <entrance-x> <entrance-z> [--steer] [--way <id>]");
}
const map = parseMap(readFileSync(file), false), report = JSON.parse(readFileSync(file.replace(/\.snmap$/, ".entrances.json"), "utf8")) as EntranceReport;
if (report.mapHash !== map.hash) throw new Error("Entrance metadata belongs to another map");
const entrances = way === undefined ? report.entrances : report.entrances.filter(e => e.id === way);
if (!entrances.length) throw new Error(`No recorded dry driving-road entrance for ${way === undefined ? "this map" : "way " + way}`);
const distance = (point: { x: number; z: number }) => Math.hypot(point.x - Number(wantedX), point.z - Number(wantedZ));
const e = entrances.reduce((a, b) => distance(a) <= distance(b) ? a : b);
const alongTrack = (x: number, z: number) => (x - e.x) * e.dx + (z - e.z) * e.dz;

// Sample the recorded approach in the entrance's longitudinal coordinate. Inside the deck,
// or where the emitter recorded no runout, use the deck tangent as the reference line.
function lanePoint(along: number, side: number) {
  let x = e.x + e.dx * along, z = e.z + e.dz * along;
  if (steered && along < 0 && e.runout) {
    for (let i = 1; i < e.runout.length; i++) {
      const a = e.runout[i - 1]!, b = e.runout[i]!;
      const start = alongTrack(a.x, a.z), end = alongTrack(b.x, b.z);
      if (along < end || start <= end) continue;
      const t = Math.max(0, Math.min(1, (along - start) / (end - start)));
      x = a.x + (b.x - a.x) * t;
      z = a.z + (b.z - a.z) * t;
      break;
    }
  }
  return { x: x - e.dz * side, z: z + e.dx * side };
}

const compiled = compileContent([...CORE_CONTENT, ...(map.content?.defs ?? [])]);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg = compiled.registry, hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
placeStatics(map, structs, reg);
const world = { hf, structs }, environment = new StaticVehicleWorld(world, () => ASPHALT), rows = [];
const reverseStart = steered ? 4 : 8, forwardEnd = steered ? 5 : 18, reverseEnd = steered ? -6 : -16;
for (const side of [-1.5, 0, 1.5]) for (const speed of [0, 5, 15, 25]) for (const direction of [1, -1]) {
  const from = direction === 1 ? -6 : reverseStart;
  const end = direction === 1 ? forwardEnd : reverseEnd;
  const { x, z } = lanePoint(from, side);
  if (castWorld(world, x, e.y + 1.5, z, 0, -1, 0, 6, true) === HIT_NONE) {
    if (!steered) throw new Error("No starting ground");
    rows.push({ side, speed, direction, reached: false, classification: "no starting surface" });
    continue;
  }
  const ground = e.y + 1.5 - rayHit.t;
  const ahead = lanePoint(from + direction, side);
  const yaw = steered ? Math.atan2(ahead.x - x, ahead.z - z) : Math.atan2(e.dx * direction, e.dz * direction);
  const car = createVehicle(COMPACT, x, ground, z, yaw);
  const input = { throttle: 0, steer: 0, brake: steered ? 1 : 0, handbrake: steered };
  const upright = () => 1 - 2 * (car.qx! ** 2 + car.qz! ** 2);
  for (let tick = 0; tick < 90; tick++) stepVehicle(car, input, COMPACT, environment);
  const startShift = Math.hypot(car.x - x, car.z - z), startUp = upright();
  const stableStart = startShift <= .5 && startUp >= .95;
  car.vx = steered ? Math.sin(car.yaw) * speed : e.dx * speed * direction;
  car.vz = steered ? Math.cos(car.yaw) * speed : e.dz * speed * direction;
  input.throttle = 1; input.brake = 0; input.handbrake = false;

  let up = 1, impact = 0, landing = 0, along = from, lateral = 0, ticks = 0;
  let first: { tick: number; along: number; routeError: number; up: number; impact: number } | null = null;
  while (ticks++ < 300 && direction * (end - along) > 0) {
    if (steered) {
      const target = lanePoint(alongTrack(car.x, car.z) + 3 * direction, side);
      const headingError = Math.atan2(target.x - car.x, target.z - car.z) - car.yaw;
      input.steer = Math.max(-1, Math.min(1, 2 * Math.atan2(Math.sin(headingError), Math.cos(headingError))));
    }
    const result = stepVehicle(car, input, COMPACT, environment);
    along = alongTrack(car.x, car.z);
    const route = lanePoint(along, side);
    const error = steered ? Math.hypot(car.x - route.x, car.z - route.z) : Math.abs((car.z - e.z) * e.dx - (car.x - e.x) * e.dz - side);
    lateral = Math.max(lateral, error);
    const frameUp = upright();
    up = Math.min(up, frameUp);
    impact = Math.max(impact, result.impactSpeed); landing = Math.max(landing, result.landSpeed ?? 0);
    if (steered && !first && (frameUp < .8 || result.impactSpeed > 5)) {
      first = { tick: ticks, along, routeError: error, up: frameUp, impact: result.impactSpeed };
    }
  }
  const reached = direction * (along - end) >= 0;
  const row = { side, speed, direction, reached, ticks, up, impact, landing, lateral };
  if (steered) {
    let classification = "course departure or ambiguous";
    if (!stableStart) classification = "unstable start";
    else if (reached && !first) classification = "passed";
    else if (first && first.routeError <= .75) classification = "failure on course";
    else if (!first && lateral <= .75) classification = "stalled on course";
    rows.push({ ...row, startShift, startUp, stableStart, first, classification });
  } else {
    rows.push(row);
  }
}
const failed = rows.filter(r => !r.reached || ("up" in r && r.up < .8) || ("impact" in r && r.impact > 5));
const classifications: Record<string, number> = {};
for (const row of rows) {
  if ("classification" in row) {
    const label = row.classification;
    classifications[label] = (classifications[label] ?? 0) + 1;
  }
}
console.log(JSON.stringify({
  mapHash: map.hash, entrance: { id: e.id, name: e.name, x: e.x, z: e.z },
  ...(steered ? { course: "short steered", classifications } : {}),
  passed: rows.length - failed.length, failed: failed.length, rows,
}, null, 2));
if (failed.length) process.exitCode = 1;
