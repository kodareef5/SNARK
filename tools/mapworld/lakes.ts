// Water standing above the sea, from the lakes prepare.py keeps apart from it (base/perched_water.geojson, each with the
// surface its hydro-flattened lidar stands at): each lake a body of the map's water (shared/world/water.ts), its bed carved
// under that surface. The water is where the lidar was flattened: a sample of the outline whose lidar stands over the
// surface is bank and stays land, as does one under a footprint. Flowing water (TIGER's H3 codes, a river's or a canal's
// channel) falls along its length, so it is cut into reaches a step apart, each a body of its own. An outline the lidar
// did not flatten, mostly ground over or under its surface, is no lake: it stays the marsh it was, and is reported.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Base, Grid } from "./base.ts";
import { blur, distanceField, fillPolygon } from "./raster.ts";

/** How a world's lakes are made, each with its default. `false` leaves them marsh. */
export interface LakeRules {
  /** Metres of water at the shore, and how much deeper it is a metre out, as a gentle sea shore is here. */
  readonly shoreDepth?: number;
  readonly slope?: number;
  /** The deepest any lake is carved. */
  readonly deepest?: number;
  /** Metres over its surface a sample of the outline is bank. */
  readonly bank?: number;
  /** The least share of an outline whose lidar is within `bank` of its surface for it to be a lake. */
  readonly flattened?: number;
  /** Samples past its outline a lake goes on where the lidar is flat at its surface. */
  readonly past?: number;
  /** The most of a lake's shore that may stand more than `bank` under its surface. */
  readonly leaks?: number;
  /** Metres between one reach's surface and the next down flowing water. */
  readonly reach?: number;
  /**
   * Metres of water over every sample of a swimming pool. A survivor swims in 1.26 m; 1.5 m under a rim a sample away
   * is a side of 37 degrees, which it walks out up.
   */
  readonly poolDepth?: number;
  /**
   * The rise of a step of a ladder out of a pool, in metres, from one pair of samples to the next 2 m off: 1.5 m is 37
   * degrees. A survivor stands on 44.8 and no steeper (1.98 m).
   */
  readonly poolClimb?: number;
  /** The most a pool's surface stands under the median of the ground beside it, in metres: a step a survivor takes. */
  readonly poolUnder?: number;
  /**
   * Metres of ground under a pool's surface that would be a wall behind its water, and the share of its rim that may be
   * one: a pool with more is taken out.
   */
  readonly poolWall?: number;
  readonly poolWallShare?: number;
}

const DEFAULTS = { shoreDepth: 0.3, slope: 0.08, deepest: 8, bank: 0.25, flattened: 0.3, past: 10, leaks: 0.2, reach: 0.25, poolDepth: 1.5, poolClimb: 1.5, poolUnder: 0.5, poolWall: 1, poolWallShare: 0.25 } as const;

export interface Lakes {
  /** Per sample, north up as the base layers are, its body's number counting from 1, or 0. */
  readonly body: Uint16Array;
  /** Each body's name, its surface in metres over the sea on the map's lattice of heights, and what the data calls it. */
  readonly bodies: { readonly name: string; readonly surface: number; readonly kind: string }[];
  /** Each outline: its id and name, samples of water and of bank, its bodies' surfaces from the highest, and why it is none. */
  readonly made: { readonly id: string; readonly name: string; readonly water: number; readonly bank: number; readonly surfaces: readonly number[]; readonly left?: string }[];
}

interface Feature {
  readonly geometry: { readonly type: string; readonly coordinates: unknown };
  readonly properties: { readonly id: string; readonly name?: string | null; readonly kind?: string; readonly mtfcc?: string; readonly above_sea_m: number; readonly intermittent?: boolean };
}

/** Water a built rim holds at its own level on any ground: it has no bank, and no water past its edge. */
const RIMMED = new Set(["pool", "fountain", "reflecting_pool"]);
export const rimmed = (kind: string): boolean => RIMMED.has(kind);
/** Water made to swim in: a swimming pool. A fountain's and a reflecting pool's is a sheet to wade through. */
export const swum = (kind: string): boolean => kind === "pool";

/** TIGER's short names, written out. */
const WORDS: readonly (readonly [RegExp, string])[] = [[/ Lk$/, " Lake"], [/ Riv$/, " River"], [/ Res$/, " Reservoir"], [/ Crk$/, " Creek"], [/ Cnl$/, " Canal"]];

/**
 * The perched lakes of `base` as bodies, from the elevation model `dem` (NAVD88 metres, NaN where none) over a sea of `sea`
 * NAVD88, on the lattice `minY + k * stepY`, leaving out samples `dry` says are built on; null where the base has none or
 * the world turns them off.
 */
