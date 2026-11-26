// The sun's shadow past the cascades (client/core/render/farshadow.ts): the sweep over solid heights shades the cells a
// tower's shadow covers and leaves the rest lit, ground that rises shades what lies behind it, a piece gone takes its
// shadow with it, the solid heights made from the map's tops are those of its statics and pool as the sweep and the
// openness pooled them, the map is the same bytes made twice or on another thread, the lookup leaves a building's own
// sunlit faces lit and shades the ground in its shadow, within the cascades it is looked up past the chunks the near
// store holds, whose pieces cast there, and the scene's part makes it again when the sun has moved enough, puts it on the
// card within the frame's allowance and looks it up only once it is all there.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { HeldTops } from "../../client/core/render/blocks.ts";
import { ThreadedCityMaker, type CityMaker, type CityThread } from "../../client/core/render/citymake.ts";
import { FAR_SPAN, FarShadow, SOLID_CHUNKS, SWEEP_QUIET, SWEEP_WAIT, TOP_CELL, chunkSolid, doSweep, farBeyondLookup, farCell, farLookup, makeSolid, nearLead, sweep, sweepBuffers, tipMoves, type Standing, type SweepJob, type SweepMade } from "../../client/core/render/farshadow.ts";
import { CAST_AT, FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { MAX_REACH } from "../../client/core/render/shadow.ts";
import { OPEN_BYTES, openMeasure } from "../../client/core/render/skyopen.ts";
import { CHUNK_SIZE, chunkAt, chunkCount, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CityStatics, cityTops, floatingKinds, landmarkKinds, type Gone } from "../../shared/world/city.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Summary, bakeChunk, pieceShapes } from "../../shared/world/tactical.ts";
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
  return { reg, dims, hf, city, statics, a, b, chunkA: chunkAt(dims, a[0]!, a[1]!), chunkB: chunkAt(dims, b[0]!, b[1]!) };
}

/** What stands of `city`: nothing gone, or as `gone` says, with a count of changes a chunk. */
function standingOf(city: CityStatics, hf: Heightfield, gone = new Map<number, Uint8Array>()): Standing {
  return { goneOf: (c) => gone.get(c) ?? null, goneVersion: new Uint32Array(chunkCount(city.dims)), get goneChanges() { return this.goneVersion.reduce((n: number, v: number) => n + v, 0); }, topsOf: (c) => (city.in(c) > 0 ? cityTops(city, c, hf, gone.get(c) ?? null) : null) };
}

/** The map's tops as its maker bakes them from the server's store (shared/world/mapfile.ts mapTops), as one part. */
function bakedTops(reg: Registry, dims: MapDims, hf: Heightfield, statics: readonly MapStatic[]) {
  const server = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  for (const s of statics) {
    const k = reg.index.get(s.kind)!;
    server.add(k, s.x, s.y, s.z, s.yaw, 0, reg.maxHp[k]!);
  }
  const shapes = pieceShapes(reg);
  const chunks: number[] = [], top: number[] = [], tint: number[] = [];
  for (const c of [...server.held].sort((x, y) => x - y)) {
    const s = new Summary();
    bakeChunk(server.chunks[c]!, chunkCx(dims, c) * CHUNK_SIZE, chunkCz(dims, c) * CHUNK_SIZE, shapes, hf, s);
    if (s.far.filled === 0) continue;
    chunks.push(c);
    top.push(...s.far.top);
    tint.push(...s.far.tint);
  }
  return { chunks: Uint32Array.from(chunks), top: Uint8Array.from(top), tint: Uint8Array.from(tint) };
}

/** `tops` held as a page holds them once their part has come. */
function held(dims: MapDims, tops: ReturnType<typeof bakedTops>): HeldTops {
  const h = new HeldTops(dims);
  h.take(tops);
  return h;
}

/** `grid`, `nx` by `nz`, pooled `k` a side: each cell's highest, and the mean of each cell's, rounded. */
function pool(grid: Uint16Array, nx: number, nz: number, k: number): { top: Uint16Array; mean: Uint16Array } {
  const w = Math.ceil(nx / k), h = Math.ceil(nz / k);
  const top = new Uint16Array(w * h), sum = new Float64Array(w * h), count = new Uint16Array(w * h);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const at = Math.floor(j / k) * w + Math.floor(i / k);
      top[at] = Math.max(top[at]!, grid[j * nx + i]!);
      sum[at]! += grid[j * nx + i]!;
      count[at]!++;
    }
  }
  return { top, mean: Uint16Array.from(sum, (s, c) => Math.round(s / count[c]!)) };
}

