import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import { framed } from "../../shared/coords.ts";
import { latLonText, latOf, lonOf, mapU, mapV, xOfLon, xOfU, zOfLat, zOfV } from "../../shared/world/coords.ts";
import { CELL_FILLED, Cells, FarCells, LEVEL_AT, MARK_MATE, MARK_TAME, Marks, OWNER_OTHER, PLAYERS_VIEW, Summary, bakeChunk, farTopByte, farTopMetres, levelSide, onlyTeam, pieceShapes, readCells, readFar, readMarks, writeCells, writeFar, writeMark, writeMarksHead } from "../../shared/world/tactical.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

function bake(w: TestWorld, chunk = 0): Summary {
  const s = new Summary();
  bakeChunk(w.structs.chunks[chunk] ?? null, (chunk % w.dims.chunksX) * 64, Math.floor(chunk / w.dims.chunksX) * 64, pieceShapes(w.reg), w.hf, s);
  return s;
}

const cell = (s: Summary, cx: number, cz: number, level = 0) => {
  const at = LEVEL_AT[level]! + cz * levelSide(level) + cx;
  const v = s.info[at]!;
  return { filled: (v & CELL_FILLED) !== 0, tint: s.tint[at]!, band: v & 7, owner: (v >> 3) & 7 };
};

// Coordinates moved from 0 to 100 across the extent to units of 102.4 m from the display origin, and shares of the picture
// took the other half of what they were used for.
test("latitude and longitude are units of 102.4 m south and east of the display origin, and a share of the picture runs 0 to 1 across the extent", () => {
  // Today's cities: 127 chunks, the origin the sector corner a chunk beyond the north-west corner, so they read 0.6 to 80 each way.
  const city = framed({ chunksX: 127, chunksZ: 127 });
  expect([lonOf(city, 8128), lonOf(city, 0), latOf(city, 8128), latOf(city, 0), lonOf(city, 4064)]).toEqual([0.625, 80, 0.625, 80, 40.3125]);
  // Miami leaves eight sectors north of it for its coast.
  const miami = framed({ chunksX: 127, chunksZ: 127, frameX: 2048, frameZ: 2048, originX: 2176, originZ: 2304 });
  expect([latOf(miami, 8128), latOf(miami, 0), lonOf(miami, 8128)]).toEqual([80.625, 160, 0.625]);
  // A map 36 by 4 units: a unit is as long either way, and ten are a sector. Its shares run 0 to 1 each way all the same.
  const map = framed({ chunksX: 36, chunksZ: 4, frameX: 104, frameZ: 32 });
  const extent = { sizeX: 2304, sizeZ: 256 };
  expect([lonOf(map, 2304), lonOf(map, 0), latOf(map, 256), latOf(map, 0)]).toEqual([2.5, 25, 7.5, 10]);
  expect([lonOf(map, 1000) - lonOf(map, 1000 + 1024), latOf(map, 100) - latOf(map, 100 + 102.4)]).toEqual([10, 1]);
  expect([mapU(extent, 2304), mapU(extent, 0), mapV(extent, 256), mapV(extent, 0), mapU(extent, 1152)]).toEqual([0, 1, 0, 1, 0.5]);
  const rng = new Rng(4);
  for (let i = 0; i < 200; i++) {
    const x = rng.range(0, extent.sizeX);
    const z = rng.range(0, extent.sizeZ);
    expect(xOfLon(map, lonOf(map, x))).toBeCloseTo(x, 8);
    expect(zOfLat(map, latOf(map, z))).toBeCloseTo(z, 8);
    expect(xOfU(extent, mapU(extent, x))).toBeCloseTo(x, 8);
    expect(zOfV(extent, mapV(extent, z))).toBeCloseTo(z, 8);
  }
  expect(latLonText(47.26, 50)).toBe("47.3 lat  50.0 lon");
});