export function readLakes(base: Base, rules: LakeRules | false | undefined, sea: number, minY: number, stepY: number, dem: Float32Array, dry: (i: number) => boolean): Lakes | null {
  const path = join(base.folder, "base", "perched_water.geojson");
  if (rules === false || !existsSync(path)) return null;
  const r = { ...DEFAULTS, ...rules };
  const { nx, nz, cell, west, north } = base.grid;
  const N = nx * nz;
  const features = (JSON.parse(readFileSync(path, "utf8")) as { features: Feature[] }).features;
  // A sample's four neighbours, -1 past the map's edge: a row's last sample's east is no sample, not the next row's first.
  const around = (i: number): [number, number, number, number] => {
    const col = i % nx;
    return [col > 0 ? i - 1 : -1, col < nx - 1 ? i + 1 : -1, i - nx, i + nx];
  };
  const snap = (m: number): number => minY + Math.round((m - minY) / stepY) * stepY;
  const body = new Uint16Array(N);
  const taken = new Uint8Array(N);
  const bodies: Lakes["bodies"] = [];
  const made: Lakes["made"][number][] = [];
  for (const f of features) {
    // Water mapped as dry most of the year (a desert's detention basin or wash) stays the ground it is.
    if (f.properties.intermittent) {
      made.push({ id: f.properties.id, name: f.properties.name ?? "", water: 0, bank: 0, surfaces: [], left: "mapped intermittent: dry most of the year" });
      continue;
    }
    const polygons = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    const at: number[] = [];
    for (const rings of polygons) {
      fillPolygon(rings, (e) => (e - west) / cell, (no) => (north - no) / cell, nx, nz, (col, row) => {
        const i = row * nx + col;
        if (taken[i] === 0 && !dry(i)) at.push(i);
        taken[i] = 1;
      });
    }
    let name = f.properties.name ?? "";
    for (const [short, long] of WORDS) name = name.replace(short, long);
    const surface = f.properties.above_sea_m;
    // The lidar over the sea, or the lake's surface where there is none.
    const lidar = (i: number): number => (Number.isNaN(dem[i]!) ? surface : dem[i]! - sea);
    const levels = new Map<number, number>();
    const level = (s: number): number => {
      let b = levels.get(s);
      if (b === undefined) {
        bodies.push({ name, surface: s, kind: f.properties.kind ?? "" });
        levels.set(s, (b = bodies.length));
      }
      return b;
    };
    let water = 0;
    let inside = 0;
    let left: string | undefined;
    if (!(f.properties.mtfcc ?? "").startsWith("H3")) {
      // The surface is where most of the outline's lidar stands, its mode, which banks inside the outline do not move.
      const bins = new Map<number, number>();
      for (const i of at) bins.set(Math.round(lidar(i) * 10), (bins.get(Math.round(lidar(i) * 10)) ?? 0) + 1);
      const mode = [...bins.entries()].reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a), [0, 0])[0] / 10;
      const flat = at.filter((i) => Math.abs(lidar(i) - mode) <= r.bank).length;
      const wet = at.filter((i) => lidar(i) <= mode + r.bank);
      inside = wet.length;
      // Past a misdrawn outline, the water goes on as far as the lidar is flat at its surface, to `past` samples.
      const reached = new Map<number, number>(wet.map((i) => [i, 0]));
      for (let k = 0; k < wet.length; k++) {
        const i = wet[k]!;
        const d = reached.get(i)!;
        if (d >= r.past) continue;
        for (const j of around(i)) {
          if (j < 0 || j >= N || reached.has(j) || taken[j] === 1 || body[j] !== 0 || dry(j) || Number.isNaN(dem[j]!) || Math.abs(dem[j]! - sea - mode) > 0.05) continue;
          reached.set(j, d + 1);
          wet.push(j);
        }
      }
      // The ground round it must hold it in: little of its shore may stand under its surface.
      let rim = 0;
      let low = 0;
      for (const i of wet) {
        for (const j of around(i)) {
          if (j < 0 || j >= N || reached.has(j)) continue;
          rim++;
          if (!Number.isNaN(dem[j]!) && dem[j]! - sea < mode - r.bank) low++;
        }
      }
      if (at.length === 0 || flat < at.length * r.flattened) left = `${Math.round((flat / Math.max(1, at.length)) * 100)}% of its lidar is within ${r.bank} m of its surface`;
      else if (low > rim * r.leaks) left = `${Math.round((low / rim) * 100)}% of its shore stands under its surface`;
      else {
        const b = level(snap(mode));
        for (const i of wet) body[i] = b;
        water = wet.length;
      }
    } else {
      // Along the channel its lidar falls: smoothed over 20 m of the outline's own samples, each taken to the nearest step.
      const value = new Float32Array(N);
      const weight = new Float32Array(N);
      for (const i of at) [value[i], weight[i]] = [lidar(i), 1];
      const v = blur(value, nx, nz, 10, 2);
      const w = blur(weight, nx, nz, 10, 2);
      for (const i of at) {
        const here = v[i]! / w[i]!;
        if (lidar(i) > here + r.bank) continue;
        body[i] = level(snap(Math.round(here / r.reach) * r.reach));
        water++;
        inside++;
      }
    }
    made.push({ id: f.properties.id, name, water, bank: at.length - (left ? 0 : inside), surfaces: [...levels.keys()].sort((a, b) => b - a), ...(left ? { left } : {}) });
  }
  return bodies.length > 0 ? { body, bodies, made } : null;
}

