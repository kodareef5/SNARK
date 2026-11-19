import { hash3 } from "./raster.ts";
import { SIDES, tileKey, type Tile } from "./ruin-geometry.ts";

/**
 * A tower's top, read from a kilometre: torn (several storeys and two bays gone from a corner or a side, ragged), ragged
 * (a lost top whose storeys stand at many heights round a core left standing), a third of its plan set back, a plant
 * floor with a room over its middle, or a tall screen round its roof with a notch broken out of it.
 */
export type CrownKind = "torn" | "ragged" | "third" | "plant" | "screen";

export interface Crown {
  readonly kind: CrownKind;
  /** Tiles whose top storeys were torn away: their walls end in broken tops, and a taller tile's side toward one is open. */
  readonly torn: ReadonlySet<Tile>;
  /** A plant floor's room over the middle of the roof: the tiles raised two storeys or more over the rest. */
  readonly raised: ReadonlySet<Tile>;
  /** A screen's notch: the side it is broken out of and the tiles along it that have none, a storey or more lower. */
  readonly notch: { readonly side: number; readonly tiles: ReadonlySet<Tile> } | null;
}

export interface CrownSite {
  readonly tiles: readonly Tile[];
  readonly bay: number;
  readonly floors: number;
  readonly playable: number;
  /** The stair cores and their escapes: the lift shaft is what stands tallest of a lost top. */
  readonly cores: readonly Tile[];
  readonly escape: readonly Tile[];
  readonly safe: (t: Tile) => boolean;
  readonly damaged: ReadonlySet<Tile>;
  /** Each tile's storeys, set as the crown asks. */
  readonly tops: Map<string, number>;
  readonly lost: boolean;
  readonly seed: number;
  /** The failure's corner, in the building's metres. */
  readonly corner: readonly [number, number];
  /** "curtain" for an office's glass, else the walls of flats and hotels. */
  readonly shell: string;
}

/**
 * A tower's top (twelve storeys or more): its tiles' storeys set and what the walls and roof then wear. Every tile keeps
 * the storey over the playable floors, where the refuge is; above it nothing is walked, so a core may be cut down too.
 * Null where a tower has too few storeys over that for a top to read.
 */
