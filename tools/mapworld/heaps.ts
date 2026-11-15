// What the buildings left: a heap of rubble on each footprint, higher and rougher where the building stood taller, with a
// broken plinth round its edge, slabs and a stair core standing out of the tallest, low walled halls where a big low
// building stood, flooded rings where tanks stood, courtyards left hollow, and a skirt of spill that stops at the kerb.
// Every shape is drawn from hashes of the building's id and of places, so a rebuild gives the same heights.

import { distanceField, fbm, fillPolygon, hash3, rand3 } from "./raster.ts";

/** What kind of ruin a footprint left. */
export const RUIN_HEAP = 1;
export const RUIN_HALL = 2;
export const RUIN_TANK = 3;

/** A sample's part of a ruin, for colour and for what grows there. */
export const PART_NONE = 0;
export const PART_HEAP = 1;
export const PART_SPILL = 2;
export const PART_WALL = 3;
export const PART_FLOOR = 4;
export const PART_POOL = 5;
export const PART_COURT = 6;

export interface Building {
  readonly id: number;
  /** Metres east and north of the map's centre. */
  readonly rings: readonly (readonly (readonly number[])[])[];
  readonly area: number;
  readonly perimeter: number;
  readonly e: number;
  readonly n: number;
  /** What USA Structures says of it, where it says (base/buildings_attributes.json): its height in metres and its use. */
  readonly height: number | null;
  readonly use: string | null;
}

export interface Ruin {
  readonly building: Building;
  readonly kind: number;
  /** Storeys it is taken to have had, and the heap's crest above the ground, in metres. */
  readonly storeys: number;
  readonly crest: number;
  readonly district: number;
}

export interface Grid {
  /** Samples a side, 2 m apart, row 0 at the north. */
  readonly n: number;
  readonly half: number;
  readonly cell: number;
}

export interface HeapInput {
  readonly grid: Grid;
  readonly buildings: readonly Building[];
  /** The district each building's centre is in, and how tall that district builds from 0 to 1. */
  readonly districtOf: (e: number, n: number) => { index: number; tall: number; industrial: boolean };
  /** Ground under the ruins, in metres above the sea. */
  readonly ground: Float32Array;
  readonly road: Uint8Array;
  readonly water: Uint8Array;
}

export interface Heaps {
  /** Metres added to the ground, or for a tank's pool the metres it is cut down. */
  readonly lift: Float32Array;
  readonly part: Uint8Array;
  /** Per sample, the index of the ruin it belongs to or spilled from, or -1. */
  readonly owner: Int32Array;
  readonly ruins: readonly Ruin[];
}

const area = (ring: readonly (readonly number[])[]): number => {
  let a = 0;
  for (let k = 0; k + 1 < ring.length; k++) a += ring[k]![0]! * ring[k + 1]![1]! - ring[k + 1]![0]! * ring[k]![1]!;
  return a / 2;
};

/** The buildings of a GeoJSON collection in metres, each polygon of a multipolygon its own. */
export function readBuildings(geojson: { features: { geometry: { type: string; coordinates: unknown }; properties: { id: number } }[] }, about: ReadonlyMap<number, { height: number | null; use: string | null }> = new Map()): Building[] {
  const out: Building[] = [];
  for (const f of geojson.features) {
    const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    polys.forEach((rings, k) => {
      let a = Math.abs(area(rings[0]!));
      for (const hole of rings.slice(1)) a -= Math.abs(area(hole));
      let p = 0;
      let ce = 0;
      let cn = 0;
      const outer = rings[0]!;
      for (let i = 0; i + 1 < outer.length; i++) {
        p += Math.hypot(outer[i + 1]![0]! - outer[i]![0]!, outer[i + 1]![1]! - outer[i]![1]!);
        ce += outer[i]![0]!;
        cn += outer[i]![1]!;
      }
      const known = about.get(f.properties.id);
      out.push({ id: f.properties.id * 4 + k, rings, area: a, perimeter: p, e: ce / (outer.length - 1), n: cn / (outer.length - 1), height: known?.height ?? null, use: known?.use ?? null });
    });
  }
  return out;
}

/** Storeys a building is taken to have had: a house or a block from its footprint, and a tower where the district builds tall. */
function storeysOf(b: Building, tall: number): number {
  // Its surveyed height where there is one, at 3.3 m a storey; else a guess from its footprint and its district.
  if (b.height !== null && b.height > 0) return Math.max(1, b.height / 3.3);
  const low = Math.min(4.5, Math.max(1, 1 + Math.log2(Math.max(60, b.area) / 110)));
  const u = rand3(b.id, 11, 0);
  const fits = Math.min(1, Math.max(0, (b.area - 250) / 1000)) * (b.area < 12000 ? 1 : 0.3);
  const tower = tall * fits * (8 + 52 * u ** 1.6);
  return Math.max(low, tower);
}

