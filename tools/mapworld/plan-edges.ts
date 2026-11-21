// Plans of a built map's street edges from above, read only, two panels side by side for each place named:
//
//   bun tools/mapworld/plan-edges.ts <city> <places.json> <out folder> [--size 48] [--scale 16]
//
// places.json is [{ name, x, z }] in engine metres (x west, z north). Each picture is `size` metres a side at `scale`
// pixels a metre, north up and west on the left.
//
// - Left, the ground as the lit terrain draws it today: the tint of the four 2 m samples round a pixel with most of their
//   weight (world-surfaces.ts groundCover), the edge wandering a little where no sidewalk is among them (groundWander),
//   and over it the walk kit's slabs and ramps (grey, outlined white) and the curb returns (grey, outlined yellow) where
//   the map set them down.
// - Right, the same ground drawn from distances instead (roads-straight.md, option 1): at each 2 m sample the signed
//   distance to the carriageway's edge and to the sidewalk's, from the street layers (base/roads.geojson, walks.geojson)
//   and the corners the build rounds (corners.ts), held in a byte each at 1/32 m within 4 m; a pixel takes the street
//   where the distances taken between its four samples say it is inside the carriageway, then the sidewalk, then the
//   samples' own cover. The pieces are the same.
//
// On both, the true kerb lines (each road's centre line, half its width either side) are drawn thin in red.
// Nothing is written but the pictures.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { surfaceIndex } from "../../content/surfaces.ts";
import { returnMiddle, returnRadius } from "../../content/curbs.ts";
import { groundCover, groundWander, GROUND_WALK } from "../../client/core/render/world-surfaces.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { encodePng } from "../snap/png.ts";
import { planCorners, type Corner, type ReturnRules } from "./corners.ts";
import { readStreetGraph } from "./street-graph.ts";

const [city, placesFile, outDir] = process.argv.slice(2);
if (!city || !placesFile || !outDir) throw new Error("bun tools/mapworld/plan-edges.ts <city> <places.json> <out folder> [--size 48] [--scale 16]");
const option = (name: string, fallback: number): number => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const SIZE = option("size", 48), SCALE = option("scale", 16), PX = Math.round(SIZE * SCALE);
mkdirSync(outDir, { recursive: true });
const folder = join("var/mapdata", city, "current");
const info = JSON.parse(readFileSync(join(folder, "map.json"), "utf8")) as { bounds: [number, number, number, number] };
const [, south, east] = info.bounds;
const toEngine = (e: number, n: number): [number, number] => [east - e, n - south];
const places = JSON.parse(readFileSync(placesFile, "utf8")) as { name: string; x: number; z: number }[];