/**
 * Carves each body's bed under its surface into `height` (metres over the sea, north up): `shoreDepth` at its edge and
 * `slope` deeper a metre out, to `deepest`; a swimming pool's `poolDepth` under every sample. Returns the deepest water
 * made.
 */
export function carveLakes(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, grid: Grid): number {
  const r = { ...DEFAULTS, ...(rules || {}) };
  const { body, bodies } = lakes;
  const { nx, nz, cell } = grid;
  const shore = distanceField((i) => body[i] === 0, nx, nz);
  let deepest = 0;
  for (let i = 0; i < nx * nz; i++) {
    const b = body[i]!;
    if (b === 0) continue;
    const depth = swum(bodies[b - 1]!.kind) ? r.poolDepth : Math.min(r.deepest, r.shoreDepth + Math.sqrt(shore[i]!) * cell * r.slope);
    height[i] = bodies[b - 1]!.surface - depth;
    deepest = Math.max(deepest, depth);
  }
  return deepest;
}

/**
 * Raises the rim of each rimmed body: a dry sample beside one of its samples, by a side or a corner, comes up to its
 * surface, so its water ends at ground and not in the air over a yard that falls away. `kept` is ground never moved,
 * footprints and roads. Returns the rims' samples and, for each that rose, what it stood at and what it was raised to. A
 * later grading may cut a rim again, a way to a door through it: settleRims then lets the body down to the cut.
 */
export function raiseRims(lakes: Lakes, height: Float32Array, grid: Grid, kept: (i: number) => boolean): { rim: Set<number>; raised: Map<number, readonly [before: number, raised: number]> } {
  const { body, bodies } = lakes;
  const { nx, nz } = grid;
  const rim = new Set<number>();
  const raised = new Map<number, readonly [number, number]>();
  for (let row = 0; row < nz; row++) {
    for (let col = 0; col < nx; col++) {
      const i = row * nx + col;
      if (body[i] !== 0 || kept(i)) continue;
      let top = -Infinity;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const [c, r] = [col + dc, row + dr];
          const b = c >= 0 && r >= 0 && c < nx && r < nz ? body[r * nx + c]! : 0;
          if (b !== 0 && rimmed(bodies[b - 1]!.kind)) top = Math.max(top, bodies[b - 1]!.surface);
        }
      }
      if (top === -Infinity) continue;
      rim.add(i);
      if (top > height[i]!) {
        const before = height[i]!;
        height[i] = top;
        raised.set(i, [before, height[i]!]);
      }
    }
  }
  return { rim, raised };
}

/** How far under the lowest ground beside it a let-down body's surface stands, and the least water worth keeping. */
const RIM_OVER = 0.1;
const LEAST_DEPTH = 0.3;
/** The steepest ground a way out is laid over, rise a metre: 40 degrees. A survivor stands on 44.8 and no steeper. */
const WALKED = 0.85;
/** Metres two samples side by side may differ for a way to pass between them. */
const LEVEL = 0.5;
/** Metres of water a survivor floats in, over any bed. */
const FLOATS = 1.3;
/** The most a bed lies under the ground at its side where benches are cut all round: 32 degrees up a side, 41 in a corner. */
const BENCH = 1.25;
/** Ways out tried for one stretch of water before it is benched all round. */
const LADDERS = 12;
/** Samples past a stretch of water that a way out is followed over. */
const REACH = 3;

