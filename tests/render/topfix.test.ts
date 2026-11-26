// The map's tops where they are wrong, past the statics a page holds (client/core/render/topfix.ts): a chunk with pieces
// gone is made from its sector, asked for once and let go; and a tower felled 6 km off leaves the city's blocks.

import { expect, test } from "bun:test";
import { FarStore } from "../../client/core/farcells.ts";
import { GoneStore } from "../../client/core/gonelists.ts";
import { HeldStatics } from "../../client/core/map-statics.ts";
import { HeldTops, makeBlocks, type BlocksJob, type BlocksMade } from "../../client/core/render/blocks.ts";
import { Camera } from "../../client/core/render/camera.ts";
import "../../client/core/render/city-late.ts";
import { InlineCityMaker, type CityMaker } from "../../client/core/render/citymake.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { FIX_QUIET, TopFix } from "../../client/core/render/topfix.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { CityStatics, cityTops } from "../../shared/world/city.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { mapHeightfield, mapTops, parseMap, readHead, readPart, writeMap, type MapData, type MapStatic, type StaticsPiece } from "../../shared/world/mapfile.ts";
import { farPack } from "../fixtures/farworld.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const DIMS = { chunksX: 128, chunksZ: 4 };
const SAMPLES = ((DIMS.chunksX * 64) / TERRAIN_CELL + 1) * ((DIMS.chunksZ * 64) / TERRAIN_CELL + 1);

/** A flat map 8,192 m by 256 m, its ground at 0, with towers of pillars eight storeys tall in chunks `at` of the first row. */
function towers(at: readonly number[]): MapData {
  const statics: MapStatic[] = [];
  for (const cx of at) for (let i = 0; i < 8; i++) statics.push({ kind: "core:pillar", x: cx * 64 + 20, y: 3.3 + i * 6, z: 32, yaw: 0 }, { kind: "core:pillar", x: cx * 64 + 40, y: 3.3 + i * 6, z: 32, yaw: 0 });
  return { id: "test:towers", dims: DIMS, minY: -32, stepY: 1 / 256, seaLevel: -Infinity, heights: new Uint16Array(SAMPLES).fill(32 * 256), tint: new Uint8Array(SAMPLES).fill(1), statics, nodes: [], spawns: [{ name: "West", x: 100, z: 100, yaw: 0 }] };
}

/** The store of `file`'s statics, holding none, and what answers each sector asked for once: every one asked so far. */
function store(file: Uint8Array) {
  const head = readHead(file);
  const held = new HeldStatics(head);
  const served: string[] = [];
  const serve = (): void => {
    for (const p of [...held.asked.keys()]) {
      const steps = held.read(p, readPart(head, p, file.subarray(p.at, p.at + p.length)) as StaticsPiece);
      let s = steps.next();
      while (!s.done) s = steps.next();
      served.push(p.name);
      held.answer(p, s.value);
    }
  };
  return { head, held, served, serve };
}

/** A list of pieces gone, as the server's would say it, of `slots` of `chunk`. */
function tell(lists: GoneStore, chunk: number, slots: number[]): void {
  if (lists.changed.length === 0) [lists.changed, lists.told] = [new Uint32Array(DIMS.chunksX * DIMS.chunksZ), new Uint32Array(DIMS.chunksX * DIMS.chunksZ)];
  lists.lists.set(chunk, Uint16Array.from(slots));
  lists.changed[chunk] = ++lists.version;
}

test("a chunk with pieces gone past the statics held is made of its sector, asked for once and let go", () => {
  const map = towers([60, 62, 100]);
  const file = writeMap(map);
  const reg = coreRegistry();
  const hf = mapHeightfield(parseMap(file));
  const { head, held, served, serve } = store(file);
  const fix = new TopFix(DIMS, hf, reg, head.kinds, held);
  const lists = new GoneStore();
  const whole = new CityStatics(DIMS, map.statics, reg);
  // The top four storeys of one tower and the lowest of another in the same sector go.
  tell(lists, 60, [8, 9, 10, 11, 12, 13, 14, 15]);
  tell(lists, 62, [0]);
  fix.update(100, 100, 8000, null, lists, null, 0);
  fix.update(100, 100, 8000, null, lists, null, FIX_QUIET - 1);
  expect([held.asked.size, fix.fixes.size]).toEqual([0, 0]);
  fix.update(100, 100, 8000, null, lists, null, FIX_QUIET);
  expect(held.asked.size).toBe(1);
  serve();
  const gone = (n: number, slots: number[]): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (slots.includes(i) ? 1 : 0));
  const want60 = cityTops(whole, 60, hf, gone(16, [8, 9, 10, 11, 12, 13, 14, 15]));
  const want62 = cityTops(whole, 62, hf, gone(16, [0]));
  expect([served.length, [...fix.fixOf(60)!.blocks!], [...fix.fixOf(62)!.blocks!], held.size]).toEqual([1, [...want60], [...want62], 0]);
  // The tower that lost its top is lower than the map's tops say.
  expect(Math.max(...want60)).toBeLessThan(Math.max(...cityTops(whole, 60, hf, null)));
  // Past the view it is let go of, and made again when it comes back.
  fix.update(8100, 100, 1000, null, lists, null, 5000);
  expect(fix.fixes.size).toBe(0);
  fix.update(100, 100, 8000, null, lists, null, 5001);
  serve();
  expect([served.length, [...fix.fixOf(60)!.blocks!]]).toEqual([2, [...want60]]);
});