/** A maker on other threads as a test sees it: each job it is asked for kept, and answered at once. */
function capture(): { maker: CityMaker; jobs: SweepJob[] } {
  const jobs: SweepJob[] = [], made: SweepMade[] = [];
  const maker: CityMaker = {
    onMade: null,
    start() {},
    make() {},
    take: () => 0,
    sweep(job) {
      jobs.push(structuredClone(job));
      made.push(doSweep(job));
    },
    swept: () => made.shift() ?? null,
  };
  return { maker, jobs };
}

/** A lit frame packet of a tier whose shadow layer is `size` texels a side. */
function litPacket(size: number): FramePacket {
  const p = new FramePacket();
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size } };
  p.lit = true;
  return p;
}

/** Frames of `shadow`, the clock going on a second a frame from `at`, until it has asked for one more job than `jobs` holds. */
function nextJob(shadow: FarShadow, jobs: SweepJob[], p: FramePacket, at = { now: 0 }, sun = sunAt(40, 30)): SweepJob {
  const had = jobs.length;
  for (let f = 0; jobs.length === had; f++) {
    if (f > 2000) throw new Error("no job asked for");
    p.beginFrame();
    shadow.update(p, { left: 1e9, spend() {} }, 0, 0, 0, sun, (at.now += 1000));
  }
  return jobs.at(-1)!;
}

/** Two towers on ground with hills, so a coarse cell's ground is a mean of others. */
function hilly() {
  const t = twoTowers();
  const at = (x: number, z: number): number => 6 * Math.sin(x / 37) + 4 * Math.cos(z / 23);
  for (let j = 0; j < t.hf.nz; j++) for (let i = 0; i < t.hf.nx; i++) t.hf.setSample(i, j, at(i * t.hf.cell, j * t.hf.cell));
  const statics = t.statics.map((s) => ({ ...s, y: s.y + at(s.x, s.z) }));
  return { ...t, statics, city: new CityStatics(t.dims, statics, t.reg) };
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
  // A worker is sent the solid heights and their ground, nothing else of the map, and sweeps them and makes the sky's
  // openness from them where asked.
  const ground = new Uint16Array(128 * 128);
  const solid = makeSolid(city, hf, () => null, ground);
  const job: SweepJob = { id: 1, solid, ground, w: 128, h: 128, cell: TOP_CELL, bareAt: null, bareTo: null, size, sun, open: true };
  const there = doSweep(structuredClone(job));
  expect(Buffer.from(there.map!.buffer).equals(Buffer.from(first.buffer))).toBe(true);
  expect(there.open).toEqual(openMeasure(solid, ground, 128, 128, 1, TOP_CELL, UNIT));
  // Cells twice as wide, as a layer half as wide has them, each the highest of its four: swept as the fine cells are
  // when the sweep pools them itself. With no sun there is no map.
  const coarse = new Uint16Array(64 * 64);
  sweep(solid, 128, 128, 2, 64, sun[0]!, sun[1]!, sun[2]!, coarse);
  expect(farCell(dims, 64)).toBe(2 * TOP_CELL);
  const pooled = pool(solid, 128, 128, 2);
  const wide = { ...job, solid: pooled.top, ground: pool(ground, 128, 128, 2).mean, w: 64, h: 64, cell: 2 * TOP_CELL, size: 64, open: false };
  expect(doSweep(wide).map).toEqual(coarse);
  expect(doSweep({ ...wide, sun: null }).map).toBe(null);
});

test("solid heights from the map's tops equal those from its statics, at three cells", () => {
  const { reg, dims, hf, city, statics } = hilly();
  const tops = bakedTops(reg, dims, hf, statics);
  const ground4 = new Uint16Array(128 * 128);
  const solid4 = makeSolid(city, hf, () => null, ground4);
  const sun = sunAt(40, 30);
  // Layers of 128, 64 and 48 texels: cells of 4, 8 and 12 m, the last reaching across the chunks' edges.
  for (const size of [128, 64, 48]) {
    const k = farCell(dims, size) / TOP_CELL;
    const a = capture(), b = capture();
    const fromTops = nextJob(new FarShadow(dims, hf, held(dims, tops), a.maker, () => false), a.jobs, litPacket(size));
    const shadow = new FarShadow(dims, hf, null, b.maker, () => false);
    shadow.hand(city, standingOf(city, hf));
    const fromStatics = nextJob(shadow, b.jobs, litPacket(size));
    expect([fromTops.w, fromTops.cell]).toEqual([Math.ceil(128 / k), k * TOP_CELL]);
    expect(fromTops.solid).toEqual(fromStatics.solid);
    expect(fromTops.ground).toEqual(fromStatics.ground);
    // The grid is the 4 m cells pooled, so the map and the openness are those the sweep and the openness made of them.
    expect(fromTops.solid).toEqual(pool(solid4, 128, 128, k).top);
    expect(fromTops.ground).toEqual(pool(ground4, 128, 128, k).mean);
    const map = new Uint16Array(size * size);
    sweep(solid4, 128, 128, k, size, sun[0]!, sun[1]!, sun[2]!, map);
    const made = doSweep({ ...fromTops, sun, open: true });
    expect(made.map).toEqual(map);
    expect(made.open).toEqual(openMeasure(solid4, ground4, 128, 128, k, TOP_CELL, UNIT));
  }
});