/** The pools' ground as a build keeps it from one settling to the next. */
export interface PoolGround {
  /** Each rimmed sample's bed as last carved or settled: a sample whose ground differs since was graded over. */
  readonly beds: Map<number, number>;
  /** Each sample raiseRims raised: what it stood at before, and what it was raised to. */
  readonly rims: ReadonlyMap<number, readonly [before: number, raised: number]>;
  /** Bodies whose level against the ground round them has been judged once: none is raised again. */
  readonly stood: Set<number>;
  /** Samples of pools taken out, now dry ground: the caller gives them a dry surface. */
  readonly restored: Set<number>;
}

/** The pools' ground as carved, with what raiseRims raised. */
export function poolGround(lakes: Lakes, height: Float32Array, rims: ReadonlyMap<number, readonly [number, number]> = new Map()): PoolGround {
  const beds = new Map<number, number>();
  for (let i = 0; i < lakes.body.length; i++) if (lakes.body[i] !== 0 && rimmed(lakes.bodies[lakes.body[i]! - 1]!.kind)) beds.set(i, height[i]!);
  return { beds, rims, stood: new Set(), restored: new Set() };
}

/**
 * Takes out each rimmed body that stands over the ground round it: one more than `poolWallShare` of whose rim, the
 * samples beside it that are no body's, lies over `poolWall` under its surface. It is a pool on a roof, on a cliff's edge
 * or on a slope too steep for it, and its water could only stand behind a wall. Run before the beds are carved: its
 * samples stay the ground they are. Returns how many went.
 */
export function dropPerched(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, grid: Grid): number {
  const r = { ...DEFAULTS, ...(rules || {}) };
  const { body, bodies } = lakes;
  const { nx, nz } = grid;
  const rim = new Map<number, Set<number>>();
  for (let i = 0; i < nx * nz; i++) {
    const b = body[i]!;
    if (b === 0 || !rimmed(bodies[b - 1]!.kind)) continue;
    const col = i % nx, row = (i - col) / nx;
    let set = rim.get(b);
    if (!set) rim.set(b, (set = new Set()));
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (col + dc >= 0 && row + dr >= 0 && col + dc < nx && row + dr < nz && body[i + dr * nx + dc] === 0) set.add(i + dr * nx + dc);
  }
  const gone = new Set<number>();
  for (const [b, set] of rim) {
    let low = 0;
    for (const j of set) if (height[j]! < bodies[b - 1]!.surface - r.poolWall) low++;
    if (low > r.poolWallShare * set.size) gone.add(b);
  }
  if (gone.size > 0) for (let i = 0; i < nx * nz; i++) if (gone.has(body[i]!)) body[i] = 0;
  return gone.size;
}

/**
 * Settles each rimmed body on the ground as it stands, and makes it water a survivor walks out of. `pools.beds` holds
 * each of its samples' beds as last carved or settled: a sample whose ground differs since has a floor or a way to a door
 * graded over it, and is ground the ruins made, never moved again. Run when the floors and the ways stand where they
 * will; run again after any later grading, it changes only what that grading broke.
 *
 * Its level is judged against its rim as a whole, the samples beside it that are no body's. Its surface stands no more
 * than `poolUnder` under their median: a pool is a step under the ground round it, never the foot of a shaft. Within that
 * it goes RIM_OVER under the lowest of them, on the lattice `minY + k * stepY`, and its beds go with it; a pool found
 * deeper under them than that comes up to them. Graded ground of its own that then stands out of the water is given up;
 * graded ground still under it stays its bed as graded, the slope down from a way beside it.
 *
 * Ground beside it lower than that (a floor levelled far under it, a road's cut) it does not follow down. Its samples
 * beside such ground become a retaining edge, dry at RIM_OVER over its surface, and a way graded through it at that
 * low level stays the way it is. Where that edge would stand over `poolWall` above the low ground along more than
 * `poolWallShare` of its rim, or nothing of it is left, the pool is taken out: its samples go back to dry ground, laid
 * level between the ground round them, and the rim raised for it goes back to what it was.
 *
 * Its ways out, for each part that hangs together, on the triangles the game collides with: from all its water a survivor
 * must reach ground past every body's squares, floating where the water is deep and walking where no triangle is steeper
 * than WALKED. A way one sample wide between walls is none: its triangles are the walls'; nor is a ledge under a rim, nor
 * the water of the pool beside it. Where the part has no such way, a ladder is cut at the lowest stretch of rim that
 * takes one: pairs of samples side by side, each `poolClimb` under the pair before, down to the bed. Where no ladder
 * serves, benches are cut all round, BENCH under the ground at every side; where that fails too, or under LEAST_DEPTH of
 * water is left, the part is no water and goes back to dry ground as a pool taken out does. A sample in no triangle of
 * its own, a slot one sample wide, is benched from the start.
 */
