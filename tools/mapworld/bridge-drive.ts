// A reproducible native compact course at the recorded dry entrance nearest a map coordinate.
import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { ASPHALT, COMPACT } from "../../content/vehicles/compact.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { createVehicle, stepVehicle } from "../../shared/sim/vehicle.ts";
import { mapHeightfield, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import type { EntranceReport } from "./bridge-entrances.ts";

const [file, wantedX, wantedZ] = process.argv.slice(2);
if (!file || !Number.isFinite(Number(wantedX)) || !Number.isFinite(Number(wantedZ))) {
  throw new Error("Usage: bun tools/mapworld/bridge-drive.ts <file.snmap> <entrance-x> <entrance-z>");
}
const map = parseMap(readFileSync(file), false), report = JSON.parse(readFileSync(file.replace(/\.snmap$/, ".entrances.json"), "utf8")) as EntranceReport;
if (report.mapHash !== map.hash) throw new Error("Entrance metadata belongs to another map");
if (!report.entrances.length) throw new Error("The map has no recorded dry driving-road entrance");
const e = report.entrances.reduce((a, b) => Math.hypot(a.x - Number(wantedX), a.z - Number(wantedZ)) <= Math.hypot(b.x - Number(wantedX), b.z - Number(wantedZ)) ? a : b);
const compiled = compileContent([...CORE_CONTENT, ...(map.content?.defs ?? [])]);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg = compiled.registry, hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
placeStatics(map, structs, reg);
const world = { hf, structs }, environment = new StaticVehicleWorld(world, () => ASPHALT), rows = [];
for (const side of [-1.5, 0, 1.5]) for (const speed of [0, 5, 15, 25]) for (const direction of [1, -1]) {
  const from = direction === 1 ? -6 : 8, end = direction === 1 ? 18 : -16;
  const x = e.x + e.dx * from - e.dz * side, z = e.z + e.dz * from + e.dx * side;
  if (castWorld(world, x, e.y + 1.5, z, 0, -1, 0, 6, true) === HIT_NONE) throw new Error("No starting ground");
  const car = createVehicle(COMPACT, x, e.y + 1.5 - rayHit.t, z, Math.atan2(e.dx * direction, e.dz * direction));
  const input = { throttle: 0, steer: 0, brake: 0, handbrake: false };
  for (let tick = 0; tick < 90; tick++) stepVehicle(car, input, COMPACT, environment);
  car.vx = e.dx * speed * direction; car.vz = e.dz * speed * direction;
  input.throttle = 1;
  let up = 1, impact = 0, landing = 0, along = from, lateral = 0, ticks = 0;
  while (ticks++ < 300 && direction * (end - along) > 0) {
    const result = stepVehicle(car, input, COMPACT, environment);
    along = (car.x - e.x) * e.dx + (car.z - e.z) * e.dz;
    lateral = Math.max(lateral, Math.abs((car.z - e.z) * e.dx - (car.x - e.x) * e.dz - side));
    up = Math.min(up, 1 - 2 * (car.qx! ** 2 + car.qz! ** 2));
    impact = Math.max(impact, result.impactSpeed); landing = Math.max(landing, result.landSpeed ?? 0);
  }
  rows.push({ side, speed, direction, reached: direction * (along - end) >= 0, ticks, up, impact, landing, lateral });
}
const failed = rows.filter(r => !r.reached || r.up < .8 || r.impact > 5);
console.log(JSON.stringify({ mapHash: map.hash, entrance: { id: e.id, name: e.name, x: e.x, z: e.z }, passed: rows.length - failed.length, failed: failed.length, rows }, null, 2));
if (failed.length) process.exitCode = 1;