test("a piece gone changes its chunk alike from the map's tops and from its statics", () => {
  const { reg, dims, hf, city, statics, chunkA } = hilly();
  const tops = held(dims, bakedTops(reg, dims, hf, statics));
  const gone = new Map<number, Uint8Array>();
  const standing = standingOf(city, hf, gone);
  const run = (from: HeldTops | null) => {
    const { maker, jobs } = capture();
    const shadow = new FarShadow(dims, hf, from, maker, () => false);
    shadow.hand(city, standing);
    return { shadow, jobs, p: litPacket(128), at: { now: 0 } };
  };
  const [a, b] = [run(tops), run(null)];
  const before = [nextJob(a.shadow, a.jobs, a.p, a.at), nextJob(b.shadow, b.jobs, b.p, b.at)];
  expect(before[0]!.solid).toEqual(before[1]!.solid);
  // Tower A falls: every piece of its chunk is gone, and the map is swept again once that has been quiet a while.
  gone.set(chunkA, new Uint8Array(city.in(chunkA)).fill(1));
  standing.goneVersion[chunkA]!++;
  const after = [nextJob(a.shadow, a.jobs, a.p, a.at), nextJob(b.shadow, b.jobs, b.p, b.at)];
  expect(after[0]!.solid).toEqual(after[1]!.solid);
  // Only chunk A's cells changed, and to its ground.
  const [i0, j0] = [chunkCx(dims, chunkA) * 16, chunkCz(dims, chunkA) * 16];
  let changed = 0;
  for (let c = 0; c < 128 * 128; c++) {
    if (after[0]!.solid[c] === before[0]!.solid[c]) continue;
    const [i, j] = [c % 128, Math.floor(c / 128)];
    expect(i >= i0 && i < i0 + 16 && j >= j0 && j < j0 + 16).toBe(true);
    expect(after[0]!.solid[c]).toBe(after[0]!.ground[c]!);
    changed++;
  }
  expect(changed).toBeGreaterThan(16);
});

