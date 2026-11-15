import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkAt, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { reportPaths } from "./report-path.ts";
import type { RuinRecord } from "./ruins.ts";

const paths = reportPaths();
const map = parseMap(new Uint8Array(readFileSync(paths.mapFile)));
const reg = compileContent(CORE_CONTENT).registry!; const hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts); placeStatics(map, structs, reg);
const source = mapNodes(map, hf, reg); const nodes = source ? new NodeField(map.dims, reg, source) : null;
const world = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) };
const params = reg.move[reg.index.get("core:survivor")!]!;
const buildings = JSON.parse(readFileSync(`${paths.folder}/buildings.json`, "utf8")) as RuinRecord[];
const circuits: { part: number; rooms: RuinRecord["rooms"] }[] = [...buildings];
if (existsSync(`${paths.folder}/street-clusters.json`)) {
  const streets = JSON.parse(readFileSync(`${paths.folder}/street-clusters.json`, "utf8")) as { points?: RuinRecord["rooms"][number]["points"] }[];
  for (const [i, r] of streets.entries()) if (r.points?.length) circuits.push({ part: -i - 1, rooms: [{ kind: "street-gap", points: r.points }] });
}
const failures: { part: number; route: number; kind: string; message: string }[] = []; let routes = 0;
const kinds: Record<string, number> = {};
for (const r of circuits) for (const [index, route] of r.rooms.entries()) {
  routes++; kinds[route.kind] = (kinds[route.kind] ?? 0) + 1;
  const first = route.points[0]!; const b = new Body(); b.x = first.x; b.y = first.y + 1; b.z = first.z;
  const chunk = chunkAt(map.dims, b.x, b.z); nodes?.retain(chunk, 1, 1, () => false);
  for (let t = 0; t < 60; t++) stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT);
  for (const p of route.points.slice(1)) {
    for (let tick = 0; tick < 160 && Math.hypot(b.x - p.x, b.z - p.z) > .16; tick++) {
      const yaw = Math.round(Math.atan2(p.x - b.x, p.z - b.z) * 65536 / (Math.PI * 2)) & 65535;
      stepBody(world, b, 0, 90, yaw, 0, route.kind === "rubble" && p.y > b.y + .35 && b.grounded ? 1 : 0, params, TICK_DT);
    }
    for (let t = 0; t < 20; t++) stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT);
    if (Math.hypot(b.x - p.x, b.z - p.z) > .3 || Math.abs(b.y - p.y) > .2) { failures.push({ part: r.part, route: index, kind: route.kind, message: `target ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} reached ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}` }); break; }
  }
  nodes?.retain(chunk, 1, -1, () => false);
}
const report = { mapHash: map.hash, routes, kinds, passed: routes - failures.length, failed: failures.length, failures };
writeFileSync(`${paths.folder}/room-test.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, failures: failures.slice(0, 12) }, null, 2)); if (failures.length) process.exitCode = 1;
