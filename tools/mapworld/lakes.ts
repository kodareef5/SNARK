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
   * The most a step of the way out of a pool rises, in metres, from one sample to the next 2 m off: 1.5 m is 37
   * degrees. A survivor stands on 44.8 and no steeper (1.98 m), and at 1.8 m one wading in a let-down pool was caught.
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

/**
 * Lets each rimmed body down to the fixed ground beside it. A floor levelled lower than its surface, a road, or a way
 * to a door graded through its rim cannot rise to hold it, so the water yields: its surface goes RIM_OVER under the
 * lowest dry sample beside it, on the lattice `minY + k * stepY`, and its bed down by as much, so it is as deep as it
 * was carved. A sample of its own `moved` since its bed was carved has a floor or a way graded across it: that is fixed
 * ground too, and the body gives it up before it is let down, so the way does not end in a pit.
 *
 * Then each part of it that still hangs together is made a place to walk out of: from every sample there is a way to
 * dry ground, sample to the next by a side, that never rises more than `poolClimb` in a step, and a bed too deep for
 * that is held up. The way goes from one sample of the bed to the next only where the bed is two samples wide there: a
 * trench one sample wide between walls is no water to swim along, so each sample of one needs dry ground it can climb
 * to at its own side. A part let down beside ground it cannot climb to is shallower for it, wading water or none. A part
 * left with under LEAST_DEPTH of water is no water any more: its samples go dry, a basin. Run once
 * the floors and the ways stand where they will. Returns how many bodies were let down, the farthest, how many dried
 * whole, how many gave up samples, and how many had their bed held up.
 */
export function settleRims(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, grid: Grid, minY: number, stepY: number, moved: (i: number) => boolean = () => false): { lowered: number; farthest: number; dried: number; crossed: number; held: number } {
  const r = { ...DEFAULTS, ...(rules || {}) };
  const { body, bodies } = lakes;
  const { nx, nz } = grid;
  const n = bodies.length;
  const across = new Uint8Array(n + 1);
  const own: number[] = [];
  for (let i = 0; i < nx * nz; i++) {
    const b = body[i]!;
    if (b === 0 || !rimmed(bodies[b - 1]!.kind)) continue;
    if (moved(i)) {
      body[i] = 0;
      across[b] = 1;
    } else own.push(i);
  }
  // Its parts: samples of one body that touch, by a side or a corner, each with the lowest dry sample beside it.
  const around = (i: number, each: (j: number) => void): void => {
    const col = i % nx, row = (i - col) / nx;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && col + dc >= 0 && row + dr >= 0 && col + dc < nx && row + dr < nz) each(i + dr * nx + dc);
  };
  const partOf = new Map<number, number>();
  const parts: { body: number; samples: number[]; lowest: number }[] = [];
  for (const start of own) {
    if (partOf.has(start)) continue;
    const part = { body: body[start]!, samples: [start], lowest: Infinity };
    partOf.set(start, parts.push(part) - 1);
    for (let q = 0; q < part.samples.length; q++) {
      around(part.samples[q]!, (j) => {
        if (body[j] === 0) part.lowest = Math.min(part.lowest, height[j]!);
        else if (body[j] === part.body && !partOf.has(j)) {
          partOf.set(j, parts.length - 1);
          part.samples.push(j);
        }
      });
    }
  }
  const lowest = new Float32Array(n + 1).fill(Infinity);
  for (const part of parts) lowest[part.body] = Math.min(lowest[part.body]!, part.lowest);
  const drop = new Float32Array(n + 1);
  let lowered = 0, farthest = 0;
  for (let b = 1; b <= n; b++) {
    const was = bodies[b - 1]!;
    if (!(lowest[b]! < was.surface)) continue;
    const surface = minY + Math.floor((lowest[b]! - RIM_OVER - minY) / stepY + 1e-6) * stepY;
    drop[b] = was.surface - surface;
    bodies[b - 1] = { ...was, surface };
    lowered++;
    farthest = Math.max(farthest, drop[b]!);
  }
  const wet = new Uint8Array(n + 1), up = new Uint8Array(n + 1), had = new Uint8Array(n + 1);
  const beside = (i: number): number[] => {
    const col = i % nx;
    return [col > 0 ? i - 1 : -1, col < nx - 1 ? i + 1 : -1, i - nx, i + nx].filter((j) => j >= 0 && j < nx * nz);
  };
  for (const [k, part] of parts.entries()) {
    const b = part.body, surface = bodies[b - 1]!.surface;
    had[b] = 1;
    // The least each bed may be for a way out, from the dry ground inward: a sample's is its own bed, or a climb under
    // the lowest ground or settled bed beside it, whichever is higher. Corners do not count: the ground between two
    // samples that touch by a corner may be a ridge.
    const at = new Map(part.samples.map((i, q) => [i, q]));
    const bed = part.samples.map((i) => height[i]! - drop[b]!);
    const least = part.samples.map((i, q) => Math.max(bed[q]!, Math.min(Infinity, ...beside(i).filter((j) => body[j] === 0).map((j) => height[j]!)) - r.poolClimb));
    const done = new Uint8Array(part.samples.length);
    for (;;) {
      let next = -1;
      for (let q = 0; q < least.length; q++) if (!done[q] && least[q]! < Infinity && (next < 0 || least[q]! < least[next]!)) next = q;
      if (next < 0) break;
      done[next] = 1;
      const i = part.samples[next]!;
      for (const j of beside(i)) {
        const q = partOf.get(j) === k ? at.get(j)! : -1;
        if (q < 0 || done[q]) continue;
        // Wide enough to swim: the two samples beside these two, on one side or the other, are the part's as well.
        const across = Math.abs(j - i) === 1 ? nx : 1;
        const wide = [across, -across].some((d) => (across === nx || Math.floor((i + d) / nx) === Math.floor(i / nx)) && partOf.get(i + d) === k && partOf.get(j + d) === k);
        if (wide) least[q] = Math.min(least[q]!, Math.max(bed[q]!, least[next]! - r.poolClimb));
      }
    }
    let deepest = 0;
    part.samples.forEach((i, q) => {
      const to = least[q]! < Infinity ? least[q]! : bed[q]!;
      if (to > bed[q]! + 1e-6) up[b] = 1;
      height[i] = to;
      deepest = Math.max(deepest, surface - to);
    });
    if (deepest < LEAST_DEPTH) for (const i of part.samples) body[i] = 0;
    else wet[b] = 1;
  }
  let dried = 0, crossed = 0, held = 0;
  for (let b = 1; b <= n; b++) {
    crossed += across[b]!;
    held += up[b]!;
    if ((had[b] || across[b]) && !wet[b]) dried++;
  }
  return { lowered, farthest, dried, crossed, held };
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