test("tops and ground that come later make their chunks again", () => {
  const { reg, dims, hf, city, statics, chunkB } = hilly();
  const tops = new HeldTops(dims);
  const { maker, jobs } = capture();
  const shadow = new FarShadow(dims, hf, tops, maker, () => false);
  const p = litPacket(128), at = { now: 0 };
  // Before any tops have come the map is of the ground alone.
  const bare = nextJob(shadow, jobs, p, at);
  expect(bare.solid).toEqual(bare.ground);
  // The tops' part comes: the towers stand, as their statics make them.
  tops.take(bakedTops(reg, dims, hf, statics));
  const ground4 = new Uint16Array(128 * 128);
  expect(nextJob(shadow, jobs, p, at).solid).toEqual(makeSolid(city, hf, () => null, ground4));
  // A sector's own ground comes under tower B, a metre higher: its chunk's cells rise with it, and no other's.
  const [ci, cj] = [chunkCx(dims, chunkB), chunkCz(dims, chunkB)];
  for (let j = cj * 32; j <= cj * 32 + 32; j++) for (let i = ci * 32; i <= ci * 32 + 32; i++) hf.setSample(i, j, hf.sample(i, j) + 1);
  hf.hold(ci, cj, ci + 1, cj + 1);
  const raised = nextJob(shadow, jobs, p, at);
  for (let c = 0; c < 128 * 128; c++) {
    const [i, j] = [c % 128, Math.floor(c / 128)];
    const inB = Math.floor(i / 16) === ci && Math.floor(j / 16) === cj;
    const rise = raised.ground[c]! - ground4[c]!;
    expect([c, inB ? Math.abs(rise - 1 / UNIT) <= 1 : rise === 0]).toEqual([c, true]);
  }
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
  const standing = { goneOf: (c: number): Gone => gone.get(c) ?? null, goneVersion: version, get goneChanges() { return this.goneVersion.reduce((n: number, v: number) => n + v, 0); }, topsOf: (c: number) => (city.in(c) > 0 ? cityTops(city, c, hf, gone.get(c) ?? null) : null) };
  const shadow = new FarShadow(dims, hf, null, null, () => false);
  shadow.hand(city, standing);
  const p = new FramePacket();
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size: 256 } };
  p.lit = true;
  const rowBytes = 256 * 2;
  // An allowance of 100 rows a frame: the map goes up in three frames, and is looked up from the third; the sky's
  // openness takes what is left of it. Until then the frame says where the camera is on the grid, the map not looked up.
  let sun: number[] | null = sunAt(30, 120);
  let now = 0;
  const frame = (bytes = 100 * rowBytes) => {
    p.beginFrame();
    const budget = allowance(bytes);
    shadow.update(p, budget, 300, 20, 300, sun, now);
    return { rows: p.farRows, from: p.farRow, spent: budget.spent, scale: p.frame[FRAME.farScale]! };
  };
  expect([frame(), frame(), frame()]).toEqual([
    { rows: 100, from: 0, spent: 100 * rowBytes, scale: -1 / TOP_CELL },
    { rows: 100, from: 100, spent: 100 * rowBytes, scale: -1 / TOP_CELL },
    { rows: 56, from: 200, spent: 100 * rowBytes, scale: 1 / TOP_CELL },
  ]);
  expect([p.openWidth, p.openRow, p.openRows]).toEqual([128, 0, (44 * rowBytes) / (128 * OPEN_BYTES)]);
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
  // Pieces gone, and more a second later: the map is swept again once, when none has gone for two seconds.
  const goes = (at: number, left: number): void => {
    gone.set(chunkA, new Uint8Array(city.in(chunkA)).fill(1).fill(0, 0, left));
    version[chunkA]!++;
    now = at;
    frame();
  };
  goes(0, 1);
  goes(1000, 0);
  now = 1000 + SWEEP_QUIET - 1;
  frame();
  expect(shadow.stats.sweeps).toBe(2);
  now = 1000 + SWEEP_QUIET;
  frame();
  expect(shadow.stats.sweeps).toBe(3);
  // Pieces that keep going, one every second and a half, are swept for ten seconds after the first of them.
  for (let at = 4000; at <= 4000 + SWEEP_WAIT + 500; at += 1500) {
    goes(at, (at / 1500) & 1);
    expect(shadow.stats.sweeps).toBe(at < 4000 + SWEEP_WAIT ? 3 : 4);
  }
  const swept = shadow.stats.sweeps;
  // A lost context while the map goes up: the layer is empty, so nothing is looked up until the map is all on it again,
  // from the map still held, unswept.
  shadow.reset();
  expect(frame().scale).toBe(-1 / TOP_CELL);
  frame();
  expect(frame().scale).toBe(1 / TOP_CELL);
  expect(shadow.stats.sweeps).toBe(swept);
  // Once all of it is on the card the map is let go, and a lost context sweeps it again.
  shadow.reset();
  expect(frame().scale).toBe(-1 / TOP_CELL);
  frame();
  expect(frame().scale).toBe(1 / TOP_CELL);
  expect(shadow.stats.sweeps).toBe(swept + 1);
  // A sun gone far from the map's, as the day's first is from last evening's: not looked up until the new one is all there.
  sun = sunAt(60, 200);
  expect(frame().scale).toBe(-1 / TOP_CELL);
  // A layer of another side, as a touch tier's: swept again for it, though the cell is the same on a map this small.
  p.tier = { ...p.tier, shadows: { ...p.tier.shadows, size: 128 } };
  const before = shadow.stats.sweeps;
  expect(frame(1e9).rows).toBe(128);
  const next = frame();
  expect([shadow.stats.sweeps - before, p.farMap.length, next.scale]).toEqual([1, 0, 1 / TOP_CELL]);
  // The night sweeps nothing and looks no map up, but keeps the grid; low poly looks nothing up and sends nothing.
  sun = null;
  expect(frame()).toEqual({ rows: 0, from: 0, spent: 0, scale: -1 / TOP_CELL });
  p.tier = tierOf("lowpoly");
  expect(frame()).toEqual({ rows: 0, from: 0, spent: 0, scale: 0 });
  expect(p.openWidth).toBe(0);
});

