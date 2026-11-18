// The colours of a mesh that is drawn with materials, for where it is drawn flat. They are read off its pictures,
// triangle by triangle. A triangle that is half or more dyed takes its dominant region, so an instance keeps its
// dyes at any distance. Any other is the palette colour nearest its base colour, of the few its material is given,
// so the flat creature is the textured one in a dozen colours.

import { MATERIAL_CUTOUT, type PackMaterial } from "../../shared/pack/pack.ts";
import { REGION_BASE, REGION_COUNT } from "../../shared/pack/palette.ts";
import { baseMips, halvings, square } from "./image.ts";
import { readMasks, readRegions } from "./mask.ts";
import type { MaterialMaps } from "./texture.ts";
import type { SourceLod } from "./write.ts";

/** A mesh has no more flat colours than this, its regions among them, and a material no more palette colours than a handful. */
export const MOST_COLOURS = 12;
const HANDFUL = 6;
/** A triangle keeps its dominant dye where all dye regions together cover this much of it. */
const DYED = 0.5;
/** One more palette colour is worth having where it brings the surface this much nearer its own colour: the mean square of the distance, in steps of 255. */
const WORTH = 25;

const toLinear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const toSrgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => toLinear(i / 255));

/** Where a triangle is read: the middles of the sixteen triangles it cuts into, as shares of its second and third corners. */
const SPOTS: number[] = [];
for (let i = 0; i < 4; i++) {
  for (let j = 0; i + j < 4; j++) {
    SPOTS.push((i + 1 / 3) / 4, (j + 1 / 3) / 4);
    if (i + j < 3) SPOTS.push((i + 2 / 3) / 4, (j + 2 / 3) / 4);
  }
}

/**
 * For each vertex of a level, the first vertex that is at the same point. Two are at one point where a pack would
 * store them at one place, so the two sides of a seam meet though their sources put them a hair apart.
 */
export function placed(lod: SourceLod): Uint32Array {
  const p = lod.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    if (p[i]! < min[i % 3]!) min[i % 3] = p[i]!;
    if (p[i]! > max[i % 3]!) max[i % 3] = p[i]!;
  }
  const first = new Map<string, number>();
  return Uint32Array.from({ length: p.length / 3 }, (_, v) => {
    const key = [0, 1, 2].map((a) => Math.round(((p[v * 3 + a]! - (min[a]! + max[a]!) / 2) / Math.max((max[a]! - min[a]!) / 2, 1e-4)) * 32767)).join();
    if (!first.has(key)) first.set(key, v);
    return first.get(key)!;
  });
}

/** A material's pictures as they are read: smallest first, each twice the one before across. None where it has none. */
interface Pictures {
  /** Base colour, four bytes a pixel. */
  base: Uint8Array[];
  /** How much of each region a pixel has, six numbers a pixel. */
  regions: Float32Array[];
}

function pictures(maps: MaterialMaps | undefined): Pictures {
  const regions = maps?.regions ? readRegions(maps.regions) : maps?.mask ? readMasks(maps.mask, maps.mask2) : null;
  const weights = regions && square(regions.weights, regions, REGION_COUNT);
  return { base: maps?.base ? baseMips(maps.base) : [], regions: weights ? halvings(weights.data, weights.size, REGION_COUNT) : [] };
}

/** What each triangle of a level is, over its area. */
interface Measured {
  /** How much of each region it has, six numbers a triangle. */
  regions: Float32Array;
  /** Its base colour with the material's tint, averaged as light: red, green and blue of 255. */
  colour: Float32Array;
  /** Twice its area. */
  size: Float32Array;
}

