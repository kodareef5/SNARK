// The sun's shadow past the cascades (client/core/render/farshadow.ts): the sweep over solid heights shades the cells a
// tower's shadow covers and leaves the rest lit, ground that rises shades what lies behind it, a piece gone takes its
// shadow with it, the map is the same bytes made twice or on another thread, the lookup leaves a building's own sunlit
// faces lit and shades the ground in its shadow, within the cascades it is looked up past the chunks the near store
// holds, whose pieces cast there, and the scene's part makes it again when the sun has moved enough, puts it on the card
// within the frame's allowance and looks it up only once it is all there.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { ThreadedCityMaker, cityKinds, type CityThread } from "../../client/core/render/citymake.ts";
import { FAR_SPAN, FarShadow, TOP_CELL, chunkSolid, doSweep, farBeyondLookup, farCell, farLookup, makeSolid, nearLead, sweep, sweepBuffers, tipMoves, type SweepJob, type SweepMade } from "../../client/core/render/farshadow.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE, chunkAt, chunkCount, type MapDims } from "../../shared/coords.ts";
import { CityStatics, cityTops, type Gone } from "../../shared/world/city.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { asWritten, building } from "../fixtures/cityworld.ts";
import { farRegistry } from "../fixtures/farworld.ts";

const UNIT = FAR_SPAN / 65535;
const DEG = Math.PI / 180;

/** A unit vector toward a sun `elevation` degrees up, `azimuth` degrees round from +z toward +x. */
function sunAt(elevation: number, azimuth: number): number[] {
  return [Math.cos(elevation * DEG) * Math.sin(azimuth * DEG), Math.sin(elevation * DEG), Math.cos(elevation * DEG) * Math.cos(azimuth * DEG)];
}

/** Where a ray from `o` along `d` enters a box, or Infinity. */
function enters(o: number[], d: number[], min: number[], max: number[]): number {
  let near = -Infinity, far = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-12) {
      if (o[a]! < min[a]! || o[a]! > max[a]!) return Infinity;
      continue;
    }
    const t0 = (min[a]! - o[a]!) / d[a]!, t1 = (max[a]! - o[a]!) / d[a]!;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
  }
  return near > far || far < 0 ? Infinity : Math.max(near, 0);
}

/** The swept height of texel (i, j) of a map, in metres over the floor, or -Infinity where nothing hides the sun. */
const sweptAt = (map: Uint16Array, size: number, i: number, j: number): number => (map[j * size + i] === 65535 ? -Infinity : (65535 - map[j * size + i]!) * UNIT);