test("a maker on other threads sweeps there, moving the solid heights and the map rather than copying them", async () => {
  const { dims, hf, city } = twoTowers();
  // Threads as a worker runs them, each message cloned with what it moves taken out of the sender; a sweep needs no kinds.
  const opened: CityThread[] = [];
  const moved: number[] = [];
  const open = (): CityThread => {
    const thread: CityThread = {
      onmessage: null,
      postMessage(m, transfer = []) {
        if ("sweep" in m) moved.push(...transfer.map((b) => b.byteLength));
        const sent = structuredClone(m, { transfer });
        if (!("sweep" in sent)) return;
        const made: SweepMade = doSweep(sent.sweep);
        const back = structuredClone(made, { transfer: sweepBuffers(made) });
        queueMicrotask(() => thread.onmessage?.({ data: back }));
      },
    };
    opened.push(thread);
    return thread;
  };
  const maker = new ThreadedCityMaker(open, 2);
  const shadow = new FarShadow(dims, hf, null, maker, () => false);
  shadow.hand(city, standingOf(city, hf));
  const p = new FramePacket();
  p.tier = { ...tierOf("medium"), shadows: { ...tierOf("medium").shadows, size: 128 } };
  p.lit = true;
  const sun = sunAt(40, 30);
  shadow.update(p, allowance(1e9), 0, 0, 0, sun);
  // Asked, and away: nothing yet. What went is the solid heights and their ground, moved.
  expect([opened.length, p.farRows, shadow.stats.sweeps]).toEqual([2, 0, 0]);
  expect(moved).toEqual([128 * 128 * 2, 128 * 128 * 2]);
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

test("solid heights are made SOLID_CHUNKS a frame and swept once all are made", () => {
  // 96 chunks a side on a layer of 128: 128 cells of 48 m a side, 9,216 chunks made in 72 frames.
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 96, chunksZ: 96 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j += 7) hf.setSample(5, j, j % 50);
  const statics = asWritten([...building(160, 160, 0, 12), ...building(4000, 5000, 0, 20)]);
  const city = new CityStatics(dims, statics, reg);
  const gone = new Map<number, Uint8Array>();
  const standing = standingOf(city, hf, gone);
  const { maker, jobs } = capture();
  const shadow = new FarShadow(dims, hf, held(dims, bakedTops(reg, dims, hf, statics)), maker, () => false);
  shadow.hand(city, standing);
  const p = litPacket(128);
  const frame = (): void => {
    p.beginFrame();
    shadow.update(p, allowance(1e9), 0, 0, 0, sunAt(40, 30));
  };
  frame();
  expect([jobs.length, shadow.stats.chunks]).toEqual([0, SOLID_CHUNKS]);
  // The second tower falls before its chunk is made.
  const chunk = chunkAt(dims, 4000, 5000);
  expect(chunk).toBeGreaterThan(SOLID_CHUNKS * 2);
  gone.set(chunk, new Uint8Array(city.in(chunk)).fill(1));
  standing.goneVersion[chunk]!++;
  let frames = 1;
  while (jobs.length === 0) {
    frame();
    frames++;
  }
  expect([frames, shadow.stats.chunks]).toEqual([(96 * 96) / SOLID_CHUNKS, 96 * 96]);
  const job = jobs[0]!;
  expect([job.w, job.h, job.cell, job.solid.length, job.bareAt]).toEqual([128, 128, 48, 128 * 128, null]);
  const ground4 = new Uint16Array(1536 * 1536);
  const solid4 = makeSolid(city, hf, (c) => gone.get(c) ?? null, ground4);
  expect(job.solid).toEqual(pool(solid4, 1536, 1536, 12).top);
  expect(job.ground).toEqual(pool(ground4, 1536, 1536, 12).mean);
  const fell = Math.floor(5000 / 48) * 128 + Math.floor(4000 / 48);
  expect(job.solid[fell]).toBe(job.ground[fell]!);
  expect(job.solid[Math.floor(160 / 48) * 128 + Math.floor(160 / 48)]).toBeGreaterThan(job.ground[Math.floor(160 / 48) * 128 + Math.floor(160 / 48)]!);
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
  const standing = { goneOf: (): Gone => null, goneVersion: new Uint32Array(chunkCount(dims)), get goneChanges() { return this.goneVersion.reduce((n: number, v: number) => n + v, 0); }, topsOf: () => null };
  const p = new FramePacket();
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size: 128 } };
  p.lit = true;
  const cam = [100, 30, 80];
  for (const [elevation, azimuth] of [[35, 200], [15, 70], [60, 330]] as const) {
    const sun = sunAt(elevation, azimuth);
    for (let k = 0; k < 3; k++) [p.frame[FRAME.moon + k], p.frame[CAST_AT + k]] = [-sun[k]!, sun[k]!];
    const shadow = new FarShadow(dims, hf, null, null, () => false);
    shadow.hand(city, standing);
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
  const standing = { goneOf: (): Gone => null, goneVersion: new Uint32Array(chunkCount(dims)), get goneChanges() { return this.goneVersion.reduce((n: number, v: number) => n + v, 0); }, topsOf: () => null };
  // The near store holds B's chunk and those about it, three a side, as about a camera there.
  const [bi, bj] = [chunkB % dims.chunksX, Math.floor(chunkB / dims.chunksX)];
  const held = (c: number): boolean => Math.abs((c % dims.chunksX) - bi) <= 1 && Math.abs(Math.floor(c / dims.chunksX) - bj) <= 1;
  expect(held(chunkA)).toBe(false);
  const shadow = new FarShadow(dims, hf, null, null, held);
  shadow.hand(city, standing);
  const p = new FramePacket();
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size: 128 } };
  p.lit = true;
  const sun = sunAt(35, 200);
  for (let k = 0; k < 3; k++) [p.frame[FRAME.moon + k], p.frame[CAST_AT + k]] = [-sun[k]!, sun[k]!];
  const cam = [b[0]! - 20, 20, b[1]! - 40];
  shadow.update(p, allowance(1e9), cam[0]!, cam[1]!, cam[2]!, sun);
  const f = p.frame;
  // The empty chunks round them count as held; A's column stops the box.
  expect(nearChunks(f, cam)).toEqual([3, 7, 0, 7]);
  const map = p.farMap.slice();
  // Behind each tower, half its shadow's length on: B's shadow is the cascades' to draw, A's is the far map's.
  const behind = (t: number[]): number[] => [t[0]! + 10 - cam[0]!, -cam[1]!, t[1]! + 30 - cam[2]!];
  const [ra, rb] = [behind(a), behind(b)];
  expect([farLookup(map, 128, f, ra[0]!, ra[1]!, ra[2]!, 0, 0), farLookup(map, 128, f, rb[0]!, rb[1]!, rb[2]!, 0, 0)]).toEqual([0, 0]);
  expect([farBeyondLookup(map, 128, f, ra[0]!, ra[1]!, ra[2]!, 0, 0), farBeyondLookup(map, 128, f, rb[0]!, rb[1]!, rb[2]!, 0, 0)]).toEqual([0, 1]);
  // The lead is how far the ray to the sun stays in the box, but no more than MAX_REACH along the light, marched for: from
  // inside it far from its edge and near it, and none from outside it, though the ray crosses it.
  const flat = Math.hypot(sun[0]!, sun[2]!);
  const [ux, uz] = [sun[0]! / flat, sun[2]! / flat];
  const inside = (x: number, z: number): boolean => x >= f[FRAME.nearFromX]! && x <= f[FRAME.nearToX]! && z >= f[FRAME.nearFromZ]! && z <= f[FRAME.nearToZ]!;
  const marched = (x: number, z: number): number => {
    let t = 0;
    while (inside(x, z) && t < MAX_REACH * flat && inside(x + ux * (t + 0.01), z + uz * (t + 0.01))) t += 0.01;
    return t;
  };
  const edge = [300 - cam[0]!, 40 - cam[2]!], outside = [rb[0]! - ux * 300, rb[2]! - uz * 300];
  for (const [x, z] of [[rb[0]!, rb[2]!], edge, outside]) expect(nearLead(f, x!, z!)).toBeCloseTo(marched(x!, z!), 1);
  expect(nearLead(f, rb[0]!, rb[2]!)).toBeCloseTo(MAX_REACH * flat, 3);
  expect(nearLead(f, edge[0]!, edge[1]!)).toBeLessThan(50);
  expect(nearLead(f, outside[0]!, outside[1]!)).toBe(0);
  // With no chunk held, a camera in B's chunk has no box and no lead.
  const none = new FarShadow(dims, hf, null, null, () => false);
  none.hand(city, standing);
  const inB = [b[0]! + 20, 20, b[1]! + 20];
  none.update(p, allowance(1e9), inB[0]!, inB[1]!, inB[2]!, sun);
  expect(nearChunks(p.frame, inB)).toBeNull();
  expect(nearLead(p.frame, rb[0]! + cam[0]! - inB[0]!, rb[2]! + cam[2]! - inB[2]!)).toBe(0);
});