test("a chunk the far cells count whole takes their tops, and asks for nothing", () => {
  const file = writeMap(towers([60]));
  const { head, held } = store(file);
  const fix = new TopFix(DIMS, mapHeightfield(parseMap(file)), coreRegistry(), head.kinds, held);
  const lists = new GoneStore();
  tell(lists, 60, [15]);
  const cells = new FarStore();
  cells.full = new Uint8Array(DIMS.chunksX * DIMS.chunksZ);
  cells.full[60] = 1;
  const top = new Uint8Array(256).fill(7);
  cells.chunks.set(60, Object.assign(Object.create(null), { top, tint: new Uint8Array(256), filled: 256, built: false }));
  fix.update(100, 100, 8000, null, lists, cells, FIX_QUIET);
  expect([held.asked.size, [...fix.fixOf(60)!.blocks!]]).toEqual([0, [...top]]);
});

test("a tower felled 6 km off is gone from the far blocks within 5 s", () => {
  const map = towers([95]);
  const file = writeMap(map);
  const h = new Harness({}, 1, 60, { map: file });
  const { held, serve } = store(file);
  const tops = new HeldTops(DIMS);
  tops.take(mapTops(parseMap(file), h.reg));
  // Every tile of blocks asked for, as the page's maker would make them.
  const jobs: BlocksJob[] = [];
  const inline = new InlineCityMaker(), made: BlocksMade[] = [];
  const maker: CityMaker = {
    onMade: null,
    start: (k) => inline.start(k),
    make: (j) => inline.make(j),
    take: (out) => inline.take(out),
    run: (ms) => inline.run(ms),
    blocks: (job) => void (jobs.push(job), made.push(makeBlocks(job))),
    built: () => made.shift() ?? null,
  };
  const a = h.join("ada", {}, { statics: false, held, tops, cityMaker: maker });
  const chunk = 95;
  /** The tower's tallest top byte in the last tile of blocks made with its chunk, or -1 for none made. */
  const tallest = (): number => {
    for (let k = jobs.length - 1; k >= 0; k--) {
      const at = [...jobs[k]!.chunks].indexOf(chunk);
      if (at >= 0) return Math.max(...jobs[k]!.top.subarray(at * 256, (at + 1) * 256));
    }
    return -1;
  };
  let scene: Scene | null = null;
  const cam = new Camera();
  const frame = (): void => {
    if (!a.world) return;
    if (!scene) {
      scene = new Scene(a.world, h.reg, farPack());
      scene.assets.tier = tierOf("ultra");
      scene.viewDistance = 8000;
    }
    a.askFar(2048, 8192);
    [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [a.own.x, 40, a.own.z, -Math.PI / 2, 0];
    scene.now = h.now;
    scene.build(cam, null);
    // A sector asked for once comes a little later, as from the server of parts.
    if (held.asked.size > 0 && h.now % 300 < 20) serve();
  };
  h.run(3000, frame);
  const before = tallest();
  expect(before).toBeGreaterThan(0);
  const at = h.now;
  for (let s = 0; s < 16; s++) h.world.structs.remove(chunk * 65536 + s);
  let gone = -1;
  h.run(5000, () => {
    frame();
    if (gone < 0 && tallest() === 0) gone = h.now - at;
  });
  expect([a.gone.lists.get(chunk)?.length ?? 0, gone >= 0, gone <= 5000]).toEqual([16, true, true]);
  expect(Math.round(95 * CHUNK_SIZE - a.own.x)).toBeGreaterThan(5900);
});