export function settleRims(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, grid: Grid, minY: number, stepY: number, pools: PoolGround): Settled {
  // A body that gives up samples or is taken out leaves ground beside the next one: again, until none changes.
  const all: Settled = { lowered: 0, raised: 0, farthest: 0, crossed: 0, edged: 0, laddered: 0, benched: 0, takenOut: 0, walled: 0, gone: 0, dry: 0 };
  const counted = ["lowered", "raised", "crossed", "edged", "laddered", "benched", "takenOut", "walled", "gone", "dry"] as const;
  for (let round = 0; round < 8; round++) {
    const once = settleOnce(lakes, rules, height, grid, minY, stepY, pools);
    for (const k of counted) all[k] += once[k];
    all.farthest = Math.max(all.farthest, once.farthest);
    if (counted.every((k) => once[k] === 0)) break;
  }
  return all;
}

/**
 * What a settling did, in bodies: let down and raised to the ground round them, and the farthest either went in metres;
 * that gave up samples graded over; given a retaining edge; given a way out by a ladder and by benches; and taken out.
 */
export interface Settled { lowered: number; raised: number; farthest: number; crossed: number; edged: number; laddered: number; benched: number; takenOut: number; /** Of those taken out: for a wall along its rim, with nothing left of it, and with no water left. */ walled: number; gone: number; dry: number }

