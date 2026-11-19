// What stands in a city's streets besides its buildings and cars (content/street.ts): a static layer after the ruins,
// set down by rules every map follows (rules/default.json "furniture", which a city's vocabulary may change), from the
// roads' centre lines and classes (base/roads.geojson, as street-cars.ts reads them), the buildings' uses and the ground.
// Every choice is a hash of where it is and the rules' seed, so a build repeats.
//
// - Junctions: where three ways meet, or two streets at a corner. Where the larger streets meet, a signal for each of
//   their approaches, across the junction from the traffic it faces, its arm over the lanes that traffic goes on into;
//   elsewhere a stop sign on the right of each approach of the lesser street, a street-name sign at a corner, and now and
//   then a pedestrian crossing sign on the larger street's approaches. Corners of shops and offices get bins, mailboxes,
//   newspaper boxes and bollards; others fewer.
// - One-way roads: the two ways of a street the data draws twice 6 to 35 m apart (its traffic keeps the other on its
//   left), and the ramps, which run off a carriageway ahead of its traffic or onto it with it. Where one meets a two-way
//   street, ONE WAY at the corners beside the way it leaves by, DO NOT ENTER on each way it comes in by.
// - A DEAD END sign at the mouth of a street that ends without meeting another; NO PARKING signs short of some corners.
// - Along each street, on the verge side of the kerb line: lamps at a spacing by its class, on both sides or staggered;
//   wooden utility poles down one side of the lesser streets of residential districts; hydrants; parking meters in runs
//   before shops; bus shelters, or a bench and a bin, along the avenues; speed limit signs at the limit each class posts,
//   and evacuation route signs on the larger ways; guard rails where a highway's edge drops or meets water; chain-link fence along the street line of open lots
//   and yards; billboards set back from the largest roads.
//
// Where the ruins laid a walk along the street (ruins.ts, makeWalks), a piece stands on the walk's top at its setback from
// the curb's face; the walk's ramps, drains and boxes it keeps clear of as of any piece. None stands where a lane runs, on a reserved route (a way to a door, a room's walk, a stair, a car's door room), in a
// ruin's piece or another of these, over water or a building's floor, or past a chunk's budget. Trees come after the
// statics and are taken out where they would stand in one (ruin-growth.ts).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { STREET_PIECES, streetKind } from "../../content/street.ts";
import { hullPoint } from "../../shared/world/convex.ts";
import { S } from "./ground.ts";
import { binKey, hash3 } from "./raster.ts";
import { boxOf, meets, obstacleIndex, type Box } from "./ruin-obstacles.ts";
import { vocabulary } from "./ruin-vocabulary.ts";
import type { Site, StaticLayer, StaticPiece } from "./statics.ts";
import { nodeKey, streetGraph, type Marked, type Segment } from "./street-graph.ts";

/** A rule's kinds by their names after "core:zzstreet_", with their weights. */
type Forms = readonly (readonly [string, number])[];
export interface Furniture {
  seed: number;
  /** The rules' name for each TIGER class (MTFCC) of street; a class not named has none of these. */
  classes: Record<string, string>;
  forms: Record<string, Forms>;
  /** Metres between a lamp and the next along each class, which have them on both sides or one at a time. `set` and the
   * others' are metres from the kerb's line to a post's middle. `lit`: the share of each class's standing lamps that still
   * work, none in a district of a style `dark` names. */
  lamps: { spacing: Record<string, number>; both: string[]; set: number; lit: Record<string, number>; dark: string[] };
  /** Metres from the kerbs to a signal's pole and a street-name sign at a corner, and to a stop sign's post; `past`, how much
   * further back along the street a corner's box goes where a walk's curb ramp stands in its place; `seek`, how far back
   * along its way from its first place a stop or yield sign may go to find room; `room`, how much of its way behind that
   * place the classes' rule needs before it puts a stop there, a car's length. */
  junctions: { major: string[]; minor: string[]; signalCross: number; signal: number; stop: number; name: number; stopBack: number; standing: number; past: number; marked: number; seek: number; room: number };
  poles: { classes: string[]; styles: string[]; spacing: number; set: number };
  hydrants: { classes: string[]; spacing: number; first: number; set: number };
  /** Runs of `run` meters `every` metres apart, a block of `block` metres at a time, before buildings of `uses`. */
  meters: { classes: string[]; uses: string[]; tall: number; block: number; chance: number; every: number; run: [number, number]; set: number };
  /** A shelter's open front `set` metres from the kerb; a bench's middle `bench`. */
  shelters: { classes: string[]; spacing: number; set: number; bench: number; shelter: number };
  /** Chances a corner gets each, before buildings of `uses`, and as many times them before any other. */
  corners: { uses: string[]; other: number; bin: number; mailbox: number; news: number; bollards: number; set: number };
  /** Metres between speed limit signs along each class, which limit's sign each posts, and the share of the larger ways'
   * that are evacuation route signs instead. */
  signs: { spacing: Record<string, number>; limits: Record<string, string>; evacuation: Record<string, number>; set: number };
  /** The one-way roads and the signs the network's shape calls for (the header). `apart`: metres between a street's two
   * carriageways; `share`: how much of a line's length runs beside its other. `back`s are metres past a junction's ways. */
  regulations: {
    divided: { classes: string[]; apart: [number, number]; share: number };
    oneway: { chance: number; set: number }; noentry: { set: number; back: number };
    /** `marked`: the crossing types (crossing=*) that take the sign where the data says. */
    crossing: { chance: number; set: number; back: number; marked: string[] };
    deadend: { classes: string[]; least: number; reach: number; set: number; back: number };
    noparking: { chance: Record<string, number>; set: number; back: number; angle: number; every: number };
  };
  rails: { classes: string[]; set: number; drop: number; water: number };
  /** Fence along the street line of an open lot or a yard at least `least` metres long, a 3 m run at a time. */
  fences: { classes: string[]; set: number; depth: number; least: number; yard: number; open: number; gap: number };
  billboards: { classes: string[]; spacing: number; set: [number, number]; chance: number };
  /** A pay station for each lot of at least `least` stalls, at the head of one of the `tries` stalls nearest its middle. */
  paystations?: { least: number; tries: number; set: number };
  /** Stripes laid on a crossing: the forms of each length of stripes, in metres, and how far in from each kerb they stop;
   * `bare`, the crossing types (crossing=*) the data says are not painted; `fresh`, the classes whose crossings are kept
   * painted, as a signalled crossing's are. */
  stripes?: { pieces: Record<string, number>; inset: number; bare: string[]; fresh: string[] };
  /** Metres kept clear: of a lane's edge, a reserved route's, any piece's; between two of these; of the map's edge. */
  /** `inside` is how far inside a road's edge a post may stand where it fits nowhere else. */
  clear: { road: number; inside: number; route: number; piece: number; between: number; edge: number; junction: number; rise: number; crossing: number };
}

/** What a layer makes, and why candidates were left out, by rule. */
/**
 * `mapped`: the controls the data maps, by kind: how many have a sign or a signal head of their own standing (`used`),
 * and for each of the rest why: `signal` where a signal at its junction holds its traffic, `nothing` where it governs no
 * piece drawn, `way` where its way gives no room to stand by, else what most of its places met.
 */
export interface FurnitureSummary { placed: Record<string, number>; byRule: Record<string, number>; refused: Record<string, Record<string, number>>; mapped?: Record<string, { mapped: number; used: number; rest: Record<string, number> }>; }

interface Part { lo: [number, number, number]; hi: [number, number, number] }
/** A way out of a junction: which way it leaves, the key of the point it leads to, and +1 where that is the way its line is drawn. */
interface Arm { dx: number; dz: number; half: number; cls: string; line: number; to: number; sense: number }
interface Junction { x: number; z: number; arms: Arm[]; reach: number }

const DEG = 180 / Math.PI;
/** Metres up to which a piece is its foot: what a walker or a car meets. */
const FOOT = 2.2;
/** The yaw of a piece whose +Z looks along (dx, dz). */
const yawOf = (dx: number, dz: number): number => ((Math.atan2(dx, dz) * DEG) % 360 + 360) % 360;
const pick = (rows: Forms, h: number): string => {
  const total = rows.reduce((n, r) => n + r[1], 0); let at = (h / 4294967296) * total;
  for (const [name, weight] of rows) { if (at < weight) return name; at -= weight; }
  return rows.at(-1)![0];
};
const chance = (h: number, p: number): boolean => h / 4294967296 < p;

/** Each piece's parts as boxes in its own frame (a tilted part as the box round it), and the box round its parts within 2.2 m of the ground. */
const PARTS = new Map(STREET_PIECES.map((p) => {
  const parts: Part[] = p.boxes.map((b) => ({ lo: [b.at[0] - b.half[0], b.at[1] - b.half[1], b.at[2] - b.half[2]], hi: [b.at[0] + b.half[0], b.at[1] + b.half[1], b.at[2] + b.half[2]] }));
  for (const h of p.hulls ?? []) {
    const points = h.corners.map((c) => hullPoint(c, h.sixty === true));
    parts.push({ lo: [0, 1, 2].map((a) => Math.min(...points.map((q) => q[a]!))) as Part["lo"], hi: [0, 1, 2].map((a) => Math.max(...points.map((q) => q[a]!))) as Part["hi"] });
  }
  // Its foot: what lies under 2.2 m, a tilted part cut there, as a body or a car meets it.
  const points: number[][] = [];
  for (const b of p.boxes) if (b.at[1] - b.half[1] < FOOT) for (const dx of [-1, 1]) for (const dz of [-1, 1]) points.push([b.at[0] + dx * b.half[0], Math.min(FOOT, b.at[1] + b.half[1]), b.at[2] + dz * b.half[2]]);
  for (const h of p.hulls ?? []) {
    const corners = h.corners.map((c) => hullPoint(c, h.sixty === true));
    for (const c of corners) if (c[1] <= FOOT) points.push(c);
    for (const a of corners) for (const b of corners) if (a[1] < FOOT && b[1] > FOOT) { const t = (FOOT - a[1]) / (b[1] - a[1]); points.push([a[0] + (b[0] - a[0]) * t, FOOT, a[2] + (b[2] - a[2]) * t]); }
  }
  const foot: Part = { lo: [Math.min(...points.map((q) => q[0]!)), 0, Math.min(...points.map((q) => q[2]!))], hi: [Math.max(...points.map((q) => q[0]!)), Math.max(...points.map((q) => q[1]!)), Math.max(...points.map((q) => q[2]!))] };
  return [p.name, { parts, foot }];
}));

