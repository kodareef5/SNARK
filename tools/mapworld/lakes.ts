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
}

const DEFAULTS = { shoreDepth: 0.3, slope: 0.08, deepest: 8, bank: 0.25, flattened: 0.3, past: 10, leaks: 0.2, reach: 0.25, poolDepth: 1.5, poolClimb: 1.5 } as const;

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
 * footprints and roads. Returns the rims' samples and how many of them rose. A later grading may cut a rim again, a way
 * to a door through it: settleRims then lets the body down to the cut.
 */
export function raiseRims(lakes: Lakes, height: Float32Array, grid: Grid, kept: (i: number) => boolean): { rim: Set<number>; raised: number } {
  const { body, bodies } = lakes;
  const { nx, nz } = grid;
  const rim = new Set<number>();
  let raised = 0;
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
        height[i] = top;
        raised++;
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

/** Each rimmed sample's bed as it was carved: what `settleRims` tells later grading by, and keeps up to date. */
export function poolBeds(lakes: Lakes, height: Float32Array): Map<number, number> {
  const beds = new Map<number, number>();
  for (let i = 0; i < lakes.body.length; i++) if (lakes.body[i] !== 0 && rimmed(lakes.bodies[lakes.body[i]! - 1]!.kind)) beds.set(i, height[i]!);
  return beds;
}

/**
 * Settles each rimmed body on the ground as it stands, and makes it water a survivor walks out of. `beds` holds each of
 * its samples' beds as last carved or settled: a sample whose ground differs since has a floor or a way to a door graded
 * over it, and is ground the ruins made, never moved again. Run when the floors and the ways stand where they will; run
 * again after any later grading, it changes only what that grading broke: run twice on the same ground, the second
 * changes nothing.
 *
 * Its surface: ground beside it lower than its surface cannot hold it, so the water yields and goes RIM_OVER under the
 * lowest such ground, on the lattice `minY + k * stepY`. Graded ground of its own that then stands out of the water is
 * given up; graded ground still under it stays its bed as graded, the slope down from a way beside it. Its other samples'
 * beds go down with its surface, so it is as deep as it was carved.
 *
 * Its ways out, for each part that hangs together, on the triangles the game collides with: from all its water a survivor
 * must reach ground past the body's squares, floating where the water is deep and walking where no triangle is steeper
 * than WALKED. A way one sample wide between walls is none: its triangles are the walls'; nor is a ledge under a rim. Where
 * the part has no
 * such way, a ladder is cut at the lowest stretch of rim that takes one: pairs of samples side by side, each `poolClimb`
 * under the pair before, down to the bed. Where no ladder serves, benches are cut all round, BENCH under the ground at
 * every side; where that fails too the part is filled to its surface. A sample in no triangle of its own, a slot one
 * sample wide, is benched from the start. A part left with under LEAST_DEPTH of water is no water: its samples go dry.
 */
export function settleRims(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, grid: Grid, minY: number, stepY: number, beds: Map<number, number>): Settled {
  // A body that gives up samples or dries leaves ground beside the next one: again, until none changes.
  const all: Settled = { lowered: 0, farthest: 0, dried: 0, crossed: 0, laddered: 0, benched: 0, filled: 0 };
  for (let round = 0; round < 8; round++) {
    const once = settleOnce(lakes, rules, height, grid, minY, stepY, beds);
    for (const k of ["lowered", "dried", "crossed", "laddered", "benched", "filled"] as const) all[k] += once[k];
    all.farthest = Math.max(all.farthest, once.farthest);
    if (once.lowered + once.dried + once.crossed + once.laddered + once.benched + once.filled === 0) break;
  }
  return all;
}

/** What a settling did: bodies let down and the farthest, in metres; left with no water; that gave up samples; and parts given a way out, by how. */
export interface Settled { lowered: number; farthest: number; dried: number; crossed: number; laddered: number; benched: number; filled: number }

function settleOnce(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, grid: Grid, minY: number, stepY: number, beds: Map<number, number>): Settled {
  const r = { ...DEFAULTS, ...(rules || {}) };
  const { body, bodies } = lakes;
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
  const of = new Map<number, number[]>();
  for (const i of [...beds.keys()]) {
    const b = body[i]!;
    if (b === 0) beds.delete(i);
    else if (of.has(b)) of.get(b)!.push(i);
    else of.set(b, [i]);
  }
  const tally = { lowered: 0, farthest: 0, dried: 0, crossed: 0, laddered: 0, benched: 0, filled: 0 };
  for (const [b, own] of of) {
    // The surface, under every sample beside its water that is not its own water.
    const was = bodies[b - 1]!;
    let surface = was.surface;
    const wet = (i: number): boolean => body[i] === b && (!moved(i) || height[i]! < surface);
    for (;;) {
      let lowest = Infinity;
      for (const i of own) if (wet(i)) for (const j of around(i)) if (body[j] === 0 || (body[j] === b && !wet(j))) lowest = Math.min(lowest, height[j]!);
      if (!(lowest < surface)) break;
      surface = minY + Math.floor((lowest - RIM_OVER - minY) / stepY + 1e-6) * stepY;
    }
    const drop = was.surface - surface;
    if (drop > 0) {
      bodies[b - 1] = { ...was, surface };
      tally.lowered++;
      tally.farthest = Math.max(tally.farthest, drop);
    }
    let gave = false;
    const kept: number[] = [];
    for (const i of own) {
      if (!moved(i)) height[i] = height[i]! - drop;
      else if (!(height[i]! < surface)) {
        body[i] = 0;
        beds.delete(i);
        gave = true;
        continue;
      }
      kept.push(i);
    }
    if (gave) tally.crossed++;
    // Its parts: samples that touch, by a side or a corner.
    const part = new Map<number, number>();
    let parts = 0, water = false;
    for (const start of kept) {
      if (part.has(start)) continue;
      const k = parts++, samples = [start];
      part.set(start, k);
      for (let q = 0; q < samples.length; q++) for (const j of around(samples[q]!)) if (body[j] === b && !part.has(j)) { part.set(j, k); samples.push(j); }
      const inPart = (i: number): boolean => i >= 0 && i < N && part.get(i) === k;
      const dry = (i: number): boolean => i >= 0 && i < N && body[i] === 0;
      const how = makeWayOut(samples, inPart, dry, (i) => body[i] === b, sides, height, surface, nx, nz, cell, r.poolClimb);
      if (how === "ladder") tally.laddered++;
      else if (how === "benches") tally.benched++;
      else if (how === "filled") tally.filled++;
      let deepest = 0;
      for (const i of samples) deepest = Math.max(deepest, surface - height[i]!);
      if (deepest < LEAST_DEPTH) for (const i of samples) { body[i] = 0; beds.delete(i); }
      else { water = true; for (const i of samples) beds.set(i, height[i]!); }
    }
    if (!water) tally.dried++;
  }
  return tally;
}

/** What a settling did, in words. */
export function settledLine(s: Settled): string {
  return `${s.lowered} pools let down to ground beside them, the farthest ${s.farthest.toFixed(2)} m; ${s.crossed} gave up samples a floor or a way was graded over; a way out made by a ladder in ${s.laddered}, by benches in ${s.benched}, ${s.filled} filled; ${s.dried} left with no water`;
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