function measure(lod: SourceLod, materials: readonly PackMaterial[], from: readonly Pictures[]): Measured {
  const { positions: p, indices } = lod;
  const uvs = lod.uvs!;
  const count = indices.length / 3;
  const out: Measured = { regions: new Float32Array(count * REGION_COUNT), colour: new Float32Array(count * 3), size: new Float32Array(count) };
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!];
    const material = materials[lod.sections?.[t] ?? 0];
    if (!material) throw new Error(`a triangle is drawn with material ${lod.sections?.[t]}, which the mesh does not have`);
    const { base, regions } = from[lod.sections?.[t] ?? 0]!;
    const e = [0, 1, 2].map((k) => [p[b * 3 + k]! - p[a * 3 + k]!, p[c * 3 + k]! - p[a * 3 + k]!]);
    const cross = [e[1]![0]! * e[2]![1]! - e[2]![0]! * e[1]![1]!, e[2]![0]! * e[0]![1]! - e[0]![0]! * e[2]![1]!, e[0]![0]! * e[1]![1]! - e[1]![0]! * e[0]![1]!];
    out.size[t] = Math.sqrt(cross[0]! * cross[0]! + cross[1]! * cross[1]! + cross[2]! * cross[2]!);
    const [u0, v0] = [uvs[a * 2]!, uvs[a * 2 + 1]!];
    const [u1, v1, u2, v2] = [uvs[b * 2]! - u0, uvs[b * 2 + 1]! - v0, uvs[c * 2]! - u0, uvs[c * 2 + 1]! - v0];
    const cover = Math.abs(u1 * v2 - u2 * v1) / 2;
    // Each is read in the picture where the triangle covers about as many pixels as it has spots, so the spots see all of it.
    const pick = (mips: readonly unknown[]): number => {
      let level = 0;
      while (level < mips.length - 1 && cover * (1 << (2 * level)) < SPOTS.length / 2) level++;
      return level;
    };
    const [inBase, inRegions] = [pick(base), pick(regions)];
    // Where a material is cut out, a pixel counts by how much of it shows.
    const cut = (material.flags & MATERIAL_CUTOUT) !== 0;
    const light = [0, 0, 0];
    let shown = 0;
    for (let s = 0; s < SPOTS.length; s += 2) {
      const u = u0 + SPOTS[s]! * u1 + SPOTS[s + 1]! * u2;
      const v = v0 + SPOTS[s]! * v1 + SPOTS[s + 1]! * v2;
      const pixel = (level: number): number => {
        const side = 1 << level;
        return Math.min(side - 1, Math.max(0, Math.floor(v * side))) * side + Math.min(side - 1, Math.max(0, Math.floor(u * side)));
      };
      const at = base.length > 0 ? pixel(inBase) * 4 : -1;
      const share = cut && at >= 0 ? Math.max(base[inBase]![at + 3]! / 255, 1e-6) : 1;
      for (let k = 0; k < 3; k++) light[k]! += share * (at < 0 ? 1 : LINEAR[base[inBase]![at + k]!]!);
      shown += share;
      for (let k = 0; k < REGION_COUNT && regions.length > 0; k++) out.regions[t * REGION_COUNT + k]! += regions[inRegions]![pixel(inRegions) * REGION_COUNT + k]! / (SPOTS.length / 2);
    }
    for (let k = 0; k < 3; k++) out.colour[t * 3 + k] = toSrgb(Math.min(1, (light[k]! / shown) * material.tint[k]!)) * 255;
  }
  return out;
}

/** The distance between the colour of triangle `t` and palette colour `p`, squared. */
function gap(m: Measured, t: number, palette: Uint8Array, p: number): number {
  const [r, g, b] = [m.colour[t * 3]! - palette[p * 4]!, m.colour[t * 3 + 1]! - palette[p * 4 + 1]!, m.colour[t * 3 + 2]! - palette[p * 4 + 2]!];
  return r * r + g * g + b * b;
}

/**
 * The palette colours for the triangles `of`, `most` at the most. Each is the one that brings them nearest their own
 * colours, given those chosen before it, and the choosing stops when one more is not worth having.
 */
