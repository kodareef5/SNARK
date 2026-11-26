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
}

const DEFAULTS = { shoreDepth: 0.3, slope: 0.08, deepest: 8, bank: 0.25, flattened: 0.3, past: 10, leaks: 0.2, reach: 0.25 } as const;

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
 * `slope` deeper a metre out, to `deepest`. Returns the deepest water made.
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
    const depth = Math.min(r.deepest, r.shoreDepth + Math.sqrt(shore[i]!) * cell * r.slope);
    height[i] = bodies[b - 1]!.surface - depth;
    deepest = Math.max(deepest, depth);
  }
  return deepest;
}

/**
 * Raises the rim of each rimmed body: a dry sample beside one of its samples, by a side or a corner, comes up to its
 * surface, so its water ends at ground and not in the air over a yard that falls away. `kept` is ground never moved,
 * footprints and roads. Returns the rims' samples, for later grading to leave alone, and how many of them rose.
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

/**
 * Lets each rimmed body down to the fixed ground beside it. A floor levelled lower than its surface, or a road, cannot
 * rise to be its rim, so the water yields: its surface goes RIM_OVER under the lowest dry sample beside it, on the
 * lattice `minY + k * stepY`, and its bed down by as much, so it is as deep as it was carved. A body left with under
 * LEAST_DEPTH of water, as one a later grading filled, is no water any more: its samples go dry. A body with a sample
 * `moved` since its bed was carved has a floor or a way to a door graded across it, which letting it down would leave
 * in a pit: it stays as it is. Run once the floors stand where they will. Returns how many were let down, the farthest,
 * how many dried and how many stayed for a grading across them.
 */
export function settleRims(lakes: Lakes, height: Float32Array, grid: Grid, minY: number, stepY: number, moved: (i: number) => boolean = () => false): { lowered: number; farthest: number; dried: number; crossed: number } {
  const { body, bodies } = lakes;
  const { nx, nz } = grid;
  const n = bodies.length;
  const lowest = new Float32Array(n + 1).fill(Infinity);
  const bed = new Float32Array(n + 1).fill(Infinity);
  const across = new Uint8Array(n + 1);
  for (let row = 0; row < nz; row++) {
    for (let col = 0; col < nx; col++) {
      const b = body[row * nx + col]!;
      if (b === 0 || !rimmed(bodies[b - 1]!.kind)) continue;
      bed[b] = Math.min(bed[b]!, height[row * nx + col]!);
      if (moved(row * nx + col)) across[b] = 1;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const [c, r] = [col + dc, row + dr];
          if (c >= 0 && r >= 0 && c < nx && r < nz && body[r * nx + c] === 0) lowest[b] = Math.min(lowest[b]!, height[r * nx + c]!);
        }
      }
    }
  }
  const drop = new Float32Array(n + 1);
  const dry = new Uint8Array(n + 1);
  let lowered = 0, farthest = 0, dried = 0, crossed = 0;
  for (let b = 1; b <= n; b++) {
    const was = bodies[b - 1]!;
    if (bed[b] === Infinity) continue;
    if (was.surface - bed[b]! >= LEAST_DEPTH && lowest[b]! < was.surface && across[b]) crossed++;
    else if (lowest[b]! < was.surface) {
      const surface = minY + Math.floor((lowest[b]! - RIM_OVER - minY) / stepY + 1e-6) * stepY;
      drop[b] = was.surface - surface;
      bodies[b - 1] = { ...was, surface };
      lowered++;
      farthest = Math.max(farthest, drop[b]!);
    }
    if (was.surface - bed[b]! < LEAST_DEPTH) {
      dry[b] = 1;
      dried++;
    }
  }
  for (let i = 0; i < nx * nz; i++) {
    const b = body[i]!;
    if (b === 0) continue;
    if (dry[b]) body[i] = 0;
    else height[i] = height[i]! - drop[b]!;
  }
  return { lowered, farthest, dried, crossed };
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
