import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hash3 } from "./raster.ts";
import { reportPaths } from "./report-path.ts";
import type { RuinRecord } from "./ruins.ts";

const paths = reportPaths();
const config = JSON.parse(readFileSync(join(paths.source, "ruins/proof.json"), "utf8")) as { previous: string; seed: number; baseline: string[]; places: string[]; fallSpecimens?: Record<string, number>; specimens?: Record<string, { minDepth?: number; maxWidth?: number; minPieces?: number }>; overrides?: Record<string, Record<string, unknown>>; extra?: Record<string, unknown>[] };
const info = JSON.parse(readFileSync(join(paths.source, "map.json"), "utf8")) as { size_m: number };
const centre = info.size_m / 2;
const buildings = JSON.parse(readFileSync(join(paths.folder, "buildings.json"), "utf8")) as RuinRecord[];
const previous = JSON.parse(readFileSync(join(paths.source, "reports", config.previous, "views.json"), "utf8")) as { name: string }[];
const views: Record<string, unknown>[] = previous.filter((v) => config.baseline.includes(v.name)).map((v) => ({ ...v, baseline: `../${config.previous}/${v.name}.png` }));
const samples: Record<string, unknown>[] = [];
const score = (r: RuinRecord): number => Math.abs(r.width - 36) + Math.abs(r.depth - 32) + Math.abs(r.height - 16) * 2;
const lineup = (name: string, r: RuinRecord): void => {
  views.push({ name, x: centre + 46, z: centre - 72, y: 30, look: [centre, centre, 9], fov: 48, size: [800, 600], isolate: { first: r.firstPiece, count: r.blocks, x: r.x, y: r.y, z: r.z, yaw: r.yaw } });
  samples.push({ view: name, footprint: r.footprint, form: r.form, kind: r.kind, collapse: r.collapse, name: r.name, pieces: r.blocks, width: r.width, depth: r.depth, height: r.height, isolation: "Exact packed pieces, translation and yaw only, flat ground, no neighbouring buildings or plants" });
};
const chosen = new Map<string, RuinRecord>();
for (const form of ["house", "apartment", "hotel", "office", "garage", "warehouse", "school", "church", "station", "hospital", "shop", "firehouse", "civic"]) {
  const specimen = config.specimens?.[form];
  const rows = buildings.filter((r) => r.form === form && !r.special && r.detail === 0 && r.width >= 16 && r.depth >= (specimen?.minDepth ?? 16) && r.width <= (specimen?.maxWidth ?? 80) && r.blocks >= (specimen?.minPieces ?? 0) && r.height <= (form === "house" ? 8 : form === "shop" ? 12 : form === "station" ? 12 : 36)).sort((a, b) => score(a) - score(b) || a.part - b.part);
  const r = rows.sort((a, b) => (form === "house" ? Math.abs(a.width - 20) + Math.abs(a.depth - 16) - Math.abs(b.width - 20) - Math.abs(b.depth - 16) : score(a) - score(b)) || a.part - b.part)[0]; if (!r) throw new Error(`No ${form} specimen`);
  chosen.set(form, r); lineup(`kind-${String(chosen.size).padStart(2, "0")}`, r);
}
for (const mode of ["shear", "pancake", "lost-top", "burnt", "facade", "hanging"]) {
  const r = buildings.find((r) => r.footprint === config.fallSpecimens?.[mode]) ?? buildings.filter((r) => r.collapse === mode && r.falls.length >= 3 && r.width <= 64 && r.depth <= 64 && r.height <= (mode === "lost-top" ? 80 : 32) && r.detail === 0 && !r.special).sort((a, b) => score(a) - score(b) || a.part - b.part)[0]!;
  if (!r) throw new Error(`No ${mode} specimen`); lineup(`fall-${mode}`, r);
  const view = views.at(-1)!; const u = r.falls.reduce((n, f) => n + f.u, 0); const v = r.falls.reduce((n, f) => n + f.v, 0);
  view.x = centre + (u < 0 ? -46 : 46); view.z = centre + (v < 0 ? -72 : 72);
}
for (const form of ["hotel", "office", "warehouse", "house"]) {
  const r = buildings.filter((r) => r.form === form && r.rooms.some((room) => !["rubble", "lobby"].includes(room.kind)) && r.detail === 0).sort((a, b) => score(a) - score(b) || a.part - b.part)[0]!;
  const room = r.rooms.find((room) => !["rubble", "lobby"].includes(room.kind) && (form !== "hotel" || room.points[0]!.y > r.y)) ?? r.rooms.find((room) => !["rubble", "lobby"].includes(room.kind))!; const p = room.points[1]!; const q = room.points[2]!;
  views.push({ name: `inside-${form}`, x: p.x, y: p.y + 1.65, z: p.z, look: [q.x, q.z, q.y - r.y + 1.2], fov: 85, size: [960, 600] });
  samples.push({ view: `inside-${form}`, footprint: r.footprint, kind: room.kind });
}
const refuge = buildings.filter((r) => r.rooms.some((room) => room.kind === "rooms" && room.points[0]!.y >= r.y + 8)).sort((a, b) => a.part - b.part)[0]!;
const room = refuge.rooms.find((room) => room.kind === "rooms" && room.points[0]!.y >= refuge.y + 8)!;
views.push({ name: "refuge", x: room.points[2]!.x, y: room.points[2]!.y + 1.65, z: room.points[2]!.z, look: [room.points[0]!.x, room.points[0]!.z, room.points[0]!.y - refuge.y + 1.1], fov: 90, size: [960, 600] });
const tower = buildings.filter((r) => r.routes.length && r.height > 80).sort((a, b) => b.routes[0]!.floors - a.routes[0]!.floors || a.part - b.part)[0]!;
const stair = tower.routes[0]!; const a = stair.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a); const dir = stair.floors % 2 === 0 ? -1 : 1;
views.push({ name: "tower-high-view", x: stair.x + s * dir * 5.5, z: stair.z + c * dir * 5.5, y: stair.y + stair.floors * 4 + 1.65, look: [stair.x + s * dir * 180, stair.z + c * dir * 180, 7], fov: 85, size: [1280, 720] });
samples.push({ view: "refuge", footprint: refuge.footprint }, { view: "tower-high-view", footprint: tower.footprint, floors: stair.floors });
const drawn: RuinRecord[] = [];
for (const r of buildings.filter((r) => r.approaches.length && r.width > 12).sort((a, b) => hash3(a.part, config.seed, 3) - hash3(b.part, config.seed, 3) || a.part - b.part)) {
  if (drawn.some((p) => Math.hypot(p.x - r.x, p.z - r.z) < 128)) continue;
  drawn.push(r); const entry = r.approaches[0]!;
  views.push({ name: `drawn-street-${drawn.length}`, x: entry.street.x, z: entry.street.z, up: 1.7, look: [entry.door.x, entry.door.z, 4], fov: 75, size: [960, 600] });
  samples.push({ view: `drawn-street-${drawn.length}`, footprint: r.footprint, name: r.name, seed: config.seed, rankHash: hash3(r.part, config.seed, 3) });
  if (drawn.length === 3) break;
}
for (const r of buildings.filter((r) => r.special && config.places.includes(r.special))) {
  const a = r.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
  views.push({ name: `place-${r.special}`, x: r.x + 30 * c - 55 * s, z: r.z - 30 * s - 55 * c, y: r.y + 22, look: [r.x, r.z, 12], fov: 65, size: [960, 600] });
  lineup(`outline-${r.special}`, r);
}
for (const v of views) Object.assign(v, config.overrides?.[String(v.name)] ?? {});
views.push(...config.extra ?? []);
writeFileSync(join(paths.folder, "views.json"), JSON.stringify(views, null, 2) + "\n");
writeFileSync(join(paths.folder, "samples.json"), JSON.stringify({ seed: config.seed, lineupDistance: Math.hypot(46, 72), eyeHeight: 30, fov: 48, samples }, null, 2) + "\n");
console.log(`${views.length} views, ${samples.length} recorded selections`);
