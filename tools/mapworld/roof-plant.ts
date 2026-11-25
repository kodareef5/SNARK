// What stands on a city's flat roofs (content/street.ts, the roof plant): a static layer after the street furniture, set
// down by rules every map follows (rules/default.json "roofs"). A roof is a building's floor slab with no slab of the same
// building over it (ruins.ts, the buildings' records in the reports' buildings.json). Each kind of plant comes one to so
// many square metres of a building's roof, on roofs of a least area (a water tank on the taller only), aligned with the
// building, a share of each a ruin of itself; each stands wholly on one roof's top, `edge` metres in from its rim, clear
// of every piece already there (a parapet, a core, a roof garden) and of every reserved route, within a chunk's budget.
// Every choice is a hash of the building and the rules' seed, so a build repeats.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { STREET_PIECES, streetKind } from "../../content/street.ts";
import { binKey, hash3 } from "./raster.ts";
import { boxOf, meets, obstacleIndex, type Box } from "./ruin-obstacles.ts";
import { vocabulary } from "./ruin-vocabulary.ts";
import type { Site, StaticLayer, StaticPiece } from "./statics.ts";
import { routeCheck } from "./street-furniture.ts";

export interface Roofs {
  seed: number;
  /** Metres kept from a roof's rim, and between a piece of plant and any other piece. */
  edge: number; gap: number;
  /** Each kind: square metres of roof to one, the least roof it comes on, the most a roof has, the chance a roof has any,
   * the least height of a building that has it, and its forms by their names after "core:zzstreet_" with their weights. */
  plant: Record<string, { per: number; least: number; most: number; chance: number; tall?: number; south?: boolean; forms: [string, number][] }>;
}
export interface RoofSummary { roofs: number; placed: Record<string, number>; refused: Record<string, number>; }
/** A building as the ruins record it (ruins.ts): its pieces, from its first, its height and its turn. */
export interface RoofRecord { firstPiece: number; blocks: number; height: number; yaw: number; }

const DEG = 180 / Math.PI;
/** A roof slab's box and the cosine and sine of its turn. */
type Slab = Box & { c: number; s: number };
const FLOOR = /^core:zruin_floor(4|8|16)_/;
const SIZES = new Map(STREET_PIECES.map((p) => {
  const lo = [0, 2].map((a) => Math.min(...p.boxes.map((b) => b.at[a]! - b.half[a]!))); const hi = [0, 2].map((a) => Math.max(...p.boxes.map((b) => b.at[a]! + b.half[a]!)));
  return [p.name, { lo, hi, top: Math.max(...p.boxes.map((b) => b.at[1] + b.half[1])) }];
}));