function settleOnce(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, grid: Grid, minY: number, stepY: number, pools: PoolGround): Settled {
  const r = { ...DEFAULTS, ...(rules || {}) };
  const { body, bodies } = lakes;
  const { beds, rims, stood, restored } = pools;
  const { nx, nz, cell } = grid;
  const N = nx * nz;
  const moved = (i: number): boolean => beds.get(i) !== height[i];
  const sides = (i: number): number[] => {
    const col = i % nx;
    return [col > 0 ? i - 1 : -1, col < nx - 1 ? i + 1 : -1, i - nx, i + nx].filter((j) => j >= 0 && j < N);
  };
  const around = (i: number): number[] => {
    const col = i % nx, row = (i - col) / nx, out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && col + dc >= 0 && row + dr >= 0 && col + dc < nx && row + dr < nz) out.push(i + dr * nx + dc);
    return out;
  };
  const lattice = (v: number): number => minY + Math.floor((v - minY) / stepY + 1e-6) * stepY;
  const of = new Map<number, number[]>();
  for (const i of [...beds.keys()]) {
    const b = body[i]!;
    if (b === 0) beds.delete(i);
    else if (of.has(b)) of.get(b)!.push(i);
    else of.set(b, [i]);
  }
  /**
   * Returns `samples` to dry ground: each laid level between the ground beside it, graded ground among them left as it
   * is. With `whole`, the body is gone: the rim raised for it alone goes back to what it was first.
   */
  const restore = (samples: readonly number[], whole: boolean): void => {
    const free = samples.filter((i) => !moved(i));
    for (const i of samples) { body[i] = 0; beds.delete(i); restored.add(i); }
    if (whole) {
      for (const i of samples) for (const j of around(i)) {
        const raised = rims.get(j);
        // Still as raised, and beside no other pool that wants it.
        if (raised && height[j] === raised[1] && !around(j).some((k) => body[k] !== 0 && rimmed(bodies[body[k]! - 1]!.kind))) height[j] = raised[0];
      }
    }
    // From the mean of the ground beside them, until no sample moves 2 mm more.
    const at = new Set(free);
    let sum = 0, count = 0;
    for (const i of free) for (const j of sides(i)) if (!at.has(j)) { sum += height[j]!; count++; }
    if (count === 0) return;
    for (const i of free) height[i] = sum / count;
    for (let sweep = 0, most = Infinity; sweep < 400 && most > 0.002; sweep++) {
      most = 0;
      for (const i of free) {
        const near = sides(i);
        const to = near.reduce((s, j) => s + height[j]!, 0) / near.length;
        most = Math.max(most, Math.abs(to - height[i]!));
        height[i] = to;
      }
    }
  };
  const tally: Settled = { lowered: 0, raised: 0, farthest: 0, crossed: 0, edged: 0, laddered: 0, benched: 0, takenOut: 0, walled: 0, gone: 0, dry: 0 };
  for (const [b, own] of of) {
    const was = bodies[b - 1]!;
    // Its rim, and the level it may stand at under it.
    const rim = new Set<number>();
    for (const i of own) for (const j of around(i)) if (body[j] === 0) rim.add(j);
    const levels = Float64Array.from(rim, (j) => height[j]!).sort();
    const limit = levels.length > 0 ? levels[levels.length >> 1]! - r.poolUnder : -Infinity;
    const reached = (j: number): boolean => height[j]! - RIM_OVER >= limit - 1e-6;
    let surface = was.surface;
    if (surface < limit && !stood.has(b)) {
      // In a pit: up to the lowest of its rim that it may stand under.
      let lowest = Infinity;
      for (const j of rim) if (reached(j)) lowest = Math.min(lowest, height[j]!);
      if (lowest < Infinity) surface = Math.max(surface, lattice(lowest - RIM_OVER));
    }
    stood.add(b);
    const wet = (i: number): boolean => body[i] === b && (!moved(i) || height[i]! < surface);
    for (;;) {
      let lowest = Infinity;
      for (const i of own) if (wet(i)) for (const j of around(i)) if ((body[j] === 0 || (body[j] === b && !wet(j))) && reached(j)) lowest = Math.min(lowest, height[j]!);
      if (!(lowest < surface)) break;
      surface = lattice(lowest - RIM_OVER);
    }
    // Ground beside its water that is lower still: its samples there become a retaining edge, and a way at that level stays.
    const low: number[] = [];
    const isLow = new Set<number>(), edge = new Set<number>();
    for (const i of own) if (wet(i)) for (const j of around(i)) if (body[j] === 0 && height[j]! < surface && !isLow.has(j)) { isLow.add(j); low.push(j); }
    let gave = false;
    for (let q = 0; q < low.length; q++) {
      const from = low[q]!;
      for (const i of around(from)) {
        if (!wet(i)) continue;
        body[i] = 0;
        if (moved(i) && Math.abs(height[i]! - height[from]!) <= LEVEL) {
          beds.delete(i);
          gave = true;
          isLow.add(i);
          low.push(i);
        } else edge.add(i);
      }
    }
    // Graded ground of its own that stands out of the water is given up.
    const kept: number[] = [];
    for (const i of own) {
      if (body[i] !== b) continue;
      if (moved(i) && !(height[i]! < surface)) {
        body[i] = 0;
        beds.delete(i);
        gave = true;
      } else kept.push(i);
    }
    // How much of the rim left to it would be an edge standing over the low ground by more than a wall.
    let walled = 0;
    for (const i of edge) if (around(i).some((j) => isLow.has(j) && height[j]! < surface - r.poolWall)) walled++;
    const rimLeft = new Set<number>();
    for (const i of kept) for (const j of around(i)) if (body[j] === 0) rimLeft.add(j);
    if (kept.length === 0 || walled > r.poolWallShare * rimLeft.size) {
      // The edge's samples were its own: with the rest they go back to ground.
      restore([...kept, ...edge], true);
      tally.takenOut++;
      if (kept.length === 0) tally.gone++;
      else tally.walled++;
      continue;
    }
    // The edge is ground now, kept as laid: no sample of the body next round, but ground to restore if the rest goes.
    for (const i of edge) {
      height[i] = surface + RIM_OVER;
      beds.set(i, height[i]!);
    }
    if (edge.size > 0) tally.edged++;
    if (gave) tally.crossed++;
    const shift = surface - was.surface;
    if (shift !== 0) {
      bodies[b - 1] = { ...was, surface };
      if (shift < 0) tally.lowered++;
      else tally.raised++;
      tally.farthest = Math.max(tally.farthest, Math.abs(shift));
      for (const i of kept) if (!moved(i)) { height[i] = height[i]! + shift; beds.set(i, height[i]!); }
    }
    // Its parts: samples that touch, by a side or a corner.
    const part = new Map<number, number>();
    let parts = 0, water = false;
    const dried: number[] = [];
    for (const start of kept) {
      if (part.has(start)) continue;
      const k = parts++, samples = [start];
      part.set(start, k);
      for (let q = 0; q < samples.length; q++) for (const j of around(samples[q]!)) if (body[j] === b && !part.has(j)) { part.set(j, k); samples.push(j); }
      const inPart = (i: number): boolean => i >= 0 && i < N && part.get(i) === k;
      const dry = (i: number): boolean => i >= 0 && i < N && body[i] === 0;
      const before = samples.map((i) => height[i]!);
      const how = makeWayOut(samples, inPart, dry, (i) => body[i] !== 0, sides, height, surface, nx, nz, cell, r.poolClimb);
      let deepest = 0;
      for (const i of samples) deepest = Math.max(deepest, surface - height[i]!);
      if (how === "filled" || deepest < LEAST_DEPTH) {
        // No water is left of it: no bench, ladder or pit either.
        samples.forEach((i, q) => { if (beds.get(i) === before[q]) beds.set(i, height[i]!); });
        dried.push(...samples);
        continue;
      }
      if (how === "ladder") tally.laddered++;
      else if (how === "benches") tally.benched++;
      water = true;
      for (const i of samples) beds.set(i, height[i]!);
    }
    if (dried.length > 0) restore(water ? dried : [...dried, ...edge], !water);
    if (!water) { tally.takenOut++; tally.dry++; }
  }
  return tally;
}