/** A far shadow of `city` on high, its layer `size` a side, run a frame at a time until it is looked up: the frame and the map. */
function lookedUp(dims: MapDims, hf: Heightfield, city: CityStatics, held: (c: number) => boolean, cam: number[], sun: number[], size = 128): { f: Float32Array; map: Uint16Array } {
  const shadow = new FarShadow(dims, hf, null, null, held);
  shadow.hand(city, standingOf(city, hf));
  const p = litPacket(size);
  for (let k = 0; k < 3; k++) [p.frame[FRAME.moon + k], p.frame[CAST_AT + k]] = [-sun[k]!, sun[k]!];
  for (let n = 0; n < 8 && !(p.frame[FRAME.farScale]! > 0); n++) shadow.update(p, allowance(1e9), cam[0]!, cam[1]!, cam[2]!, sun);
  expect([p.frame[FRAME.farScale]! > 0, p.farRows]).toEqual([true, size]);
  return { f: p.frame, map: p.farMap!.slice() };
}

/** The near box a frame holds, in chunks of the world: first and last column, first and last row; null for none. */
function nearChunks(f: Float32Array, cam: number[]): number[] | null {
  if (f[FRAME.nearFromX]! > f[FRAME.nearToX]!) return null;
  const at = (v: number, c: number): number => Math.round((v + c) / CHUNK_SIZE);
  return [at(f[FRAME.nearFromX]!, cam[0]!), at(f[FRAME.nearToX]!, cam[0]!) - 1, at(f[FRAME.nearFromZ]!, cam[2]!), at(f[FRAME.nearToZ]!, cam[2]!) - 1];
}

