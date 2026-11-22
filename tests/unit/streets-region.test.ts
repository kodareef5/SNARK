// The streets' pictures round the camera (client/core/render/streets.ts StreetRegion, planning/workstreams/streets.md):
// a sector's part that comes or goes takes back the tiles of its own square's chunks alone, none where it is outside the
// region, and what the pictures hold after is byte for byte what filling them afresh gives; a step of a chunk brings in
// a row or a column and no more.

import { expect, test } from "bun:test";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { StreetSectors, decodeStreets, encodeStreets, heldSide, kindsByte, sideReach, type StreetCorner, type Stretch } from "../../shared/world/streets.ts";
import { STREET_CHUNKS, STREET_SIDE, STREET_TILE_BYTES, STREET_TILE_SIDE, STREET_TILES_FRAME, StreetPlanes, StreetRegion } from "../../client/core/render/streets.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";

const SPAN = SECTOR_CHUNKS * CHUNK_SIZE;
const side = heldSide(4, 1.5, 2, kindsByte(1, 1, 0));
const stretch = (xz: number[], seed: number): Stretch => ({ type: 2, flags: 0, seed, sides: [side, side], xz: Float64Array.from(xz) });
/**
 * Streets over the corner where four sectors meet, at (1024, 1024): one along x across two sectors, one along z 6 m
 * past the sectors' edge (its verge and walk reach back over it), one at 45 degrees through the corner, their corner
 * rounded, and one far off in sector (5, 5).
 */
const STRETCHES = [stretch([0, 1100, 1024, 1100, 2048, 1100], 1), stretch([1030, 0, 1030, 1024, 1030, 2048], 2), stretch([900, 900, 1150, 1150], 3), stretch([5120, 5200, 6000, 5200], 4)];
const CORNERS: StreetCorner[] = [{ cx: 1040, cz: 1110, radius: 6, reach: 6 * Math.SQRT2, ax: -1, az: 0, bx: 0, bz: -1, stretch: 0, side: 0 }];

/** Sector (col, row)'s part as the build writes it (tools/mapworld/streets/plan.ts): each stretch and corner whose reach meets its square. */
function hold(held: StreetSectors, col: number, row: number): void {
  const x0 = col * SPAN, z0 = row * SPAN;
  const meets = (lx: number, lz: number, hx: number, hz: number): boolean => hx >= x0 && lx <= x0 + SPAN && hz >= z0 && lz <= z0 + SPAN;
  const mine = new Map<number, number>();
  STRETCHES.forEach((s, k) => {
    const r = Math.max(s.sides[0].kerb + sideReach(s.sides[0]), s.sides[1].kerb + sideReach(s.sides[1])) + 1;
    const xs = s.xz.filter((_, q) => q % 2 === 0), zs = s.xz.filter((_, q) => q % 2 === 1);
    if (meets(Math.min(...xs) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...zs) + r)) mine.set(k, mine.size);
  });
  const corners = CORNERS.filter((c) => {
    const r = c.reach + 1 + sideReach(STRETCHES[c.stretch]!.sides[c.side]);
    if (!meets(c.cx - r, c.cz - r, c.cx + r, c.cz + r)) return false;
    if (!mine.has(c.stretch)) mine.set(c.stretch, mine.size);
    return true;
  });
  const part = { x0, z0, stretches: [...mine.keys()].map((k) => STRETCHES[k]!), corners: corners.map((c) => ({ ...c, stretch: mine.get(c.stretch)! })) };
  held.put(col * 4096 + row, decodeStreets(encodeStreets(part), x0, z0), col * SECTOR_CHUNKS, row * SECTOR_CHUNKS, (col + 1) * SECTOR_CHUNKS, (row + 1) * SECTOR_CHUNKS);
}
const drop = (held: StreetSectors, col: number, row: number): void => held.drop(col * 4096 + row);