test("a tower on flat ground shades the cells its shadow covers and no others, for three sun heights and four directions", () => {
  const n = 128;
  const ground = 10;
  const solid = new Uint16Array(n * n).fill(Math.round(ground / UNIT));
  // A tower 24 m square and 80 m tall, its cells (60, 60) to (65, 65).
  const [i0, i1, top] = [60, 65, ground + 80];
  for (let j = i0; j <= i1; j++) for (let i = i0; i <= i1; i++) solid[j * n + i] = Math.round(top / UNIT);
  const map = new Uint16Array(n * n);
  for (const elevation of [20, 40, 65]) {
    for (const azimuth of [25, 115, 205, 295]) {
      const sun = sunAt(elevation, azimuth);
      expect(sweep(solid, n, n, 1, n, sun[0]!, sun[1]!, sun[2]!, map)).toBeCloseTo(80, 1);
      // A cell's middle is on a line of the sweep within half a cell across, and its shadow's tip within half a cell
      // along: so the cells whose ray from the middle meets the tower shrunk by a cell are shaded, and those whose ray
      // misses it grown by a cell are lit. The cells between are counted, to show they are only the edge.
      const tan = Math.tan(elevation * DEG);
      const box = (by: number): [number[], number[]] => [[i0 * TOP_CELL - by, ground - 1, i0 * TOP_CELL - by], [(i1 + 1) * TOP_CELL + by, top + by * tan, (i1 + 1) * TOP_CELL + by]];
      const [inner, outer] = [box(-TOP_CELL), box(TOP_CELL)];
      let [surely, between] = [0, 0];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if (i >= i0 && i <= i1 && j >= i0 && j <= i1) continue;
          const o = [(i + 0.5) * TOP_CELL, ground, (j + 0.5) * TOP_CELL];
          const shaded = sweptAt(map, n, i, j) > ground + UNIT;
          if (enters(o, sun, inner[0], inner[1]) < Infinity) {
            surely++;
            if (!shaded) throw new Error(`sun ${elevation} up, ${azimuth} round: cell ${i}, ${j} is in the tower's shadow and lit`);
          } else if (enters(o, sun, outer[0], outer[1]) === Infinity) {
            if (shaded) throw new Error(`sun ${elevation} up, ${azimuth} round: cell ${i}, ${j} is out of the tower's shadow and shaded`);
          } else between++;
        }
      }
      // A square swept along the ground covers its width across the sun times the sweep's length, and itself: the
      // shrunk tower's shadow is all shaded, and the edge is the grown one's less that.
      const across = Math.abs(Math.sin(azimuth * DEG)) + Math.abs(Math.cos(azimuth * DEG));
      const area = (side: number, high: number): number => across * side * (high / tan / TOP_CELL) + side * side;
      expect(surely).toBeGreaterThanOrEqual(Math.floor(0.9 * (area(4, 80 - TOP_CELL * tan) - 16)));
      expect(between).toBeLessThanOrEqual(Math.ceil(1.1 * (area(8, 80 + TOP_CELL * tan) - area(4, 80 - TOP_CELL * tan))));
    }
  }
});

test("ground that rises shades what lies behind it, and not its own side toward the sun", () => {
  const dims: MapDims = { chunksX: 8, chunksZ: 4 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
  // A ridge along z, 30 m over the plain at x = 256, falling 3 m in 4 either way.
  const at = (x: number): number => 10 + Math.max(0, 30 - Math.abs(x - 256) * 0.75);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, at(i * hf.cell));
  const solid = new Uint16Array(chunkCount(dims) * 256);
  for (let c = 0; c < chunkCount(dims); c++) chunkSolid(solid, dims, hf.minY, c, null, hf);
  const [nx, nz] = [dims.chunksX * 16, dims.chunksZ * 16];
  const size = nx;
  const map = new Uint16Array(size * size);
  // The sun from -x, 20 degrees up: the ridge's top throws its shadow 30 / tan 20 = 82 m on past it.
  const sun = sunAt(20, -90);
  sweep(solid, nx, nz, 1, size, sun[0]!, sun[1]!, sun[2]!, map);
  const shaded = (x: number): boolean => sweptAt(map, size, Math.floor(x / TOP_CELL), 30) > at(x) - hf.minY + UNIT;
  // Its side toward the sun, its top, its far side (steeper than the sun), the plain in its shadow, and the plain past it.
  expect([200, 230, 250].map(shaded)).toEqual([false, false, false]);
  expect([262, 280, 300, 320, 330].map(shaded)).toEqual([true, true, true, true, true]);
  expect([346, 370, 420].map(shaded)).toEqual([false, false, false]);
  // The sun from +x instead lights the far side and shades the near.
  const back = sunAt(20, 90);
  sweep(solid, nx, nz, 1, size, back[0]!, back[1]!, back[2]!, map);
  expect([280, 300, 330].map(shaded)).toEqual([false, false, false]);
  expect([230, 200, 182].map(shaded)).toEqual([true, true, true]);
});

