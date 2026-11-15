import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hash3 } from "./raster.ts";
import { reportPaths } from "./report-path.ts";
import type { RuinRecord } from "./ruins.ts";

const paths = reportPaths();
const config = JSON.parse(readFileSync(join(paths.source, "ruins/proof.json"), "utf8")) as { previous: string; seed: number; baseline: string[]; places: string[]; fallSpecimens?: Record<string, number>; specimens?: Record<string, { kinds?: string[]; minDepth?: number; maxWidth?: number; minPieces?: number; minHeight?: number; maxHeight?: number; targetHeight?: number }>; overrides?: Record<string, Record<string, unknown>>; extra?: Record<string, unknown>[] };
const info = JSON.parse(readFileSync(join(paths.source, "map.json"), "utf8")) as { size_m: number };
const centre = info.size_m / 2;
const buildings = JSON.parse(readFileSync(join(paths.folder, "buildings.json"), "utf8")) as RuinRecord[];
const previous = JSON.parse(readFileSync(join(paths.source, "reports", config.previous, "views.json"), "utf8")) as { name: string }[];
const views: Record<string, unknown>[] = previous.filter((v) => config.baseline.includes(v.name)).map((v) => ({ ...v, baseline: `../${config.previous}/${v.name}.png` }));
const samples: Record<string, unknown>[] = [];
const score = (r: RuinRecord): number => Math.abs(r.width - 36) + Math.abs(r.depth - 32) + Math.abs(r.sourceHeight - (config.specimens?.[r.form]?.targetHeight ?? 16)) * 2;
const lineup = (name: string, r: RuinRecord): void => {
  views.push({ name, x: centre + 46, z: centre - 72, y: 30, look: [centre, centre, 9], fov: 48, size: [800, 600], isolate: { first: r.firstPiece, count: r.blocks, x: r.x, y: r.y, z: r.z, yaw: r.yaw } });
  samples.push({ view: name, footprint: r.footprint, form: r.form, kind: r.kind, collapse: r.collapse, name: r.name, pieces: r.blocks, width: r.width, depth: r.depth, height: r.height, isolation: "Exact packed pieces, translation and yaw only, flat ground, no neighbouring buildings or plants" });
};
const chosen = new Map<string, RuinRecord>();
for (const form of ["house", "apartment", "hotel", "office", "garage", "warehouse", "school", "church", "station", "hospital", "shop", "firehouse", "civic"]) {
  const specimen = config.specimens?.[form];
  const rows = buildings.filter((r) => r.form === form && (!specimen?.kinds || specimen.kinds.includes(r.kind)) && !r.special && r.detail === 0 && r.width >= 16 && r.depth >= (specimen?.minDepth ?? 16) && r.width <= (specimen?.maxWidth ?? 80) && r.blocks >= (specimen?.minPieces ?? 0) && r.sourceHeight >= (specimen?.minHeight ?? 0) && r.height <= (specimen?.maxHeight ?? (form === "house" ? 16 : form === "shop" ? 20 : form === "station" ? 16 : 48))).sort((a, b) => score(a) - score(b) || a.part - b.part);
  const r = rows.sort((a, b) => (form === "house" ? Math.abs(a.width - 20) + Math.abs(a.depth - 16) - Math.abs(b.width - 20) - Math.abs(b.depth - 16) : score(a) - score(b)) || a.part - b.part)[0]; if (!r) throw new Error(`No ${form} specimen`);
  chosen.set(form, r); lineup(`kind-${String(chosen.size).padStart(2, "0")}`, r);
}
for (const mode of ["shear", "pancake", "lost-top", "burnt", "facade", "hanging"]) {
  const r = buildings.find((r) => r.footprint === config.fallSpecimens?.[mode]) ?? buildings.filter((r) => r.collapse === mode && r.sourceHeight >= (mode === "lost-top" ? 40 : 16) && r.falls.length >= 3 && r.width <= 64 && r.depth <= 64 && r.height <= (mode === "lost-top" ? 64 : 40) && r.detail === 0 && !r.special).sort((a, b) => Math.abs(a.sourceHeight - 24) * 3 + Math.abs(a.width - 40) + Math.abs(a.depth - 40) - Math.abs(b.sourceHeight - 24) * 3 - Math.abs(b.width - 40) - Math.abs(b.depth - 40) || a.part - b.part)[0]!;
  if (!r) throw new Error(`No ${mode} specimen`); lineup(`fall-${mode}`, r);
  const view = views.at(-1)!; const u = r.falls.reduce((n, f) => n + f.u, 0); const v = r.falls.reduce((n, f) => n + f.v, 0);
  view.x = centre + (u < 0 ? -46 : 46); view.z = centre + (v < 0 ? -72 : 72); view.y = 48; view.look = [centre, centre, 30]; view.fov = 64;
}
for (const form of ["hotel", "office", "warehouse", "house"]) {
  const kinds = config.specimens?.[form]?.kinds;
  const r = buildings.filter((r) => r.form === form && (!kinds || kinds.includes(r.kind)) && r.rooms.some((room) => !["rubble", "lobby"].includes(room.kind)) && r.detail === 0).sort((a, b) => score(a) - score(b) || a.part - b.part)[0]!;
  const room = r.rooms.find((room) => !["rubble", "lobby"].includes(room.kind) && (form !== "hotel" || room.points[0]!.y > r.y)) ?? r.rooms.find((room) => !["rubble", "lobby"].includes(room.kind))!; const p = room.points[1]!; const q = room.points[2]!;
  views.push({ name: `inside-${form}`, x: p.x, y: p.y + 1.65, z: p.z, look: [q.x, q.z, q.y - r.y + 1.2], fov: 85, size: [960, 600] });
  samples.push({ view: `inside-${form}`, footprint: r.footprint, kind: room.kind });
}
// The first refuge by part at twelve floors, and at sixteen.
const refugeAt = (r: RuinRecord, floors: number) => r.rooms.find((room) => room.kind === "refuge" && Math.round((room.points[0]!.y - r.y) / 4) === floors);
for (const floors of [12, 16]) {
  const refuge = buildings.filter((r) => refugeAt(r, floors)).sort((a, b) => a.part - b.part)[0];
  if (!refuge) continue;
  const gallery = refugeAt(refuge, floors)!.points[2]!; const name = floors === 12 ? "refuge" : `refuge-${floors}`;
  const refugeAngle = refuge.yaw * Math.PI / 180; const rc = Math.cos(refugeAngle); const rs = Math.sin(refugeAngle);
  views.push({ name, x: gallery.x - 2.5 * rc + 2 * rs, y: gallery.y + 1.65, z: gallery.z + 2.5 * rs + 2 * rc, look: [gallery.x + 2.8 * rc, gallery.z - 2.8 * rs, gallery.y - refuge.y + .8], fov: 100, size: [960, 600] });
  samples.push({ view: name, footprint: refuge.footprint, name: refuge.name, floors });
}
const tower = buildings.filter((r) => r.routes.length && r.height > 80).sort((a, b) => b.routes[0]!.floors - a.routes[0]!.floors || a.part - b.part)[0]!;
const stair = tower.routes[0]!; const a = stair.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a); const dir = stair.floors % 2 === 0 ? -1 : 1;
views.push({ name: "tower-high-view", x: stair.x + s * dir * 5.5, z: stair.z + c * dir * 5.5, y: stair.y + stair.floors * 4 + 1.65, look: [stair.x + s * dir * 180, stair.z + c * dir * 180, 7], fov: 85, size: [1280, 720] });
samples.push({ view: "tower-high-view", footprint: tower.footprint, floors: stair.floors });
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
if (existsSync(join(paths.folder, "street-clusters.json"))) {
  const clusters = JSON.parse(readFileSync(join(paths.folder, "street-clusters.json"), "utf8")) as { x: number; z: number; name: string; points: { x: number; y: number; z: number }[] }[];
  for (const name of ["pile-up", "slewed-bus", "fallen-crane"]) {
    const r = clusters.filter((r) => r.name === name && r.points.length).sort((a, b) => hash3(a.x, a.z, config.seed) - hash3(b.x, b.z, config.seed))[0];
    if (!r) continue;
    const p = r.points[0]!;
    views.push({ name: `street-${name}`, x: p.x, z: p.z, y: p.y + 1.7, look: [r.x, r.z, 1.2], fov: 85, size: [960, 600] });
    samples.push({ view: `street-${name}`, x: r.x, z: r.z, seed: config.seed, passage: r.points });
  }
}
if (existsSync(join(paths.folder, "roof-gardens.json"))) {
  const gardens = JSON.parse(readFileSync(join(paths.folder, "roof-gardens.json"), "utf8")) as { part: number; x: number; y: number; z: number; yaw: number }[];
  const r = gardens.filter((r) => r.y > 16).sort((a, b) => hash3(a.part, config.seed, 8) - hash3(b.part, config.seed, 8))[0] ?? gardens[0];
  if (r) {
    const a = r.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    views.push({ name: "roof-garden", x: r.x + c * 8 - s * 16, z: r.z - s * 8 - c * 16, y: r.y + 14, look: [r.x, r.z, r.y - buildings.find((b) => b.part === r.part)!.y + .3], fov: 68, size: [960, 600] });
    samples.push({ view: "roof-garden", part: r.part });
  }
}
views.push(...config.extra ?? []);
for (const v of views) {
  if (previous.some((p) => p.name === v.name)) v.baseline = `../${config.previous}/${v.name}.png`;
  Object.assign(v, config.overrides?.[String(v.name)] ?? {});
}
writeFileSync(join(paths.folder, "views.json"), JSON.stringify(views, null, 2) + "\n");
writeFileSync(join(paths.folder, "samples.json"), JSON.stringify({ seed: config.seed, lineupDistance: Math.hypot(46, 72), eyeHeight: 30, fov: 48, samples }, null, 2) + "\n");
console.log(`${views.length} views, ${samples.length} recorded selections`);
