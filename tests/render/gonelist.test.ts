// The map's own pieces gone as the server lists them (client/core/gonelists.ts), followed by what is drawn far away: the
// far city's levels and the city's blocks past them.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { BLOCK_SLOTS } from "../../client/core/render/cityblocks.ts";
import { CITY_BUFFER, CITY_SLOTS } from "../../client/core/render/farcity.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { WALL, building, cityWorld, type CityWorld } from "../fixtures/cityworld.ts";

const sum = (a: Uint8Array): number => a.reduce((n, v) => n + v, 0);
const mid = (cx: number, cz: number): [number, number] => [cx * CHUNK_SIZE + 32, cz * CHUNK_SIZE + 32];
const blockDraws = (p: FramePacket): number[] => [...p.drawBuffer.subarray(0, p.drawCount).keys()].filter((d) => p.drawBuffer[d] === CITY_BUFFER && p.drawSlot[d]! >= BLOCK_SLOTS && p.drawSlot[d]! < CITY_SLOTS);
const indices = (p: FramePacket, draws: number[]): number => draws.reduce((n, d) => n + p.drawIndexCount[d]!, 0);
/** Pixels of the last frame that are not as `was` has them. */
const moved = (w: CityWorld, was: Uint8ClampedArray): number => {
  let n = 0;
  for (let i = 0; i < w.W * w.H; i++) if ([0, 1, 2].some((k) => w.raster.color[i * 4 + k] !== was[i * 4 + k])) n++;
  return n;
};
/** The slots of `chunk`'s walls whose middles stand under `y`. */
const lowWalls = (w: CityWorld, chunk: number, y: number): number[] => {
  const t = w.server.chunks[chunk]!;
  return [...Array(t.high).keys()].filter((s) => w.reg.defs[t.kind[s]!]!.id === WALL && t.y[s]! < y);
};

test("a hole below a standing top is seen from afar by its list, as the far feed's tops never show it", () => {
  const [x, z] = mid(6, 6);
  const w = cityWorld({ chunks: 16, statics: building(x, z, 0, 10, 2, 5000), width: 320, height: 180 });
  const chunk = w.chunkOf(x, z);
  const doomed = lowWalls(w, chunk, 8);
  expect(doomed.length).toBeGreaterThanOrEqual(4);
  w.look(x, 6, z, 300, 0.4, 2);
  w.frame();
  const whole = w.raster.color.slice();
  for (const s of doomed) w.server.remove(chunk * 65536 + s);
  // The far feed's cells of the chunk are as they were: every top still stands.
  w.send(chunk);
  w.frame();
  expect([w.scene.city!.goneOf(chunk), moved(w, whole)]).toEqual([null, 0]);
  // Its list names the walls, and the level is made again without them.
  w.list(chunk);
  w.frame();
  const gone = w.scene.city!.goneOf(chunk)!;
  expect([sum(gone), doomed.every((s) => gone[s] === 1)]).toEqual([doomed.length, true]);
  expect(moved(w, whole)).toBeGreaterThan(5);
});

test("a list that comes before the map's statics is applied when they come", () => {
  const [x, z] = mid(6, 6);
  const w = cityWorld({ chunks: 16, statics: building(x, z, 0, 6, 2, 5000), late: true });
  const chunk = w.chunkOf(x, z);
  w.look(x, 6, z, 300, 0.4, 2);
  w.list(chunk, [0, 3, 4, 5, 40]);
  w.frame();
  expect(w.scene.city).toBeNull();
  w.arrive();
  w.frame();
  const gone = w.scene.city!.goneOf(chunk)!;
  expect([...gone.keys()].filter((i) => gone[i] === 1)).toEqual([0, 3, 4, 5, 40]);
  // A slot the chunk has no piece for is passed over.
  w.list(chunk, [1, 60000]);
  w.frame();
  expect(sum(w.scene.city!.goneOf(chunk)!)).toBe(1);
});

test("a chunk mended back to the map is told by an empty list, and its pieces are drawn again", () => {
  const [x, z] = mid(6, 6);
  const w = cityWorld({ chunks: 16, statics: building(x, z, 0, 8, 2, 5000), width: 320, height: 180 });
  const chunk = w.chunkOf(x, z);
  w.look(x, 12, z, 300, 0.4, 2);
  w.frame();
  const whole = w.raster.color.slice();
  const t = w.server.chunks[chunk]!;
  w.list(chunk, [...Array(t.high).keys()].filter((s) => t.y[s]! > 12));
  w.frame();
  expect(moved(w, whole)).toBeGreaterThan(30);
  w.list(chunk, []);
  w.frame();
  expect([w.scene.city!.goneOf(chunk), moved(w, whole)]).toEqual([null, 0]);
});

test("rows of a chunk held near outrank its list, and a list told after it is let go outranks them", () => {
  const [x, z] = mid(6, 6);
  const w = cityWorld({ chunks: 16, statics: building(x, z, 0, 4, 2, 5000) });
  const chunk = w.chunkOf(x, z);
  const city = (): number => sum(w.scene.city!.goneOf(chunk) ?? new Uint8Array(1));
  w.look(x, 6, z, 300, 0.4, 2);
  // A list of three, then the rows, in which five are gone: while held and after, the rows stand.
  w.list(chunk, [0, 1, 2]);
  w.frame();
  expect(city()).toBe(3);
  for (let s = 0; s < 5; s++) w.server.remove(chunk * 65536 + s);
  w.rows(chunk);
  w.frame();
  expect(city()).toBe(5);
  w.drop(chunk);
  w.frame();
  expect(city()).toBe(5);
  // A list told once it is let go is newer than the rows remembered.
  w.list(chunk, [0, 1, 2, 3, 4, 5, 6]);
  w.frame();
  expect(city()).toBe(7);
  // Held again with a list told meanwhile, and let go: the list told since the rows were matched stands.
  w.rows(chunk);
  w.frame();
  expect(city()).toBe(5);
  w.list(chunk, [0]);
  w.frame();
  expect(city()).toBe(5);
  w.drop(chunk);
  w.frame();
  expect(city()).toBe(1);
});

test("a client 3 km away loses a levelled chunk from the far blocks", () => {
  const [x, z] = mid(50, 50);
  // A tower of 20 storeys and 32 m a side, past the far city's reach.
  const tier = { ...tierOf("medium"), reach: { ...tierOf("medium").reach, city: 700, bases: 0 } };
  const w = cityWorld({ chunks: 64, statics: building(x, z, 0, 20, 4), tops: true, tier, width: 320, height: 180 });
  w.scene.viewDistance = 3600;
  w.look(x, 30, z, 3000, Math.PI / 4, 120);
  let p = w.frame();
  for (let f = 0; f < 8; f++) p = w.frame();
  const chunk = w.chunkOf(x, z);
  const had = indices(p, blockDraws(p));
  expect(had).toBeGreaterThan(0);
  const tall = w.raster.color.slice();
  // Levelled: every piece of its chunk is on the list, and its tile of blocks is made again without it.
  w.list(chunk, [...Array(w.statics.in(chunk)).keys()]);
  p = w.frame();
  p = w.frame();
  expect(w.scene.city!.goneOf(chunk)).not.toBeNull();
  expect(indices(p, blockDraws(p))).toBeLessThan(had);
  expect(moved(w, tall)).toBeGreaterThan(5);
});