test("the near box grows from the camera's chunk while each new row is held or empty", () => {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 10, chunksZ: 10 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  // A storey in every chunk but (3, 8), which is bare ground.
  const open = 8 * 10 + 3;
  const statics = asWritten(Array.from({ length: 100 }, (_, c) => c).filter((c) => c !== open).flatMap((c) => building((c % 10) * 64 + 32, Math.floor(c / 10) * 64 + 32, 0, 1, 1)));
  const city = new CityStatics(dims, statics, reg);
  const sun = sunAt(35, 200);
  const boxOf = (cam: number[], missing: number[]): number[] | null => nearChunks(lookedUp(dims, hf, city, (c) => c !== open && !missing.includes(c), cam, sun).f, cam);
  const mid = [5 * 64 + 20, 20, 5 * 64 + 40];
  // All held: the whole map, its edges stopping it, and from near a corner NEAR_SCAN chunks on.
  expect(boxOf(mid, [])).toEqual([0, 9, 0, 9]);
  expect(boxOf([70, 20, 90], [])).toEqual([0, 7, 0, 7]);
  // A hole next to the camera's chunk stops that side at once; one two rings out stops it a ring later.
  expect(boxOf(mid, [5 * 10 + 6])).toEqual([0, 5, 0, 9]);
  expect(boxOf(mid, [5 * 10 + 7])).toEqual([0, 6, 0, 9]);
  expect(boxOf(mid, [2 * 10 + 5])).toEqual([0, 9, 3, 9]);
  // The camera's own chunk missing: no box at all.
  expect(boxOf(mid, [5 * 10 + 5])).toBeNull();
});

test("a tower in a missing chunk between two held ones shades the street", () => {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  // Chunks (3, 4), (4, 4) and (5, 4): the ends held, a tower of 12 storeys in the middle, the sun low over it from +x.
  const city = new CityStatics(dims, asWritten(building(288, 288, 0, 12)), reg);
  const held = (c: number): boolean => c === 4 * 8 + 3 || c === 4 * 8 + 5;
  const cam = [200, 20, 300];
  const sun = sunAt(30, 90);
  const { f, map } = lookedUp(dims, hf, city, held, cam, sun);
  const r = [250 - cam[0]!, -cam[1]!, 288 - cam[2]!];
  expect(farLookup(map, 128, f, r[0]!, r[1]!, r[2]!, 0, 0)).toBe(0);
  expect(farBeyondLookup(map, 128, f, r[0]!, r[1]!, r[2]!, 0, 0)).toBe(0);
});

test("a tower 300 m toward a low sun shades the street; one in reach is not doubled", () => {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 16, chunksZ: 16 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  // Towers of 25 storeys: one 300 m from a street toward the sun, another 40 m from a second street.
  const city = new CityStatics(dims, asWritten([...building(800, 400, 0, 25), ...building(540, 640, 0, 25)]), reg);
  const cam = [520, 20, 520];
  const sun = sunAt(8, 90);
  const { f, map } = lookedUp(dims, hf, city, () => true, cam, sun, 256);
  expect(nearChunks(f, cam)).toEqual([2, 14, 2, 14]);
  const far = [500 - cam[0]!, -cam[1]!, 400 - cam[2]!], near = [500 - cam[0]!, -cam[1]!, 640 - cam[2]!];
  expect([farLookup(map, 256, f, far[0]!, far[1]!, far[2]!, 0, 0), farLookup(map, 256, f, near[0]!, near[1]!, near[2]!, 0, 0)]).toEqual([0, 0]);
  expect(farBeyondLookup(map, 256, f, far[0]!, far[1]!, far[2]!, 0, 0)).toBe(0);
  expect(farBeyondLookup(map, 256, f, near[0]!, near[1]!, near[2]!, 0, 0)).toBe(1);
  // The lead stops MAX_REACH along the light, the furthest a cascade takes a caster from.
  expect(nearLead(f, far[0]!, far[2]!)).toBeCloseTo(MAX_REACH * Math.hypot(sun[0]!, sun[2]!), 3);
});