/** The card's two pictures, and the tiles a region puts on them. */
class Card {
  readonly dist = new Uint8Array(STREET_SIDE * STREET_SIDE * 4);
  readonly kinds = new Uint8Array(STREET_SIDE * STREET_SIDE * 4);
  readonly region = new StreetRegion();
  private readonly p = { streetTiles: 0, streetAt: new Int32Array(STREET_TILES_FRAME * 2), streetDist: new Uint8Array(STREET_TILES_FRAME * STREET_TILE_BYTES), streetKinds: new Uint8Array(STREET_TILES_FRAME * STREET_TILE_BYTES) };
  /** Frames round chunk (ccx, ccz)'s middle until no tile is left; the chunks put on the card, as "cx,cz". */
  settle(held: StreetSectors, ccx: number, ccz: number): string[] {
    const made: string[] = [], p = this.p, half = STREET_CHUNKS / 2;
    for (;;) {
      this.region.follow(held, ccx * CHUNK_SIZE + 32, ccz * CHUNK_SIZE + 32, p as unknown as FramePacket);
      if (p.streetTiles === 0) return made.sort();
      for (let t = 0; t < p.streetTiles; t++) {
        const sx = p.streetAt[t * 2]!, sz = p.streetAt[t * 2 + 1]!;
        for (let j = 0; j < STREET_TILE_SIDE; j++) {
          const to = ((sz + j) * STREET_SIDE + sx) * 4, from = t * STREET_TILE_BYTES + j * STREET_TILE_SIDE * 4;
          this.dist.set(p.streetDist.subarray(from, from + STREET_TILE_SIDE * 4), to);
          this.kinds.set(p.streetKinds.subarray(from, from + STREET_TILE_SIDE * 4), to);
        }
        // The one chunk of the region in that place.
        const at = (c: number, s: number): number => { for (let d = -half + 1; d < half; d++) if (((c + d) & (STREET_CHUNKS - 1)) * STREET_TILE_SIDE === s) return c + d; throw new Error("no chunk there"); };
        made.push(`${at(ccx, sx)},${at(ccz, sz)}`);
      }
    }
  }
  /** The region round chunk (ccx, ccz) as the pictures hold it, its chunks in order. */
  regionBytes(ccx: number, ccz: number): number[] {
    const out: number[] = [], half = STREET_CHUNKS / 2;
    for (let cz = ccz - half + 1; cz < ccz + half; cz++) for (let cx = ccx - half + 1; cx < ccx + half; cx++) {
      const sx = (cx & (STREET_CHUNKS - 1)) * STREET_TILE_SIDE, sz = (cz & (STREET_CHUNKS - 1)) * STREET_TILE_SIDE;
      for (let j = 0; j < STREET_TILE_SIDE; j++) {
        const at = ((sz + j) * STREET_SIDE + sx) * 4;
        out.push(...this.dist.subarray(at, at + STREET_TILE_SIDE * 4), ...this.kinds.subarray(at, at + STREET_TILE_SIDE * 4));
      }
    }
    return out;
  }
}
/** The chunks cx0 up to cx1 and cz0 up to cz1, as "cx,cz", sorted as settle's. */
const chunks = (cx0: number, cz0: number, cx1: number, cz1: number): string[] => {
  const out: string[] = [];
  for (let cz = cz0; cz < cz1; cz++) for (let cx = cx0; cx < cx1; cx++) out.push(`${cx},${cz}`);
  return out.sort();
};
// The camera in chunk (16, 17): the region is chunks 9 to 23 by 10 to 24, over the four sectors round (1024, 1024).
const CX = 16, CZ = 17;
const four = (): StreetSectors => {
  const held = new StreetSectors();
  for (const [col, row] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) hold(held, col, row);
  return held;
};

test("a sector that comes or goes outside the region round the camera puts no tile on the card", () => {
  const held = four(), card = new Card();
  expect(card.settle(held, CX, CZ).length).toBe(225);
  hold(held, 5, 5);
  expect(card.settle(held, CX, CZ)).toEqual([]);
  drop(held, 5, 5);
  expect(card.settle(held, CX, CZ)).toEqual([]);
  // The sector past the region's edge that the street along x runs on into: none either.
  hold(held, 2, 1);
  expect(card.settle(held, CX, CZ)).toEqual([]);
});

test("a sector that comes within the region puts its own chunks' tiles on the card and no others, and one dropped clears its own", () => {
  const held = new StreetSectors(), card = new Card();
  for (const [col, row] of [[0, 0], [0, 1], [1, 1]] as const) hold(held, col, row);
  card.settle(held, CX, CZ);
  hold(held, 1, 0);
  expect(card.settle(held, CX, CZ)).toEqual(chunks(16, 10, 24, 16));
  // Dropped, the sector's chunks are made again with nothing held there: zeros, though the street along z, held in
  // the sector beside it, runs on into them. The street's verge and walk over the edge into the sector beside stay.
  const before = card.regionBytes(CX, CZ);
  drop(held, 1, 1);
  expect(card.settle(held, CX, CZ)).toEqual(chunks(16, 16, 24, 25));
  const after = card.regionBytes(CX, CZ), tile = STREET_TILE_SIDE * STREET_TILE_SIDE * 8;
  for (let k = 0; k < 225; k++) {
    const cx = CX - 7 + (k % 15), cz = CZ - 7 + Math.floor(k / 15), bytes = after.slice(k * tile, (k + 1) * tile);
    if (cx >= 16 && cz >= 16) expect(bytes.every((b) => b === 0)).toBe(true);
    else expect(bytes).toEqual(before.slice(k * tile, (k + 1) * tile));
  }
  expect(after.slice(((16 - 10) * 15 + 15 - 9) * tile, ((16 - 10) * 15 + 16 - 9) * tile).some((b) => b !== 0)).toBe(true);
});