const map = parseMap(Bun.mmap(join("var/maps", `${city}.snmap`)), false, false);
const nx = map.dims.chunksX * 32 + 1, nz = map.dims.chunksZ * 32 + 1;
const tintAt = (i: number, j: number): number => map.tint[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!;

// The pieces near any place: slabs and ramps as boxes, returns by their arcs.
const t = map.statics;
const kit = new Map<number, [number, number]>();
t.kinds.forEach((k, i) => { if (/zwalk8g_/.test(k)) kit.set(i, [4, 1.425]); else if (/zwalk8_/.test(k)) kit.set(i, [4, 1.2]); else if (/zcurbramp/.test(k)) kit.set(i, [0.9, 1.2]); });
const returnKinds = new Set(t.kinds.flatMap((k, i) => (/^core:zzzcurb_r\d$/.test(k) ? [i] : [])));
const reach = SIZE;
const near = (x: number, z: number): boolean => places.some((p) => Math.abs(p.x - x) < reach && Math.abs(p.z - z) < reach);
const boxes: { x: number; z: number; c: number; s: number; hx: number; hz: number; ramp: boolean }[] = [];
const returns: { x: number; z: number; c: number; s: number; radius: number; m: number }[] = [];
for (let i = 0; i < t.kind.length; i++) {
  const x = t.x[i]!, z = t.z[i]!;
  if (!near(x, z)) continue;
  const a = (t.yaw[i]! / 65536) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
  const half = kit.get(t.kind[i]!);
  if (half) boxes.push({ x, z, c, s, hx: half[0], hz: half[1], ramp: half[0] < 1 });
  else if (returnKinds.has(t.kind[i]!)) { const radius = returnRadius(t.kinds[t.kind[i]!]!); returns.push({ x, z, c, s, radius, m: returnMiddle(radius)[0] }); }
}
/** 0 off the pieces, 1 inside one, 2 on a slab's or ramp's outline, 3 on a return's. */
const onPiece = (x: number, z: number, edge: number): number => {
  let inside = 0;
  for (const b of boxes) {
    const dx = x - b.x, dz = z - b.z, u = dx * b.c - dz * b.s, v = dx * b.s + dz * b.c;
    if (Math.abs(u) <= b.hx && Math.abs(v) <= b.hz) { if (Math.abs(u) > b.hx - edge || Math.abs(v) > b.hz - edge) return 2; inside = 1; }
  }
  for (const r of returns) {
    // In the piece's corner frame (corners.ts onReturn): the arc's centre at (radius, radius), the walk from the face 2.4 m back.
    const dx = x - r.x, dz = z - r.z, lx = dx * r.c - dz * r.s + r.m, lz = dx * r.s + dz * r.c + r.m;
    const ex = lx - r.radius, ez = lz - r.radius, d = Math.hypot(ex, ez);
    if (ex <= 0 && ez <= 0 && d <= r.radius + 0.45 && d >= r.radius - 2.4) { if (d > r.radius + 0.45 - edge || d < r.radius - 2.4 + edge || d > r.radius - edge && d < r.radius + edge) return 3; inside = 1; }
  }
  return inside;
};

// The street layers near the places, as segments in engine metres.
type Seg = { ax: number; az: number; bx: number; bz: number; half: number };
const segsOf = (file: string, keep: (p: Record<string, unknown>) => number | null): Seg[] => {
  const out: Seg[] = [];
  for (const f of (JSON.parse(readFileSync(join(folder, "base", file), "utf8")) as { features: { geometry: { type: string; coordinates: number[][] | number[][][] }; properties: Record<string, unknown> }[] }).features) {
    const half = keep(f.properties);
    if (half === null) continue;
    const runs = f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]];
    for (const run of runs) for (let i = 1; i < run.length; i++) {
      const [ax, az] = toEngine(run[i - 1]![0]!, run[i - 1]![1]!), [bx, bz] = toEngine(run[i]![0]!, run[i]![1]!);
      if (near(ax, az) || near(bx, bz) || near((ax + bx) / 2, (az + bz) / 2)) out.push({ ax, az, bx, bz, half });
    }
  }
  return out;
};
const roads = segsOf("roads.geojson", (p) => (p.tunnel === true || p.bridge === true ? null : Number(p.width_m ?? 8) / 2));
const walks = segsOf("walks.geojson", (p) => (p.kind === "sidewalk" ? Number(p.width_m ?? 2.5) / 2 : null));
const toSeg = (x: number, z: number, s: Seg): number => {
  const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2)) : 0;
  return Math.hypot(x - s.ax - ex * k, z - s.az - ez * k);
};
// The corners the build rounds, as it plans them (rules/default.json street.walks.returns).
const rules = (JSON.parse(readFileSync("tools/mapworld/rules/default.json", "utf8")) as { street: { walks: { returns: ReturnRules } } }).street.walks.returns;
const corners = planCorners(readStreetGraph(folder, toEngine), rules).filter((c) => near(c.cx, c.cz));
const inWedge = (c: Corner, x: number, z: number): number => {
  const vx = x - c.cx, vz = z - c.cz, turn = c.ax * c.bz - c.az * c.bx;
  const s1 = c.ax * vz - c.az * vx, s2 = vx * c.bz - vz * c.bx;
  return (turn >= 0 ? s1 >= 0 && s2 >= 0 : s1 <= 0 && s2 <= 0) ? Math.hypot(vx, vz) : -1;
};
/** Signed metres to the carriageway's edge, less than 0 inside it, and to the sidewalk's, as a byte holds them. */
const held = (d: number): number => Math.max(-127, Math.min(127, Math.round(d * 32))) / 32;
const distances = (x: number, z: number): [number, number] => {
  let road = Infinity, walk = Infinity;
  for (const s of roads) road = Math.min(road, toSeg(x, z, s) - s.half);
  for (const s of walks) walk = Math.min(walk, toSeg(x, z, s) - s.half);
  for (const c of corners) {
    const r = inWedge(c, x, z);
    if (r < 0 || r > c.reach + 1) continue;
    // Outside the arc and short of the kerbs' corner the corner is street; 0.5 to 3 m behind its face, sidewalk.
    road = Math.min(road, c.radius - r);
    walk = Math.min(walk, Math.abs(r - (c.radius - 1.75)) - 1.25);
  }
  return [held(road), held(walk)];
};

const FINISH: Record<number, [number, number, number]> = { 6: [58, 58, 62], 16: [208, 205, 194], 7: [172, 157, 137], 0: [92, 138, 70], 5: [150, 140, 120] };
const colourOf = (tint: number): [number, number, number] => FINISH[surfaceIndex(tint, true)] ?? [140, 115, 95];
const ASPHALT = 6, PIECE: [number, number, number] = [168, 172, 176];
const wander = new Float64Array(2);