/** A part of a piece standing at (x, y, z) turned `yaw` as a box in the world. */
const worldBox = (q: Part, x: number, y: number, z: number, yaw: number): Box => {
  const a = yaw / DEG; const c = Math.cos(a); const s = Math.sin(a);
  const mx = (q.lo[0] + q.hi[0]) / 2; const mz = (q.lo[2] + q.hi[2]) / 2;
  return { x: x + mx * c + mz * s, y: y + (q.lo[1] + q.hi[1]) / 2, z: z - mx * s + mz * c, yaw, size: [q.hi[0] - q.lo[0], q.hi[1] - q.lo[1], q.hi[2] - q.lo[2]] };
};
/** The four corners of a box's footprint and its middle, in the world. */
const footprint = (b: Box): [number, number][] => {
  const a = b.yaw / DEG; const c = Math.cos(a); const s = Math.sin(a); const hx = b.size[0] / 2; const hz = b.size[2] / 2;
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, 0]].map(([u, v]) => [b.x + u! * c + v! * s, b.z - u! * s + v! * c]);
};

/** Ground no piece of these stands on: water, a building's floor and walls, heaps, containers and decks. */
const BARRED = new Set<number>([S.CHANNEL, S.DEEP, S.FLAT, S.SHALLOW, S.POOL, S.HEAP, S.SPILL, S.WALL, S.FLOOR, S.DECK, S.CONTAINER]);

/** A walk's slab, with or without its gutter (not its ramps, drains or boxes). */
const isWalk = (p: StaticPiece): boolean => /^core:zruin_zwalk8g?_/.test(p.kind);

/** A way kept clear besides the site's reserved routes: its points and its width. */
export type Reserved = Site["growthRoutes"][number];

/**
 * Whether a box meets a reserved route (a way to a door, a room's walk, a stair, a car's door room): the route's stretch,
 * grown by its half width and `margin`, crosses the box's footprint, the box within half a metre below the route to 2.5 m
 * above it. Routes in 64 m bins, as street-cars.ts keeps a parked car off them.
 */
