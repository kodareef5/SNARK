// Water standing above the sea, from the lakes prepare.py keeps apart from it (base/perched_water.geojson, each with the
// surface its hydro-flattened lidar stands at): each lake a body of the map's water (shared/world/water.ts), its bed carved
// under that surface. The water is where the lidar was flattened: a sample of the outline whose lidar stands over the
// surface is bank and stays land, as does one under a footprint. Flowing water (TIGER's H3 codes, a river's or a canal's
// channel) falls along its length, so it is cut into reaches a step apart, each a body of its own. An outline the lidar
// did not flatten, mostly ground over or under its surface, is no lake: it stays the marsh it was, and is reported.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Base } from "./base.ts";
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
  /** Each body's name and surface in metres over the sea, on the map's lattice of heights. */
  readonly bodies: { readonly name: string; readonly surface: number }[];
  /** Each outline: its id and name, samples of water and of bank, its bodies' surfaces from the highest, and why it is none. */
  readonly made: { readonly id: string; readonly name: string; readonly water: number; readonly bank: number; readonly surfaces: readonly number[]; readonly left?: string }[];
}

interface Feature {
  readonly geometry: { readonly type: string; readonly coordinates: unknown };
  readonly properties: { readonly id: string; readonly name?: string | null; readonly mtfcc?: string; readonly above_sea_m: number };
}

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
  const n = base.n;
  const cell = base.info.spacing_m;
  const half = base.info.size_m / 2;
  const features = (JSON.parse(readFileSync(path, "utf8")) as { features: Feature[] }).features;
  const snap = (m: number): number => minY + Math.round((m - minY) / stepY) * stepY;
  const body = new Uint16Array(n * n);
  const taken = new Uint8Array(n * n);
  const bodies: Lakes["bodies"] = [];
  const made: Lakes["made"][number][] = [];
  for (const f of features) {
    const polygons = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    const at: number[] = [];
    for (const rings of polygons) {
      fillPolygon(rings, (e) => (e + half) / cell, (no) => (half - no) / cell, n, n, (col, row) => {
        const i = row * n + col;
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
        bodies.push({ name, surface: s });
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
        for (const j of [i - 1, i + 1, i - n, i + n]) {
          if (j < 0 || j >= n * n || reached.has(j) || taken[j] === 1 || body[j] !== 0 || dry(j) || Number.isNaN(dem[j]!) || Math.abs(dem[j]! - sea - mode) > 0.05) continue;
          reached.set(j, d + 1);
          wet.push(j);
        }
      }
      // The ground round it must hold it in: little of its shore may stand under its surface.
      let rim = 0;
      let low = 0;
      for (const i of wet) {
        for (const j of [i - 1, i + 1, i - n, i + n]) {
          if (j < 0 || j >= n * n || reached.has(j)) continue;
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
      const value = new Float32Array(n * n);
      const weight = new Float32Array(n * n);
      for (const i of at) [value[i], weight[i]] = [lidar(i), 1];
      const v = blur(value, n, n, 10, 2);
      const w = blur(weight, n, n, 10, 2);
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
export function carveLakes(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, n: number, cell: number): number {
  const r = { ...DEFAULTS, ...(rules || {}) };
  const { body, bodies } = lakes;
  const shore = distanceField((i) => body[i] === 0, n, n);
  let deepest = 0;
  for (let i = 0; i < n * n; i++) {
    const b = body[i]!;
    if (b === 0) continue;
    const depth = Math.min(r.deepest, r.shoreDepth + Math.sqrt(shore[i]!) * cell * r.slope);
    height[i] = bodies[b - 1]!.surface - depth;
    deepest = Math.max(deepest, depth);
  }
  return deepest;
}

/**
 * The bodies' squares of `cell` metres for the map file, row by row from z = 0 as the engine has them: a square is the
 * body of a corner sample in one, else of a corner next to one, so that each body's squares reach over its shore.
 */
export function lakeSquares(lakes: Lakes, n: number, cell: number): Uint16Array {
  const { body } = lakes;
  // Each dry sample next to a lake takes that lake's number.
  const shore = new Uint16Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      if (body[i] !== 0) continue;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const c = col + dc;
        const r = row + dr;
        if (c >= 0 && r >= 0 && c < n && r < n && body[r * n + c] !== 0) {
          shore[i] = body[r * n + c]!;
          break;
        }
      }
    }
  }
  // Engine sample (si, sj) is base sample (n - 1 - si, n - 1 - sj): x and z count west and south from the north-west corner.
  const side = ((n - 1) * 2) / cell;
  const per = cell / 2;
  const grid = new Uint16Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let own = 0;
      let near = 0;
      for (let dj = 0; dj <= per && own === 0; dj++) {
        for (let di = 0; di <= per && own === 0; di++) {
          const k = (n - 1 - (j * per + dj)) * n + (n - 1 - (i * per + di));
          if (body[k] !== 0) own = body[k]!;
          else if (near === 0) near = shore[k]!;
        }
      }
      grid[j * side + i] = own !== 0 ? own : near;
    }
  }
  return grid;
}
