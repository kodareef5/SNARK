// The marinas' docks walked and boarded on a built map, as the build laid them (tools/boat/marinas.ts):
//   bun tools/mapworld/dock-walk.ts <file.snmap> [--source DIR]
//
// The build's reports/<ruins>/marinas.json gives each run of dock modules, from its root, and each slip with the place
// on its dock beside it. A run is reached when it begins on land or on the deck of a run already reached. A survivor set
// down at a run's first point walks it point to point, as the bridge walk walks a deck. For each slip held for a found
// vessel it walks from the nearest point of its walkway out along the finger to the slip's place, stands there on the
// dock, and gets aboard the vessel by the boarding rule (shared/sim/boat-boarding.ts) as the server asks it. Writes
// dock-walk.json and dock-test.json beside the report; fails if any reached run or slip is not walked and boarded.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { chunkAt, TICK_DT } from "../../shared/coords.ts";
import { BOARD_OK, boatBoarding, type BoatBoard } from "../../shared/sim/boat-boarding.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { isBoatVehicle } from "../../shared/sim/vehicle.ts";
import { type CollisionWorld } from "../../shared/world/collide.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics, type MapData } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { JOINT } from "../boat/marinas.ts";
import { reportPaths } from "./report-path.ts";

/** A run as the report writes it: [x, z, y] a module, from its root, in the map's metres. */
export interface WalkedRun { site: string; id: string; finger: boolean; landed: boolean; points: [number, number, number][]; joins?: string[] }
export interface WalkedSlip { id: string; site: string; vessel: string; x: number; z: number; yaw: number; found: boolean; how: string; dock: [number, number, number] | null; run?: string; held?: string | null }

/** A survivor's walk on a built map: set down at a point, then point to point, each within 0.4 m and 0.65 m of its height. */
export function walker(map: MapData, reg = withContent(compileContent(CORE_CONTENT).registry!, map.content?.defs ?? [])) {
  const hf = mapHeightfield(map), structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const source = mapNodes(map, hf, reg), nodes = source ? new NodeField(map.dims, reg, source) : null;
  const world: CollisionWorld = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) }, params = reg.move[reg.index.get("core:survivor")!]!;
  let steps = 0;
  const settle = (b: Body, ticks: number): void => { for (let t = 0; t < ticks; t++) { stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT); steps++; } };
  const move = (b: Body, x: number, z: number, limit = 150): boolean => {
    nodes?.retain(chunkAt(map.dims, x, z), 1, 1, () => false);
    for (let t = 0; t < limit && Math.hypot(b.x - x, b.z - z) > .2; t++) {
      const yaw = Math.round(Math.atan2(x - b.x, z - b.z) * 65536 / (2 * Math.PI)) & 65535;
      stepBody(world, b, 0, 100, yaw, 0, 0, params, TICK_DT); steps++;
    }
    return Math.hypot(b.x - x, b.z - z) < .4;
  };
  /** Walks the points from the first; the empty string, or where it stopped. */
  const walk = (points: readonly (readonly [number, number, number])[]): { message: string; body: Body } => {
    const [x, z, y] = points[0]!, b = new Body(); b.x = x; b.z = z; b.y = y + 1;
    nodes?.retain(chunkAt(map.dims, x, z), 1, 1, () => false);
    settle(b, 60);
    if (Math.abs(b.y - y) > .65) return { message: `set down at ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} came to ${b.y.toFixed(2)}`, body: b };
    for (const [px, pz, py] of points.slice(1)) {
      const arrived = move(b, px, pz);
      settle(b, 30);
      if (!arrived || Math.abs(b.y - py) > .65) return { message: `target ${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)} reached ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}`, body: b };
    }
    return { message: "", body: b };
  };
  return { world, reg, walk, steps: () => steps };
}

/** The nearest point of a run's line to (x, z), and the index of the module before it. */
function foot(run: WalkedRun, x: number, z: number): { at: [number, number, number]; k: number; d: number } {
  let best = { at: run.points[0]!, k: 0, d: Infinity };
  for (let k = 0; k < run.points.length; k++) {
    const a = run.points[k]!, b = run.points[Math.min(k + 1, run.points.length - 1)]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
    const p: [number, number, number] = [a[0] + dx * t, a[1] + dz * t, a[2] + (b[2] - a[2]) * t], d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best.d) best = { at: p, k, d };
  }
  return best;
}

