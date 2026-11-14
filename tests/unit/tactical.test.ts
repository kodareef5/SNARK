import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import { latLonText, latOf, lonOf, xOfLon, zOfLat } from "../../shared/world/coords.ts";
import { CELL_FILLED, Cells, LEVEL_AT, MARK_MATE, MARK_TAME, Marks, OWNER_OTHER, PLAYERS_VIEW, Summary, bakeChunk, levelSide, onlyTeam, readCells, readMarks, writeCells, writeMark, writeMarksHead, type PieceShapes } from "../../shared/world/tactical.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

function shapesOf(w: TestWorld): PieceShapes {
  return { halfX: w.reg.halfX, halfY: w.reg.halfY, halfZ: w.reg.halfZ, tint: Uint8Array.from(w.reg.defs, (d) => (d?.type === "structure" ? d.color : 0)) };
}

function bake(w: TestWorld, chunk = 0): Summary {
  const s = new Summary();
  bakeChunk(w.structs.chunks[chunk] ?? null, (chunk % w.dims.chunksX) * 64, Math.floor(chunk / w.dims.chunksX) * 64, shapesOf(w), w.hf, s);
  return s;
}

const cell = (s: Summary, cx: number, cz: number, level = 0) => {
  const at = LEVEL_AT[level]! + cz * levelSide(level) + cx;
  const v = s.info[at]!;
  return { filled: (v & CELL_FILLED) !== 0, tint: s.tint[at]!, band: v & 7, owner: (v >> 3) & 7 };
};

test("latitude and longitude run 0 to 100 from the north-west corner, +X is west, and both convert back", () => {
  const map = { sizeX: 2304, sizeZ: 256 };
  expect(latOf(map, 256)).toBe(0);
  expect(latOf(map, 0)).toBe(100);
  expect(lonOf(map, 2304)).toBe(0);
  expect(lonOf(map, 0)).toBe(100);
  expect(lonOf(map, 1152 - 23.04)).toBeCloseTo(51, 9);
  const rng = new Rng(4);
  for (let i = 0; i < 200; i++) {
    const x = rng.range(0, map.sizeX);
    const z = rng.range(0, map.sizeZ);
    expect(xOfLon(map, lonOf(map, x))).toBeCloseTo(x, 8);
    expect(zOfLat(map, latOf(map, z))).toBeCloseTo(z, 8);
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
  const tints = shapesOf(many).tint;
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