/** What a settling did, in words. */
export function settledLine(s: Settled): string {
  return `${s.lowered} pools let down and ${s.raised} raised to the ground round them, the farthest ${s.farthest.toFixed(2)} m; ${s.crossed} gave up samples a floor or a way was graded over; ${s.edged} given a retaining edge; a way out made by a ladder in ${s.laddered}, by benches in ${s.benched}; ${s.takenOut} taken out, their ground restored (${s.walled} for a wall along their rim, ${s.gone} with nothing left, ${s.dry} with no water left)`;
}

/**
 * Makes one part of a rimmed body water a survivor walks out of (settleRims), raising beds in `height` where it must.
 * Says what it took: nothing, a ladder, benches all round, or filling it to its surface.
 */
function makeWayOut(samples: readonly number[], inPart: (i: number) => boolean, dry: (i: number) => boolean, ours: (i: number) => boolean, sides: (i: number) => number[], height: Float32Array, surface: number, nx: number, nz: number, cell: number, climb: number): "" | "ladder" | "benches" | "filled" {
  // The cells round the part and REACH samples past it, each two triangles split from its north-west corner to its
  // south-east, as the game's are: (a, b, d) and (a, c, d) of a at (col, row), b east of it, c south, d south-east.
  let [c0, c1, r0, r1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const i of samples) { const col = i % nx, row = (i - col) / nx; c0 = Math.min(c0, col); c1 = Math.max(c1, col); r0 = Math.min(r0, row); r1 = Math.max(r1, row); }
  [c0, r0, c1, r1] = [Math.max(0, c0 - REACH), Math.max(0, r0 - REACH), Math.min(nx - 2, c1 + REACH - 1), Math.min(nz - 2, r1 + REACH - 1)];
  const wide = c1 - c0 + 1, deep = r1 - r0 + 1;
  if (wide < 1 || deep < 1) return "";
  const corners = (t: number): [number, number, number] => {
    const cellAt = t >> 1, a = (r0 + Math.floor(cellAt / wide)) * nx + c0 + (cellAt % wide);
    return t & 1 ? [a, a + nx, a + nx + 1] : [a, a + 1, a + nx + 1];
  };
  // A sample in no triangle wholly the part's is a slot: benched to the ground at its sides.
  const open = new Set<number>();
  for (let t = 0; t < wide * deep * 2; t++) { const c = corners(t); if (c.every(inPart)) for (const i of c) open.add(i); }
  const bench = (i: number, from: (j: number) => boolean): boolean => {
    let top = -Infinity;
    for (const j of sides(i)) if (from(j)) top = Math.max(top, height[j]!);
    if (!(top - BENCH > height[i]!)) return false;
    height[i] = top - BENCH;
    return true;
  };
  for (const i of samples) if (!open.has(i)) bench(i, dry);
  /** Whether every triangle of the part's own that is floated over or walked reaches a walked one of a cell past the body's squares. */
  const walksOut = (): boolean => {
    const pass = new Uint8Array(wide * deep * 2), reached = new Uint8Array(pass.length), queue: number[] = [];
    for (let t = 0; t < pass.length; t++) {
      const [a, m, d] = corners(t), [ha, hm, hd] = [height[a]!, height[m]!, height[d]!];
      // The middle corner is a's east or south neighbour: the slope is the two legs', a metre each way.
      const walked = Math.hypot(hm - ha, hd - hm) / cell <= WALKED;
      const floated = [a, m, d].every((i) => inPart(i) && surface - height[i]! >= FLOATS);
      pass[t] = walked || floated ? 1 : 0;
      // A square is the body's where a corner of it is: the cell's fourth corner is a's south or east neighbour.
      if (walked && ![a, m, d, t & 1 ? a + 1 : a + nx].some(ours)) { reached[t] = 1; queue.push(t); }
    }
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q]!, at = t >> 1, col = at % wide, row = Math.floor(at / wide);
      // (a, b, d) meets its cell's other, the cell north's (a, c, d) and the cell east's; (a, c, d) the south's and the west's.
      const next = t & 1 ? [t - 1, row + 1 < deep ? (at + wide) * 2 : -1, col > 0 ? (at - 1) * 2 : -1] : [t + 1, row > 0 ? (at - wide) * 2 + 1 : -1, col + 1 < wide ? (at + 1) * 2 + 1 : -1];
      for (const u of next) if (u >= 0 && pass[u] && !reached[u]) { reached[u] = 1; queue.push(u); }
    }
    for (let t = 0; t < pass.length; t++) if (pass[t] && !reached[t] && corners(t).every(inPart)) return false;
    return true;
  };
  if (walksOut()) return "";
  // Ladders, from the lowest stretch of rim two samples wide: q and its neighbour under two dry samples that are level.
  const rims: { q: number; q2: number; e: number; top: number }[] = [];
  for (const q of samples) {
    const col = q % nx;
    for (const e of [1, -1, nx, -nx]) {
      if ((e === 1 && col === nx - 1) || (e === -1 && col === 0) || !dry(q + e)) continue;
      const d = Math.abs(e) === 1 ? nx : 1, q2 = q + d;
      if ((d === 1 && col === nx - 1) || !inPart(q2) || !dry(q2 + e) || Math.abs(height[q + e]! - height[q2 + e]!) > LEVEL) continue;
      rims.push({ q, q2, e, top: Math.max(height[q + e]!, height[q2 + e]!) });
    }
  }
  rims.sort((a, b) => a.top - b.top || a.q - b.q || a.e - b.e);
  let tried = 0;
  for (const { q, q2, e, top } of rims) {
    if (tried === LADDERS) break;
    const saved: [number, number][] = [];
    let level = top;
    for (let k = 0; ; k++) {
      const pair = [q - k * e, q2 - k * e];
      // Inward along a row, a step stays in the row.
      if (!pair.every(inPart) || (Math.abs(e) === 1 && Math.floor(pair[0]! / nx) !== Math.floor(q / nx))) break;
      level -= climb;
      const low = pair.filter((i) => height[i]! < level);
      if (low.length === 0) break;
      for (const i of low) { saved.push([i, height[i]!]); height[i] = level; }
    }
    if (saved.length > 0) tried++;
    if (saved.length > 0 && walksOut()) return "ladder";
    for (const [i, h] of saved) height[i] = h;
  }
  // Benches all round, to the ground at every side and to the bench beside.
  for (let changed = true; changed;) {
    changed = false;
    for (const i of samples) if (bench(i, (j) => dry(j) || inPart(j))) changed = true;
  }
  if (walksOut()) return "benches";
  for (const i of samples) height[i] = Math.max(height[i]!, surface);
  return "filled";
}