function choose(of: readonly number[], m: Measured, most: number, palette: Uint8Array): number[] {
  const far = new Float64Array(of.length).fill(Infinity);
  const set: number[] = [];
  let surface = 0;
  for (const t of of) surface += m.size[t]!;
  let total = Infinity;
  while (set.length < most && of.length > 0) {
    let best = 1;
    let least = Infinity;
    for (let p = 1; p < REGION_BASE; p++) {
      let sum = 0;
      for (let i = 0; i < of.length && sum < least; i++) sum += m.size[of[i]!]! * Math.min(far[i]!, gap(m, of[i]!, palette, p));
      if (sum < least) {
        least = sum;
        best = p;
      }
    }
    if (total - least < WORTH * surface) break;
    set.push(best);
    total = least;
    of.forEach((t, i) => (far[i] = Math.min(far[i]!, gap(m, t, palette, best))));
  }
  return set;
}

/** Takes out single triangles of a colour: one that no neighbour shares its colour with takes the colour two of its neighbours share. */
function settle(lod: SourceLod, colours: Uint8Array): void {
  // Triangles are neighbours across an edge between two points, whichever vertices they have there.
  const at = placed(lod);
  const edge = (t: number, k: number): number => {
    const [a, b] = [at[lod.indices[t * 3 + k]!]!, at[lod.indices[t * 3 + ((k + 1) % 3)]!]!];
    return a < b ? a * at.length + b : b * at.length + a;
  };
  const onEdge = new Map<number, number[]>();
  for (let t = 0; t < colours.length; t++) {
    for (let k = 0; k < 3; k++) {
      const list = onEdge.get(edge(t, k));
      if (list) list.push(t);
      else onEdge.set(edge(t, k), [t]);
    }
  }
  // A triangle that changes ends beside two of its new colour, and none of the three changes again, so this ends.
  for (let changed = true; changed; ) {
    changed = false;
    for (let t = 0; t < colours.length; t++) {
      const beside: number[] = [];
      for (let k = 0; k < 3; k++) for (const other of onEdge.get(edge(t, k))!) if (other !== t) beside.push(colours[other]!);
      const twice = beside.includes(colours[t]!) ? undefined : beside.find((colour, i) => beside.indexOf(colour) !== i);
      if (twice === undefined) continue;
      colours[t] = twice;
      changed = true;
    }
  }
}

/**
 * Reads a mesh's pictures onto its levels. `fine` settles which colours the mesh has: the regions that dye a triangle
 * of it, and for each material a few palette colours for the triangles that no region dyes. What comes back gives a
 * level of the mesh the colour of each of its triangles, from among those, so every level is the same creature.
 * `maps` has the pictures of each of `materials`, of which the base colour and the regions are read.
 */
export function baker(fine: SourceLod, materials: readonly PackMaterial[], maps: readonly MaterialMaps[], palette: Uint8Array): (lod: SourceLod) => Uint8Array {
  const from = materials.map((_, k) => pictures(maps[k]));
  /** Dominant allowed region where total dye coverage reaches `least`; -1 for an undyed majority. */
  const dye = (m: Measured, t: number, allowed: (k: number) => boolean, least: number): number => {
    let best = -1;
    let dyed = 0;
    for (let k = 0; k < REGION_COUNT; k++) {
      const weight = m.regions[t * REGION_COUNT + k]!;
      dyed += weight;
      if (allowed(k) && weight > 0 && (best < 0 || weight > m.regions[t * REGION_COUNT + best]!)) best = k;
    }
    // The surface renderer computes undyed as 1-sum(mask,mask2). Requiring
    // one region alone to reach half incorrectly calls a fully dyed three-
    // region transition plain and bakes its neutral albedo as a white band.
    return dyed >= least ? best : -1;
  };
  const first = measure(fine, materials, from);
  const used = new Set<number>();
  const plain: number[][] = materials.map(() => []);
  for (let t = 0; t < first.size.length; t++) {
    const k = dye(first, t, () => true, DYED);
    if (k >= 0) used.add(k);
    else plain[fine.sections?.[t] ?? 0]!.push(t);
  }
  const most = Math.max(1, Math.min(HANDFUL, Math.floor((MOST_COLOURS - used.size) / Math.max(1, plain.filter((of) => of.length > 0).length))));
  const sets = plain.map((of) => choose(of, first, most, palette));
  return (lod) => {
    const m = lod === fine ? first : measure(lod, materials, from);
    const colours = new Uint8Array(m.size.length);
    for (let t = 0; t < colours.length; t++) {
      const set = sets[lod.sections?.[t] ?? 0]!;
      // A material that is dyed all over has no colours of its own, and its triangles go to the region they have most of.
      const k = dye(m, t, (region) => used.has(region), set.length > 0 ? DYED : 0);
      if (k >= 0) colours[t] = REGION_BASE + k;
      else colours[t] = set.reduce((best, p) => (gap(m, t, palette, p) < gap(m, t, palette, best) ? p : best), set[0] ?? 0);
    }
    settle(lod, colours);
    return colours;
  };
}