export function placeRoofPlant(site: Site, placed: readonly StaticPiece[], records: readonly RoofRecord[], rules: Roofs, maxChunk: number): { pieces: StaticPiece[]; summary: RoofSummary } {
  const { x0, z0 } = site.ground.grid; const chunksX = site.ground.grid.sizeX / 64; const seed = rules.seed;
  const chunkOf = (x: number, z: number): number => Math.floor((z - z0) / 64) * chunksX + Math.floor((x - x0) / 64);
  const counts = new Uint32Array(chunksX * (site.ground.grid.sizeZ / 64));
  for (const p of placed) counts[chunkOf(p.x, p.z)]!++;
  const obstacles = obstacleIndex(placed); const onRoute = routeCheck(site.growthRoutes, 0.4);
  const isFloor = (p: StaticPiece): boolean => FLOOR.test(p.kind);
  const mine = new Map<number, Box[]>(); const pieces: StaticPiece[] = [];
  const summary: RoofSummary = { roofs: 0, placed: {}, refused: {} };
  const refuse = (why: string): false => { summary.refused[why] = (summary.refused[why] ?? 0) + 1; return false; };

  for (const r of records) {
    // Its slabs, and those with none of its own over them: its roofs.
    const slabs: Slab[] = placed.slice(r.firstPiece, r.firstPiece + r.blocks).filter(isFloor).map((p) => { const b = boxOf(p); const a = b.yaw / DEG; return { ...b, c: Math.cos(a), s: Math.sin(a) }; });
    if (slabs.length === 0) continue;
    const inside = (b: Slab, x: number, z: number, margin: number): boolean => {
      const dx = x - b.x; const dz = z - b.z;
      return Math.abs(dx * b.c - dz * b.s) <= b.size[0] / 2 - margin && Math.abs(dx * b.s + dz * b.c) <= b.size[2] / 2 - margin;
    };
    const roofs = slabs.filter((b) => !slabs.some((o) => o !== b && o.y > b.y + 1 && inside(o, b.x, b.z, 0)));
    if (roofs.length === 0) continue;
    summary.roofs++;
    // Where a point is on a roof: its top there, if a roof slab holds it `edge` in from that slab's own sides, or holds it
    // at all where a neighbour at the same height carries on past those sides.
    const topAt = (x: number, z: number): number => {
      let top = NaN;
      for (const b of roofs) if (inside(b, x, z, 0)) { const t = b.y + b.size[1] / 2; if (!(t <= top)) top = t; }
      if (Number.isNaN(top)) return NaN;
      for (const [ox, oz] of [[rules.edge, 0], [-rules.edge, 0], [0, rules.edge], [0, -rules.edge]] as const) {
        if (!roofs.some((b) => Math.abs(b.y + b.size[1] / 2 - top) < 0.05 && inside(b, x + ox, z + oz, 0))) return NaN;
      }
      return top;
    };
    const area = roofs.reduce((n, b) => n + b.size[0] * b.size[2], 0);
    const h = hash3(r.firstPiece, r.blocks, seed);
    for (const [kind, k] of Object.entries(rules.plant)) {
      const hk = hash3(h, kind.length * 131 + kind.charCodeAt(0), seed);
      if (area < k.least || (k.tall !== undefined && r.height < k.tall) || hash3(hk, 1, seed) / 4294967296 >= k.chance) continue;
      const want = Math.min(k.most, Math.max(1, Math.floor(area / k.per)));
      let done = 0;
      for (let t = 0; t < want * 8 && done < want; t++) {
        const ht = hash3(hk, 10 + t, seed); const slab = roofs[ht % roofs.length]!;
        const u = ((hash3(ht, 1, seed) % 1000) / 1000 - 0.5) * slab.size[0]; const v = ((hash3(ht, 2, seed) % 1000) / 1000 - 0.5) * slab.size[2];
        const a = slab.yaw / DEG; const x = slab.x + u * Math.cos(a) + v * Math.sin(a); const z = slab.z - u * Math.sin(a) + v * Math.cos(a);
        // Square with the building; a solar rack the quarter turn of it that faces most nearly south (-z).
        let yaw = r.yaw + 90 * (hash3(ht, 3, seed) % 4);
        if (k.south) yaw = [0, 90, 180, 270].map((q) => r.yaw + q).sort((p, q) => Math.abs(Math.cos(p / DEG) - 1) - Math.abs(Math.cos(q / DEG) - 1))[0]!;
        const total = k.forms.reduce((n, f) => n + f[1], 0); let at = (hash3(ht, 4, seed) / 4294967296) * total; let name = k.forms.at(-1)![0];
        for (const [f, w] of k.forms) { if (at < w) { name = f; break; } at -= w; }
        if (put(name, x, z, ((yaw % 360) + 360) % 360, topAt)) done++;
      }
    }
  }
  return { pieces, summary };

  function put(name: string, x: number, z: number, yaw: number, topAt: (x: number, z: number) => number): boolean {
    const size = SIZES.get(name); if (!size) throw new Error(`roofs.plant names ${name}, which is no street piece`);
    const a = yaw / DEG; const c = Math.cos(a); const s = Math.sin(a);
    const corners = [[size.lo[0]!, size.lo[1]!], [size.hi[0]!, size.lo[1]!], [size.hi[0]!, size.hi[1]!], [size.lo[0]!, size.hi[1]!]].map(([u, v]) => [x + u! * c + v! * s, z - u! * s + v! * c] as const);
    const tops = corners.map(([px, pz]) => topAt(px, pz));
    if (tops.some((t) => Number.isNaN(t)) || Math.max(...tops) - Math.min(...tops) > 0.05) return refuse("rim");
    const y = tops[0]!;
    const mx = (size.lo[0]! + size.hi[0]!) / 2; const mz = (size.lo[1]! + size.hi[1]!) / 2;
    const box: Box = { x: x + mx * c + mz * s, y: y + size.top / 2, z: z - mx * s + mz * c, yaw, size: [size.hi[0]! - size.lo[0]!, size.top, size.hi[1]! - size.lo[1]!] };
    if (obstacles.hits(box, rules.gap, (p) => FLOOR.test(p.kind))) return refuse("piece");
    if (onRoute(box)) return refuse("route");
    const near: Box[] = [];
    for (let bz = Math.floor(box.z / 16) - 1; bz <= Math.floor(box.z / 16) + 1; bz++) for (let bx = Math.floor(box.x / 16) - 1; bx <= Math.floor(box.x / 16) + 1; bx++) near.push(...(mine.get(binKey(bx, bz)) ?? []));
    if (near.some((o) => meets(box, o, rules.gap))) return refuse("plant");
    const chunk = chunkOf(x, z); if (counts[chunk]! >= maxChunk) return refuse("budget");
    counts[chunk]!++;
    const k = binKey(Math.floor(box.x / 16), Math.floor(box.z / 16)); if (!mine.has(k)) mine.set(k, []); mine.get(k)!.push(box);
    const kind = streetKind(name); pieces.push({ kind, x, y, z, yaw });
    summary.placed[kind] = (summary.placed[kind] ?? 0) + 1;
    return true;
  }
}

export function makeRoofPlant(site: Site, placed: readonly StaticPiece[]): StaticPiece[] {
  if (site.world.heaps !== false) return [];
  const v = vocabulary(site.source) as ReturnType<typeof vocabulary> & { roofs?: Roofs };
  if (!v.roofs) return [];
  const folder = join(site.source, "reports", site.world.ruins?.report ?? "ruins"); mkdirSync(folder, { recursive: true });
  const file = join(folder, "buildings.json"); if (!existsSync(file)) return [];
  const records = JSON.parse(readFileSync(file, "utf8")) as RoofRecord[];
  // Room is left in each chunk for the obelisks and the harbours' wrecks, which come after.
  const { pieces, summary } = placeRoofPlant(site, placed, records, v.roofs, v.budgets.maxChunk - 8);
  writeFileSync(join(folder, "roofs.json"), `${JSON.stringify({ pieces: pieces.length, ...summary }, null, 2)}\n`);
  console.log(`roof plant: ${pieces.length} pieces on ${summary.roofs} roofs, ${Object.entries(summary.placed).map(([k, n]) => `${n} ${k.slice(14)}`).join(", ")}`);
  return pieces;
}

export const ROOF_PLANT: StaticLayer = { name: "roof plant", make: makeRoofPlant };