test("the pictures after sectors come and go are byte for byte what filling them afresh gives", () => {
  const held = four(), card = new Card();
  card.settle(held, CX, CZ);
  drop(held, 1, 1);
  card.settle(held, CX, CZ);
  hold(held, 5, 5);
  drop(held, 0, 0);
  hold(held, 1, 1);
  hold(held, 2, 1);
  card.settle(held, CX, CZ);
  const fresh = new Card();
  fresh.settle(held, CX, CZ);
  expect(Buffer.from(card.dist).equals(Buffer.from(fresh.dist))).toBe(true);
  expect(Buffer.from(card.kinds).equals(Buffer.from(fresh.kinds))).toBe(true);
  // The twin on the processor reads the same as one made afresh.
  const planes = new StreetPlanes(held), e = new Float64Array(3), k = new Uint8Array(4), e2 = new Float64Array(3), k2 = new Uint8Array(4);
  const read = (x: number, z: number): (number | boolean)[] => [planes.at(x, z, e, k), ...e, ...k];
  const spots = [[1022, 1100], [1030, 1050], [1040, 1110], [1000, 1000], [700, 1103]] as const;
  const was = spots.map(([x, z]) => read(x, z));
  drop(held, 1, 1);
  hold(held, 1, 1);
  hold(held, 3, 3);
  expect(spots.map(([x, z]) => read(x, z))).toEqual(was);
  const afresh = new StreetPlanes(held);
  expect(spots.map(([x, z]) => [afresh.at(x, z, e2, k2), ...e2, ...k2])).toEqual(was);
});

test("a step of a chunk brings in a column, a step across a row and a column, and a step back none", () => {
  const held = four(), card = new Card();
  card.settle(held, CX, CZ);
  expect(card.settle(held, CX + 1, CZ)).toEqual(chunks(CX + 8, CZ - 7, CX + 9, CZ + 8));
  // The pictures hold 16 chunks a side and the region 15: the column left behind is kept, so a step back costs none,
  // and a step across from there brings in only the row.
  expect(card.settle(held, CX, CZ)).toEqual([]);
  expect(card.settle(held, CX + 1, CZ + 1)).toEqual(chunks(CX - 6, CZ + 8, CX + 9, CZ + 9));
  expect(card.settle(held, CX + 2, CZ + 2).length).toBe(15 + 14);
  // A sector that comes as the camera moves: only its chunks within the region, and the pictures as fresh ones.
  drop(held, 1, 1);
  card.settle(held, CX + 2, CZ + 2);
  hold(held, 1, 1);
  expect(card.settle(held, CX + 2, CZ + 2)).toEqual(chunks(16, 16, CX + 2 + 8, CZ + 2 + 8));
  const fresh = new Card();
  fresh.settle(held, CX + 2, CZ + 2);
  expect(card.regionBytes(CX + 2, CZ + 2)).toEqual(fresh.regionBytes(CX + 2, CZ + 2));
});

test("the sectors say what changed since a version, its square, until the changes kept no longer reach back", () => {
  const held = new StreetSectors(), out: number[] = [];
  const v0 = held.version;
  hold(held, 1, 0);
  drop(held, 1, 0);
  drop(held, 4, 4);
  expect(held.version).toBe(v0 + 2);
  expect(held.changedSince(v0, out)).toBe(true);
  expect(out).toEqual([16, 0, 32, 16, 16, 0, 32, 16]);
  expect(held.changedSince(held.version, out)).toBe(true);
  expect(out).toEqual([]);
  expect(held.changedSince(held.version + 1, out)).toBe(false);
  for (let k = 0; k < 70; k++) hold(held, 0, 0);
  expect(held.changedSince(v0, out)).toBe(false);
  expect(held.changedSince(held.version - 3, out)).toBe(true);
  expect(out).toEqual([0, 0, 16, 16, 0, 0, 16, 16, 0, 0, 16, 16]);
});