export function routeCheck(reserved: readonly Reserved[], margin: number): (b: Box) => boolean {
  const routes = reserved.flatMap((r) => r.points.slice(1).map((b, i) => ({ a: r.points[i]!, b, width: r.width })));
  const routeBins = new Map<number, typeof routes>();
  for (const r of routes) for (let z = Math.floor((Math.min(r.a.z, r.b.z) - r.width) / 64); z <= Math.floor((Math.max(r.a.z, r.b.z) + r.width) / 64); z++) for (let x = Math.floor((Math.min(r.a.x, r.b.x) - r.width) / 64); x <= Math.floor((Math.max(r.a.x, r.b.x) + r.width) / 64); x++) {
    const k = binKey(x, z); if (!routeBins.has(k)) routeBins.set(k, []); routeBins.get(k)!.push(r);
  }
  return (b: Box): boolean => {
    const reach = Math.hypot(b.size[0], b.size[2]) / 2 + 8; const near = new Set<(typeof routes)[number]>();
    for (let bz = Math.floor((b.z - reach) / 64); bz <= Math.floor((b.z + reach) / 64); bz++) for (let bx = Math.floor((b.x - reach) / 64); bx <= Math.floor((b.x + reach) / 64); bx++) for (const r of routeBins.get(binKey(bx, bz)) ?? []) near.add(r);
    const a = b.yaw / DEG; const c = Math.cos(a); const s = Math.sin(a);
    for (const r of near) {
      if (Math.min(r.a.y, r.b.y) - 0.5 > b.y + b.size[1] / 2 || Math.max(r.a.y, r.b.y) + 2.5 < b.y - b.size[1] / 2) continue;
      // The route's stretch in the box's frame, the box grown by the route's half width: does the stretch cross it?
      const local = (p: { x: number; z: number }): [number, number] => [(p.x - b.x) * c - (p.z - b.z) * s, (p.x - b.x) * s + (p.z - b.z) * c];
      const p = local(r.a); const q = local(r.b); const half = [b.size[0] / 2 + r.width / 2 + margin, b.size[2] / 2 + r.width / 2 + margin];
      let enter = 0; let leave = 1; let misses = false;
      for (let axis = 0; axis < 2 && !misses; axis++) {
        const delta = q[axis]! - p[axis]!;
        if (Math.abs(delta) < 1e-8) misses = Math.abs(p[axis]!) >= half[axis]!;
        else { const t0 = (-half[axis]! - p[axis]!) / delta; const t1 = (half[axis]! - p[axis]!) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
      }
      if (!misses && enter <= leave) return true;
    }
    return false;
  };
}

export function placeFurniture(site: Site, placed: readonly StaticPiece[], rules: Furniture, maxChunk: number, uses: ReadonlyMap<number, string> = new Map(), reserved: readonly Reserved[] = []): { pieces: StaticPiece[]; summary: FurnitureSummary } {
  const { ground } = site; const { nx, nz, x0, z0, x1, z1 } = ground.grid; const chunksX = ground.grid.sizeX / 64;
  const sample = (x: number, z: number): number => Math.max(0, Math.min(nz - 1, Math.round((z1 - z) / 2))) * nx + Math.max(0, Math.min(nx - 1, Math.round((x1 - x) / 2)));
  const { clear } = rules; const seed = rules.seed;
  const graph = streetGraph(site);
  const segments: Segment[] = graph.segments;
  const classOf = (s: { mtfcc: string }): string | undefined => rules.classes[s.mtfcc];
  // Every road's stretches in 16 m bins, to keep the lanes clear of every way, named or not.
  const laneBins = new Map<number, Segment[]>();
  for (const s of segments) {
    const reach = s.half + 2; const lx = Math.min(s.ax, s.bx) - reach; const hx = Math.max(s.ax, s.bx) + reach; const lz = Math.min(s.az, s.bz) - reach; const hz = Math.max(s.az, s.bz) + reach;
    for (let bz = Math.floor(lz / 16); bz <= Math.floor(hz / 16); bz++) for (let bx = Math.floor(lx / 16); bx <= Math.floor(hx / 16); bx++) {
      const k = binKey(bx, bz); if (!laneBins.has(k)) laneBins.set(k, []); laneBins.get(k)!.push(s);
    }
  }
  const inLane = (x: number, z: number, road: number): boolean => {
    for (const s of laneBins.get(binKey(Math.floor(x / 16), Math.floor(z / 16))) ?? []) {
      const ex = s.bx - s.ax; const ez = s.bz - s.az; const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (ex * ex + ez * ez)));
      if (Math.hypot(x - s.ax - ex * t, z - s.az - ez * t) < s.half + road) return true;
    }
    return false;
  };
  const onRoute = routeCheck([...site.growthRoutes, ...reserved], clear.route);
  const obstacles = obstacleIndex(placed);
  // The walks, which a piece stands on rather than keeps clear of: by 16 m bins, as boxes.
  const walkBins = new Map<number, Box[]>();
  for (const p of placed) {
    if (!isWalk(p)) continue;
    const b = boxOf(p); const k = binKey(Math.floor(b.x / 16), Math.floor(b.z / 16));
    if (!walkBins.has(k)) walkBins.set(k, []); walkBins.get(k)!.push(b);
  }
  /** The top of a walk at (x, z), or -Infinity where none is. */
  const walkTop = (x: number, z: number): number => {
    let top = -Infinity;
    for (let bz = Math.floor(z / 16) - 1; bz <= Math.floor(z / 16) + 1; bz++) for (let bx = Math.floor(x / 16) - 1; bx <= Math.floor(x / 16) + 1; bx++) {
      for (const b of walkBins.get(binKey(bx, bz)) ?? []) {
        const a = b.yaw / DEG; const c = Math.cos(a); const sn = Math.sin(a); const dx = x - b.x; const dz = z - b.z;
        if (Math.abs(dx * c - dz * sn) <= b.size[0] / 2 && Math.abs(dx * sn + dz * c) <= b.size[2] / 2) top = Math.max(top, b.y + b.size[1] / 2);
      }
    }
    return top;
  };
  const counts = new Uint32Array(chunksX * (ground.grid.sizeZ / 64));
  const chunkOf = (x: number, z: number): number => Math.floor((z - z0) / 64) * chunksX + Math.floor((x - x0) / 64);
  for (const p of placed) counts[chunkOf(p.x, p.z)]!++;
  const mine = new Map<number, Box[]>();
  const pieces: StaticPiece[] = [];
  const summary: FurnitureSummary = { placed: {}, byRule: {}, refused: {} };
  let quiet = false; let lastWhy = "";
  const refuse = (rule: string, why: string): false => { lastWhy = why; if (!quiet) { const r = (summary.refused[rule] ??= {}); r[why] = (r[why] ?? 0) + 1; } return false; };

  /**
   * Sets the piece down if every rule allows it, on the lowest ground under its foot; says whether it did. Its foot keeps
   * `road` metres off every road's edge (less than none: that far inside it, where no lane runs).
   */
  const put = (rule: string, name: string, x: number, z: number, yaw: number, between = clear.between, road = clear.road): boolean => {
    const shape = PARTS.get(name); if (!shape) throw new Error(`furniture.forms names ${name}, which is no street piece`);
    const foot = worldBox(shape.foot, x, 0, z, yaw); const corners = footprint(foot);
    if (corners.some(([px, pz]) => Math.min(px - x0, pz - z0, x1 - px, z1 - pz) < clear.edge)) return refuse(rule, "edge");
    if (corners.some(([px, pz]) => inLane(px, pz, road))) return refuse(rule, "lane");
    if (corners.some(([px, pz]) => graph.onCrossing(px, pz, clear.crossing))) return refuse(rule, "crossing");
    // On a walk wherever it touches one, on the lowest ground under it elsewhere.
    const tops = corners.map(([px, pz]) => walkTop(px, pz)); const walk = Math.max(...tops);
    const heights = corners.map(([px, pz], i) => Math.max(site.groundAt(px, pz), tops[i]!));
    if (corners.some(([px, pz]) => BARRED.has(ground.surface[sample(px, pz)]!)) || Math.min(...heights) < 0.3) return refuse(rule, "ground");
    if (Math.max(...heights) - Math.min(...heights) > clear.rise) return refuse(rule, "slope");
    const y = walk > -Infinity ? Math.max(walk, Math.min(...heights)) : Math.min(...heights);
    const boxes = shape.parts.map((q) => worldBox(q, x, y, z, yaw));
    if (boxes.some((b) => obstacles.hits(b, clear.piece, isWalk))) return refuse(rule, "piece");
    if (onRoute({ ...foot, y: y + foot.size[1] / 2 })) return refuse(rule, "route");
    const near = new Set<Box>();
    for (const b of boxes) for (let bz = Math.floor((b.z - 12) / 16); bz <= Math.floor((b.z + 12) / 16); bz++) for (let bx = Math.floor((b.x - 12) / 16); bx <= Math.floor((b.x + 12) / 16); bx++) for (const o of mine.get(binKey(bx, bz)) ?? []) near.add(o);
    if (boxes.some((b) => [...near].some((o) => meets(b, o, between)))) return refuse(rule, "furniture");
    const chunk = chunkOf(x, z); if (counts[chunk]! >= maxChunk) return refuse(rule, "budget");
    counts[chunk]!++;
    for (const b of boxes) { const k = binKey(Math.floor(b.x / 16), Math.floor(b.z / 16)); if (!mine.has(k)) mine.set(k, []); mine.get(k)!.push(b); }
    const kind = streetKind(name);
    pieces.push({ kind, x, y, z, yaw });
    summary.placed[kind] = (summary.placed[kind] ?? 0) + 1; summary.byRule[rule] = (summary.byRule[rule] ?? 0) + 1;
    return true;
  };
  /**
   * A post or a box at the kerb: tried at its rule's setback, then nearer the kerb, and last just inside the road's edge
   * where no lane runs, as downtown, where a building's face stands at the street's edge. `at` gives the place and yaw
   * for a setback from the kerb's line; `further`, places to try at the same setbacks before that last resort (a stop
   * sign further back, past a walk's curb ramp).
   */
  const putOut = (rule: string, name: string, set: number, at: (set: number) => [number, number, number] | null, ...further: ((set: number) => [number, number, number] | null)[]): boolean => {
    const tries: [number, number, (set: number) => [number, number, number] | null][] = [];
    for (const s of set > 0.45 ? [set, 0.45] : [set]) for (const f of [at, ...further]) tries.push([s, clear.road, f]);
    tries.push([-0.1, -clear.inside, at]);
    for (let k = 0; k < tries.length; k++) {
      const p = tries[k]![2](tries[k]![0]); quiet = k < tries.length - 1;
      const done = p !== null && put(rule, name, p[0], p[1], p[2], clear.between, tries[k]![1]);
      quiet = false; if (done) return true;
    }
    return false;
  };
  const form = (rule: string, h: number): string => { const rows = rules.forms[rule]; if (!rows?.length) throw new Error(`furniture.forms has no ${rule}`); return pick(rows, h); };
  /**
   * A control's sign or pole at the first of its places that takes it, each [x, z, yaw, metres off the road's edge].
   * Where none does, it is refused once, for what most of its places met, or `way` where its way gave it none.
   */
  const putFirst = (rule: string, name: string, places: readonly (readonly [number, number, number, number])[]): string | null => {
    const met = new Map<string, number>();
    quiet = true;
    for (const [x, z, yaw, road] of places) {
      if (put(rule, name, x, z, yaw, clear.between, road)) { quiet = false; return null; }
      met.set(lastWhy, (met.get(lastWhy) ?? 0) + 1);
    }
    quiet = false;
    const why = [...met].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "way";
    refuse(rule, why);
    return why;
  };

  // Each line's runs of points as the data draws them, to walk a street from a point along its real line.
  const runs = new Map<number, [number, number][][]>();
  for (const s of segments) {
    let rs = runs.get(s.line); if (!rs) runs.set(s.line, (rs = []));
    const last = rs.at(-1)?.at(-1);
    if (last && last[0] === s.ax && last[1] === s.az) rs.at(-1)!.push([s.bx, s.bz]); else rs.push([[s.ax, s.az], [s.bx, s.bz]]);
  }
  /** The run of a line holding the node `key` with a point after it going `sense`, and the node's place in it. */
  const runAt = (line: number, key: number, sense: number): [[number, number][], number] | null => {
    for (const pts of runs.get(line) ?? []) for (let k = 0; k < pts.length; k++) if (k + sense >= 0 && k + sense < pts.length && nodeKey(pts[k]![0], pts[k]![1]) === key) return [pts, k];
    return null;
  };
  /** A place on a street, the way it runs there, and the half width of its piece. */
  interface Stand { x: number; z: number; dx: number; dz: number; half: number }
  /**
   * Where the street is `d` metres on from (x, z), which lies on the stretch of a line's run from point i toward point
   * i + sense, and which way it runs there: on through a node where only two ways meet (a way's tags change there). Short
   * of that, the node it ends at (a junction or a dead end) and how far that was.
   */
  const trace = (line: number, pts: [number, number][], i: number, sense: number, x: number, z: number, d: number): Stand | { end: number; node: ReturnType<typeof graph.nodeAt> } => {
    let walked = 0;
    for (let hops = 0; hops < 512; hops++) {
      const j = i + sense;
      if (j < 0 || j >= pts.length) {
        const n = graph.nodeAt(x, z);
        if (!n || n.ways.length !== 2) return { end: walked, node: n };
        const [px, pz] = pts[i - sense]!; const ix = x - px; const iz = z - pz;
        const w = n.ways[0]!.dx * ix + n.ways[0]!.dz * iz > n.ways[1]!.dx * ix + n.ways[1]!.dz * iz ? n.ways[0]! : n.ways[1]!;
        const at = runAt(w.line, n.key, w.sense); if (!at) return { end: walked, node: n };
        [pts, i] = at; line = w.line; sense = w.sense; [x, z] = pts[i]!;
        continue;
      }
      const [bx, bz] = pts[j]!; const l = Math.hypot(bx - x, bz - z);
      if (l > 1e-6) {
        if (d <= l) return { x: x + ((bx - x) * d) / l, z: z + ((bz - z) * d) / l, dx: (bx - x) / l, dz: (bz - z) / l, half: graph.pieces[line]!.half };
        d -= l; walked += l;
      }
      x = bx; z = bz; i = j;
      if (j < pts.length - 1) { const n = graph.nodeAt(x, z); if (n && n.ways.length >= 3) return { end: walked, node: n }; }
    }
    return { end: walked, node: undefined };
  };
  const isStand = (s: ReturnType<typeof trace>): s is Stand => "dx" in s;
  /** Walking out of a junction (or a node) along one of its ways. */
  const outOf = (j: { x: number; z: number }, a: { line: number; sense: number }, d: number): ReturnType<typeof trace> => {
    const at = runAt(a.line, nodeKey(j.x, j.z), a.sense); if (!at) return { end: 0, node: undefined };
    return trace(a.line, at[0], at[1], a.sense, at[0][at[1]]![0], at[0][at[1]]![1], d);
  };
  /** The point `set` metres off a street's kerb at a place on it, on the right of the way it runs there (side 1) or its left (-1). */
  const kerbAt = (s: Stand, side: number, set: number): [number, number] => [s.x - s.dz * side * (s.half + set), s.z + s.dx * side * (s.half + set)];
  /** Places from `from` metres along a way out of a node to `to`, a step at a time, at each setback in turn. */
  const STEP = 0.5;
  const seek = (walkTo: (d: number) => ReturnType<typeof trace>, from: number, to: number, side: number, sets: readonly number[], yaw: (s: Stand) => number): [number, number, number, number][] => {
    const places: [number, number, number, number][] = [];
    for (let d = from; d <= to + 1e-6; d += STEP) {
      const s = walkTo(d); if (!isStand(s)) break;
      for (const set of sets) places.push([...kerbAt(s, side, set), yaw(s), clear.road]);
    }
    return places;
  };

  // A building's use behind a point of the verge, looking `deep` metres along (nx, nz): its class as the attributes give it.
  const useAt = (x: number, z: number, vx: number, vz: number, deep = 16): string => {
    const owner = ground.heaps?.owner; if (!owner) return "";
    for (let d = 2; d <= deep; d += 2) {
      const o = owner[sample(x + vx * d, z + vz * d)]!;
      if (o >= 0) return uses.get(Math.floor(ground.heaps.ruins[o]!.building.id / 4)) ?? "";
    }
    return "";
  };
  const districtOf = (x: number, z: number): { style: string; tall: number } => site.world.districts[ground.district[sample(x, z)]! - 1] ?? { style: "", tall: 0 };
  // What the street data says of a line (street-graph.ts), where it says it: whether a side of it (1 the right of the way
  // it is drawn, -1 its left) has a sidewalk, whether it is lit, its speed limit, and its kerb's parking on a side.
  const walked = (line: number, side: number): boolean => {
    const tag = graph.pieces[line]?.sidewalk;
    return tag === "no" || tag === "none" ? false : tag === "left" ? side < 0 : tag === "right" ? side > 0 : true;
  };
  const litTag = (line: number): boolean | null => graph.pieces[line]?.lit ?? null;
  const speedOf = (line: number): number | null => graph.pieces[line]?.maxspeed ?? null;
  const parkingOf = (line: number, side: number): string | null => graph.pieces[line]?.parking[side > 0 ? 1 : 0] ?? null;

  // Junctions, from the street graph's nodes (street-graph.ts): three ways or more. Where only two meet, a way's tags
  // change, in the middle of a block.
  const keyOf = nodeKey;
  // Each line's first and last points' keys, for where a way out of a node leads.
  const lineEnds = new Map<number, [number, number]>();
  for (const s of segments) { const e = lineEnds.get(s.line); if (!e) lineEnds.set(s.line, [keyOf(s.ax, s.az), keyOf(s.bx, s.bz)]); else e[1] = keyOf(s.bx, s.bz); }
  const ends = new Map<number, { x: number; z: number; arms: Arm[] }>();
  for (const n of graph.nodes) {
    ends.set(n.key, { x: n.x, z: n.z, arms: n.ways.map((w) => {
      const piece = graph.pieces[w.line]!; const [first, last] = lineEnds.get(w.line) ?? [n.key, n.key];
      return { dx: w.dx, dz: w.dz, half: piece.half, cls: classOf(piece) ?? "", line: w.line, to: w.sense > 0 ? last : first, sense: w.sense };
    }) });
  }
  const junctions: Junction[] = [];
  // A street the data draws twice (two names for one way) is one arm, the wider.
  const armsAt = (e: { arms: Arm[] }): Arm[] => {
    const arms: Arm[] = [];
    for (const a of e.arms.filter((q) => q.cls !== "").sort((p, q) => q.half - p.half || p.line - q.line)) if (!arms.some((b) => a.dx * b.dx + a.dz * b.dz > 0.97)) arms.push(a);
    return arms.sort((a, b) => Math.atan2(a.dz, a.dx) - Math.atan2(b.dz, b.dx));
  };
  for (const e of ends.values()) {
    const arms = armsAt(e);
    if (arms.length < 3) continue;
    junctions.push({ x: e.x, z: e.z, arms, reach: Math.max(...arms.map((a) => a.half)) + clear.junction });
  }
  const junctionBins = new Map<number, Junction[]>();
  for (const j of junctions) { const k = binKey(Math.floor(j.x / 32), Math.floor(j.z / 32)); if (!junctionBins.has(k)) junctionBins.set(k, []); junctionBins.get(k)!.push(j); }
  const nearJunction = (x: number, z: number, more = 0): boolean => {
    for (let bz = Math.floor(z / 32) - 1; bz <= Math.floor(z / 32) + 1; bz++) for (let bx = Math.floor(x / 32) - 1; bx <= Math.floor(x / 32) + 1; bx++) for (const j of junctionBins.get(binKey(bx, bz)) ?? []) if (Math.hypot(j.x - x, j.z - z) < j.reach + more) return true;
    return false;
  };

  const J = rules.junctions;
  const isMajor = (a: Arm): boolean => J.major.includes(a.cls);
  const isMinor = (a: Arm): boolean => J.minor.includes(a.cls);
  // The corner between arm a and the next arm b, turning from a toward b: where it is, set back from both kerbs.
  const corner = (j: Junction, a: Arm, b: Arm, set: number): [number, number] | null => {
    const sin = a.dx * b.dz - a.dz * b.dx; if (sin < 0.35) return null;
    const da = a.half + set; const db = b.half + set;
    return [j.x + (a.dx * db + b.dx * da) / sin, j.z + (a.dz * db + b.dz * da) / sin];
  };
  // The points the data marks (signals, stops), by 32 m bins, and the junctions whose traffic a signal or a stop holds: a
  // crossing there needs no sign of its own.
  const markedBins = new Map<number, Marked[]>();
  for (const m of graph.marked) { const k = binKey(Math.floor(m.x / 32), Math.floor(m.z / 32)); if (!markedBins.has(k)) markedBins.set(k, []); markedBins.get(k)!.push(m); }
  const markedNear = (x: number, z: number, reach: number): Marked[] => {
    const out: Marked[] = [];
    for (let bz = Math.floor((z - reach) / 32); bz <= Math.floor((z + reach) / 32); bz++) for (let bx = Math.floor((x - reach) / 32); bx <= Math.floor((x + reach) / 32); bx++) {
      for (const m of markedBins.get(binKey(bx, bz)) ?? []) if (Math.hypot(m.x - x, m.z - z) < reach) out.push(m);
    }
    return out;
  };
  const oneWay = (line: number): boolean => graph.pieces[line]!.oneway !== 0;
  const held: { x: number; z: number; reach: number; lines: Set<number> | null }[] = [];
  // The mapped controls with a sign or a head of their own standing, those a signal at their junction holds instead, and
  // what kept each of the others out.
  const stood = new Set<Marked>(); const signalled = new Set<Marked>(); const missing = new Map<Marked, string>();
  for (const j of junctions) {
    const h = hash3(Math.round(j.x * 4), Math.round(j.z * 4), seed);
    const n = j.arms.length; const major = j.arms.filter(isMajor).length; const minor = j.arms.filter(isMinor).length;
    // The previous arm of each, turning the other way: the corner on the right of traffic coming in along it.
    const prev = (i: number): Arm => j.arms[(i + n - 1) % n]!;
    // Signals where the data marks them at the junction; where the data marks no points at all, by the classes' rule.
    const here = graph.mapped.points ? markedNear(j.x, j.z, j.reach + J.marked) : [];
    const signals = graph.mapped.points ? n >= 3 && here.some((m) => m.kind === "signal") : n >= 3 && major + minor === n && (major >= 3 || (major === 2 && minor === 2 && chance(hash3(h, 1, seed), J.signalCross)));
    // The mapped stops that govern a way in: traffic on the way out's line that travels toward the junction, against the
    // way out.
    const governing = (a: Arm): Marked[] => here.filter((m) => m.kind === "stop" && m.governs.some((g) => g.line === a.line && g.dx * a.dx + g.dz * a.dz < 0));
    const markedStops = j.arms.filter((a) => governing(a).length > 0);
    if (signals) {
      held.push({ x: j.x, z: j.z, reach: j.reach, lines: null });
      for (const a of j.arms) for (const m of governing(a)) signalled.add(m);
      let stands = false; let why: string | null = null;
      j.arms.forEach((a, i) => {
        // A mast arm spans the larger ways only, where the classes' rule put the signals; a lesser street's way in has none.
        // Where the data marks them, every street's way in has its own.
        if ((graph.mapped.points ? !isMajor(a) && !isMinor(a) : !isMajor(a)) || !chance(hash3(h, 10 + i, seed), J.standing)) return;
        // Its heads face the traffic that comes in along it, from across the junction: the pole at the far corner on that
        // traffic's right, its arm over the lanes it goes on into. Where nothing goes on (a T's stem), at the near corner.
        const o = j.arms.findIndex((b) => b.dx * a.dx + b.dz * a.dz < -0.8);
        const far = o >= 0 ? j.arms[o]! : null; const next = o >= 0 ? j.arms[(o + 1) % n]! : null;
        // How far along `on` the corner between p and q is; where they run on nearly in line there is none, and the pole
        // starts at the junction's mouth.
        const along = (p: Arm, q: Arm, on: Arm, set: number): number => { const c = corner(j, p, q, set); return c ? Math.max(0, (c[0] - j.x) * on.dx + (c[1] - j.z) * on.dz) : 0; };
        // From the corner a step at a time back along the way it stands by, where a crossing or another way takes the
        // corner; then the same from the near corner on the traffic's right, its arm over the lanes it comes in on.
        const farSide = (set: number): [number, number, number, number][] => far && next ? seek((d) => outOf(j, far, d), along(far, next, far, set), along(far, next, far, set) + 2 * J.past, 1, [set], (s) => yawOf(s.dz, -s.dx)) : [];
        const nearSide = (set: number): [number, number, number, number][] => seek((d) => outOf(j, a, d), along(prev(i), a, a, set), along(prev(i), a, a, set) + 2 * J.past, -1, [set], (s) => yawOf(-s.dz, s.dx));
        // Last, just inside the road's edge at the first of them, where no lane runs.
        const inside = [...farSide(-0.1), ...nearSide(-0.1)].slice(0, 1).map((p): [number, number, number, number] => [p[0], p[1], p[2], -clear.inside]);
        const r = putFirst("signals", form("signal", hash3(h, 20 + i, seed)), [...farSide(J.signal), ...nearSide(J.signal), ...farSide(0.45), ...nearSide(0.45), ...inside]);
        if (r === null) stands = true; else why = r;
      });
      for (const m of here) if (m.kind === "signal") { if (stands) stood.add(m); else if (why !== null) missing.set(m, why); }
    } else if (markedStops.length > 0 || (n >= 3 && minor > 0 && major + minor === n)) {
      // The ways in the data marks a stop on; where it marks none, the lesser street stops: a T's stem, or of two streets
      // crossing the one with fewer ways in, by a hash. Not a way across a divided road's median, between its carriageways,
      // which its traffic comes in by from the far one, nor one whose traffic has just come from another junction or an end,
      // with no room on it for a car to stand behind the sign, nor one way out of the junction that no traffic comes in by.
      const back = (a: Arm): number => Math.max(...j.arms.filter((b) => b !== a).map((b) => b.half)) + J.stopBack;
      const median = (a: Arm): boolean => {
        const e = outOf(j, a, rules.regulations.divided.apart[1]);
        if (isStand(e) || !e.node || e.node.ways.length < 3) return false;
        const across = (w: { dx: number; dz: number }): boolean => Math.abs(w.dx * a.dx + w.dz * a.dz) < 0.7;
        return e.node.ways.some((w) => oneWay(w.line) && across(w) && j.arms.some((b) => b !== a && oneWay(b.line) && across(b) && Math.abs(w.dx * b.dx + w.dz * b.dz) > 0.9));
      };
      const lines = [...new Set(j.arms.map((a) => a.line))];
      const stopped = markedStops.length > 0 ? markedStops : (major > 0 ? j.arms.filter(isMinor) : n === 3 ? j.arms.filter((a) => j.arms.filter((b) => b.line === a.line).length === 1) : j.arms.filter((a) => a.line === lines[hash3(h, 2, seed) % lines.length])).filter((a) => graph.pieces[a.line]!.oneway * a.sense <= 0 && !median(a) && isStand(outOf(j, a, back(a) + J.room)));
      held.push({ x: j.x, z: j.z, reach: j.reach, lines: new Set(stopped.map((a) => a.line)) });
      for (const [i, a] of j.arms.entries()) {
        if (!stopped.includes(a)) continue;
        // On the right of traffic coming in, facing it: at the rule's place, or where the crossing or another way's lanes
        // take that, the first place further back along its way that has room, before the crossing.
        const why = putFirst("stops", form("stop", hash3(h, 30 + i, seed)), seek((d) => outOf(j, a, d), back(a), back(a) + J.seek, -1, [J.stop, 2 * J.stop], (s) => yawOf(s.dx, s.dz)));
        for (const m of governing(a)) { if (why === null) stood.add(m); else if (!stood.has(m)) missing.set(m, why); }
      }
      const first = j.arms.findIndex((a) => stopped.includes(a));
      if (first >= 0) putOut("names", "street_name", J.name, (set) => { const p = corner(j, prev(first), j.arms[first]!, set); return p && [p[0], p[1], yawOf(j.arms[first]!.dx, j.arms[first]!.dz)]; });
    }
    // Corner furniture, by the use of the building behind the corner.
    const C = rules.corners;
    if (major + minor !== n) continue;
    j.arms.forEach((a, i) => {
      const b = j.arms[(i + 1) % n]!; const p = corner(j, a, b, C.set); if (!p) return;
      const vx = a.dx + b.dx; const vz = a.dz + b.dz; const vl = Math.hypot(vx, vz) || 1;
      const busy = C.uses.includes(useAt(p[0], p[1], vx / vl, vz / vl)); const k = busy ? 1 : C.other;
      const toRoad = yawOf(a.dz, -a.dx); const hc = (m: number): number => hash3(h, 100 + i * 16 + m, seed);
      // `d` metres back along arm a (or b) from the corner set back `set` from both kerbs.
      const back = (d: number, arm = a) => (set: number): [number, number, number] | null => { const q = corner(j, a, b, set); return q && [q[0] + arm.dx * d, q[1] + arm.dz * d, toRoad]; };
      if (chance(hc(0), C.bin * k)) putOut("corners", form("bin", hc(1)), C.set, back(2.5), back(2.5 + J.past));
      if (chance(hc(2), C.mailbox * k)) putOut("corners", "mailbox", C.set, back(4.2), back(4.2 + J.past));
      if (chance(hc(3), C.news * k)) for (let m = 0; m < 1 + hc(4) % 3; m++) putOut("corners", "newsbox", C.set, back(5.6 + m * 0.62), back(5.6 + m * 0.62 + J.past));
      if (chance(hc(5), C.bollards * k)) for (const d of [0, 1.5, 3]) putOut("corners", "bollard", C.set, back(d, b));
    });
  }

  // A signal, stop or give-way the data maps that no junction stood a sign or head for (a signal at a crossing, a stop at
  // a driveway or where two ways meet, a give-way, a junction's stop that found no room there): at its own point, on the
  // right of each way of traffic it governs, along that way's line. A signal stands past the point, its arm over the
  // lanes; a sign before it, facing the traffic, further back where the first place has no room.
  for (const m of graph.marked) {
    if (stood.has(m) || signalled.has(m) || !(m.kind === "signal" || m.kind === "stop" || (m.kind === "give_way" && rules.forms.yield))) continue;
    const h = hash3(Math.round(m.x * 4), Math.round(m.z * 4), seed + 17);
    const rule = m.kind === "signal" ? "signals" : m.kind === "stop" ? "stops" : "yields";
    m.governs.forEach((g, k) => {
      // The stretch of its line nearest the point, the foot of the point on it, and which way the traffic runs along it.
      let on: { pts: [number, number][]; i: number; fx: number; fz: number; sense: number } | null = null; let least = Infinity;
      for (const pts of runs.get(g.line) ?? []) for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i]!; const ex = pts[i + 1]![0] - ax; const ez = pts[i + 1]![1] - az;
        const t = Math.max(0, Math.min(1, ((m.x - ax) * ex + (m.z - az) * ez) / (ex * ex + ez * ez || 1)));
        const far = Math.hypot(m.x - ax - ex * t, m.z - az - ez * t);
        if (far < least) { least = far; on = { pts, i, fx: ax + ex * t, fz: az + ez * t, sense: ex * g.dx + ez * g.dz >= 0 ? 1 : -1 }; }
      }
      if (!on) return;
      const { pts, i, fx, fz, sense } = on;
      const walkTo = (way: number) => (d: number) => trace(g.line, pts, way > 0 ? i : i + 1, way, fx, fz, d);
      let places: [number, number, number, number][];
      if (m.kind === "signal") {
        const side = (set: number) => seek(walkTo(sense), J.past, 3 * J.past, 1, [set], (s) => yawOf(s.dz, -s.dx));
        places = [...side(J.signal), ...side(0.45), ...side(-0.1).slice(0, 1).map((p): [number, number, number, number] => [p[0], p[1], p[2], -clear.inside])];
      } else places = seek(walkTo(-sense), J.stopBack, J.stopBack + J.seek, -1, [J.stop, 2 * J.stop], (s) => yawOf(s.dx, s.dz));
      const why = putFirst(rule, form(m.kind === "signal" ? "signal" : m.kind === "stop" ? "stop" : "yield", hash3(h, k, seed)), places);
      if (why === null) stood.add(m); else if (!stood.has(m)) missing.set(m, why);
    });
  }
  // Each line of the named classes, walked from its first point: where the `d`th metre of it is, and which way it runs.
  const lines = new Map<number, Segment[]>();
  for (const s of segments) if (classOf(s) !== undefined) { if (!lines.has(s.line)) lines.set(s.line, []); lines.get(s.line)!.push(s); }
  // A line that runs along another for most of its length is the same street drawn twice: the wider, or the first, keeps it.
  const width = (line: number): number => lines.get(line)![0]!.half;
  const order = [...lines.keys()].sort((a, b) => width(b) - width(a) || a - b);
  const kept = new Set<number>();
  for (const line of order) {
    let near = 0; let all = 0;
    for (const s of lines.get(line)!) {
      const length = Math.hypot(s.bx - s.ax, s.bz - s.az);
      for (let d = length / 2 % 10; d < length; d += 10) {
        const x = s.ax + (s.bx - s.ax) * d / length; const z = s.az + (s.bz - s.az) * d / length; all++;
        if ((laneBins.get(binKey(Math.floor(x / 16), Math.floor(z / 16))) ?? []).some((o) => o.line !== s.line && kept.has(o.line) && (() => {
          const ex = o.bx - o.ax; const ez = o.bz - o.az; const t = Math.max(0, Math.min(1, ((x - o.ax) * ex + (z - o.az) * ez) / (ex * ex + ez * ez)));
          return Math.hypot(x - o.ax - ex * t, z - o.az - ez * t) < 2 && Math.abs((ex * (s.bx - s.ax) + ez * (s.bz - s.az)) / Math.hypot(ex, ez) / length) > 0.95;
        })())) near++;
      }
    }
    if (all === 0 || near / all < 0.8) kept.add(line);
  }
  order.splice(0, order.length, ...[...kept].sort((a, b) => a - b));
  /** Calls `at` for each station `spacing` metres apart along each line of `classes`, from a phase of the line's hash. */
  const along = (classes: readonly string[], spacing: (cls: string) => number, salt: number, at: (x: number, z: number, dx: number, dz: number, half: number, k: number, line: number, cls: string) => void, phase?: (line: number, every: number) => number): void => {
    for (const line of order) {
      const run = lines.get(line)!; const cls = classOf(run[0]!)!; if (!classes.includes(cls)) continue;
      const every = spacing(cls); if (!(every > 0)) continue;
      let next = phase ? phase(line, every) : hash3(line, salt, seed) % Math.max(1, Math.floor(every)); let walked = 0; let k = 0;
      for (const s of run) {
        const length = Math.hypot(s.bx - s.ax, s.bz - s.az); const dx = (s.bx - s.ax) / length; const dz = (s.bz - s.az) / length;
        while (next <= walked + length) { const t = next - walked; at(s.ax + dx * t, s.az + dz * t, dx, dz, s.half, k++, line, cls); next += every; }
        walked += length;
      }
    }
  };
  // The point `out` metres from a station on the right of the way the line runs (side 1) or its left (-1), and the yaw
  // that faces the road from there.
  const side = (x: number, z: number, dx: number, dz: number, out: number, s: number): [number, number, number] => [x - dz * out * s, z + dx * out * s, yawOf(dz * s, -dx * s)];

  // Bus shelters, or a bench and a bin, along the avenues: on the right of each way in turn.
  const B = rules.shelters;
  along(B.classes, () => B.spacing, 7, (x, z, dx, dz, half, k, line) => {
    if (nearJunction(x, z, 6)) return;
    const s = k % 2 === 0 ? 1 : -1; const h = hash3(line, k, seed + 7);
    if (!walked(line, s)) return;
    if (chance(h, B.shelter)) { const [px, pz, yaw] = side(x, z, dx, dz, half + B.set + 0.8, s); if (put("shelters", form("shelter", hash3(h, 1, seed)), px, pz, yaw)) return; }
    const [px, pz, yaw] = side(x, z, dx, dz, half + B.bench, s);
    if (put("shelters", form("bench", hash3(h, 2, seed)), px, pz, yaw)) { const [bx, bz] = [px + dx * 1.6, pz + dz * 1.6]; put("shelters", form("bin", hash3(h, 3, seed)), bx, bz, yaw); }
  });
  // Lamps.
  const L = rules.lamps;
  along(Object.keys(L.spacing), (cls) => L.spacing[cls]!, 1, (x, z, dx, dz, half, k, line, cls) => {
    if (nearJunction(x, z) || litTag(line) === false) return;
    const h = hash3(line, k, seed + 1);
    for (const s of L.both.includes(cls) ? [1, -1] : [k % 2 === 0 ? 1 : -1]) {
      let name = form("lamp", hash3(h, s + 2, seed));
      if (name === "lamp" && chance(hash3(h, s + 5, seed), L.lit[cls] ?? 0) && !L.dark.includes(districtOf(x, z).style)) name = "lamp_lit";
      putOut("lamps", name, L.set, (set) => side(x, z, dx, dz, half + set, s));
    }
  });
  // Utility poles down one side of the lesser streets of the districts that have them.
  const P = rules.poles;
  along(P.classes, () => P.spacing, 2, (x, z, dx, dz, half, k, line) => {
    if (!P.styles.includes(districtOf(x, z).style) || nearJunction(x, z, -2)) return;
    const s = hash3(line, 0, seed + 2) % 2 === 0 ? 1 : -1;
    putOut("poles", form("pole", hash3(line, k, seed + 3)), P.set, (set) => side(x, z, dx, dz, half + set, s));
  });
  // Hydrants, the first a few metres in from where a line starts.
  const H = rules.hydrants;
  along(H.classes, () => H.spacing, 3, (x, z, dx, dz, half, k, line) => {
    if (nearJunction(x, z, -4) || !walked(line, k % 2 === 0 ? 1 : -1)) return;
    putOut("hydrants", "hydrant", H.set, (set) => side(x, z, dx, dz, half + set, k % 2 === 0 ? 1 : -1));
  }, (line, every) => H.first + hash3(line, 3, seed) % Math.max(1, Math.floor(every / 4)));
  // Parking meters in runs, before shops and offices in the denser districts.
  const M = rules.meters;
  along(M.classes, () => M.block, 4, (x, z, dx, dz, half, k, line) => {
    for (const s of [1, -1]) {
      // A kerb the data says cars stand at, in a dense district, has them; one it says they do not, none; where it says
      // nothing, before the uses that would have them.
      const kerb = parkingOf(line, s);
      if (!walked(line, s) || kerb === "no" || districtOf(x, z).tall < M.tall) continue;
      const h = hash3(line, k * 2 + (s > 0 ? 0 : 1), seed + 4);
      if (kerb === null) {
        if (!chance(h, M.chance)) continue;
        const [ux, uz] = side(x, z, dx, dz, half + 0.5, s);
        if (!M.uses.includes(useAt(ux, uz, -dz * s, dx * s, 20))) continue;
      }
      const count = M.run[0] + hash3(h, 1, seed) % (M.run[1] - M.run[0] + 1);
      for (let m = 0; m < count; m++) {
        const [mx, mz] = [x + dx * m * M.every, z + dz * m * M.every];
        if (nearJunction(mx, mz, -3)) break;
        putOut("meters", form("meter", hash3(h, 10 + m, seed)), M.set, (set) => side(mx, mz, dx, dz, half + set, s));
      }
    }
  });
  // A pay station in each lot with stalls enough, at the head of a stall near the lot's middle, its panel (its -z) to the
  // aisle.
  const Y = rules.paystations;
  if (Y) for (const lot of graph.lots) {
    if (lot.stalls.length < Y.least) continue;
    const h = hash3(Math.round(lot.x * 4), Math.round(lot.z * 4), seed + 16);
    const nearest = [...lot.stalls].sort((a, b) => Math.hypot(a[0] - lot.x, a[1] - lot.z) - Math.hypot(b[0] - lot.x, b[1] - lot.z)).slice(0, Y.tries);
    for (const [x, z, fx, fz] of nearest) {
      const ox = x - fx; const oz = z - fz; const ol = Math.hypot(ox, oz) || 1;
      if (put("paystations", form("paystation", h), x + (ox / ol) * (ol + Y.set), z + (oz / ol) * (ol + Y.set), yawOf(ox / ol, oz / ol))) break;
    }
  }
  // Speed limit signs at the limit each class posts, or now and then on the larger ways an evacuation route sign, on the
  // right, facing the traffic.
  const G = rules.signs;
  along(Object.keys(G.spacing), (cls) => G.spacing[cls]!, 5, (x, z, dx, dz, half, k, line, cls) => {
    if (nearJunction(x, z)) return;
    const h = hash3(line, k, seed + 5); const mph = speedOf(line);
    const rule = chance(hash3(h, 1, seed), G.evacuation[cls] ?? 0) ? "evacuation" : mph !== null && rules.forms[`speed${mph}`] ? `speed${mph}` : G.limits[cls];
    if (!rule) return;
    putOut("signs", form(rule, h), G.set, (set) => { const [px, pz] = side(x, z, dx, dz, half + set, 1); return [px, pz, yawOf(-dx, -dz)]; });
  });
  regulate();
  // Guard rail where a highway's edge drops or the water is near, a 4 m run at a time.
  const R = rules.rails;
  along(R.classes, () => 4, 6, (x, z, dx, dz, half, k, line) => {
    for (const s of [1, -1]) {
      const [ex, ez] = side(x, z, dx, dz, half + 0.5, s); const [fx, fz] = side(x, z, dx, dz, half + 4, s); const [wx, wz] = side(x, z, dx, dz, half + R.water, s);
      const drop = site.groundAt(ex, ez) - site.groundAt(fx, fz) > R.drop; const water = site.groundAt(wx, wz) < 0.1 || site.groundAt(fx, fz) < 0.1;
      if (!drop && !water) continue;
      const [px, pz, yaw] = side(x + dx * 2, z + dz * 2, dx, dz, half + R.set, s); put("rails", form("rail", hash3(line, k * 2 + s, seed + 6)), px, pz, yaw, -0.05);
    }
  }, () => 0);
  // Chain-link fence along the street line of open lots and yards: open ground from the fence line `depth` metres in, no
  // building and no road, for `least` metres along.
  const F = rules.fences;
  const lot = (px: number, pz: number, ox: number, oz: number): number => {
    let yard = 0;
    for (let d = 0; d <= F.depth; d += 2) {
      const i = sample(px + ox * d, pz + oz * d); const surface = ground.surface[i]!;
      if (surface === S.YARD) yard++; else if (surface !== S.OPEN && surface !== S.GREEN && surface !== S.DESERT) return -1;
      if (ground.heaps && ground.heaps.owner[i]! >= 0) return -1;
    }
    return yard;
  };
  along(F.classes, () => 3, 8, (x, z, dx, dz, half, k, line) => {
    for (const s of [1, -1]) {
      const [px, pz, yaw] = side(x + dx * 1.5, z + dz * 1.5, dx, dz, half + F.set, s);
      const yards = [-F.least / 2, 0, F.least / 2].map((d) => lot(px + dx * d, pz + dz * d, -dz * s, dx * s));
      if (yards.some((y) => y < 0)) continue;
      // A lot is fenced or not as a whole: by the hash of its street's line and side, and of which 60 m of it this is.
      const h = hash3(line, Math.floor(k / 20) * 2 + (s > 0 ? 0 : 1), seed + 8);
      if (!chance(h, yards.some((y) => y > 0) ? F.yard : F.open) || chance(hash3(line, k * 2 + s, seed + 9), F.gap)) continue;
      put("fences", form("fence", hash3(h, k, seed)), px, pz, yaw, -0.05);
    }
  }, () => 0);
  // Billboards set back from the largest roads, facing them.
  const W = rules.billboards;
  along(W.classes, () => W.spacing, 10, (x, z, dx, dz, half, k, line) => {
    const h = hash3(line, k, seed + 10); if (!chance(h, W.chance) || nearJunction(x, z, 20)) return;
    const back = W.set[0] + (hash3(h, 1, seed) % 1000) / 1000 * (W.set[1] - W.set[0]);
    const [px, pz, yaw] = side(x, z, dx, dz, half + back, h % 2 === 0 ? 1 : -1); put("billboards", form("billboard", hash3(h, 2, seed)), px, pz, yaw);
  });
  if (graph.mapped.points) {
    summary.mapped = {};
    for (const m of graph.marked) {
      if (m.kind === "crossing") continue;
      const k = (summary.mapped[m.kind] ??= { mapped: 0, used: 0, rest: {} }); k.mapped++;
      const why = stood.has(m) ? null : signalled.has(m) ? "signal" : m.governs.length === 0 ? "nothing" : missing.get(m) ?? "untried";
      if (why === null) k.used++; else k.rest[why] = (k.rest[why] ?? 0) + 1;
    }
  }
  // Stripes on the crossings of the walk network, laid flat on the road between its kerbs: the longest pieces first, from
  // where the crossing meets the road's middle out. Last, as nothing stands on a crossing and they take a chunk's budget.
  const T = rules.stripes;
  if (T) {
    const sizes = Object.entries(T.pieces).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const c of graph.crossings) {
      if ((c.type !== null && T.bare.includes(c.type)) || c.markings === "no") continue;
      const ex = c.bx - c.ax; const ez = c.bz - c.az; const cl = Math.hypot(ex, ez); if (cl < 1) continue;
      const vx = ex / cl; const vz = ez / cl;
      const road = roadAt((c.ax + c.bx) / 2, (c.az + c.bz) / 2, 2); if (!road) continue;
      // A crossing that runs along the road is no crossing of it.
      const sin = Math.abs(vx * road.dz - vz * road.dx); if (sin < 0.5) continue;
      // Where along it the crossing meets the road's middle, and the stretch of it between the kerbs, less the inset: a
      // crossing drawn in pieces has each piece's share of that striped.
      const t = (road.fx - c.ax) * vx + (road.fz - c.az) * vz; const across = (2 * road.s.half) / sin;
      const lo = Math.max(0, t - across / 2 + T.inset); const hi = Math.min(cl, t + across / 2 - T.inset);
      let left = hi - lo; const chosen: [string, number][] = [];
      for (const [name, length] of sizes) while (left >= length) { chosen.push([name, length]); left -= length; }
      let from = lo + left / 2;
      const fresh = c.signal === true || c.type === "traffic_signals" || T.fresh.includes(classOf(road.s) ?? "");
      const yaw = ((Math.atan2(-vz, vx) * DEG) % 360 + 360) % 360; const h = hash3(Math.round((c.ax + vx * t) * 4), Math.round((c.az + vz * t) * 4), seed + 15);
      chosen.forEach(([name, length], k) => {
        const px = c.ax + vx * (from + length / 2); const pz = c.az + vz * (from + length / 2); from += length;
        if (Math.min(px - x0, pz - z0, x1 - px, z1 - pz) < clear.edge) return void refuse("stripes", "edge");
        const chunk = chunkOf(px, pz); if (counts[chunk]! >= maxChunk) return void refuse("stripes", "budget");
        counts[chunk]!++;
        const kind = streetKind(fresh ? name : form(name, hash3(h, k, seed)));
        pieces.push({ kind, x: px, y: site.groundAt(px, pz), z: pz, yaw });
        summary.placed[kind] = (summary.placed[kind] ?? 0) + 1; summary.byRule.stripes = (summary.byRule.stripes ?? 0) + 1;
      });
    }
  }
  return { pieces, summary };

  function regulate(): void {
    const R = rules.regulations; const D = R.divided;
    // Which way each one-way line runs: +1 as it is drawn, -1 against. Where the data says (a piece of OpenStreetMap's,
    // with its highway class), as it says; where it does not (TIGER's lines), a street of one name drawn twice is two
    // carriageways, each with the other on its left, and a ramp goes the way of what it leaves or joins.
    const flow = new Map<number, number>();
    const said = (line: number): boolean => graph.pieces[line]?.highway != null;
    for (const line of lines.keys()) if (said(line) && graph.pieces[line]!.oneway !== 0) flow.set(line, graph.pieces[line]!.oneway);
    const names = lineNames(site);
    for (const [line, run] of lines) {
      const name = names[line]; if (!name || said(line) || !D.classes.includes(classOf(run[0]!)!)) continue;
      let votes = 0; let beside = 0; let all = 0;
      for (const s of run) {
        const length = Math.hypot(s.bx - s.ax, s.bz - s.az); const dx = (s.bx - s.ax) / length; const dz = (s.bz - s.az) / length;
        for (let d = length / 2 % 10; d < length; d += 10) {
          const x = s.ax + dx * d; const z = s.az + dz * d; all++;
          let best = Infinity; let left = 0;
          for (let bz = Math.floor((z - D.apart[1]) / 16); bz <= Math.floor((z + D.apart[1]) / 16); bz++) for (let bx = Math.floor((x - D.apart[1]) / 16); bx <= Math.floor((x + D.apart[1]) / 16); bx++) {
            for (const o of laneBins.get(binKey(bx, bz)) ?? []) {
              if (o.line === line || names[o.line] !== name) continue;
              const ex = o.bx - o.ax; const ez = o.bz - o.az; const el = Math.hypot(ex, ez);
              if (Math.abs((ex * dx + ez * dz) / el) < 0.9) continue;
              const t = Math.max(0, Math.min(1, ((x - o.ax) * ex + (z - o.az) * ez) / (el * el)));
              const qx = o.ax + ex * t - x; const qz = o.az + ez * t - z; const q = Math.hypot(qx, qz);
              // Left of travel along (dx, dz) is (dz, -dx).
              if (q >= D.apart[0] && q <= D.apart[1] && q < best) { best = q; left = qx * dz - qz * dx; }
            }
          }
          if (best < Infinity) { beside++; votes += left > 0 ? 1 : -1; }
        }
      }
      if (all > 0 && beside / all >= D.share && votes !== 0) flow.set(line, Math.sign(votes));
    }
    // A ramp runs off a carriageway ahead of its traffic, or onto it with it; a ramp that goes on from another goes its way.
    const ramp = (line: number): boolean => { const run = lines.get(line); return run !== undefined && classOf(run[0]!) === "ramp"; };
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const e of ends.values()) {
        const arms = armsAt(e);
        for (const r of arms) {
          if (!ramp(r.line) || flow.has(r.line) || said(r.line)) continue;
          const known = arms.filter((b) => b.line !== r.line && flow.has(b.line));
          const leaving = known.filter((b) => !ramp(b.line) && b.sense * flow.get(b.line)! > 0);
          let out = 0;
          if (leaving.length > 0) out = r.dx * leaving[0]!.dx + r.dz * leaving[0]!.dz > 0 ? 1 : -1;
          else if (arms.length === 2 && known.length === 1) out = known[0]!.sense * flow.get(known[0]!.line)! < 0 ? 1 : -1;
          if (out !== 0) { flow.set(r.line, out * r.sense); changed = true; }
        }
      }
      if (!changed) break;
    }
    const O = R.oneway; const N = R.noentry;
    const twoWay = (a: Arm): boolean => !flow.has(a.line) && (J.major.includes(a.cls) || J.minor.includes(a.cls));
    for (const j of junctions) {
      if (!j.arms.some(twoWay)) continue;
      const h = hash3(Math.round(j.x * 4), Math.round(j.z * 4), seed + 11); const n = j.arms.length;
      j.arms.forEach((a, i) => {
        if (!flow.has(a.line)) return;
        const across = Math.max(...j.arms.filter((b) => b !== a).map((b) => b.half));
        if (a.sense * flow.get(a.line)! < 0) {
          // Traffic comes in along it: DO NOT ENTER on the right of whoever would go out along it, facing them.
          const back = across + N.back;
          putOut("oneway", form("noentry", hash3(h, i, seed)), N.set, (set) => [j.x + a.dx * back - a.dz * (a.half + set), j.z + a.dz * back + a.dx * (a.half + set), yawOf(-a.dx, -a.dz)]);
        } else if (!ramp(a.line)) {
          // Traffic leaves along it: ONE WAY at the corners either side, along it, its arrow the way it goes.
          for (const [c, b0, b1] of [[0, j.arms[(i + n - 1) % n]!, a], [1, a, j.arms[(i + 1) % n]!]] as const) {
            if (!chance(hash3(h, 20 + i * 2 + c, seed), O.chance)) continue;
            putOut("oneway", form("oneway", hash3(h, 40 + i * 2 + c, seed)), O.set, (set) => { const p = corner(j, b0, b1, set); return p && [p[0], p[1], yawOf(-a.dz, a.dx)]; });
          }
        }
      });
    }
    // DEAD END where a street leaves a junction and ends, going on through no other, short of the map's edge.
    const E = R.deadend;
    const endsIn = (j: Junction, a: Arm): boolean => {
      let at = a; let from = keyOf(j.x, j.z); let walked = 0;
      for (let step = 0; step < 400; step++) {
        const e = ends.get(at.to); const f = ends.get(from); if (!e || !f) return false;
        walked += Math.hypot(e.x - f.x, e.z - f.z); if (walked > E.reach) return false;
        const arms = armsAt(e).filter((b) => b.to !== from);
        if (arms.length === 0) return walked >= E.least && Math.min(e.x - x0, e.z - z0, x1 - e.x, z1 - e.z) > clear.edge + 40;
        if (arms.length > 1) return false;
        from = at.to; at = arms[0]!;
      }
      return false;
    };
    for (const j of junctions) {
      const h = hash3(Math.round(j.x * 4), Math.round(j.z * 4), seed + 12);
      j.arms.forEach((a, i) => {
        if (!E.classes.includes(a.cls) || flow.has(a.line) || !endsIn(j, a)) return;
        // On the right of traffic turning in, facing it.
        const back = Math.max(...j.arms.filter((b) => b !== a).map((b) => b.half)) + E.back;
        putOut("deadends", form("deadend", hash3(h, i, seed)), E.set, (set) => [j.x + a.dx * back - a.dz * (a.half + set), j.z + a.dz * back + a.dx * (a.half + set), yawOf(-a.dx, -a.dz)]);
      });
    }
    // NO PARKING short of some corners, on the right of the traffic coming in, turned toward it, its arrow to the corner.
    const P = R.noparking; const turn = P.angle / DEG;
    for (const j of junctions) {
      const h = hash3(Math.round(j.x * 4), Math.round(j.z * 4), seed + 13);
      j.arms.forEach((a, i) => {
        if (flow.has(a.line) || parkingOf(a.line, -a.sense) !== null || !chance(hash3(h, i, seed), P.chance[a.cls] ?? 0)) return;
        const back = Math.max(...j.arms.filter((b) => b !== a).map((b) => b.half)) + P.back;
        const zx = -a.dz * Math.cos(turn) + a.dx * Math.sin(turn); const zz = a.dx * Math.cos(turn) + a.dz * Math.sin(turn);
        putOut("noparking", form("noparking", hash3(h, 20 + i, seed)), P.set, (set) => [j.x + a.dx * back + a.dz * (a.half + set), j.z + a.dz * back - a.dx * (a.half + set), yawOf(zx, zz)]);
      });
    }
    // And along a kerb the data says has no parking, one every `every` metres, facing the traffic beside it.
    along(Object.keys(P.chance), () => P.every, 13, (x, z, dx, dz, half, k, line) => {
      if (nearJunction(x, z)) return;
      for (const s of [1, -1]) {
        if (parkingOf(line, s) !== "no") continue;
        // Traffic on the right side (1) goes as the line is drawn; on the left, against it, where the street is two-way.
        const t = s > 0 ? 1 : -1; if (flow.has(line) && flow.get(line)! !== t) continue;
        const zx = dz * t * Math.cos(turn) - dx * t * Math.sin(turn); const zz = -dx * t * Math.cos(turn) - dz * t * Math.sin(turn);
        putOut("noparking", form("noparking", hash3(line, k * 2 + (s > 0 ? 0 : 1), seed + 13)), P.set, (set) => { const [px, pz] = side(x, z, dx, dz, half + set, s); return [px, pz, yawOf(zx, zz)]; });
      }
    });
    crossingSigns(flow);
  }

  /** The road stretch nearest (x, z) within `reach` of its edge, and the foot of the point on it. */
  function roadAt(x: number, z: number, reach: number): { s: Segment; fx: number; fz: number; dx: number; dz: number } | null {
    let best: { s: Segment; fx: number; fz: number; dx: number; dz: number } | null = null; let least = Infinity;
    for (const o of laneBins.get(binKey(Math.floor(x / 16), Math.floor(z / 16))) ?? []) {
      if (classOf(o) === undefined) continue;
      const ex = o.bx - o.ax; const ez = o.bz - o.az; const l = Math.hypot(ex, ez); const t = Math.max(0, Math.min(1, ((x - o.ax) * ex + (z - o.az) * ez) / (l * l)));
      const fx = o.ax + ex * t; const fz = o.az + ez * t; const d = Math.hypot(x - fx, z - fz);
      if (d < o.half + reach && d < least) { least = d; best = { s: o, fx, fz, dx: ex / l, dz: ez / l }; }
    }
    return best;
  }

  /**
   * The pedestrian crossing sign (W11-2) before a crossing of the walk network that no signal or stop holds, on the right
   * of the traffic coming to it, facing it: where the data says what a crossing is, only one of the `marked` types.
   */
  function crossingSigns(flow: ReadonlyMap<number, number>): void {
    const X = rules.regulations.crossing;
    graph.crossings.forEach((c) => {
      if (c.signal === true) return;
      const mx = (c.ax + c.bx) / 2; const mz = (c.az + c.bz) / 2;
      if (graph.mapped.points && markedNear(mx, mz, c.half + 2).some((m) => m.kind === "signal")) return;
      // Where the data keeps no type, only a crossing it draws, as one OpenStreetMap draws is most often painted.
      if (c.type !== null ? !X.marked.includes(c.type) : !c.drawn) return;
      const road = roadAt(mx, mz, 2); if (!road) return;
      const cls = classOf(road.s)!; if (!J.major.includes(cls) && !J.minor.includes(cls)) return;
      if (held.some((q) => Math.hypot(q.x - road.fx, q.z - road.fz) < q.reach + 6 && (q.lines === null || q.lines.has(road.s.line)))) return;
      const h = hash3(Math.round(mx * 4), Math.round(mz * 4), seed + 14); if (!chance(h, X.chance)) return;
      for (const t of [1, -1]) {
        if (flow.has(road.s.line) && flow.get(road.s.line)! !== t) continue;
        const tx = road.dx * t; const tz = road.dz * t; const back = c.half + X.back;
        putOut("crossings", form("crossing", hash3(h, t > 0 ? 1 : 2, seed)), X.set, (set) => { const [px, pz] = side(road.fx - tx * back, road.fz - tz * back, tx, tz, road.s.half + set, 1); return [px, pz, yawOf(-tx, -tz)]; });
      }
    });
  }
}