/** A map 8 chunks a side with two frame towers of 12 storeys, 16 m square, on flat ground at 0. */
function twoTowers() {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const a = [160, 160], b = [352, 352];
  const statics: MapStatic[] = asWritten([...building(a[0]!, a[1]!, 0, 12), ...building(b[0]!, b[1]!, 0, 12)]);
  const city = new CityStatics(dims, statics, reg);
  return { reg, dims, hf, city, a, b, chunkA: chunkAt(dims, a[0]!, a[1]!), chunkB: chunkAt(dims, b[0]!, b[1]!) };
}

/** Whether ground at (x, z) is in the map's shadow, the map's cells `cell` metres. */
const groundShaded = (map: Uint16Array, size: number, cell: number, x: number, z: number, ground: number, floor: number): boolean => sweptAt(map, size, Math.floor(x / cell), Math.floor(z / cell)) > ground - floor + UNIT;

test("a piece gone takes its shadow with it", () => {
  const { dims, hf, city, a, b, chunkA } = twoTowers();
  const size = dims.chunksX * 16;
  const sun = sunAt(35, 200);
  // 48 m tall: each tower's shadow reaches 68 m along the ground, toward +z and a little +x.
  const behind = (p: number[]): [number, number] => [p[0]! + 10, p[1]! + 30];
  const mapOf = (gone: (chunk: number) => Gone): Uint16Array => {
    const map = new Uint16Array(size * size);
    sweep(makeSolid(city, hf, gone), size, size, 1, size, sun[0]!, sun[1]!, sun[2]!, map);
    return map;
  };
  const standing = mapOf(() => null);
  expect([a, b].map((p) => groundShaded(standing, size, TOP_CELL, ...behind(p), 0, hf.minY))).toEqual([true, true]);
  // Tower A falls: every piece of its chunk is gone.
  const fallen = mapOf((c) => (c === chunkA ? new Uint8Array(city.in(c)).fill(1) : null));
  expect([a, b].map((p) => groundShaded(fallen, size, TOP_CELL, ...behind(p), 0, hf.minY))).toEqual([false, true]);
  // The rest of the map is as it was, but for A's cells and its shadow.
  let differ = 0;
  for (let k = 0; k < standing.length; k++) if (standing[k] !== fallen[k]) differ++;
  expect(differ).toBeGreaterThan(0);
  expect(differ).toBeLessThan(400);
});

test("the map made twice from the same statics and sun is the same bytes, and the same made on another thread", () => {
  const { dims, hf, city } = twoTowers();
  const size = 256;
  const sun = sunAt(28, 140);
  const once = (): Uint16Array => {
    const map = new Uint16Array(size * size);
    sweep(makeSolid(city, hf, () => null), dims.chunksX * 16, dims.chunksZ * 16, 1, size, sun[0]!, sun[1]!, sun[2]!, map);
    return map;
  };
  const first = once();
  expect(Buffer.from(once().buffer).equals(Buffer.from(first.buffer))).toBe(true);
  // A worker is sent the statics' columns and the ground, and makes the solid heights itself.
  const kinds = cityKinds(city, hf, { center: [0, 0, 0], half: [1, 1, 1] });
  const job: SweepJob = { id: 1, solid: null, make: { first: city.first.slice(), kind: city.kind.slice(), yaw: city.yaw.slice(), x: city.x.slice(), y: city.y.slice(), z: city.z.slice(), gone: null, heights: hf.heights.slice() }, k: 1, size, sun };
  const there = doSweep(kinds, structuredClone(job));
  expect(Buffer.from(there.map.buffer).equals(Buffer.from(first.buffer))).toBe(true);
  expect(Buffer.from(there.solid.buffer).equals(Buffer.from(makeSolid(city, hf, () => null).buffer))).toBe(true);
  // Coarser cells, as a layer half as wide has them, take each cell's highest of its four.
  const coarse = new Uint16Array(64 * 64);
  sweep(there.solid, 128, 128, 2, 64, sun[0]!, sun[1]!, sun[2]!, coarse);
  expect(farCell(dims, 64)).toBe(2 * TOP_CELL);
  expect(doSweep(kinds, { id: 2, solid: there.solid, make: null, k: 2, size: 64, sun }).map).toEqual(coarse);
});