for (const place of places) {
  const W = PX * 2 + 8, px = new Uint8Array(W * PX * 4);
  // The 2 m samples the panel needs, and their two distances.
  const i0 = Math.floor((place.x - SIZE / 2) / 2) - 1, j0 = Math.floor((place.z - SIZE / 2) / 2) - 1, n = SIZE / 2 + 4;
  const dist = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const [r, w] = distances((i0 + i) * 2, (j0 + j) * 2); dist[(j * n + i) * 2] = r; dist[(j * n + i) * 2 + 1] = w; }
  const put = (u: number, v: number, rgb: readonly number[]): void => { const k = (v * W + u) * 4; px[k] = rgb[0]!; px[k + 1] = rgb[1]!; px[k + 2] = rgb[2]!; px[k + 3] = 255; };
  for (let v = 0; v < PX; v++) for (let u = 0; u < PX; u++) {
    const x = place.x + SIZE / 2 - (u + 0.5) / SCALE, z = place.z + SIZE / 2 - (v + 0.5) / SCALE;
    // Today: the cover the terrain shader picks.
    let fi = x / 2, fj = z / 2, i = Math.floor(fi), j = Math.floor(fj);
    const four = (a: number, b: number): number[] => [tintAt(a, b), tintAt(a + 1, b), tintAt(a, b + 1), tintAt(a + 1, b + 1)];
    let q = four(i, j);
    if (!q.some((k) => surfaceIndex(k, true) === GROUND_WALK)) {
      groundWander(x, z, 1 / SCALE, wander);
      fi = (x + wander[0]!) / 2; fj = (z + wander[1]!) / 2; i = Math.floor(fi); j = Math.floor(fj); q = four(i, j);
    }
    const today = groundCover(q[0]!, q[1]!, q[2]!, q[3]!, fi - i, fj - j);
    // From distances: between the four samples' distances, the street, then the walk, then the samples' own cover.
    const gi = x / 2 - i0, gj = z / 2 - j0, a = Math.floor(gi), b = Math.floor(gj), fx = gi - a, fz = gj - b;
    const lerp = (k: number): number => {
      const at = (p: number, r: number): number => dist[((b + r) * n + a + p) * 2 + k]!;
      return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fz) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fz;
    };
    // Off both, the samples' own cover with the street's and the walk's tints in it taken as the other tint most among them.
    const ci = Math.floor(x / 2), cj = Math.floor(z / 2), raw = four(ci, cj);
    const paved = (k: number): boolean => surfaceIndex(k, true) === ASPHALT || surfaceIndex(k, true) === GROUND_WALK;
    const others = raw.filter((k) => !paved(k));
    const most = others.sort((p, r) => others.filter((k) => k === r).length - others.filter((k) => k === p).length)[0];
    const kept = most === undefined ? raw : raw.map((k) => (paved(k) ? most : k));
    const rest = most === undefined ? colourOf(today) : colourOf(groundCover(kept[0]!, kept[1]!, kept[2]!, kept[3]!, x / 2 - ci, z / 2 - cj));
    const drawn = lerp(0) < 0 ? FINISH[ASPHALT]! : lerp(1) < 0 ? FINISH[GROUND_WALK]! : rest;
    const piece = onPiece(x, z, 1.2 / SCALE);
    for (const [panel, ground] of [[0, colourOf(today)], [1, drawn]] as const) {
      const rgb = piece === 2 ? [255, 255, 255] : piece === 3 ? [250, 220, 40] : piece === 1 ? PIECE : ground;
      put(u + panel * (PX + 8), v, rgb);
    }
  }
  // The true kerb lines, thin, on both panels.
  for (const s of roads) {
    const l = Math.hypot(s.bx - s.ax, s.bz - s.az); if (l <= 0) continue;
    const ux = (s.bx - s.ax) / l, uz = (s.bz - s.az) / l;
    for (let d = 0; d <= l; d += 0.5 / SCALE) for (const side of [1, -1]) {
      const x = s.ax + ux * d - uz * s.half * side, z = s.az + uz * d + ux * s.half * side;
      if (roads.some((o) => o !== s && toSeg(x, z, o) < o.half - 0.05)) continue;
      const u = Math.floor((place.x + SIZE / 2 - x) * SCALE), v = Math.floor((place.z + SIZE / 2 - z) * SCALE);
      if (u >= 0 && v >= 0 && u < PX && v < PX) for (const panel of [0, 1]) put(u + panel * (PX + 8), v, [230, 40, 40]);
    }
  }
  writeFileSync(join(outDir, `${place.name}-plan.png`), encodePng(W, PX, px));
  console.log(`${place.name}: ${boxes.length} slabs and ramps and ${returns.length} returns near the places, ${roads.length} road and ${walks.length} walk segments, ${corners.length} corners`);
}
