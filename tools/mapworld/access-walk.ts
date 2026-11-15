import { reportPaths } from "./report-path.ts";
const paths = reportPaths();
import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkAt, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { RuinRecord } from "./ruins.ts";

const folder = paths.folder;
const map = parseMap(new Uint8Array(readFileSync(paths.mapFile)));
const reg = compileContent(CORE_CONTENT).registry!; const hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts); placeStatics(map, structs, reg);
const source = mapNodes(map, hf, reg); const nodes = source ? new NodeField(map.dims, reg, source) : null;
const world = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) }; const params = reg.move[reg.index.get("core:survivor")!]!;
const records = JSON.parse(readFileSync(`${folder}/buildings.json`, "utf8")) as RuinRecord[];
const results: { part: number; name: string | null; route: number; ok: boolean; message: string }[] = [];
for (const r of records) for (let i = 0; i < r.approaches.length; i++) {
  const a = r.approaches[i]!; const b = new Body(); b.x = a.street.x; b.z = a.street.z; b.y = hf.heightAt(b.x, b.z) + 1;
  const chunks = [...new Set([a.street, a.door, a.core].map((p) => chunkAt(map.dims, p.x, p.z)))];
  for (const c of chunks) nodes?.retain(c, 1, 1, () => false);
  for (let t = 0; t < 60; t++) stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT);
  let message = "";
  for (const p of [a.door, a.core, a.door, a.street]) {
    const limit = 300 + Math.ceil(Math.hypot(b.x - p.x, b.z - p.z) * 40);
    for (let t = 0; t < limit && Math.hypot(b.x - p.x, b.z - p.z) > .2; t++) {
      const yaw = Math.round(Math.atan2(p.x - b.x, p.z - b.z) * 65536 / (2 * Math.PI)) & 65535;
      stepBody(world, b, 0, 100, yaw, 0, 0, params, TICK_DT);
    }
    if (Math.hypot(b.x - p.x, b.z - p.z) > .4 || b.y < 0) { message = `target ${p.x.toFixed(2)},${p.z.toFixed(2)} reached ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}`; break; }
  }
  for (const c of chunks) nodes?.retain(c, 1, -1, () => false);
  results.push({ part: r.part, name: r.name, route: i, ok: !message, message });
}
if (records.some((r) => r.entries.length) && results.length === 0) throw new Error("No street approaches were generated");
const failures = results.filter((r) => !r.ok);
const summary = { mapHash: map.hash, routes: results.length, buildingsWithApproach: records.filter((r) => r.approaches.length).length, coresWithoutStreetApproach: records.filter((r) => r.routes.length && !r.approaches.length).map((r) => ({ part: r.part, name: r.name })), passed: results.length - failures.length, failed: failures.length, failures };
writeFileSync(`${folder}/access-test.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2)); if (failures.length) process.exitCode = 1;