/** A frame's allowance, counting what it spends. */
function allowance(bytes: number) {
  return {
    left: bytes,
    spent: 0,
    spend(n: number): void {
      this.spent += n;
      this.left -= n;
    },
  };
}

test("the scene's part sweeps when the statics come and again when the tallest tip moves half a cell, puts it on the card within the allowance, and looks it up once all of it is there", () => {
  const { dims, hf, city, chunkA } = twoTowers();
  const version = new Uint32Array(chunkCount(dims));
  const gone = new Map<number, Uint8Array>();
  const standing = { goneOf: (c: number): Gone => gone.get(c) ?? null, goneVersion: version, topsOf: (c: number) => (city.in(c) > 0 ? cityTops(city, c, hf, gone.get(c) ?? null) : null) };
  const shadow = new FarShadow(city, hf, standing, null, () => false);
  const p = new FramePacket();
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size: 256 } };
  p.lit = true;
  const rowBytes = 256 * 2;
  // An allowance of 100 rows a frame: the map goes up in three frames, and is looked up from the third.
  let sun = sunAt(30, 120);
  const frame = (bytes = 100 * rowBytes) => {
    p.beginFrame();
    const budget = allowance(bytes);
    shadow.update(p, budget, 300, 20, 300, sun);
    return { rows: p.farRows, from: p.farRow, spent: budget.spent, scale: p.frame[FRAME.farScale]! };
  };
  expect([frame(), frame(), frame()]).toEqual([
    { rows: 100, from: 0, spent: 100 * rowBytes, scale: 0 },
    { rows: 100, from: 100, spent: 100 * rowBytes, scale: 0 },
    { rows: 56, from: 200, spent: 56 * rowBytes, scale: 1 / TOP_CELL },
  ]);
  expect(shadow.stats.sweeps).toBe(1);
  expect(p.frame[FRAME.farAt]).toBe(300 / TOP_CELL);
  expect(p.frame[FRAME.farDepth]).toBeCloseTo((hf.minY + FAR_SPAN - 20) / FAR_SPAN, 7);
  // No room left this frame: nothing goes.
  expect(frame(rowBytes - 1).rows).toBe(0);
  // The sun moves on a step at a time; the map is swept again at the step where the towers' tips have moved half a cell.
  const made = sunAt(30, 120);
  const solid = makeSolid(city, hf, () => null);
  const rise = (Math.max(...solid) - Math.min(...solid)) * UNIT;
  expect(rise).toBeGreaterThan(40);
  let steps = 0;
  while (shadow.stats.sweeps === 1) {
    steps++;
    sun = sunAt(30 + steps * 0.05, 120 + steps * 0.05);
    frame();
  }
  expect(steps).toBeGreaterThan(3);
  expect(tipMoves(made, sun, rise)).toBeGreaterThanOrEqual(TOP_CELL / 2);
  expect(tipMoves(made, sunAt(30 + (steps - 1) * 0.05, 120 + (steps - 1) * 0.05), rise)).toBeLessThan(TOP_CELL / 2);
  // While the new map goes up, the old one is still looked up.
  expect(p.farRows).toBe(100);
  expect(p.frame[FRAME.farScale]).toBe(1 / TOP_CELL);
  frame();
  frame();
  // A piece gone: its chunk is made again and the map swept again.
  gone.set(chunkA, new Uint8Array(city.in(chunkA)).fill(1));
  version[chunkA]!++;
  frame();
  expect(shadow.stats.sweeps).toBe(3);
  // A lost context: the layer is empty, so nothing is looked up until the map is all on it again, unswept.
  shadow.reset();
  expect(frame().scale).toBe(0);
  frame();
  expect(frame().scale).toBe(1 / TOP_CELL);
  expect(shadow.stats.sweeps).toBe(3);
  // A sun gone far from the map's, as the day's first is from last evening's: not looked up until the new one is all there.
  sun = sunAt(60, 200);
  expect(frame().scale).toBe(0);
  // A layer of another side, as a touch tier's: swept again for it, though the cell is the same on a map this small.
  p.tier = { ...p.tier, shadows: { ...p.tier.shadows, size: 128 } };
  const before = shadow.stats.sweeps;
  expect(frame(1e9).rows).toBe(128);
  const next = frame();
  expect([shadow.stats.sweeps - before, p.farMap.length, next.scale]).toEqual([1, 0, 1 / TOP_CELL]);
  // Low poly and the night look nothing up and send nothing.
  p.tier = tierOf("lowpoly");
  expect(frame()).toEqual({ rows: 0, from: 0, spent: 0, scale: 0 });
});

