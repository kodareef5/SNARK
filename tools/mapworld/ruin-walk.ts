// Authoritative capsule movement through stairs from the actual packed city, including rotated and damaged shells.
import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkAt, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { RuinRecord } from "./ruins.ts";

const folder = "assets/source/maps/miami/reports/ruins1";
const map = parseMap(new Uint8Array(readFileSync(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "var/maps/miami.snmap")));
const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg = compiled.registry;
const hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
placeStatics(map, structs, reg);
const source = mapNodes(map, hf, reg);
const nodes = source ? new NodeField(map.dims, reg, source) : null;
const world = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) };
const params = reg.move[reg.index.get("core:survivor")!]!;
const records = JSON.parse(readFileSync(`${folder}/buildings.json`, "utf8")) as RuinRecord[];
const candidates = records.filter((r) => r.routes.length > 0).sort((a, b) => a.part - b.part);
const sample = process.argv.includes("--all") ? candidates : candidates.filter((r, i) => r.special || i % Math.max(1, Math.floor(candidates.length / 48)) === 0);
const results: { part: number; name: string | null; floors: number; route: number; startHeight: number; ok: boolean; message: string }[] = [];
for (const r of sample) for (let ri = 0; ri < r.routes.length; ri++) {
  const route = r.routes[ri]!;
  const chunk = chunkAt(map.dims, route.x, route.z);
  nodes?.retain(chunk, 1, 1, () => false);
  const a = route.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
  const point = (u: number, v: number): [number, number] => [route.x + u * c + v * s, route.z - u * s + v * c];
  const start = point(-1.5, -3.25);
  const b = new Body(); b.x = start[0]; b.z = start[1]; b.y = Math.max(hf.heightAt(b.x, b.z), route.y) + 2;
  for (let tick = 0; tick < 90; tick++) stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT);
  let message = "";
  const go = (u: number, v: number, y: number): boolean => {
    const [x, z] = point(u, v);
    for (let tick = 0; tick < 220 && Math.hypot(b.x - x, b.z - z) > .15; tick++) {
      const yaw = Math.round(Math.atan2(x - b.x, z - b.z) * 65536 / (Math.PI * 2)) & 65535;
      stepBody(world, b, 0, 90, yaw, 0, 0, params, TICK_DT);
    }
    for (let tick = 0; tick < 16; tick++) stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT);
    if (Math.hypot(b.x - x, b.z - z) > .25 || Math.abs(b.y - y) > .15) {
      message = `target ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} reached ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`;
      return false;
    }
    return true;
  };
  let ok = true;
  for (let level = 0; level < route.floors && ok; level++) {
    const dir = level % 2 === 0 ? 1 : -1; const x = level % 2 === 0 ? -1.5 : 1.5;
    ok = go(x, dir * 3.25, route.y + (level + 1) * 4) && go(-x, dir * 3.25, route.y + (level + 1) * 4);
  }
  const dir = route.floors % 2 === 0 ? -1 : 1;
  if (ok) ok = go(route.floors % 2 === 0 ? -1.5 : 1.5, dir * 5.5, route.y + route.floors * 4);
  if (ok) ok = go(route.floors % 2 === 0 ? -1.5 : 1.5, dir * 3.25, route.y + route.floors * 4);
  for (let level = route.floors - 1; level >= 0 && ok; level--) {
    const direction = level % 2 === 0 ? 1 : -1; const lane = level % 2 === 0 ? -1.5 : 1.5;
    ok = go(lane, direction * 3.25, route.y + (level + 1) * 4) && go(lane, -direction * 3.25, route.y + level * 4);
  }
  nodes?.retain(chunk, 1, -1, () => false);
  results.push({ part: r.part, name: r.name, floors: route.floors, route: ri, startHeight: route.y, ok, message });
}
const failed = results.filter((r) => !r.ok);
const report = { includes: "terrain and resource-node collision; ascent, landing turns, roof exit and descent to ground", sampledBuildings: sample.length, stairRoutes: results.length, passed: results.length - failed.length, failed: failed.length, results };
writeFileSync(`${folder}/circulation.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, results: failed }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