export function crownOf(s: CrownSite): Crown | null {
  const { tiles, bay, floors, playable, tops } = s;
  const least = playable + 1;
  const room = floors - least;
  if (room < 2) return null;
  const h = (a: number, b: number, salt: number): number => hash3(s.seed + salt, a, b);
  const torn = new Set<Tile>();
  const set = (t: Tile, top: number): void => {
    const was = tops.get(tileKey(t.i, t.j))!;
    const now = Math.min(floors, Math.max(least, top));
    if (now === was) return;
    tops.set(tileKey(t.i, t.j), now);
    if (now < floors) torn.add(t);
  };
  const us = tiles.map((t) => t.u), vs = tiles.map((t) => t.v);
  const [minU, maxU, minV, maxV] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const [cu, cv] = s.corner;
  const far = Math.max(1, ...tiles.map((t) => Math.hypot(t.u - cu, t.v - cv)));
  if (s.lost) {
    // A lost top stands at many heights: the lift's core whole, a spire over the tiles round it, which stand a few storeys
    // lower each, and the rest lower still toward where it failed, a storey up or down by seed. So that a row of them is
    // not a row of spires, one in three keeps its core and the stair beside it whole together, two bays standing, and one
    // in three has its core broken off a storey over the rest.
    const spire = h(floors, tiles.length, 211) % 3;
    for (const t of tiles) {
      if (s.damaged.has(t) || s.cores.includes(t)) continue;
      const k = tileKey(t.i, t.j);
      if (s.escape.includes(t)) set(t, spire === 1 ? floors : floors - 2 - (h(t.i, t.j, 3) % 2));
      else if (s.safe(t)) set(t, floors - 3 - (h(t.i, t.j, 5) % Math.max(1, Math.ceil(room * 0.5))));
      else tops.set(k, Math.max(playable, Math.min(floors - 2, Math.floor(floors * (0.55 + 0.25 * Math.hypot(t.u - cu, t.v - cv) / far)) + (h(t.i, t.j, 7) % 3) - 1)));
      if (tops.get(k)! < floors) torn.add(t);
    }
    if (spire === 2) {
      const rest = Math.max(least, ...tiles.filter((t) => !s.cores.includes(t)).map((t) => tops.get(tileKey(t.i, t.j))!));
      for (const c of s.cores) if (!s.damaged.has(c)) set(c, rest + 1);
    }
    return { kind: "ragged", torn, raised: new Set(), notch: null };
  }
  const pick = h(floors, tiles.length, 151) % 100;
  if (floors >= least + 5 && pick < (floors >= 24 ? 35 : 25)) {
    // Torn: two bays and several storeys gone from the failure's corner, or from the middle of a side, the bays round
    // them less; each tile a storey or two more or less than the next.
    const drop = Math.min(room, Math.max(3, Math.round(room * (0.45 + 0.3 * ((h(1, 2, 157) % 100) / 100)))));
    const side = h(3, 4, 163) % 8;
    for (const t of tiles) {
      let ring: number;
      if (side < 4) ring = Math.round(Math.max(Math.abs(t.u - cu), Math.abs(t.v - cv)) / bay);
      else {
        const [dx, dz] = SIDES[side - 4]!;
        const depth = Math.round((dx ? (dx > 0 ? maxU - t.u : t.u - minU) : dz > 0 ? maxV - t.v : t.v - minV) / bay);
        const along = Math.round(Math.abs(dx ? t.v - (minV + maxV) / 2 : t.u - (minU + maxU) / 2) / bay);
        // A cleft through the building's depth, so the sky shows through it.
        ring = along <= 1 ? (depth <= 1 ? 0 : 1) : along === 2 && depth <= 1 ? 2 : 9;
      }
      const ragged = h(t.i, t.j, 159);
      if (ring <= 1) set(t, floors - drop + (ragged % 3));
      else if (ring === 2 && ragged % 2 === 0) set(t, floors - Math.round(drop * (0.25 + 0.1 * (ragged % 4))));
    }
    return { kind: "torn", torn, raised: new Set(), notch: null };
  }
  // A whole tower's crown, by its walls and its seed, so neighbours differ: glass most often sets back or screens its plant,
  // flats and hotels most often put a plant room on top.
  // A slab two bays deep or long against its depth sets back its end, which reads from a kilometre where a room or a
  // screen on its roof does not.
  const order: CrownKind[] = s.shell === "curtain" ? ["third", "third", "screen", "plant"] : ["plant", "plant", "screen", "third"];
  const spans = [maxU - minU, maxV - minV].map((d) => Math.round(d / bay) + 1).sort((a, b) => a - b);
  let kind = spans[0]! <= 2 || spans[1]! >= 1.8 * spans[0]! ? "third" : order[h(floors, 5, 167) % order.length]!;
  const inner = tiles.filter((t) => SIDES.every(([a, b]) => tops.has(tileKey(t.i + a, t.j + b))));
  if (kind === "plant" && inner.length === 0) kind = "screen";
  if (kind === "third") {
    // A third of the plan along its long axis set back a seventh of its storeys, four at least, and on a wide one the
    // third across from it half as far.
    const long = maxU - minU >= maxV - minV;
    const at = (t: Tile): number => Math.round(((long ? t.u : t.v) - (long ? minU : minV)) / bay);
    const n = at(tiles.find((t) => (long ? t.u : t.v) === (long ? maxU : maxV))!) + 1;
    const k = Math.max(1, Math.round(n / 3));
    const step = Math.max(4, Math.round(floors * 0.15));
    const high = h(5, 6, 173) % 2 === 1;
    const both = n >= 4 && h(6, 7, 179) % 3 === 0;
    for (const t of tiles) {
      const from = high ? n - 1 - at(t) : at(t);
      if (from < k) set(t, floors - step);
      else if (both && n - 1 - from < k) set(t, floors - Math.ceil(step / 2));
    }
    // A set-back storey is a whole storey of the kind's walls, not torn.
    torn.clear();
    return { kind, torn, raised: new Set(), notch: null };
  }
  if (kind === "plant") {
    // Two storeys, a tenth of the tower's on a tall one, and its lift's overrun over them, so it reads from a kilometre
    // where one storey is two pixels. It steps: the room's edge stands half as high as its middle (the tiles inside it,
    // or else the cores), so it reads as plant on a roof and not a second building on the first.
    const rise = Math.max(2, Math.round(floors / 10));
    const deep = new Set(inner.filter((t) => SIDES.every(([a, b]) => inner.some((o) => o.i === t.i + a && o.j === t.j + b))));
    const middle = deep.size ? deep : new Set(inner.filter((t) => s.cores.includes(t)));
    for (const t of inner) tops.set(tileKey(t.i, t.j), floors + (middle.has(t) || middle.size === 0 ? rise : Math.ceil(rise / 2)));
    return { kind, torn, raised: new Set(inner), notch: null };
  }
  // A screen round the roof, broken out along one or two bays of one side.
  const side = h(7, 8, 181) % 4;
  const [dx, dz] = SIDES[side]!;
  const edge = tiles.filter((t) => !tops.has(tileKey(t.i + dx, t.j + dz))).sort((a, b) => (dx ? a.v - b.v : a.u - b.u));
  const from = h(8, 9, 191) % Math.max(1, edge.length - 1);
  const notch = new Set(edge.slice(from, from + 1 + (h(9, 10, 193) % 2)));
  // The notch takes the storeys under the screen too, a twelfth of the tower's and one at least.
  for (const t of notch) set(t, floors - Math.max(1, Math.round(floors / 12)));
  return { kind: "screen", torn, raised: new Set(), notch: { side, tiles: notch } };
}