test("a chunk's summary holds each cell's tallest piece, how high it stands and whose it is", () => {
  const w = flatWorld(2);
  const k = (id: string) => w.kind(`core:${id}`);
  const colour = (id: string) => (w.reg.defs[k(id)] as { color: number }).color;
  w.structs.add(k("foundation_wood"), 6, 0.19, 6, 0, 7, 100);
  w.structs.add(k("wall_stone"), 6, 1.88, 7.5, 0, 7, 100);
  // The static pillar is 6 m tall and another team's.
  w.structs.add(k("pillar"), 10, 3, 6, 0, 9, 100);
  // A foundation alone is under a metre high.
  w.structs.add(k("foundation_thatch"), 62, 0.19, 62, 0, 9, 100);
  const s = bake(w);
  expect(s.filled).toBe(3);
  expect([...s.teams.subarray(0, s.teamCount)]).toEqual([7, 9]);
  expect(cell(s, 1, 1)).toEqual({ filled: true, tint: colour("wall_stone"), band: 1, owner: 0 });
  expect(cell(s, 2, 1)).toEqual({ filled: true, tint: colour("pillar"), band: 2, owner: 1 });
  expect(cell(s, 15, 15)).toEqual({ filled: true, tint: colour("foundation_thatch"), band: 0, owner: 1 });
  expect(cell(s, 0, 0).filled).toBe(false);
  // Each coarser cell is the tallest of the four under it.
  expect(cell(s, 0, 0, 1)).toEqual(cell(s, 1, 1));
  expect(cell(s, 1, 0, 1)).toEqual(cell(s, 2, 1));
  expect(cell(s, 0, 0, 2)).toEqual(cell(s, 2, 1));
  expect(cell(s, 0, 0, 3)).toEqual(cell(s, 2, 1));
  expect(cell(s, 1, 1, 3)).toEqual(cell(s, 15, 15));
  expect(cell(s, 1, 0, 3).filled).toBe(false);

  // Only one team's cells, as a tribe far away is shown its own.
  const mine = new Summary();
  onlyTeam(s, 1, mine);
  expect([mine.filled, mine.teamCount, mine.teams[0]]).toEqual([2, 1, 9]);
  expect(cell(mine, 1, 1).filled).toBe(false);
  expect(cell(mine, 2, 1)).toEqual({ filled: true, tint: colour("pillar"), band: 2, owner: 0 });
  expect(cell(mine, 0, 0, 3)).toEqual(cell(mine, 2, 1));

  // The same table bakes to the same summary, and health or a new owner of nothing new changes none of it.
  const again = bake(w);
  expect(again.same(s)).toBe(true);
  w.structs.damage(w.structs.add(k("wall_stone"), 6, 1.88, 4.5, 0, 7, 100), 10);
  expect(bake(w).same(s)).toBe(true);
  w.structs.reown(9, 11);
  expect(bake(w).same(s)).toBe(false);
});

test("a wide piece fills the cells it covers and a small one the cell of its centre, as brute force finds them", () => {
  const w = flatWorld(2);
  const slab = w.kind("core:slab");
  // An 8 m slab square on the cell grid covers four cells, and turned an eighth of a turn its corners reach further.
  w.structs.add(slab, 40, 0.25, 40, 0, 1, 100);
  let s = bake(w);
  const filled = (s: Summary): string[] => {
    const out: string[] = [];
    for (let c = 0; c < 256; c++) if (s.info[c] !== 0) out.push(`${c % 16},${c >> 4}`);
    return out;
  };
  expect(filled(s)).toEqual(["9,9", "10,9", "9,10", "10,10"]);
  w.structs.remove(0);
  w.structs.add(slab, 40, 0.25, 40, 8192, 1, 100);
  s = bake(w);
  expect(filled(s).length).toBeGreaterThan(4);
  for (const at of ["9,9", "10,10", "8,9", "11,10", "9,8", "10,11"]) expect(filled(s)).toContain(at);
  expect(filled(s)).not.toContain("8,8");

  // 3,000 small pieces at random: each cell shows the piece whose top is highest among those centred in it.
  const many = flatWorld(2);
  const kinds = ["foundation_wood", "wall_stone", "pillar_metal", "storage_box", "ceiling_thatch"].map((id) => many.kind(`core:${id}`));
  const rng = new Rng(11);
  const best = new Map<number, { top: number; kind: number; owner: number }>();
  for (let n = 0; n < 3000; n++) {
    const kind = kinds[rng.int(kinds.length)]!;
    const ref = many.structs.add(kind, rng.range(64.1, 127.9), rng.range(0, 40), rng.range(0.1, 63.9), rng.int(4) * 16384, 1 + rng.int(3), 100);
    const t = many.structs.chunks[1]!;
    const slot = ref & 0xffff;
    const c = Math.min(15, Math.floor(t.z[slot]! / 4)) * 16 + Math.min(15, Math.floor((t.x[slot]! - 64) / 4));
    const top = t.y[slot]! + many.reg.halfY[kind]!;
    if (!best.has(c) || top > best.get(c)!.top) best.set(c, { top, kind, owner: t.owner[slot]! });
  }
  const b = bake(many, 1);
  expect(b.filled).toBe(best.size);
  const tints = pieceShapes(many.reg).tint;
  for (const [c, want] of best) {
    expect(b.tint[c]).toBe(tints[want.kind]!);
    expect(b.teams[(b.info[c]! >> 3) & 7]).toBe(want.owner);
    expect(b.info[c]! & 7).toBe([1, 4, 8, 16, 32, 64].findIndex((m) => want.top <= m));
  }
});

