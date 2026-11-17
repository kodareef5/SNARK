// A client's ground as it comes a part at a time (shared/world/heightfield.ts): every sample filled from its overview, then
// each sector's own set over it, in any order, with a record of which chunks hold their own.

import { expect, test } from "bun:test";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_STEP, joinParts, mapHeightfield, parseMap, readHead, readPart, setGround, writeMap, type GroundPiece, type MapHead, type OverviewPiece } from "../../shared/world/mapfile.ts";
import { coarseGround } from "../../client/core/render/terrain.ts";
import { wideMap } from "../fixtures/map.ts";

const PER = CHUNK_SIZE / TERRAIN_CELL;
/** Off the lattice's grids: two overviews and ten sectors, the first column of each 8 chunks wide. */
const file = writeMap(wideMap());
const whole = mapHeightfield(parseMap(file));

/** A map's file read as a client takes it: its head, its overviews and its sectors' grounds, each read alone. */
function partsOf(file: Uint8Array): { head: MapHead; overviews: OverviewPiece[]; grounds: GroundPiece[] } {
  const head = readHead(file);
  const read = (kind: string) => head.parts.filter((p) => p.kind === kind).map((p) => readPart(head, p, file.subarray(p.at, p.at + p.length)));
  return { head, overviews: read("overview") as OverviewPiece[], grounds: read("ground") as GroundPiece[] };
}

/** The ground of the map with no sector held, every sample `poison` until an overview fills it. */
function staged(head: MapHead, poison = 65535): Heightfield {
  const hf = mapHeightfield(joinParts(head, [], false));
  hf.heights.fill(poison);
  hf.holdNone();
  return hf;
}

const fill = (hf: Heightfield, o: OverviewPiece): void => hf.fill(o.sq.cx0, o.sq.cz0, o.sq.cx1, o.sq.cz1, OVERVIEW_STEP, o.heights, o.tint);
const land = (hf: Heightfield, g: GroundPiece): void => (setGround(hf.dims, hf.heights, hf.tint, g), hf.hold(g.sq.cx0, g.sq.cz0, g.sq.cx1, g.sq.cz1));

test("a sample not yet held is its overview's: as an 8 m tile draws it, its two triangles split as the ground's, and its nearest coarse sample's tint", () => {
  const { head, overviews } = partsOf(file);
  const hf = staged(head);
  for (const o of overviews) fill(hf, o);
  // The overview's ground as a heightfield of 8 m, whose heightAt is the triangles the coarse tiles draw.
  const coarse = new Heightfield(head.dims, TERRAIN_CELL * OVERVIEW_STEP, head.minY, head.stepY, Uint16Array.from(coarseGround(whole).heights));
  let wrong = 0;
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const want = Math.round((coarse.heightAt(i * hf.cell, j * hf.cell) - head.minY) / head.stepY);
      const near = (Math.round(j / OVERVIEW_STEP) * OVERVIEW_STEP) * hf.nx + Math.round(i / OVERVIEW_STEP) * OVERVIEW_STEP;
      if (hf.heights[j * hf.nx + i] !== want || hf.tint[j * hf.nx + i] !== whole.tint[near]) wrong++;
    }
  }
  expect(wrong).toBe(0);
  // Every fourth sample is the map's own, so the whole map's picture on the card is right before any sector comes.
  expect(coarseGround(hf)).toEqual(coarseGround(whole));
  expect([hf.exact.every((e) => e === 0), hf.exactIn(0, 0, 10, 10)]).toEqual([true, false]);
});

test("sectors set in any order over the overviews' ground leave it the map's, and the record says which chunks are their own all the while", () => {
  const { head, overviews, grounds } = partsOf(file);
  for (const seed of [1, 2, 3]) {
    const rng = new Rng(seed);
    const order = [...grounds];
    for (let k = order.length - 1; k > 0; k--) {
      const r = rng.int(k + 1);
      [order[k], order[r]] = [order[r]!, order[k]!];
    }
    const hf = staged(head);
    // An overview may even come after a sector it covers: the sector's samples, its edges among them, stay its own.
    const late = overviews.slice(seed % 2);
    for (const o of overviews.slice(0, seed % 2)) fill(hf, o);
    land(hf, order[0]!);
    for (const o of late) fill(hf, o);
    const filled = Uint16Array.from(hf.heights);
    for (const g of order.slice(1)) land(hf, g);
    // Each chunk is the map's own once its sector came, and the overviews' before, but for its edges a sector held shares.
    expect([hf.heights, hf.tint, hf.exact.every((e) => e === 1)]).toEqual([whole.heights, whole.tint, true]);
    const first = order[0]!.sq;
    let moved = 0;
    for (let j = first.cz0 * PER; j <= first.cz1 * PER; j++) for (let i = first.cx0 * PER; i <= first.cx1 * PER; i++) if (filled[j * hf.nx + i] !== whole.heights[j * hf.nx + i]) moved++;
    expect([moved, hf.changes.length / 4]).toEqual([0, overviews.length + grounds.length]);
  }
});

test("a box is exact where every chunk it touches holds its own, the box held to the map", () => {
  const { head, overviews, grounds } = partsOf(file);
  const hf = staged(head);
  for (const o of overviews) fill(hf, o);
  const g = grounds.find((p) => p.sq.cx0 > 0 && p.sq.cz0 > 0)!;
  land(hf, g);
  const [x0, z0, x1, z1] = [g.sq.cx0 * CHUNK_SIZE, g.sq.cz0 * CHUNK_SIZE, g.sq.cx1 * CHUNK_SIZE, g.sq.cz1 * CHUNK_SIZE];
  expect(hf.exactIn(x0, z0, x1 - 0.01, z1 - 0.01)).toBe(true);
  expect(hf.exactIn(x0 - 0.01, z0, x1 - 0.01, z1 - 0.01)).toBe(false);
  expect(hf.exactIn(x0, z0, x1, z1 - 0.01)).toBe(g.sq.cx1 === head.dims.chunksX);
  // A whole map's ground holds all its own, off its edges too.
  expect([whole.exactIn(-500, -500, 1e6, 1e6), whole.changes.length]).toEqual([true, 0]);
  const [a, b] = [hf.exact.filter((e) => e === 1).length, (g.sq.cx1 - g.sq.cx0) * (g.sq.cz1 - g.sq.cz0)];
  expect(a).toBe(b);
});
