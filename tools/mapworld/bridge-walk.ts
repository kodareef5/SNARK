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
import type { BridgeRecord, DeckPoint } from "./bridges.ts";
import { Base } from "./base.ts";
import { regions } from "./raster.ts";

const folder = paths.folder;
const map = parseMap(new Uint8Array(readFileSync(paths.mapFile)));
const reg = compileContent(CORE_CONTENT).registry!; const hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts); placeStatics(map, structs, reg);
const source = mapNodes(map, hf, reg); const nodes = source ? new NodeField(map.dims, reg, source) : null;
const world = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) }; const params = reg.move[reg.index.get("core:survivor")!]!;
const records = JSON.parse(readFileSync(`${folder}/bridges.json`, "utf8")) as BridgeRecord[];
const results: { id: number; name: string | null; type: string; ok: boolean; message: string }[] = [];
let steps = 0;
const move = (b: Body, x: number, z: number, limit = 150): boolean => {
  nodes?.retain(chunkAt(map.dims, x, z), 1, 1, () => false);
  for (let t = 0; t < limit && Math.hypot(b.x - x, b.z - z) > .2; t++) {
    const yaw = Math.round(Math.atan2(x - b.x, z - b.z) * 65536 / (2 * Math.PI)) & 65535;
    stepBody(world, b, 0, 100, yaw, 0, 0, params, TICK_DT); steps++;
  }
  return Math.hypot(b.x - x, b.z - z) < .4;
};
for (const r of records.filter((r) => r.status === "built" && r.kind !== "breakwater")) {
  const runs: DeckPoint[][] = []; let run: DeckPoint[] = [];
  for (const d of r.deck) { if (d.gap) { if (run.length > 1) runs.push(run); run = []; } else run.push(d); }
  if (run.length > 1) runs.push(run);
  const deckRuns = runs.length;
  for (const a of r.access ?? []) { runs.push(a.points); runs.push([...a.points].reverse()); }
  for (let index = 0; index < runs.length; index++) {
    const points = runs[index]!; const first = points[0]!; const b = new Body(); b.x = first.x; b.z = first.z; b.y = first.y + 1;
    nodes?.retain(chunkAt(map.dims, b.x, b.z), 1, 1, () => false);
    for (let t = 0; t < 60; t++) stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT);
    let message = "";
    for (const p of points.slice(1)) {
      const arrived = move(b, p.x, p.z);
      for (let t = 0; t < 30; t++) stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT);
      if (!arrived || Math.abs(b.y - p.y) > .65) { message = `target ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} reached ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}`; break; }
    }
    results.push({ id: r.id, name: r.name, type: index < deckRuns ? `deck ${index + 1}/${deckRuns}` : `access ${Math.floor((index - deckRuns) / 2) + 1} ${index % 2 === deckRuns % 2 ? "up" : "down"}`, ok: !message, message });
  }
  for (let index = 0; index < r.swim.length; index++) {
    const s = r.swim[index]!; const b = new Body(); b.x = s.x - s.dx * s.distance; b.z = s.z - s.dz * s.distance; b.y = -.8;
    const ok = move(b, s.x + s.dx * s.distance, s.z + s.dz * s.distance, 1800) && b.y < 0;
    results.push({ id: r.id, name: r.name, type: `swim ${index + 1}`, ok, message: ok ? "" : `stopped ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)} under ${s.x.toFixed(2)},${s.z.toFixed(2)}` });
  }
}
const base = new Base(paths.source); const gaps = paths.world.bridgeGapLayer ? base.bytes(paths.world.bridgeGapLayer) : new Uint8Array(base.n * base.n);
const broken = regions((i) => gaps[i] === 1, base.n, base.n);
const gapAt = (x: number, z: number): number => broken.label[Math.round((base.info.size_m - z) / 2) * base.n + Math.round((base.info.size_m - x) / 2)] ?? 0;
const touched = new Set(records.flatMap((r) => r.deck.filter((d) => d.gap).map((d) => gapAt(d.x, d.z))).filter(Boolean));
const filled = map.statics.filter((p) => p.kind.includes("zruin_floor") && gapAt(p.x, p.z));
const gapAudit = { authored: broken.count, intersectedByWays: touched.size, floorCentresInGap: filled.length };
if (broken.count !== touched.size || filled.length) results.push({ id: 0, name: "authored broken spans", type: "gap preservation", ok: false, message: JSON.stringify(gapAudit) });
const summary = { mapHash: map.hash, ways: records.length, built: records.filter((r) => r.status === "built").length, deckRuns: results.filter((r) => r.type.startsWith("deck")).length, accessRuns: results.filter((r) => r.type.startsWith("access")).length, swimCrossings: results.filter((r) => r.type.startsWith("swim")).length, gapAudit, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, steps, failures: results.filter((r) => !r.ok) };
writeFileSync(`${folder}/bridge-walk.json`, JSON.stringify(results, null, 2) + "\n"); writeFileSync(`${folder}/bridge-test.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2)); if (summary.failed) process.exitCode = 1;