test("a piece that stands in the air with nothing under it, a tide eye's collider, casts no far shadow: as a column from the ground it would be a tower where there is open air", () => {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const tower = [160, 160], spar = [352, 352];
  const statics: MapStatic[] = asWritten([...building(tower[0]!, tower[1]!, 0, 12), { kind: "core:zztide_eye_spar", x: spar[0]!, y: 300, z: spar[1]!, yaw: 0 }]);
  const city = new CityStatics(dims, statics, reg);
  const standing = { goneOf: (): Gone => null, goneVersion: new Uint32Array(chunkCount(dims)), get goneChanges() { return this.goneVersion.reduce((n: number, v: number) => n + v, 0); }, topsOf: (c: number) => (city.in(c) > 0 ? cityTops(city, c, hf, null) : null) };
  const sun = sunAt(35, 200);
  const shadeOf = (floating: Uint8Array | null): ((x: number, z: number) => number) => {
    const shadow = new FarShadow(dims, hf, null, null, () => false, landmarkKinds(reg), floating);
    shadow.hand(city, standing);
    const p = new FramePacket();
    p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size: 256 } };
    p.lit = true;
    p.beginFrame();
    shadow.update(p, allowance(1e9), 0, 0, 0, sun);
    expect(p.farRows).toBe(256);
    const map = Uint16Array.from(p.farMap!);
    return (x, z) => farLookup(map, 256, p.frame, x, 0.2, z, 0, 0);
  };
  // 20 m behind each along the ground, away from the sun: the tower's shadow, and where a column under the spar would fall.
  const flat = Math.hypot(sun[0]!, sun[2]!);
  const behind = (at: number[]): [number, number] => [at[0]! - (20 * sun[0]!) / flat, at[1]! - (20 * sun[2]!) / flat];
  const kept = shadeOf(floatingKinds(reg)), columns = shadeOf(null);
  expect(kept(...behind(tower))).toBe(0);
  expect(columns(...behind(tower))).toBe(0);
  expect(columns(...behind(spar))).toBe(0);
  expect(kept(...behind(spar))).toBe(1);
});

test("a floating piece casts nothing from the map's tops, nor once its statics come", () => {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  const spar = [352, 352];
  const statics = asWritten([...building(160, 160, 0, 12), { kind: "core:zztide_eye_spar", x: spar[0]!, y: 300, z: spar[1]!, yaw: 0 }]);
  const city = new CityStatics(dims, statics, reg);
  const tops = held(dims, bakedTops(reg, dims, hf, statics));
  const { maker, jobs } = capture();
  const shadow = new FarShadow(dims, hf, tops, maker, () => false, landmarkKinds(reg), floatingKinds(reg));
  const p = litPacket(128), at = { now: 0 };
  // The map's tops leave the spar out, as the far feed does (tactical.ts pieceShapes), and keep the tower.
  const cell = Math.floor(spar[1]! / TOP_CELL) * 128 + Math.floor(spar[0]! / TOP_CELL);
  const towerCell = Math.floor(160 / TOP_CELL) * 128 + Math.floor(160 / TOP_CELL);
  const before = nextJob(shadow, jobs, p, at);
  expect([before.solid[cell] === before.ground[cell], before.solid[towerCell]! > before.ground[towerCell]!]).toEqual([true, true]);
  // Its statics come: its chunk is made of them, the spar left out, as a map made of statics alone has it.
  shadow.hand(city, standingOf(city, hf));
  const after = nextJob(shadow, jobs, p, at);
  expect(after.solid[cell]).toBe(after.ground[cell]!);
  const alone = capture();
  const own = new FarShadow(dims, hf, null, alone.maker, () => false, landmarkKinds(reg), floatingKinds(reg));
  own.hand(city, standingOf(city, hf));
  const plain = nextJob(own, alone.jobs, litPacket(128));
  expect([after.solid, after.bareAt, after.bareTo]).toEqual([plain.solid, plain.bareAt, plain.bareTo]);
});
