// Manual placement acceptance against the actual rebuilt Miami file, not a preview terrain fixture.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { CRUISE_LAYOUT, cruisePoint, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { chunkAt, TICK_DT } from "../../shared/coords.ts";
import { Body, MODE_WALK, stepBody } from "../../shared/sim/character.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { mapHeightfield, mapNodes, parseMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { GROUND_FREE, PATH_FOUND, PathFinder, groundAt } from "../../shared/world/path.ts";
import { obstructed } from "../../shared/world/snap.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Base } from "../mapworld/base.ts";
import { landmarksOf, placeLandmarks } from "../mapworld/landmarks.ts";
import type { World } from "../mapworld/ground.ts";
import { workFolder } from "../maps/work.ts";

const root = resolve(import.meta.dir, "../.."), file = resolve(root, process.argv[2] ?? "var/maps/miami.snmap");
const out = resolve(root, process.argv[3] ?? "var/cruise-miami/placement.json");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = readFileSync(file), map = parseMap(bytes), source = workFolder("miami");
const configBytes = readFileSync(resolve(source, "world/world.json")), config = JSON.parse(configBytes.toString()) as World;
const base = new Base(source);
const placed = landmarksOf(config.landmarks ?? [], (lon, lat) => base.toSample(lon, lat), base.grid);
const cruise = placed.find(p => p.landmark.name === "cruise");
if (!cruise || map.id !== "core:miami") throw new Error("Expected the configured cruise berth in rebuilt Miami");
const { x, z } = cruise.site, y = cruise.site.y ?? 0, yaw = Math.round(cruise.site.yaw * 65536 / 360) & 65535;
const point = (at: readonly number[]) => cruisePoint(x, y, z, yaw, at);
const core = compileContent(CORE_CONTENT); if (!core.registry) throw new Error(core.errors.join("\n"));
const reg = withContent(core.registry, map.content?.defs ?? []), hf = mapHeightfield(map);
const makeStore = () => new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const structs = makeStore(), others = makeStore();
const key = (s: MapStatic) => `${s.kind}|${s.x},${s.y},${s.z}|${s.yaw}`;
const expected = placeLandmarks(placed, reg, 0), wanted = new Map(expected.statics.map(s => [key(s), 0]));
const faults: string[] = [], counts = new Map<string, number>();
let localCount = 0, otherCount = 0;
for (const s of map.statics) {
  const k = key(s); if (wanted.has(k)) wanted.set(k, wanted.get(k)! + 1);
  for (const { name } of map.content?.landmarks ?? []) if (s.kind.startsWith(`${name}:`)) counts.set(name, (counts.get(name) ?? 0) + 1);
  // Every collision that can affect this 365 m vessel or its 180 m shore approach lies inside this margin.
  if (Math.hypot(s.x - x, s.z - z) > 500) continue;
  const kind = reg.index.get(s.kind)!;
  structs.add(kind, s.x, s.y, s.z, s.yaw, 0, 10000); localCount++;
  if (!s.kind.startsWith("cruise:")) { others.add(kind, s.x, s.y, s.z, s.yaw, 0, 10000); otherCount++; }
}
if (structs.count !== localCount || others.count !== otherCount) faults.push("native collision stores lost a local map row");
for (const [k, count] of wanted) if (count !== 1) faults.push(`expected one landmark placement, got ${count}: ${k}`);
if (JSON.stringify(map.content?.landmarks) !== JSON.stringify(expected.content.landmarks)) faults.push("map LAND placements differ from world.json");
const crossings = cruiseStatics(x, y, z, yaw).filter(s => obstructed(others, reg.parts, reg.index.get(s.kind)!, s.x, s.y, s.z, s.yaw));
if (crossings.length) faults.push(`${crossings.length} cruise modules intersect existing city statics under native construction overlap rules`);
let depthSamples = 0, highestBed = -Infinity, lowestClearance = Infinity;
for (let a = -24; a <= 24; a += 2) for (let b = -180; b <= 180; b += 2) {
  const p = point([a, 0, b]), bed = hf.heightAt(p[0], p[2]); depthSamples++;
  highestBed = Math.max(highestBed, bed); lowestClearance = Math.min(lowestClearance, y + CRUISE_LAYOUT.dimensions.provisionalKeelY - bed);
  if (hf.waterAt(p[0], p[2]) !== y) faults.push(`waterline differs at ${a},${b}`);
}
if (lowestClearance < 1.9) faults.push(`only ${lowestClearance} m clearance below the provisional keel`);
const nodeSource = mapNodes(map, hf, reg), nodes = nodeSource ? new NodeField(map.dims, reg, nodeSource) : null;
const retained = new Set<number>();
const world = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) };
const params = reg.move[reg.index.get("core:survivor")!]!;
const localRoute = [[174, 0, -24], [154, 0, -24], [130, 0, -24], [106, 0, -24], [82, 14, -24], CRUISE_LAYOUT.docking.shoreLanding, CRUISE_LAYOUT.docking.shipLanding, CRUISE_LAYOUT.docking.arrival];
const route = localRoute.map(p => { const at = point(p); return [at[0], p[1] === 0 ? hf.heightAt(at[0], at[2]) : at[1], at[2]] as const; });
const keep = (a: number, b: number) => { const c = chunkAt(map.dims, a, b); if (!retained.has(c)) { nodes?.retain(c, 2, 1, () => false); retained.add(c); } };
// Existing vegetation remains physical. The ordinary ground path finder chooses the clear
// connections between terrace targets; every segment is then actually walked both ways.
const corridorBody = { ...params, radius: .8, height: 2.6 };
const path = new PathFinder(world, corridorBody);
const approach = [route[0]!];
for (let i = 1; i < route.length - 2; i++) {
  const a = route[i - 1]!, b = route[i]!; keep(a[0], a[2]); keep(b[0], b[2]);
  if (path.find(a[0], a[2], b[0], b[2]) !== PATH_FOUND) faults.push(`no native ground connection on approach leg ${i}`);
  else approach.push(...Array.from({ length: path.count }, (_, p) => [path.x[p]!, groundUnder(hf, path.x[p]!, path.z[p]!, params.radius), path.z[p]!] as const));
  approach.push(b);
}
route.splice(0, route.length - 2, ...approach);
let corridorSamples = 0;
for (let i = 1; i < route.length - 2; i++) {
  const a = route[i - 1]!, b = route[i]!, steps = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[2] - b[2]) / .5));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, px = a[0] + (b[0] - a[0]) * t, pz = a[2] + (b[2] - a[2]) * t;
    keep(px, pz); corridorSamples++;
    if (groundAt(world, corridorBody, px, pz) !== GROUND_FREE) { faults.push(`shore corridor lacks 1.6 m width / 2.6 m headroom at ${px},${pz}`); break; }
  }
}
const body = new Body(); [body.x, body.y, body.z] = route[0]!; body.y += 1; keep(body.x, body.z);
for (let t = 0; t < 90; t++) stepBody(world, body, 0, 0, 0, 0, 0, params, TICK_DT);
const start = [body.x, body.y, body.z], legs: object[] = []; let ticks = 0;
for (const [leg, target] of [...route.slice(1), ...route.slice(0, -1).reverse()].entries()) {
  const limit = 300 + Math.ceil(Math.hypot(body.x - target[0], body.z - target[2]) * 40); let message = "";
  for (let t = 0; t < limit; t++) {
    const left = Math.hypot(body.x - target[0], body.z - target[2]); if (left < .1) break;
    keep(body.x, body.z); keep(target[0], target[2]);
    const facing = Math.round(Math.atan2(target[0] - body.x, target[2] - body.z) * 65536 / (2 * Math.PI)) & 65535;
    stepBody(world, body, 0, Math.min(100, Math.round(left * 150)), facing, 0, 0, params, TICK_DT); ticks++;
    if (!capsuleFree(world, body.x, body.y, body.z, params.radius, 2.6)) { message = "body/headroom blocked"; break; }
  }
  for (let t = 0; t < 20; t++) stepBody(world, body, 0, 0, 0, 0, 0, params, TICK_DT);
  if (!message && (Math.hypot(body.x - target[0], body.z - target[2]) > .2 || Math.abs(body.y - target[1]) > .3 || body.mode !== MODE_WALK)) message = "ordinary walking did not reach the supported target";
  legs.push({ leg, target, reached: [body.x, body.y, body.z], mode: body.mode, message });
  if (message) { faults.push(`walking leg ${leg}: ${message}`); break; }
}
const shore = point(CRUISE_LAYOUT.docking.shoreLanding), berth = { x, y, z, yaw, degrees: cruise.site.yaw, longitude: cruise.site.at[0], latitude: cruise.site.at[1] };
const report = { scope: "Actual rebuilt Miami LAND/static/heightfield data. Every authored Cruise and Koru placement checked exactly once; all non-cruise native solids within 500 m tested against the ship using construction overlap rules. Native survivor input walks from real dry shore to deck5 and back, with actual static/node collision and 2.6 m headroom. No render, all-interior, dynamic-traffic or bathymetric-survey certification.",
  map: { path: file.slice(root.length + 1), hash: map.hash, sha256: hash(bytes), statics: map.statics.length, localStatics: structs.count, localOtherStatics: others.count, landmarks: map.content?.landmarks },
  sources: { world: hash(configBytes), layout: hash(readFileSync(resolve(root, "content/landmarks/cruise-layout.json"))), adapter: hash(readFileSync(resolve(root, "content/landmarks/cruise.ts"))), audit: hash(readFileSync(import.meta.path)) },
  berth, landmarkCounts: Object.fromEntries(counts), existingStaticCrossings: crossings, depth: { samples: depthSamples, highestBed, provisionalKeel: y + CRUISE_LAYOUT.dimensions.provisionalKeelY, minimumClearance: lowestClearance },
  shoreLanding: { at: shore, terrain: groundUnder(hf, shore[0], shore[2], params.radius), water: hf.waterAt(shore[0], shore[2]) },
  walking: { start, startTerrain: hf.heightAt(start[0]!, start[2]!), corridor: { clearWidth: 1.6, clearHeight: 2.6, samples: corridorSamples, sampleSpacing: .5 }, route, ticks, legs }, faults };
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ out, berth, landmarks: report.landmarkCounts, depth: report.depth, crossings: crossings.length, walkingLegs: legs.length, faults }));
if (faults.length) process.exitCode = 1;