test("a maker on other threads sweeps there, moving the solid heights and the map rather than copying them", async () => {
  const { dims, hf, city } = twoTowers();
  const kinds = cityKinds(city, hf, { center: [0, 0, 0], half: [1, 1, 1] });
  // Threads as a worker runs them, each message cloned with what it moves taken out of the sender.
  const opened: CityThread[] = [];
  const open = (): CityThread => {
    let held: typeof kinds | null = null;
    const thread: CityThread = {
      onmessage: null,
      postMessage(m, transfer = []) {
        const sent = structuredClone(m, { transfer });
        if ("kinds" in sent) held = sent.kinds;
        else if ("sweep" in sent) {
          const made: SweepMade = doSweep(held!, sent.sweep);
          const back = structuredClone(made, { transfer: sweepBuffers(made) });
          queueMicrotask(() => thread.onmessage?.({ data: back }));
        }
      },
    };
    opened.push(thread);
    return thread;
  };
  const maker = new ThreadedCityMaker(open, 2);
  maker.start(kinds);
  const standing = { goneOf: (): Gone => null, goneVersion: new Uint32Array(chunkCount(dims)), topsOf: (c: number) => (city.in(c) > 0 ? cityTops(city, c, hf, null) : null) };
  const shadow = new FarShadow(city, hf, standing, maker, () => false);
  const p = new FramePacket();
  p.tier = { ...tierOf("medium"), shadows: { ...tierOf("medium").shadows, size: 128 } };
  p.lit = true;
  const sun = sunAt(40, 30);
  shadow.update(p, allowance(1e9), 0, 0, 0, sun);
  // Asked, and away: nothing yet.
  expect([opened.length, p.farRows, shadow.stats.sweeps]).toEqual([2, 0, 0]);
  await new Promise((r) => setTimeout(r, 0));
  p.beginFrame();
  shadow.update(p, allowance(1e9), 0, 0, 0, sun);
  expect([p.farRows, shadow.stats.sweeps, p.frame[FRAME.farScale]]).toEqual([128, 1, 1 / TOP_CELL]);
  const here = new Uint16Array(128 * 128);
  sweep(makeSolid(city, hf, () => null), 128, 128, 1, 128, sun[0]!, sun[1]!, sun[2]!, here);
  expect(p.farMap).toEqual(here);
  // A frame that sends no rows sends no map.
  p.beginFrame();
  shadow.update(p, allowance(1e9), 0, 0, 0, sun);
  expect([p.farRows, p.farMap.length]).toEqual([0, 0]);
  expect(CHUNK_SIZE / TOP_CELL).toBe(16);
});