test("a summary travels at any of its four cell sizes, a base in tens of bytes, and bad bytes are refused", () => {
  const w = flatWorld(2);
  const k = (id: string) => w.kind(`core:${id}`);
  // A house six foundations square with walls round it.
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) w.structs.add(k("foundation_wood"), 13.5 + i * 3, 0.19, 13.5 + j * 3, 0, 21, 100);
    for (const [x, z, yaw] of [[13.5 + i * 3, 12, 0], [13.5 + i * 3, 30, 0], [12, 13.5 + i * 3, 16384], [30, 13.5 + i * 3, 16384]] as const) w.structs.add(k("wall_stone"), x, 1.88, z, yaw, 21, 100);
  }
  const s = bake(w);
  const wr = new BitWriter(1024);
  const r = new BitReader();
  const got = new Cells();
  const sizes: number[] = [];
  for (let level = 0; level < 4; level++) {
    wr.reset();
    writeCells(wr, 513, s, level);
    expect(wr.overflow).toBe(false);
    sizes.push(wr.byteLength);
    r.reset(wr.bytes().slice());
    expect(readCells(r, got)).toBe(513);
    expect(got.level).toBe(level);
    expect([...got.teams.subarray(0, got.teamCount)]).toEqual([21]);
    const n = levelSide(level) * levelSide(level);
    expect([...got.tint.subarray(0, n)]).toEqual([...s.tint.subarray(LEVEL_AT[level]!, LEVEL_AT[level]! + n)]);
    expect([...got.info.subarray(0, n)]).toEqual([...s.info.subarray(LEVEL_AT[level]!, LEVEL_AT[level]! + n)]);
  }
  expect(sizes[0]!).toBeLessThanOrEqual(60);
  expect(sizes[3]!).toBeLessThanOrEqual(10);
  expect(sizes).toEqual([...sizes].sort((a, b) => b - a));

  // The worst chunk has no two neighbours alike, and eight teams, the last of which is only "another".
  const worst = flatWorld(2);
  const pieces = ["foundation_wood", "foundation_stone"].map((id) => worst.kind(`core:${id}`));
  for (let c = 0; c < 256; c++) worst.structs.add(pieces[(c + (c >> 4)) % 2]!, (c % 16) * 4 + 2, 0.19, (c >> 4) * 4 + 2, 0, 1000000 + (c % 8), 100);
  const full = bake(worst);
  expect(full.filled).toBe(256);
  expect(full.teamCount).toBe(7);
  expect((full.info[7]! >> 3) & 7).toBe(OWNER_OTHER);
  wr.reset();
  writeCells(wr, 0, full, 0);
  expect(wr.byteLength).toBeLessThanOrEqual(760);
  const bytes = wr.bytes().slice();
  r.reset(bytes);
  expect(readCells(r, got)).toBe(0);
  expect((got.info[7]! >> 3) & 7).toBe(OWNER_OTHER);
  // Cut short, or with an owner that is no team of its own.
  r.reset(bytes.subarray(0, 300));
  expect(readCells(r, got)).toBe(-1);
  wr.reset();
  wr.u16(4);
  wr.bits(3, 2);
  wr.bits(1, 3);
  wr.varint(9);
  wr.bits(3, 2);
  wr.bool(true);
  wr.u8(5);
  wr.bits(2 | (3 << 3), 6);
  r.reset(wr.bytes().slice());
  expect(readCells(r, got)).toBe(-1);
});