export function makeHeaps(input: HeapInput): Heaps {
  const { grid, buildings, ground, road, water } = input;
  const { n, half, cell } = grid;
  const lift = new Float32Array(n * n);
  const part = new Uint8Array(n * n);
  const owner = new Int32Array(n * n).fill(-1);
  const court = new Uint8Array(n * n);
  const ruins: Ruin[] = [];
  const toCol = (e: number): number => (e + half) / cell;
  const toRow = (no: number): number => (half - no) / cell;
  // Spill reaches this far round each ruin, and stands this high at its foot.
  const reach: number[] = [];
  const foot: number[] = [];

  for (const b of buildings) {
    const d = input.districtOf(b.e, b.n);
    const round = (4 * Math.PI * b.area) / (b.perimeter * b.perimeter);
    const storeys = storeysOf(b, d.tall);
    const kind = d.industrial && round > 0.8 && b.area > 150 && b.area < 6000 ? RUIN_TANK : b.area > 4000 && storeys < 6 ? RUIN_HALL : RUIN_HEAP;
    const crest = kind === RUIN_HEAP ? Math.min(20, 0.8 + 0.35 * storeys) : kind === RUIN_HALL ? 2 + 2 * rand3(b.id, 5, 0) : 2.6;
    const r = ruins.length;
    ruins.push({ building: b, kind, storeys, crest, district: d.index });
    reach.push(kind === RUIN_HEAP ? 1.5 + 0.5 * crest : 3);
    foot.push(kind === RUIN_HEAP ? Math.min(0.45 * crest, 6) : 0.8);

    // The footprint in a window round it, and how far each of its samples is from its edge.
    let c0 = Infinity;
    let c1 = -Infinity;
    let r0 = Infinity;
    let r1 = -Infinity;
    for (const [e, no] of b.rings[0]!) {
      c0 = Math.min(c0, toCol(e!));
      c1 = Math.max(c1, toCol(e!));
      r0 = Math.min(r0, toRow(no!));
      r1 = Math.max(r1, toRow(no!));
    }
    const wc0 = Math.max(0, Math.floor(c0) - 1);
    const wr0 = Math.max(0, Math.floor(r0) - 1);
    const ww = Math.min(n - 1, Math.ceil(c1) + 1) - wc0 + 1;
    const wh = Math.min(n - 1, Math.ceil(r1) + 1) - wr0 + 1;
    if (ww <= 0 || wh <= 0) continue;
    const inside = new Uint8Array(ww * wh);
    fillPolygon(b.rings, toCol, toRow, n, n, (col, row) => (inside[(row - wr0) * ww + col - wc0] = 1));
    // A courtyard is inside the outer ring and outside the footprint.
    if (b.rings.length > 1) {
      fillPolygon([b.rings[0]!], toCol, toRow, n, n, (col, row) => {
        if (inside[(row - wr0) * ww + col - wc0] === 0) court[row * n + col] = 1;
      });
    }
    const depth = distanceField((i) => inside[i] === 0, ww, wh);
    let deepest = 0;
    let core = -1;
    for (let i = 0; i < ww * wh; i++) {
      if (inside[i] && depth[i]! > deepest) {
        deepest = depth[i]!;
        core = i;
      }
    }
    const slope = Math.tan(((30 + 18 * rand3(b.id, 3, 0)) * Math.PI) / 180);
    const plinth = 0.5 + 1.2 * rand3(b.id, 4, 0);
    const step = 1.7 + 0.7 * rand3(b.id, 8, 0);
    // Slabs lying across the heap: a centre on the footprint, a length, a width, a turn and a rise from one end to the other.
    const slabs: number[] = [];
    if (kind === RUIN_HEAP && crest > 5) {
      const cells: number[] = [];
      for (let i = 0; i < ww * wh; i++) if (inside[i]) cells.push(i);
      for (let s = 0; s < Math.floor(crest / 5) && cells.length > 0; s++) {
        const at = cells[hash3(b.id, 20 + s, 0) % cells.length]!;
        slabs.push((at % ww) * cell, Math.floor(at / ww) * cell, 6 + 8 * rand3(b.id, 21, s), 2 + 2 * rand3(b.id, 22, s), Math.PI * rand3(b.id, 23, s), 1 + 0.25 * crest * rand3(b.id, 24, s));
      }
    }
    // A tower's core and lower floors still stand out of its heap, in the building's own outline, broken off unevenly.
    const stub = storeys > 18 && core >= 0 ? crest * (0.3 + 0.4 * rand3(b.id, 6, 0)) : 0;
    const coreDepth = Math.max(4, 0.3 * Math.sqrt(deepest) * cell);
    for (let j = 0; j < wh; j++) {
      for (let i = 0; i < ww; i++) {
        const k = j * ww + i;
        if (!inside[k]) continue;
        const col = wc0 + i;
        const row = wr0 + j;
        const at = row * n + col;
        if (water[at]) continue;
        const dIn = Math.sqrt(depth[k]!) * cell;
        const x = col * cell;
        const z = row * cell;
        let h: number;
        let p = PART_HEAP;
        if (kind === RUIN_TANK) {
          if (dIn <= 2.2) {
            h = crest;
            p = PART_WALL;
          } else {
            // The tank holds water: its floor below the sea, whatever the ground outside.
            h = -0.9 - ground[at]!;
            p = PART_POOL;
          }
        } else if (kind === RUIN_HALL) {
          // Walls stand round the edge, broken by gaps; inside, the roof lies in a low, uneven floor of rubble.
          const broken = fbm(x, z, 9, b.id & 0xffff) < 0.38;
          if (dIn <= 2.2 && !broken) {
            h = crest * (0.75 + 0.5 * fbm(x, z, 5, 77));
            p = PART_WALL;
          } else {
            h = 0.35 + 1.1 * fbm(x, z, 7, (b.id >>> 3) & 0xffff) + Math.min(0.6, dIn * 0.1);
            p = PART_FLOOR;
          }
        } else {
          const gap = fbm(x, z, 10, (b.id >>> 2) & 0xffff) < 0.35;
          const edge = gap ? 0.15 : plinth;
          h = Math.min(crest, edge + dIn * slope);
          const rough = fbm(x, z, 6, (b.id >>> 5) & 0xffff);
          h *= 0.82 + 0.36 * rough;
          // A tall heap is its floors fallen one on another: ledges a body can stand on, risers it must jump, and here
          // and there a stretch where the rubble has run into a slope that walks.
          if (crest > 6 && fbm(x, z, 12, (b.id >>> 9) & 0xffff) > 0.3) {
            const f = h / step;
            const k = Math.floor(f);
            h = h * 0.25 + (k + Math.min(1, Math.max(0, (f - k - 0.65) / 0.35))) * step * 0.75;
          }
          h += (fbm(x, z, 2.5, (b.id >>> 7) & 0xffff) - 0.5) * 0.12 * crest * Math.min(1, dIn / 3);
          for (let s = 0; s < slabs.length; s += 6) {
            const dx = (i * cell - slabs[s]!) * Math.cos(slabs[s + 4]!) + (j * cell - slabs[s + 1]!) * Math.sin(slabs[s + 4]!);
            const dz = -(i * cell - slabs[s]!) * Math.sin(slabs[s + 4]!) + (j * cell - slabs[s + 1]!) * Math.cos(slabs[s + 4]!);
            if (Math.abs(dx) < slabs[s + 2]! / 2 && Math.abs(dz) < slabs[s + 3]! / 2) h = Math.max(h, Math.min(crest * 1.1, h * 0.6 + slabs[s + 5]! * (0.5 + dx / slabs[s + 2]!) + 0.8));
          }
          if (stub > 0 && dIn >= coreDepth) {
            const broken = fbm(x, z, 8, (b.id >>> 11) & 0xffff);
            h = Math.max(h, crest + stub * (broken < 0.35 ? 0.45 : 1) + (fbm(x, z, 3, 991) - 0.5) * 3);
            p = PART_WALL;
          }
        }
        if (h > lift[at]! || owner[at]! < 0 || p === PART_POOL) {
          lift[at] = h;
          part[at] = p;
          owner[at] = r;
        }
      }
    }
  }

  // Spill round each ruin from its nearest footprint sample, low on streets and in courtyards, none in the water.
  const nearest = new Int32Array(n * n);
  const d2 = distanceField((i) => part[i] !== PART_NONE, n, n, nearest);
  for (let at = 0; at < n * n; at++) {
    if (part[at] !== PART_NONE || water[at]) continue;
    const from = nearest[at]!;
    if (from < 0) continue;
    const r = owner[from]!;
    if (r < 0) continue;
    const d = Math.sqrt(d2[at]!) * cell;
    let w = reach[r]!;
    if (court[at]) w = Math.min(w, 2.5);
    if (d >= w) {
      if (court[at]) {
        part[at] = PART_COURT;
        owner[at] = r;
      }
      continue;
    }
    const col = at % n;
    const row = (at - col) / n;
    let h = foot[r]! * (1 - d / w) ** 1.6 * (0.6 + 0.8 * fbm(col * cell, row * cell, 5, 913));
    if (road[at]) h = d > 3 ? 0 : h * 0.35;
    if (h < 0.05) continue;
    lift[at] = h;
    part[at] = court[at] ? PART_COURT : PART_SPILL;
    owner[at] = r;
  }
  return { lift, part, owner, ruins };
}