/** Each road line's name (base/roads.geojson), by its place in the file, as roadIndex numbers the lines. */
function lineNames(site: Site): string[] {
  const file = join(site.source, "base/roads.geojson"); if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, "utf8")) as { features: { properties: { name?: string | null } }[] }).features.map((f) => f.properties.name ?? "");
}

/**
 * The ways onto the bridges the ruins built (their reports' bridges.json, written earlier in the same build): each
 * entrance's first twelve metres and the road it runs on into, at the entrance's own width and a metre more.
 */
function bridgeWays(folder: string): Reserved[] {
  const file = join(folder, "bridges.json"); if (!existsSync(file)) return [];
  const records = JSON.parse(readFileSync(file, "utf8")) as { entrances?: { x: number; y: number; z: number; dx: number; dz: number; width: number; runout?: { x: number; y: number; z: number }[] }[] }[];
  return records.flatMap((r) => (r.entrances ?? []).flatMap((e) => [
    { points: [{ x: e.x, y: e.y, z: e.z }, { x: e.x - e.dx * 12, y: e.y, z: e.z - e.dz * 12 }, { x: e.x + e.dx * 12, y: e.y, z: e.z + e.dz * 12 }], width: e.width + 1 },
    ...(e.runout && e.runout.length > 1 ? [{ points: e.runout, width: e.width + 1 }] : []),
  ]));
}