test("far cells keep each cell's tallest piece, defence or static to a quarter metre, and no box, bed, station or owner", () => {
  const w = flatWorld(2);
  const k = (id: string) => w.kind(`core:${id}`);
  const colour = (id: string) => (w.reg.defs[k(id)] as { color: number }).color;
  const far = (s: Summary, cx: number, cz: number) => ({ tint: s.far.tint[cz * 16 + cx]!, top: farTopMetres(s.far.top[cz * 16 + cx]!) });
  // A box in an open yard, a bed and a campfire, each alone in its cell; and a box on a foundation.
  for (const [id, x] of [["storage_box", 2], ["bed", 6], ["campfire", 10]] as const) w.structs.add(k(id), x, w.reg.halfY[k(id)]!, 2, 0, 7, 100);
  w.structs.add(k("foundation_wood"), 18, 0.19, 2, 0, 7, 100);
  w.structs.add(k("storage_box"), 18, 0.38 + 0.3125, 2, 0, 7, 100);
  // A tower of pillars 12 m high and a wall.
  for (let i = 0; i < 2; i++) w.structs.add(k("pillar"), 26, 3 + i * 6, 26, 0, 9, 100);
  w.structs.add(k("wall_stone"), 34, 1.88, 34, 0, 7, 100);
  const s = bake(w);
  expect(s.filled).toBe(6);
  expect(s.far.filled).toBe(3);
  for (const cx of [0, 1, 2]) expect([cell(s, cx, 0).filled, far(s, cx, 0).tint, s.far.top[cx]]).toEqual([true, 0, 0]);
  expect(far(s, 4, 0)).toEqual({ tint: colour("foundation_wood"), top: 0.5 });
  expect(far(s, 6, 6)).toEqual({ tint: colour("pillar"), top: 12 });
  expect(Math.abs(far(s, 8, 8).top - (1.88 + w.reg.halfY[k("wall_stone")]!))).toBeLessThanOrEqual(0.25);

  // The far cells have their own version: a box in an empty cell changes the map and not them, and blows change neither.
  const box = w.structs.add(k("storage_box"), 50, 0.3125, 50, 0, 7, 100);
  const boxed = bake(w);
  expect([boxed.same(s), boxed.far.same(s.far)]).toEqual([false, true]);
  w.structs.damage(box, 10);
  expect(bake(w).far.same(s.far)).toBe(true);
  // A new owner changes the map's cells and not the far ones.
  w.structs.reown(9, 11);
  expect([bake(w).same(boxed), bake(w).far.same(s.far)]).toEqual([false, true]);

  // The top's byte: half metres to 64 m, then 2 m steps to 318 m, and never 0 for a filled cell.
  for (let m = -1; m <= 330; m += 0.37) {
    const b = farTopByte(m);
    expect(b).toBeGreaterThanOrEqual(1);
    expect(Math.abs(farTopMetres(b) - Math.max(0.5, Math.min(318, m)))).toBeLessThanOrEqual(m <= 64 ? 0.25 : 1);
  }
  expect([farTopByte(64), farTopByte(64.9), farTopByte(65.1), farTopByte(318), farTopByte(1000)]).toEqual([128, 128, 129, 255, 255]);
});

