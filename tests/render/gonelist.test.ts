// The map's own pieces gone as the server lists them (client/core/gonelists.ts), followed by what is drawn far away: the
// far city's levels, the city's blocks past them, and how often each is made again while pieces keep going.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { BLOCK_SLOTS, GONE_EVERY } from "../../client/core/render/cityblocks.ts";
import { CITY_BUFFER, CITY_SLOTS, FIRST_WAIT, QUIET_FAR, QUIET_NEAR, WAIT_NEAR } from "../../client/core/render/farcity.ts";
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

test("a client 3 km away loses a levelled chunk from the far blocks, five seconds after its first piece went", () => {
  const [x, z] = mid(50, 50);
  // A tower of 20 storeys and 32 m a side, past the far city's reach.
  const tier = { ...tierOf("medium"), reach: { ...tierOf("medium").reach, city: 700, bases: 0 } };
  const w = cityWorld({ chunks: 64, statics: building(x, z, 0, 20, 4), tops: true, tier, width: 320, height: 180 });
  w.scene.blocks!.here = 1;
  w.scene.viewDistance = 3600;
  w.look(x, 30, z, 3000, Math.PI / 4, 120);
  let p = w.frame();
  for (let f = 0; f < 8; f++) p = w.frame();
  const chunk = w.chunkOf(x, z);
  const had = indices(p, blockDraws(p));
  expect(had).toBeGreaterThan(0);
  const tall = w.raster.color.slice();
  // Levelled: every piece of its chunk is on the list. The blocks stand until their wait is over, then are made without it.
  w.list(chunk, [...Array(w.statics.in(chunk)).keys()]);
  p = w.frame();
  expect(w.scene.city!.goneOf(chunk)).not.toBeNull();
  p = w.frame(false, GONE_EVERY - 100);
  expect([indices(p, blockDraws(p)), moved(w, tall)]).toEqual([had, 0]);
  p = w.frame(false, 200);
  p = w.frame();
  expect(indices(p, blockDraws(p))).toBeLessThan(had);
  expect(moved(w, tall)).toBeGreaterThan(5);
});

/** A world whose far city makes its levels a frame's budget at a time, as a page's does, brought to rest. */
function paced(metres: number) {
  const [x, z] = mid(6, 6);
  const w = cityWorld({ chunks: 16, statics: building(x, z, 0, 10, 2, 5000) });
  const city = w.scene.city!;
  city.makeMs = 1;
  w.look(x, 6, z, metres, 0.4, 2);
  for (let f = 0; f < 400 && (f < 30 || city.stats.behind > 0 || city.stats.missing > 0); f++) w.frame(false, 50);
  expect([city.stats.behind, city.stats.missing]).toEqual([0, 0]);
  const chunk = w.chunkOf(x, z);
  const t = w.server.chunks[chunk]!;
  const slots = [...Array(t.high).keys()].sort((a, b) => t.y[b]! - t.y[a]!);
  /** Runs `ms` in frames of 50 ms and returns the levels made in them. */
  const run = (ms: number): number => {
    let made = 0;
    for (let at = 0; at < ms; at += 50) {
      w.frame(false, 50);
      made += city.stats.made;
    }
    return made;
  };
  /** Runs until no level is wanted and not made, after `ms` at least, and returns the levels made. */
  const rest = (ms: number): number => {
    let made = run(ms);
    for (let f = 0; f < 400 && city.stats.behind > 0; f++) made += run(50);
    return made;
  };
  return { w, city, chunk, slots, run, rest };
}

test("five waves of removals in one second cause at most one remake of a far tile's level", () => {
  const { w, chunk, slots, run, rest, city } = paced(400);
  // The tile's levels, counted by letting one change make them all again.
  w.list(chunk, slots.slice(0, 1));
  const held = rest(QUIET_NEAR + 100);
  expect(held).toBeGreaterThan(0);
  // Five waves, 200 ms apart, each taking four more pieces from the top: nothing is made while they come.
  let made = 0;
  for (let wave = 1; wave <= 5; wave++) {
    w.list(chunk, slots.slice(0, 1 + wave * 4));
    made += run(200);
  }
  expect(made).toBe(0);
  expect(sum(w.scene.city!.goneOf(chunk)!)).toBe(21);
  // Half a second after the last, each level is made once more, and that is all.
  made += rest(QUIET_NEAR + 100);
  expect([made, city.stats.behind]).toEqual([held, 0]);
  expect(run(WAIT_NEAR + 1000)).toBe(0);
});

test("a tile whose pieces keep going is made again every three seconds near the eye, and waits two seconds of quiet past it", () => {
  const near = paced(400);
  near.w.list(near.chunk, near.slots.slice(0, 1));
  const held = near.rest(QUIET_NEAR + 100);
  // A piece every 300 ms for six seconds: never quiet, so made at three seconds and at six, and once after the last.
  let made = 0;
  for (let k = 2; k <= 21; k++) {
    near.w.list(near.chunk, near.slots.slice(0, k));
    made += near.run(300);
  }
  made += near.rest(QUIET_NEAR + 100);
  expect(made).toBeGreaterThanOrEqual(2 * held);
  expect(made).toBeLessThanOrEqual(3 * held);
  expect(WAIT_NEAR).toBe(3000);
  // Past 700 m a single change waits two seconds.
  const far = paced(1200);
  far.w.list(far.chunk, far.slots.slice(0, 1));
  expect(far.run(QUIET_FAR - 100)).toBe(0);
  expect(far.rest(200)).toBeGreaterThan(0);
});

test("a tile come into reach waits 300 ms for its lists before it is first made, and no longer", () => {
  const [x, z] = mid(6, 6);
  const fresh = () => {
    const w = cityWorld({ chunks: 16, statics: building(x, z, 0, 6, 2, 5000) });
    w.scene.city!.makeMs = 1;
    w.look(x, 6, z, 400, 0.4, 2);
    return w;
  };
  const made = (w: CityWorld, ms: number): number => {
    let n = 0;
    for (let at = 0; at < ms; at += 50) {
      w.frame(false, 50);
      n += w.scene.city!.stats.made;
    }
    return n;
  };
  // No list told: nothing is made for 300 ms, then the tile is.
  const waits = fresh();
  expect(made(waits, FIRST_WAIT - 50)).toBe(0);
  expect(made(waits, 3000)).toBeGreaterThan(0);
  // A list of one of its chunks already here: it is made from the first frame, without the pieces listed.
  const told = fresh();
  told.list(told.chunkOf(x, z), [0, 1]);
  expect(made(told, FIRST_WAIT - 50)).toBeGreaterThan(0);
  expect(made(told, QUIET_NEAR + 3000)).toBe(0);
});

test("a chunk let go by the near store while its tile waits is drawn far without what went, at once", () => {
  const { w, chunk, slots, run, city } = paced(400);
  // Held near, it loses its top pieces: the tile's levels wait for quiet.
  w.rows(chunk);
  run(100);
  for (const s of slots.slice(0, 12)) w.server.remove(chunk * 65536 + s);
  w.rows(chunk);
  expect(run(100)).toBe(0);
  expect(sum(city.goneOf(chunk)!)).toBe(12);
  expect(city.stats.behind).toBe(0);
  // Let go a moment later, it is the far city's to draw: its levels are due again in that frame, with no more waiting.
  w.drop(chunk);
  w.frame(false, 50);
  expect(city.stats.behind + city.stats.made).toBeGreaterThan(0);
});
