// A building's id from its footprint's own place and shape, so it is the same building's when the data is downloaded
// again and its rows come renumbered or in another order, and on a cut of the map or the map widened.
//
// The id is 48 bits of two hashes of three whole numbers: the footprint's middle on the lattice (shared/coords.ts), snapped
// to a quarter metre along x and z, and its area to a square metre. The middle is the mean of its outer ring's corners and
// the area its rings', so neither changes with the corner a ring starts at or the way it winds. Footprints that come to the
// same three numbers, as a footprint listed twice does, are put in the order of their shapes (perimeter, corners, then each
// corner's place from the middle, least first) and each after the first hashes its place in that order in too; so does one
// whose 48 bits another's already are. Two whose shapes are the same to a millimetre keep the order they came in, which
// is all that tells them apart.

import type { Building } from "./heaps.ts";

/** Steps a metre the middle is snapped to. */
const SNAP = 4;

/** 32 mixed bits of four whole numbers. */
function mix(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2d) ^ Math.imul(d + 0x51ed270b, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** 32 mixed bits of a building's id, all 48 of its bits read: what seeds its heap, its layout, its tint and its roof. */
export const seedOf = (id: number): number => mix(id % 4294967296, Math.floor(id / 4294967296), 0x5eed, 0x48);

/** The 48 bits of (x, z, area) and a place `nth` among those that share them. */
function idOf(x: number, z: number, area: number, nth: number): number {
  return (mix(x, z, area, nth * 2 + 1) & 0xffff) * 4294967296 + mix(x, z, area, nth * 2);
}

/** A footprint's shape as numbers to order it by: its perimeter and corners, then each corner from its middle, in millimetres, sorted. */
function shapeOf(b: Building): number[] {
  const corners: number[][] = [];
  for (const ring of b.rings) for (let k = 0; k + 1 < ring.length; k++) corners.push([Math.round((ring[k]![0]! - b.e) * 1000), Math.round((ring[k]![1]! - b.n) * 1000)]);
  corners.sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);
  return [Math.round(b.perimeter * 1000), corners.length, ...corners.flat()];
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let k = 0; k < a.length && k < b.length; k++) if (a[k] !== b[k]) return a[k]! - b[k]!;
  return a.length - b.length;
}

/**
 * The id of each of `buildings`, in their order: whole, below 2^48, and no two the same. `toLattice` gives the lattice x
 * and z of a point in metres east and north of the projection's centre, as the footprints are (Site.toLattice).
 */
export function buildingIds(buildings: readonly Building[], toLattice: (e: number, n: number) => readonly [number, number]): number[] {
  const keys = buildings.map((b) => {
    const [x, z] = toLattice(b.e, b.n);
    return [Math.round(x * SNAP), Math.round(z * SNAP), Math.round(b.area)] as const;
  });
  // In the order of their numbers and then their shapes, which no order of the rows changes: each takes the id of its
  // place among those that share its numbers, or the next one no footprint before it has.
  const shapes = new Map<number, number[]>();
  const shape = (i: number): number[] => shapes.get(i) ?? (shapes.set(i, shapeOf(buildings[i]!)), shapes.get(i)!);
  const order = [...keys.keys()].sort((a, b) => compare(keys[a]!, keys[b]!) || compare(shape(a), shape(b)) || a - b);
  const ids = new Array<number>(buildings.length);
  const taken = new Set<number>();
  let nth = 0;
  order.forEach((i, at) => {
    const [x, z, area] = keys[i]!;
    nth = at > 0 && compare(keys[order[at - 1]!]!, keys[i]!) === 0 ? nth + 1 : 0;
    let id = idOf(x, z, area, nth);
    for (let salt = nth + 1; taken.has(id); salt++) id = idOf(x, z, area, salt);
    taken.add(id);
    ids[i] = id;
  });
  return ids;
}