test("a chunk's far cells travel whole in at most 802 bytes with no owner, an empty one in 4, and bad bytes are refused", () => {
  const w = flatWorld(2);
  const k = (id: string) => w.kind(`core:${id}`);
  // The same house built by two tribes in two chunks.
  for (const [x0, team] of [[0, 21], [64, 1000003]] as const) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) w.structs.add(k("foundation_wood"), x0 + 13.5 + i * 3, 0.19, 13.5 + j * 3, 0, team, 100);
      w.structs.add(k("wall_stone"), x0 + 13.5 + i * 3, 1.88, 12, 0, team, 100);
    }
  }
  const wr = new BitWriter(1024);
  const r = new BitReader();
  const got = new FarCells();
  const sent: Uint8Array[] = [];
  for (const chunk of [0, 1]) {
    const s = bake(w, chunk);
    wr.reset();
    writeFar(wr, chunk, s.far);
    sent.push(wr.bytes().slice());
    r.reset(sent[chunk]!);
    expect(readFar(r, got)).toBe(chunk);
    expect(got.same(s.far)).toBe(true);
  }
  // Past the chunk's number the two are the same bytes: nothing says whose they are.
  expect(sent[0]!.subarray(2)).toEqual(sent[1]!.subarray(2));
  expect(sent[0]!.length).toBeLessThanOrEqual(40);

  // No cell like the one before it, row by row, is the most a chunk can take.
  const worst = flatWorld(2);
  const pieces = ["foundation_wood", "foundation_stone"].map((id) => worst.kind(`core:${id}`));
  for (let c = 0; c < 256; c++) worst.structs.add(pieces[c % 2]!, (c % 16) * 4 + 2, 0.19, (c >> 4) * 4 + 2, 0, 1, 100);
  wr.reset();
  writeFar(wr, 0, bake(worst).far);
  expect(wr.byteLength).toBe(802);
  const bytes = wr.bytes().slice();
  r.reset(bytes.subarray(0, 300));
  expect(readFar(r, got)).toBe(-1);
  wr.reset();
  writeFar(wr, 9, new FarCells());
  expect(wr.byteLength).toBe(4);
  r.reset(wr.bytes().slice());
  expect([readFar(r, got), got.filled]).toEqual([9, 0]);
  // A filled cell whose top is 0.
  wr.reset();
  wr.u16(0);
  wr.bits(255, 8);
  wr.bool(true);
  wr.u8(5);
  wr.u8(0);
  r.reset(wr.bytes().slice());
  expect(readFar(r, got)).toBe(-1);
});

test("marks travel in four and a half bytes each, to within a step of the map", () => {
  const map = { sizeX: 8192, sizeZ: 4096 };
  const w = new BitWriter(2048);
  const rng = new Rng(5);
  const sent: { kind: number; x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < 255; i++) sent.push({ kind: i % 3 === 0 ? MARK_MATE : MARK_TAME, x: rng.range(0, map.sizeX), z: rng.range(0, map.sizeZ), yaw: rng.int(65536) });
  writeMarksHead(w, 7, 3, PLAYERS_VIEW, sent.length);
  for (const m of sent) writeMark(w, m.kind, m.x, m.z, m.yaw, map);
  expect(w.byteLength).toBe((20 + 255 * 36) / 8);
  const got = new Marks();
  const r = new BitReader(w.bytes().slice());
  expect(readMarks(r, map, got)).toBe(true);
  expect([got.count, got.self, got.zoom, got.players, got.version]).toEqual([255, 7, 3, PLAYERS_VIEW, 1]);
  for (let i = 0; i < 255; i++) {
    expect(got.kind[i]).toBe(sent[i]!.kind);
    expect(Math.abs(got.x[i]! - sent[i]!.x)).toBeLessThanOrEqual(0.26);
    expect(Math.abs(got.z[i]! - sent[i]!.z)).toBeLessThanOrEqual(0.13);
    expect(got.heading[i]).toBe(sent[i]!.yaw >>> 11);
  }
  // A count the bytes do not hold is refused and changes nothing.
  expect(readMarks(new BitReader(w.bytes().slice(0, 100)), map, got)).toBe(false);
  expect([got.count, got.version]).toEqual([255, 1]);
});