/**
 * The bodies' squares of `cell` metres for the map file, row by row from z = 0 as the engine has them: a square is the
 * body of a corner sample in one, else of a corner next to one, so that each body's squares reach over its shore. A
 * rimmed body takes no square past its own: its rim is its shore.
 */
export function lakeSquares(lakes: Lakes, grid: Grid, cell: number): Uint16Array {
  const { body, bodies } = lakes;
  const { nx, nz } = grid;
  // Each dry sample next to a lake takes that lake's number.
  const shore = new Uint16Array(nx * nz);
  for (let row = 0; row < nz; row++) {
    for (let col = 0; col < nx; col++) {
      const i = row * nx + col;
      if (body[i] !== 0) continue;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const c = col + dc;
        const r = row + dr;
        if (c >= 0 && r >= 0 && c < nx && r < nz && body[r * nx + c] !== 0 && !rimmed(bodies[body[r * nx + c]! - 1]!.kind)) {
          shore[i] = body[r * nx + c]!;
          break;
        }
      }
    }
  }
  // Engine sample (si, sj) is base sample (nx - 1 - si, nz - 1 - sj): x and z count west and south from the north-west corner.
  const across = grid.sizeX / cell;
  const down = grid.sizeZ / cell;
  const per = cell / grid.cell;
  const squares = new Uint16Array(across * down);
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      let own = 0;
      let near = 0;
      for (let dj = 0; dj <= per && own === 0; dj++) {
        for (let di = 0; di <= per && own === 0; di++) {
          const k = (nz - 1 - (j * per + dj)) * nx + (nx - 1 - (i * per + di));
          if (body[k] !== 0) own = body[k]!;
          else if (near === 0) near = shore[k]!;
        }
      }
      squares[j * across + i] = own !== 0 ? own : near;
    }
  }
  return squares;
}