/**
 * `lod` in the colours its triangles have where it is drawn flat, still with its surface. A triangle is drawn in the
 * colour of its last corner, and a vertex has one colour whichever triangles end on it. So a vertex takes the colour
 * most of the triangles at it have, and each triangle is turned to end on a corner of its own colour. The few that
 * have none, along the edge of a colour, show their neighbour's.
 */
export function painted(lod: SourceLod, colours: Uint8Array): SourceLod {
  const indices = lod.indices.slice();
  const colors = new Uint8Array(lod.positions.length / 3);
  const at: number[][] = Array.from(colors, () => []);
  indices.forEach((v, i) => at[v]!.push(Math.floor(i / 3)));
  at.forEach((list, v) => {
    const of = list.map((t) => colours[t]!);
    colors[v] = of.reduce((best, colour) => (of.filter((c) => c === colour).length > of.filter((c) => c === best).length ? colour : best), of[0] ?? 0);
  });
  /** Whether triangle `t` has a corner of its colour, not counting vertex `but`. */
  const has = (t: number, but = -1): boolean => [0, 1, 2].some((k) => indices[t * 3 + k] !== but && colors[indices[t * 3 + k]!] === colours[t]);
  for (let t = 0; t < colours.length; t++) {
    // A triangle without one, as a small patch of colour may be, takes over a corner that no other triangle needs.
    const spare = has(t) ? undefined : indices.subarray(t * 3, t * 3 + 3).find((v) => at[v]!.every((other) => colours[other] !== colors[v] || has(other, v)));
    if (spare !== undefined) colors[spare] = colours[t]!;
  }
  for (let t = 0; t < colours.length; t++) {
    // Three turns bring a triangle back to where it began, so one that still has none is left as it was.
    for (let turn = 0; turn < 3 && colors[indices[t * 3 + 2]!] !== colours[t]; turn++) indices.set([indices[t * 3 + 1]!, indices[t * 3 + 2]!, indices[t * 3]!], t * 3);
  }
  return { ...lod, colors, indices };
}

/**
 * `lod` as a flat level with every triangle in its colour, each on three vertices of its own. Vertices at one point
 * are put exactly there, so that simplify() makes one of them.
 */
export function flatOf(lod: SourceLod, colours: Uint8Array): SourceLod {
  const n = lod.indices.length;
  const at = placed(lod);
  const out: SourceLod = { positions: new Float32Array(n * 3), colors: new Uint8Array(n), indices: Uint32Array.from({ length: n }, (_, i) => i) };
  if (lod.bones) out.bones = new Uint8Array(n);
  lod.indices.forEach((v, i) => {
    out.positions.set(lod.positions.subarray(at[v]! * 3, at[v]! * 3 + 3), i * 3);
    out.colors[i] = colours[Math.floor(i / 3)]!;
    if (out.bones) out.bones[i] = lod.bones![v]!;
  });
  return out;
}