test("the lookup leaves a building's own sunlit walls and roof lit wherever they lie in their cells and however it is turned, and shades the ground in its shadow", () => {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  // Towers of 12 storeys 16 m square: one with its walls on its cells' edges, others with theirs a part of a cell in, and
  // others turned (in 65,536ths of a turn), the eighth of a turn among them, whose cells along a wall stand out most.
  const places = [[112, 112, 0], [113.3, 400.7, 0], [402.6, 113.9, 0], [403.9, 402.1, 0], [256, 256, 8192], [160, 300, 3000], [330, 190, 13000]];
  const city = new CityStatics(dims, asWritten(places.flatMap(([x, z, yaw]) => building(x!, z!, 0, 12, 2, yaw))), reg);
  const solid = makeSolid(city, hf, () => null);
  const top = Math.max(...solid) * UNIT + hf.minY;
  const standing = { goneOf: (): Gone => null, goneVersion: new Uint32Array(chunkCount(dims)), topsOf: () => null };
  const p = new FramePacket();
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size: 128 } };
  p.lit = true;
  const cam = [100, 30, 80];
  for (const [elevation, azimuth] of [[35, 200], [15, 70], [60, 330]] as const) {
    const sun = sunAt(elevation, azimuth);
    for (let k = 0; k < 3; k++) p.frame[FRAME.moon + k] = -sun[k]!;
    const shadow = new FarShadow(city, hf, standing, null, () => false);
    p.beginFrame();
    shadow.update(p, allowance(1e9), cam[0]!, cam[1]!, cam[2]!, sun);
    const map = p.farMap.slice();
    const look = (x: number, y: number, z: number, n: number[]): number => farLookup(map, 128, p.frame, x - cam[0]!, y - cam[1]!, z - cam[2]!, n[0]!, n[2]!);
    for (const [cx, cz, yaw] of places) {
      // A point of the tower's own frame (u, v) from its middle in the world, as building() turns its pieces.
      const a = (yaw! / 65536) * 2 * Math.PI;
      const [c, sn] = [Math.cos(a), Math.sin(a)];
      const world = (u: number, v: number): [number, number] => [cx! + c * u + sn * v, cz! + c * v - sn * u];
      // Each wall the sun reaches, a quarter of the way in from either end and from the foot to the top.
      for (const [nu, nv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = [c * nu! + sn * nv!, 0, c * nv! - sn * nu!];
        if (n[0]! * sun[0]! + n[2]! * sun[2]! < 0.1) continue;
        for (let along = -7; along <= 7; along += 0.5) {
          for (const y of [1, 12, 30, top - 2]) {
            const [x, z] = world(nu! * 8 + nv! * along, nv! * 8 + nu! * along);
            expect({ sun: [elevation, azimuth], at: [x, y, z], lit: look(x, y, z, n) }).toEqual({ sun: [elevation, azimuth], at: [x, y, z], lit: 1 });
          }
        }
      }
      // Its roof, and the ground behind it, half its shadow's length on.
      for (const [u, v] of [[0, 0], [-6, -6], [6, 6], [-6, 6]]) expect(look(...world(u!, v!).flatMap((w, k) => (k === 0 ? [w, top] : [w])) as [number, number, number], [0, 1, 0])).toBe(1);
      const back = (top / 2 / Math.tan(elevation * DEG)) / Math.hypot(sun[0]!, sun[2]!);
      const [bx, bz] = [cx! - sun[0]! * back - Math.sign(sun[0]!) * 8, cz! - sun[2]! * back - Math.sign(sun[2]!) * 8];
      if (bx > 0 && bz > 0 && bx < 512 && bz < 512) expect({ sun: [elevation, azimuth], at: [bx, bz], lit: look(bx, 0, bz, [0, 1, 0]) }).toEqual({ sun: [elevation, azimuth], at: [bx, bz], lit: 0 });
      // The ground on its sunward side, past its walls.
      expect(look(cx! + sun[0]! * 24, 0, cz! + sun[2]! * 24, [0, 1, 0])).toBe(1);
    }
  }
});