/** The buildings' uses by footprint (base/buildings_attributes.json): OCC_CLS by OBJECTID. */
function readUses(source: string): Map<number, string> {
  const file = join(source, "base/buildings_attributes.json"); if (!existsSync(file)) return new Map();
  const facts = JSON.parse(readFileSync(file, "utf8")) as { fields: string[]; rows: (string | number | null)[][] };
  const id = facts.fields.indexOf("OBJECTID"); const use = facts.fields.indexOf("OCC_CLS");
  return new Map(facts.rows.map((row) => [Number(row[id]), String(row[use] ?? "")]));
}

export function makeFurniture(site: Site, placed: readonly StaticPiece[]): StaticPiece[] {
  if (site.world.heaps !== false) return [];
  const v = vocabulary(site.source) as ReturnType<typeof vocabulary> & { furniture?: Furniture };
  if (!v.furniture) return [];
  // Room is left in each chunk for the obelisks and the harbours' wrecks, which come after.
  const folder = join(site.source, "reports", site.world.ruins?.report ?? "ruins"); mkdirSync(folder, { recursive: true });
  const { pieces, summary } = placeFurniture(site, placed, v.furniture, v.budgets.maxChunk - 8, readUses(site.source), bridgeWays(folder));
  writeFileSync(join(folder, "furniture.json"), `${JSON.stringify({ pieces: pieces.length, ...summary }, null, 2)}\n`);
  console.log(`furniture: ${pieces.length} pieces, ${Object.entries(summary.byRule).map(([r, n]) => `${n} ${r}`).join(", ")}`);
  return pieces;
}

export const STREET_FURNITURE: StaticLayer = { name: "street furniture", make: makeFurniture };
/** Whether a static is one of these, and how far from a spawn point the build takes them away (metres). */
export const isFurniture = (kind: string): boolean => kind.startsWith(streetKind(""));
export const SPAWN_CLEAR = 4;