if (import.meta.main) {
  const paths = reportPaths(), file = join(paths.folder, "marinas.json");
  if (!existsSync(file)) throw new Error(`no ${file}: build the map first`);
  const map = parseMap(new Uint8Array(readFileSync(paths.mapFile)));
  const report = JSON.parse(readFileSync(file, "utf8")) as { runs: WalkedRun[]; slips: WalkedSlip[] };
  const { world, reg, walk, steps } = walker(map);
  const results: { site: string; what: string; ok: boolean; message: string }[] = [];
  // Which runs a survivor reaches from the land: those that begin on it, then those one of whose modules meets a
  // reached run's deck, and where: the joint, the parent's deck point and the module's index.
  const reached = new Map<WalkedRun, { from: [number, number, number]; k: number } | null>(report.runs.filter((r) => r.landed).map((r) => [r, null]));
  for (let grew = true; grew;) {
    grew = false;
    for (const r of report.runs) {
      if (reached.has(r)) continue;
      // Met where one ran onto the other's deck (the build's joins), or by a module within a joint of the other's line.
      const joined = [...reached.keys()].find((o) => o.site === r.site && (r.joins?.includes(o.id) || o.joins?.includes(r.id)));
      for (let k = 0; k < r.points.length && !reached.has(r); k++) {
        const [x, z, y] = r.points[k]!;
        const o = joined ?? [...reached.keys()].find((o) => o.site === r.site && foot(o, x, z).d < JOINT && Math.abs(foot(o, x, z).at[2] - y) < .6);
        if (!o) continue;
        // From the module of the run nearest the other's line.
        const near = joined ? r.points.reduce((best, p, j) => (foot(o, p[0], p[1]).d < foot(o, r.points[best]![0], r.points[best]![1]).d ? j : best), 0) : k;
        reached.set(r, { from: foot(o, r.points[near]![0], r.points[near]![1]).at, k: near }); grew = true;
      }
    }
  }
  for (const r of report.runs) {
    const joint = reached.get(r);
    if (joint === undefined) { results.push({ site: r.site, what: `run ${r.id}`, ok: false, message: "reached from no land and no other run" }); continue; }
    // A run met on another's deck is walked from that deck onto it, then out to each of its ends.
    const ways = joint ? [[joint.from, ...r.points.slice(0, joint.k + 1).reverse()], [joint.from, ...r.points.slice(joint.k)]].filter((w) => w.length > 1) : [r.points];
    const message = ways.map((w) => walk(w).message).find((m) => m) ?? "";
    results.push({ site: r.site, what: `run ${r.id}`, ok: !message, message });
  }
  const vehicles = new Map((map.vehicles ?? []).map((v) => [v.id, v]));
  const at: BoatBoard = { x: 0, y: 0, z: 0, top: 0 };
  for (const s of report.slips.filter((s) => s.found)) {
    const what = `${s.how} ${s.id.split("#").slice(1).join("#")} ${s.vessel}`;
    const v = s.held ? vehicles.get(s.held) : undefined;
    if (!s.dock) { results.push({ site: s.site, what, ok: false, message: "held with no dock" }); continue; }
    if (!v) { results.push({ site: s.site, what, ok: true, message: "no vessel fitted the slip, which stays empty" }); continue; }
    // Out from the walkway its finger stands on, or failing that the nearest run reached.
    const run = report.runs.find((r) => r.site === s.site && r.id === s.run && reached.has(r)) ?? report.runs.filter((r) => r.site === s.site && reached.has(r)).sort((a, b) => foot(a, s.dock![0], s.dock![1]).d - foot(b, s.dock![0], s.dock![1]).d)[0];
    if (!run) { results.push({ site: s.site, what, ok: false, message: "no reached run near its dock" }); continue; }
    const f = foot(run, s.dock[0], s.dock[1]);
    const { message, body } = walk([run.points[f.k]!, f.at, [s.dock[0], s.dock[1], s.dock[2]]]);
    if (message) { results.push({ site: s.site, what, ok: false, message: `walking out: ${message}` }); continue; }
    const def = reg.vehicle[reg.index.get(v.kind)!]!;
    if (!isBoatVehicle(def)) throw new Error(`${v.kind} in a slip is not a vessel`);
    const frame = { x: v.x, y: v.y ?? 0, z: v.z, yaw: v.yaw * 2 * Math.PI / 65536, pitch: 0, roll: 0 };
    const code = boatBoarding(def, frame, body.x, body.y, body.z, world.hf.waterAt(body.x, body.z), false, true, at);
    results.push({ site: s.site, what, ok: code === BOARD_OK, message: code === BOARD_OK ? "" : `from ${body.x.toFixed(2)},${body.y.toFixed(2)},${body.z.toFixed(2)} the boarding rule says ${code}` });
  }
  const summary = {
    mapHash: map.hash, runs: report.runs.length, reached: reached.size, slips: report.slips.length, found: report.slips.filter((s) => s.found).length,
    passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, steps: steps(), failures: results.filter((r) => !r.ok),
  };
  writeFileSync(join(paths.folder, "dock-walk.json"), JSON.stringify(results, null, 2) + "\n");
  writeFileSync(join(paths.folder, "dock-test.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ ...summary, failures: summary.failures.slice(0, 20) }, null, 2));
  if (summary.failed) process.exitCode = 1;
}