test("within the cascades the far map is looked up past the chunks the near store holds, so their pieces are not cast twice and the far city's are", () => {
  const { dims, hf, city, a, b, chunkA, chunkB } = twoTowers();
  const standing = { goneOf: (): Gone => null, goneVersion: new Uint32Array(chunkCount(dims)), topsOf: () => null };
  // The near store holds B's chunk and those about it, three a side, as about a camera there.
  const [bi, bj] = [chunkB % dims.chunksX, Math.floor(chunkB / dims.chunksX)];
  const held = (c: number): boolean => Math.abs((c % dims.chunksX) - bi) <= 1 && Math.abs(Math.floor(c / dims.chunksX) - bj) <= 1;
  expect(held(chunkA)).toBe(false);
  const shadow = new FarShadow(city, hf, standing, null, held);
  const p = new FramePacket();
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size: 128 } };
  p.lit = true;
  const sun = sunAt(35, 200);
  for (let k = 0; k < 3; k++) p.frame[FRAME.moon + k] = -sun[k]!;
  const cam = [b[0]! - 20, 20, b[1]! - 40];
  shadow.update(p, allowance(1e9), cam[0]!, cam[1]!, cam[2]!, sun);
  const f = p.frame;
  expect([f[FRAME.nearFromX], f[FRAME.nearFromZ], f[FRAME.nearToX], f[FRAME.nearToZ]]).toEqual([(bi - 1) * 64 - cam[0]!, (bj - 1) * 64 - cam[2]!, (bi + 2) * 64 - cam[0]!, (bj + 2) * 64 - cam[2]!]);
  const map = p.farMap.slice();
  // Behind each tower, half its shadow's length on: B's shadow is the cascades' to draw, A's is the far map's.
  const behind = (t: number[]): number[] => [t[0]! + 10 - cam[0]!, -cam[1]!, t[1]! + 30 - cam[2]!];
  const [ra, rb] = [behind(a), behind(b)];
  expect([farLookup(map, 128, f, ra[0]!, ra[1]!, ra[2]!, 0, 0), farLookup(map, 128, f, rb[0]!, rb[1]!, rb[2]!, 0, 0)]).toEqual([0, 0]);
  expect([farBeyondLookup(map, 128, f, ra[0]!, ra[1]!, ra[2]!, 0, 0), farBeyondLookup(map, 128, f, rb[0]!, rb[1]!, rb[2]!, 0, 0)]).toEqual([0, 1]);
  // The lead is where the ray to the sun leaves the box, marched for: from inside it, from outside through it, and none
  // from a point it does not cross.
  const flat = Math.hypot(sun[0]!, sun[2]!);
  const [ux, uz] = [sun[0]! / flat, sun[2]! / flat];
  const inside = (x: number, z: number): boolean => x >= f[FRAME.nearFromX]! && x <= f[FRAME.nearToX]! && z >= f[FRAME.nearFromZ]! && z <= f[FRAME.nearToZ]!;
  const marched = (x: number, z: number): number => {
    let last = 0;
    for (let t = 0; t < 2000; t += 0.01) if (inside(x + ux * t, z + uz * t)) last = t;
    return last;
  };
  for (const [x, z] of [[rb[0]!, rb[2]!], [rb[0]! - ux * 300, rb[2]! - uz * 300], [rb[0]! + ux * 300, rb[2]! + uz * 300]]) expect(nearLead(f, x!, z!)).toBeCloseTo(marched(x!, z!), 1);
  expect(nearLead(f, rb[0]! - ux * 300, rb[2]! - uz * 300)).toBeGreaterThan(300);
  expect(nearLead(f, rb[0]! + ux * 300, rb[2]! + uz * 300)).toBe(0);
  // With no chunk held the box is empty and the lead none.
  const none = new FarShadow(city, hf, standing, null, () => false);
  none.update(p, allowance(1e9), cam[0]!, cam[1]!, cam[2]!, sun);
  expect(nearLead(p.frame, rb[0]!, rb[2]!)).toBe(0);
  expect(p.frame[FRAME.nearFromX]! > p.frame[FRAME.nearToX]!).toBe(true);
});
