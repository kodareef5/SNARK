import { expect, test } from "bun:test";
import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, frameKey, framed, type MapDims } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { CityStatics, cityTops } from "../../shared/world/city.ts";
import { MapStatics, OVERVIEW_STEP, blankLayers, blankStatics, joinParts, joinStatics, mapHeightfield, mapNodes, mapTops, parseMap, partSteps, placeStatics, holdRoad, readHead, readPart, resolveNodes, setGround, setStatics, topsOf, writeMap, type GroundPiece, type MapData, type RoadPiece, type NodeScatter, type NodeZoned, type OverviewPiece, type StaticsPiece, type TopsPiece } from "../../shared/world/mapfile.ts";
import { FarCells, Summary, bakeChunk, pieceShapes } from "../../shared/world/tactical.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { SEA_DRY, SEA_UNDER, formOf, mix, nodeForms, scatterNodes, type NodeForms, type NodeSource, type NodeSpot, type SlotsTaken } from "../../shared/world/nodes.ts";
import { MapWater, seaHere } from "../../shared/world/water.ts";
import { Rng } from "../../shared/rng.ts";
import { ROAD_PLANES, RoadSectors, roadSamples } from "../../shared/world/roadframe.ts";
import { Found, GONE_FELL, StructureStore } from "../../shared/world/structures.ts";
import { busyMap, flatMap, wideMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const spot = (): NodeSpot => ({ kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 });

test("a map written to a file is read back whole, and the same map is the same bytes", () => {
  const map = busyMap();
  const file = writeMap(map);
  const back = parseMap(file);
  // A map that does not say where it sits is read back at the lattice's middle, with the default display origin. Its hash is its head's.
  expect({ ...back, statics: [...back.statics] }).toEqual({ ...map, dims: framed(map.dims), statics: [...map.statics], hash: hashBytes(file.subarray(12, readHead(file).bytes)) });
  expect(back.dims).toEqual({ chunksX: 2, chunksZ: 3, frameX: 2048, frameZ: 2048, originX: 2064, originZ: 2064 });
  expect(writeMap(back)).toEqual(file);
  // One that does keeps its frame and origin, and its head differs from the default's in those eight bytes and its hashes.
  const placed = { chunksX: 2, chunksZ: 3, frameX: 1001, frameZ: 4093, originX: 1008, originZ: 4096 };
  const there = writeMap({ ...map, dims: placed });
  expect(parseMap(there).dims).toEqual(placed);
  expect(parseMap(there).heights).toEqual(map.heights);
  // A map with nothing on it and no water.
  const bare = parseMap(writeMap(flatMap(1)));
  expect([bare.seaLevel, [...bare.statics], bare.nodes, mapNodes(bare, mapHeightfield(bare), reg)]).toEqual([-Infinity, [], [], null]);
  // Smooth ground costs little once the file is compressed for the wire.
  expect(Bun.gzipSync(writeMap(flatMap(4))).length).toBeLessThan(400);
});

test("a map written in parts and read back is the map it was made of: every height, tint, static in its slot, node slot and water square", () => {
  const map = wideMap();
  const file = writeMap(map);
  const back = parseMap(file);
  const head = readHead(file);
  // Two overviews and ten sectors of ground, and a sector's statics for each sector that has some.
  expect(head.parts.map((p) => `${p.kind} ${p.col}-${p.row}`)).toEqual(["overview 31-32", "overview 32-32", ...[128, 129].flatMap((r) => [127, 128, 129, 130, 131].map((c) => `ground ${c}-${r}`)), ...[128, 129].flatMap((r) => [127, 128, 129, 130, 131].map((c) => `statics ${c}-${r}`))]);
  expect([back.heights, back.tint]).toEqual([map.heights, map.tint]);
  // The statics set down from the file fill the slots those of the list fill, piece for piece.
  const [ours, theirs] = [back, map].map((m) => {
    const structs = new StructureStore(m.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    placeStatics(m, structs, reg);
    return structs;
  });
  expect(ours!.held).toEqual(theirs!.held);
  for (const c of theirs!.held) for (const col of ["kind", "x", "y", "z", "yaw"] as const) expect(ours!.chunks[c]![col]).toEqual(theirs!.chunks[c]![col]);
  expect(back.statics.first).toEqual(MapStatics.of(map.dims, map.statics).first);
  // Every node slot of every chunk, of every layer: scattered where its picture allows, listed, and the two zoned on one picture.
  const hf = mapHeightfield(back);
  const [a, b] = [mapNodes(back, hf, reg)!, mapNodes(map, hf, reg)!];
  const [s, t] = [spot(), spot()];
  let standing = 0;
  for (let c = 0; c < chunkCount(map.dims); c++) {
    for (let i = 0; i < a.perChunk; i++) {
      a.at(c, i, s);
      b.at(c, i, t);
      expect(s.kind === 0 ? [0] : s).toEqual(t.kind === 0 ? [0] : t);
      if (s.kind !== 0) standing++;
    }
  }
  expect([a.perChunk, standing > 5000]).toEqual([46, true]);
  expect([back.nodes[0], back.nodes[1]]).toEqual([map.nodes[0], map.nodes[1]]);
  // Every chunk's water squares.
  const [w, v] = [back.water!, map.water!];
  expect([w.chunks(), w.bodies, w.cell]).toEqual([v.chunks(), v.bodies, v.cell]);
  for (const c of v.chunks()) expect(w.squares.subarray(w.block[c]!, w.block[c]! + 64)).toEqual(v.squares.subarray(v.block[c]!, v.block[c]! + 64));
  expect(writeMap(back)).toEqual(file);
});

test("the reader accepts the previous bend layout and refuses unknown formats", () => {
  const plain = writeMap({ ...wideMap(), statics: [] });
  const as = (version: number): Uint8Array<ArrayBuffer> => {
    const f = plain.slice();
    new DataView(f.buffer).setUint16(4, version, true);
    return f;
  };
  expect(readHead(as(15)).version).toBe(15);
  for (const v of [10, 11, 13, 14, 255]) expect(() => readHead(as(v))).toThrow(`map: version ${v} is not one this build reads`);
});

test("a sector's statics name their own kinds", () => {
  const wide = wideMap();
  // A kind only the far corner's sector holds.
  const corner = { kind: "core:torch", x: wide.dims.chunksX * CHUNK_SIZE - 10, y: 1, z: wide.dims.chunksZ * CHUNK_SIZE - 10, yaw: 0 };
  const map = { ...wide, statics: [...wide.statics, corner] };
  const file = writeMap(map);
  const head = readHead(file);
  const part = head.parts.find((p) => p.kind === "statics")!;
  const bytes = file.subarray(part.at, part.at + part.length);
  const piece = readPart(head, part, bytes) as StaticsPiece;
  // Its own table: the kinds it holds, in the head's order.
  const used = [...new Set(piece.id)].sort((a, b) => a - b).map((k) => head.kinds[k]!);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let at = 2;
  const own = Array.from({ length: view.getUint16(0, true) }, () => new TextDecoder().decode(bytes.subarray(at + 1, (at += 1 + bytes[at]!))));
  expect(own).toEqual(used);
  expect(used.length).toBeLessThan(head.kinds.length);
  // A kind the head does not name is refused.
  expect(() => readPart({ ...head, kinds: head.kinds.filter((k) => k !== own[0]) }, part, bytes)).toThrow("which its head does not");
});

test("a map's roads' frame rides in a part of its own for each sector a road runs in, is read whole only where it is drawn from, and is held a sector at a time", () => {
  const map = wideMap();
  const nx = map.dims.chunksX * 32 + 1, nz = map.dims.chunksZ * 32 + 1, cells = roadSamples(nx), n = cells * roadSamples(nz);
  // A frame on the first 100 rows of cells only: the sectors past them have no road part.
  const plane = (k0: number): Uint8Array => Uint8Array.from({ length: n }, (_, k) => (k < 100 * cells ? ((k * 7 + k0) % 255) + 1 : 0));
  const road = { across: plane(0), along: plane(1), half: plane(2), lanes: plane(3) };
  const file = writeMap({ ...map, road }), plain = writeMap(map);
  const head = readHead(file), parts = head.parts.filter((p) => p.kind === "road");
  // Every other part is as a map without a frame has it, the head but for its table of parts.
  const others = (f: Uint8Array): string[] => readHead(f).parts.filter((p) => p.kind !== "road").map((p) => p.name);
  expect(others(file)).toEqual(others(plain));
  expect(parts.length).toBeGreaterThan(0);
  expect(parts.length).toBeLessThan(head.parts.filter((q) => q.kind === "ground").length);
  // A server's read keeps none of it; a drawing read keeps it whole, and writes the same bytes again.
  expect(parseMap(file).road).toBeUndefined();
  const drawn = parseMap(file, true, true);
  expect(drawn.road).toEqual(road);
  expect(writeMap(drawn)).toEqual(file);
  const whole = new Uint8Array(ROAD_PLANES);
  expect(mapHeightfield(drawn).road!.cell(1000 % cells, Math.floor(1000 / cells), whole, 0)).toBe(true);
  expect([...whole]).toEqual([road.across[1000]!, road.along[1000]!, road.half[1000]!, road.lanes[1000]!]);
  // A sector's part read alone is held by its square, gives its cells and no other, and is let go with it.
  const p = parts[1]!, piece = readPart(head, p, file.subarray(p.at, p.at + p.length)) as RoadPiece;
  const held = new RoadSectors();
  holdRoad(held, piece);
  const i0 = (piece.sq.cx0 * 32) / 2, j0 = (piece.sq.cz0 * 32) / 2, k = (j0 + 3) * cells + i0 + 5, cell = new Uint8Array(ROAD_PLANES);
  expect(held.cell(i0 + 5, j0 + 3, cell, 0)).toBe(true);
  expect([...cell]).toEqual([road.across[k]!, road.along[k]!, road.half[k]!, road.lanes[k]!]);
  expect(held.cell(i0 - 1, j0, cell, 0)).toBe(false);
  expect(held.bytes).toBe(piece.road.across.length * ROAD_PLANES);
  held.drop(p.col * 4096 + p.row);
  expect([held.bytes, held.cell(i0 + 5, j0 + 3, cell, 0)]).toEqual([0, false]);
});

test("each part reads alone given the head, and sets into what the game holds", () => {
  const map = wideMap();
  const file = writeMap(map);
  const head = readHead(file);
  const bytes = (kind: string, col: number, row: number): [typeof head.parts[number], Uint8Array] => {
    const p = head.parts.find((q) => q.kind === kind && q.col === col && q.row === row)!;
    return [p, file.subarray(p.at, p.at + p.length)];
  };
  const nx = 70 * 32 + 1;
  // The second sector of the first row: chunks 8 up to 24 along x, 0 up to 14 along z, and its far edges.
  const ground = readPart(head, ...bytes("ground", 128, 128)) as GroundPiece;
  expect([ground.sq.cx0, ground.sq.cx1, ground.sq.cz0, ground.sq.cz1, ground.heights.length]).toEqual([8, 24, 0, 14, 513 * 449]);
  const [heights, tint] = [new Uint16Array(map.heights.length), new Uint8Array(0)];
  setGround(head.dims, heights, tint, ground);
  for (let j = 0; j < 449; j++) expect([...heights.subarray(j * nx + 256, j * nx + 769)]).toEqual([...map.heights.subarray(j * nx + 256, j * nx + 769)]);
  expect([heights[nx * 449 + 256], heights[255], heights[769]]).toEqual([0, 0, 0]);
  // An overview: every fourth sample, and each of its chunks' lowest and highest sample, edges and all.
  const over = readPart(head, ...bytes("overview", 32, 32)) as OverviewPiece;
  const w = 62 * 8 + 1;
  expect(over.heights.length).toBe(w * (20 * 8 + 1));
  for (const [i, j] of [[0, 0], [7, 3], [w - 1, 160]] as const) expect(over.heights[j * w + i]).toBe(map.heights[j * OVERVIEW_STEP * nx + 256 + i * OVERVIEW_STEP]);
  const lowest = (cx: number, cz: number): number[] => {
    const all = Array.from({ length: 33 * 33 }, (_, k) => map.heights[(cz * 32 + Math.floor(k / 33)) * nx + cx * 32 + (k % 33)]!);
    return [Math.min(...all), Math.max(...all)];
  };
  expect([over.low[0], over.high[0], over.low[62 * 19 + 61], over.high[62 * 19 + 61]]).toEqual([...lowest(8, 0), ...lowest(69, 19)]);
  // A sector's statics: those of its chunks, each in its chunk, in the map's order.
  const statics = readPart(head, ...bytes("statics", 127, 129)) as StaticsPiece;
  const whole = MapStatics.of(map.dims, map.statics);
  let mine = 0;
  for (let cz = 14; cz < 20; cz++) for (let cx = 0; cx < 8; cx++) mine += whole.first[cz * 70 + cx + 1]! - whole.first[cz * 70 + cx]!;
  expect([statics.id.length, [...statics.chunk].every((c) => c % 70 < 8 && c >= 14 * 70)]).toEqual([mine, true]);
  // Without its statics' parts the head and the rest are the map with none, which a client draws from while they come.
  const ground0 = joinParts(head, head.parts.filter((p) => p.kind !== "statics").map((p) => readPart(head, p, file.subarray(p.at, p.at + p.length))), false);
  expect([ground0.statics.length, ground0.heights, ground0.nodes[2]]).toEqual([0, map.heights, parseMap(file).nodes[2]]);
  expect(blankLayers(head).map((l) => ("zone" in l ? l.zone.length : "first" in l ? l.first.length : l.allow!.length))).toEqual([11200, 1401, 22400, 22400]);
  // Read a step at a time, a city's pieces in one sector yield a slice of them a step.
  const many = Array.from({ length: 70000 }, (_, i) => ({ kind: i % 3 ? "core:wall" : "core:crate", x: (i % 250) / 4, y: 1 + (i % 7), z: (i * 7) % 64, yaw: i % 65536 }));
  // A chunk holds 65,535 at most, as a structure store's chunk does; over two chunks they are a sector's.
  expect(() => writeMap({ ...flatMap(1), statics: many })).toThrow("map: chunk 0, 0 holds more than 65535 statics");
  const city = writeMap({ ...flatMap(2), statics: many.map((s, i) => ({ ...s, x: s.x + (i % 2) * CHUNK_SIZE })) });
  const cityHead = readHead(city);
  const part = cityHead.parts.find((p) => p.kind === "statics")!;
  const steps = partSteps(cityHead, part, city.subarray(part.at, part.at + part.length));
  let step = steps.next();
  let taken = 0;
  for (; !step.done; step = steps.next()) taken++;
  expect([taken, (step.value as StaticsPiece).id.length]).toEqual([2, 70000]);
  // Pieces from one end of the widest map to the other, and from the lowest to the highest, come back where they were.
  const dims = { chunksX: 256, chunksZ: 1 };
  const samples = (256 * 32 + 1) * 33;
  const far = [{ kind: "core:wall", x: 0, y: -1024, z: 64, yaw: 65535 }, { kind: "core:wall", x: 16384, y: 3072, z: 0, yaw: 0 }, { kind: "core:wall", x: 0.5, y: 0, z: 63.5, yaw: 1 }];
  const wide = parseMap(writeMap({ ...flatMap(1), dims, heights: new Uint16Array(samples), tint: new Uint8Array(samples), statics: far }));
  const ref = MapStatics.of(dims, far);
  expect([wide.statics.first, wide.statics.x, wide.statics.y, wide.statics.z, wide.statics.yaw]).toEqual([ref.first, ref.x, ref.y, ref.z, ref.yaw]);
  // The map's order is each sector's pieces in turn, its own in the order the map gave them.
  expect([...wide.statics]).toEqual([far[0], far[2], far[1]]);
  // A piece off the map in the part itself is refused as one in a map written so would be.
  const off = city.slice();
  // The high byte of the last piece's x, in the third of x's planes, after the part's kinds, its count and 6 planes.
  const kinds = 2 + 1 + "core:crate".length + 1 + "core:wall".length;
  off[part.at + kinds + 4 + 6 * 70000 + 69999]! = 0x7f;
  expect(() => readPart(cityHead, part, off.subarray(part.at, part.at + part.length), false)).toThrow("is off the map");
});

test("the head lays out every chunk's statics, and each sector's set in alone, in any order, makes the table joinStatics makes", () => {
  const map = wideMap();
  const file = writeMap(map);
  const head = readHead(file);
  const pieces = head.parts.filter((p) => p.kind === "statics").map((p) => readPart(head, p, file.subarray(p.at, p.at + p.length)) as StaticsPiece);
  const listed = MapStatics.of(map.dims, map.statics);
  expect([...head.counts]).toEqual(Array.from({ length: chunkCount(map.dims) }, (_, c) => listed.first[c + 1]! - listed.first[c]!));
  const finish = <T,>(steps: Generator<void, T>): T => {
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
    }
  };
  const columns = (t: MapStatics): unknown[] => [t.kinds, t.first, t.kind, t.yaw, t.x, t.y, t.z, t.row];
  // A sector alone fills its own chunks' rows and no others.
  const alone = blankStatics(head);
  const one = pieces[3]!;
  finish(setStatics(head, alone, one));
  const whole = finish(joinStatics(head, pieces));
  for (let c = 0; c < chunkCount(map.dims); c++) {
    const rows = [alone.first[c]!, alone.first[c + 1]!] as const;
    const mine = one.chunk.includes(c);
    for (const col of ["kind", "yaw", "x", "y", "z"] as const) expect([...alone[col].subarray(...rows)]).toEqual(mine ? [...whole[col].subarray(...rows)] : Array(rows[1] - rows[0]).fill(0));
  }
  // Every sector, in a scrambled order, with the map's order and without it.
  const scrambled = [7, 2, 9, 0, 5, 1, 8, 3, 6, 4].map((k) => pieces[k]!);
  expect(scrambled.length).toBe(pieces.length);
  for (const order of [true, false]) {
    const t = blankStatics(head, order);
    for (const p of scrambled) finish(setStatics(head, t, p));
    expect(columns(t)).toEqual(columns(finish(joinStatics(head, pieces, order))));
  }
  expect([...finish(joinStatics(head, pieces))]).toEqual([...parseMap(file).statics]);
  // A sector's statics that do not fill the rows its head counts are refused.
  const short = { ...one, id: one.id.subarray(1), yaw: one.yaw.subarray(1), x: one.x.subarray(1), y: one.y.subarray(1), z: one.z.subarray(1), chunk: one.chunk.subarray(1) };
  expect(() => finish(setStatics(head, blankStatics(head), short))).toThrow(`map: the statics of sector ${one.sq.col}, ${one.sq.row} do not fill the rows laid out for them`);
});

test("an overview's tops are the far feed's cells of its chunks as the statics give them, read alone and after every other part", () => {
  const map = wideMap();
  const tops = mapTops(map, reg);
  const file = writeMap({ ...map, tops });
  const head = readHead(file);
  // A part for each overview's square, after every other part, and nothing in the first frame waits for them.
  expect(head.parts.filter((p) => p.kind === "tops").map((p) => `${p.col}-${p.row}`)).toEqual(["31-32", "32-32"]);
  expect(head.parts.slice(-2).every((p) => p.kind === "tops")).toBe(true);
  const back = parseMap(file);
  expect(writeMap(back)).toEqual(file);
  // What the server bakes of each chunk with the statics set down, and the tops the far city takes from the statics.
  const hf = mapHeightfield(back);
  const structs = new StructureStore(back.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(back, structs, reg);
  const city = new CityStatics(back.dims, back.statics, reg);
  const [baked, read] = [new Summary(), new FarCells()];
  const pieces = head.parts.filter((p) => p.kind === "tops").map((p) => readPart(head, p, file.subarray(p.at, p.at + p.length)) as TopsPiece);
  let filled = 0;
  for (let c = 0; c < chunkCount(back.dims); c++) {
    bakeChunk(structs.chunks[c] ?? null, chunkCx(back.dims, c) * CHUNK_SIZE, chunkCz(back.dims, c) * CHUNK_SIZE, pieceShapes(reg), hf, baked);
    const piece = pieces.find((p) => c % 70 >= p.sq.cx0 && c % 70 < p.sq.cx1)!;
    expect(topsOf(piece, c, read)).toBe(baked.far.filled > 0);
    expect([read.top, read.tint, read.filled]).toEqual([baked.far.top, baked.far.tint, baked.far.filled]);
    expect([...read.top]).toEqual([...cityTops(city, c, hf, null)]);
    if (topsOf(back.tops!, c, read)) filled++;
    expect([read.top, read.tint]).toEqual([baked.far.top, baked.far.tint]);
  }
  expect(filled).toBe(structs.held.length);
  // A map whose maker baked none has no tops parts.
  expect(readHead(writeMap(map)).parts.some((p) => p.kind === "tops")).toBe(false);
});

test("a part that is damaged, or another's, is refused with its name, and so is a head", () => {
  const file = writeMap(wideMap());
  const head = readHead(file);
  const [a, b] = [head.parts[3]!, head.parts[4]!];
  const flipped = file.slice();
  flipped[a.at + 100]! ^= 1;
  const said = `map: its part ${a.name} is damaged or another's: its bytes are not those its head names`;
  expect(a.name).toMatch(/^ground\.128-128\.[0-9a-f]{16}\.part$/);
  expect(() => readPart(head, a, flipped.subarray(a.at, a.at + a.length))).toThrow(said);
  expect(() => parseMap(flipped)).toThrow(said);
  // Another part's bytes, as a stale file under the name would be.
  expect(() => readPart(head, a, file.subarray(b.at, b.at + b.length))).toThrow(`map: its part ${a.name} is damaged or another's`);
  // A head damaged, and the parts of a file cut short or run on.
  const changed = file.slice();
  changed[60]! ^= 1;
  expect(() => readHead(changed)).toThrow("map: its head is damaged: its hash is not that of its bytes");
  expect(() => parseMap(file.subarray(0, file.length - 1))).toThrow("map: it is cut short");
  expect(() => parseMap(Uint8Array.from([...file, 0]))).toThrow("map: it runs on past its last part");
  // Taken on trust, a damaged part is read as it is.
  expect(readPart(head, a, flipped.subarray(a.at, a.at + a.length), false).kind).toBe("ground");
});

test("a map widened on one side keeps every part of the squares it did not reach, by name and bytes", () => {
  const map = wideMap();
  const statics = MapStatics.of(map.dims, map.statics);
  // A column of chunks more on the east, where x is 0: the lattice corner moves a chunk east and every place a chunk west.
  const [nx, nz] = [70 * 32 + 1, 20 * 32 + 1];
  const heights = new Uint16Array((nx + 32) * nz);
  for (let j = 0; j < nz; j++) heights.set(map.heights.subarray(j * nx, j * nx + nx), j * (nx + 32) + 32);
  const plain = { ...map, nodes: [], water: undefined };
  const wider: MapData = { ...plain, dims: { ...map.dims, chunksX: 71, frameX: 2039 }, heights, tint: new Uint8Array(heights.length), statics: [...statics].map((s) => ({ ...s, x: s.x + CHUNK_SIZE })), spawns: [{ name: "West", x: 4064, z: 600, yaw: 0 }] };
  const tinted = { ...plain, tint: new Uint8Array(map.tint.length) };
  const [before, after] = [readHead(writeMap(tinted)), readHead(writeMap(wider))];
  const names = (h: typeof before): string[] => h.parts.map((p) => p.name);
  // The ground of column 127 of sectors and of column 31 of overviews takes the new chunks. Every other part keeps its name,
  // the statics of column 127 among them, which stand where they stood on the lattice.
  const touched = (n: string): boolean => /^(ground\.127|overview\.31)-/.test(n);
  expect(names(before).filter((n) => !touched(n)).filter((n) => names(after).includes(n)).length).toBe(19);
  expect(names(before).filter(touched).filter((n) => names(after).includes(n))).toEqual([]);
});

test("slots a build takes out stand empty whatever the ground, and the rest stand as the rule resolves them", () => {
  const zoned = busyMap().nodes[2] as NodeZoned;
  const { out: resolved, other, ...rule } = zoned;
  // Bits past the last chunk's slots are not kept.
  const taken = new Uint8Array(Math.ceil((6 * zoned.perChunk) / 8)).fill(0x55).fill(0x05, 22);
  const map = parseMap(writeMap(resolveNodes({ ...busyMap(), nodes: [{ ...rule, out: taken }] }, reg)));
  const back = map.nodes[0] as NodeZoned;
  expect([[...back.out!].map((b, k) => b & taken[k]!), back.other]).toEqual([[...taken.subarray(0, 22), 0x05], other]);
  expect([...back.out!].map((b, k) => b & ~taken[k]! & 0xff)).toEqual([...resolved!].map((b, k) => b & ~taken[k]! & 0xff));
  const hf = mapHeightfield(map);
  const kept = mapNodes(map, hf, reg)!;
  const all = mapNodes({ ...map, nodes: [zoned] }, hf, reg)!;
  const [a, b] = [spot(), spot()];
  let stood = 0;
  for (let chunk = 0; chunk < 6; chunk++) {
    for (let i = 0; i < zoned.perChunk; i++) {
      kept.at(chunk, i, a);
      all.at(chunk, i, b);
      if (i % 2 === 0) expect(a.kind).toBe(0);
      else expect(a.kind === 0 ? [b.kind] : a).toEqual(a.kind === 0 ? [0] : b);
      if (a.kind !== 0) stood++;
    }
  }
  expect(stood).toBeGreaterThan(10);
  expect(() => writeMap({ ...busyMap(), nodes: [{ ...zoned, out: taken.subarray(1) }] })).toThrow("map: the slots taken out of scattered nodes are not a bit per slot of every chunk");
  // A file says where every node stands: a layer not resolved is refused.
  expect(() => writeMap({ ...busyMap(), nodes: [{ ...rule, out: taken }] })).toThrow("map: its scattered nodes are not resolved");
});

/**
 * The rule of where a scattered node stands as it was before a map's file said so, read from the whole ground at every ask:
 * shared/world/nodes.ts scatterNodes of map version 7, kept here to hold every slot of a resolved map to it.
 */
function ruleBefore(dims: MapDims, hf: Heightfield, seed: number, perChunk: number, forms: NodeForms, kindsAt: (x: number, z: number) => readonly number[] | null): NodeSource {
  const count = forms.footReach.length;
  const [ring, slant, fall] = [new Int32Array(count), new Int32Array(count), new Int32Array(count)];
  for (let k = 0; k < count; k++) {
    if (!(forms.footReach[k]! > 0)) continue;
    ring[k] = Math.ceil(forms.footReach[k]! / hf.cell);
    slant[k] = Math.floor((ring[k]! * 181 + 128) / 256);
    fall[k] = Math.floor(forms.footFall[k]! / hf.stepY);
  }
  const per = (hf.cell * 65536) / CHUNK_SIZE;
  const height = (i: number, j: number): number => hf.heights[Math.min(hf.nz - 1, Math.max(0, j)) * hf.nx + Math.min(hf.nx - 1, Math.max(0, i))]!;
  const fits = (kind: number, ux: number, uz: number): boolean => {
    const [i, j] = [Math.floor((ux + per / 2) / per), Math.floor((uz + per / 2) / per)];
    const low = height(i, j) - fall[kind]!;
    const [r, d] = [ring[kind]!, slant[kind]!];
    return [[r, 0], [-r, 0], [0, r], [0, -r], [d, d], [d, -d], [-d, d], [-d, -d]].every(([a, b]) => height(i + a!, j + b!) >= low);
  };
  return {
    perChunk,
    at(chunk, index, out) {
      out.kind = 0;
      const key = frameKey(dims, chunk);
      const h = mix(seed, key, index);
      const g = mix(h, index, key);
      const x = (chunkCx(dims, chunk) + (h & 0xffff) / 65536) * CHUNK_SIZE;
      const z = (chunkCz(dims, chunk) + (h >>> 16) / 65536) * CHUNK_SIZE;
      const grows = kindsAt(x, z);
      if (grows === null || grows.length === 0) return;
      const y = hf.heightAt(x, z);
      let kind = grows[g % grows.length]!;
      const sea = forms.sea[kind]!;
      if ((sea === SEA_DRY ? y < hf.waterAt(x, z) + 0.3 : sea === SEA_UNDER && (y >= hf.seaLevel || !seaHere(hf.water, x, z))) || hf.slopeCosAt(x, z) < 0.85) return;
      if (kind !== 0 && ring[kind]! > 0 && !fits(kind, chunkCx(dims, chunk) * 65536 + (h & 0xffff), chunkCz(dims, chunk) * 65536 + (h >>> 16))) kind = forms.footElse[kind]!;
      if (kind === 0) return;
      [out.kind, out.form, out.x, out.y, out.z, out.yaw] = [kind, formOf(forms, kind, mix(g, key, seed)), x, y, z, (g >>> 8) & 0xffff];
    },
  };
}

/**
 * Hills of 24 by 20 chunks off the lattice's grid of sectors, so they lie on four: the sea in the south, terraces whose steps
 * are cliffs, and a pond on a rise. A zoned layer of trees, banyans, rocks and the sea floor's kinds, and a scattered one of
 * rubble and metal rocks with slots a build took out; neither yet resolved.
 */
function hillsMap(): MapData {
  const rng = new Rng(47);
  const dims = { chunksX: 24, chunksZ: 20, frameX: 2040, frameZ: 2044 };
  const [nx, nz] = [24 * 32 + 1, 20 * 32 + 1];
  const pond = { x: 1100, z: 900, r: 70, surface: 14 };
  const ground = (x: number, z: number): number => {
    let h = 6 + 4 * Math.sin(x / 37) * Math.cos(z / 29) + ((x + z / 2) % 200 < 100 ? 6 : 0) + Math.min(0, (z - 220) / 12);
    const d = Math.hypot(x - pond.x, z - pond.z);
    if (d < pond.r + 30) h = Math.max(h, 16);
    if (d < pond.r) h = pond.surface - 2 + d / pond.r;
    return h;
  };
  const heights = Uint16Array.from({ length: nx * nz }, (_, k) => Math.round((ground((k % nx) * 2, Math.floor(k / nx) * 2) + 32) * 256));
  const grid = Uint16Array.from({ length: 192 * 160 }, (_, k) => (Math.hypot((k % 192) * 8 + 4 - pond.x, Math.floor(k / 192) * 8 + 4 - pond.z) < pond.r + 8 ? 1 : 0));
  const water = MapWater.fromGrid(dims, -32, 1 / 256, 8, [{ name: "Rise Pond", level: (pond.surface + 32) * 256 }], grid);
  const zone = Uint8Array.from({ length: 96 * 80 }, (_, k) => (k % 97 === 0 ? 0 : Math.floor(k / 96) * 16 < 260 ? 2 : 1));
  const zoned: NodeZoned = { seed: 91, perChunk: 48, zones: [{ bare: 2, kinds: [["core:banyan", 3], ["core:rock", 2], ["core:palm", 2], ["core:fig", 1]] }, { bare: 3, kinds: [["core:clam", 2], ["core:oil_rock", 1], ["core:crystal_rock", 1], ["core:mangrove", 2]] }], zoneCell: 16, zone };
  const allow = Uint8Array.from({ length: (192 * 160) / 8 }, (_, k) => (k % 24 < 20 ? 0xff : 0));
  const scatter: NodeScatter = { seed: 92, perChunk: 32, kinds: [["core:tree", 3], ["core:rubble", 2], ["core:metal_rock", 1]], allowCell: 8, allow, out: Uint8Array.from({ length: (480 * 32) / 8 }, () => (rng.int(8) === 0 ? 1 << rng.int(8) : 0)) };
  return { id: "test:hills", dims, minY: -32, stepY: 1 / 256, seaLevel: 0, heights, tint: new Uint8Array(nx * nz).fill(7), statics: [], nodes: [zoned, scatter], spawns: [{ name: "Rise", x: 1100, z: 900, yaw: 0 }], water };
}

test("whether each node stands, and as what, is decided as a map is made, and its file then says it: every slot as the rule had it", () => {
  const made = hillsMap();
  const taken: SlotsTaken = { water: 0, slope: 0, footing: 0, other: 0 };
  const map = parseMap(writeMap(resolveNodes(made, reg, taken)));
  // Each rule takes slots here: under the water, on the terraces' cliffs, where a rock's footing falls away, and where a
  // banyan's does and a fig grows in its place.
  expect(Object.values(taken).every((n) => n > 20)).toBe(true);
  const hf = mapHeightfield(map);
  const forms = nodeForms(reg);
  const file = mapNodes(map, hf, reg)!;
  const [zoned, scatter] = made.nodes as [NodeZoned, NodeScatter];
  const weighed = (kinds: readonly (readonly [string, number])[], bare = 0): number[] => [...kinds.flatMap(([id, w]) => Array(w).fill(reg.index.get(id)!)), ...Array(bare).fill(0)];
  const zones = [null, ...zoned.zones.map((z) => weighed(z.kinds, z.bare))];
  const before = [
    ruleBefore(map.dims, hf, zoned.seed, zoned.perChunk, forms, (x, z) => zones[zoned.zone[Math.floor(z / 16) * 96 + Math.floor(x / 16)]!]!),
    ruleBefore(map.dims, hf, scatter.seed, scatter.perChunk, forms, (x, z) => {
      const bit = Math.floor(z / 8) * 192 + Math.floor(x / 8);
      return (scatter.allow![bit >> 3]! >> (bit & 7)) & 1 ? weighed(scatter.kinds) : null;
    }),
  ];
  const [a, b] = [spot(), spot()];
  const stood = new Map<number, number>();
  for (let c = 0; c < chunkCount(map.dims); c++) {
    for (let i = 0; i < file.perChunk; i++) {
      file.at(c, i, a);
      const [layer, slot] = i < 48 ? [0, i] : [1, i - 48];
      before[layer]!.at(c, slot, b);
      const bit = c * 32 + slot;
      if (layer === 1 && (scatter.out![bit >> 3]! >> (bit & 7)) & 1) expect(a.kind).toBe(0);
      // A heap of rubble keeps apart from its neighbours (nodes.test.ts), so it may be another variant, at its own size.
      else if (a.kind !== 0 && forms.apart[a.kind]! > 0) expect([a.kind, a.x, a.y, a.z, a.yaw, forms.size[a.form]]).toEqual([b.kind, b.x, b.y, b.z, b.yaw, forms.size[b.form]]);
      else expect(a.kind === 0 ? [0] : a).toEqual(b.kind === 0 ? [0] : b);
      if (a.kind !== 0) stood.set(a.kind, (stood.get(a.kind) ?? 0) + 1);
    }
  }
  for (const id of ["core:banyan", "core:fig", "core:rock", "core:clam", "core:crystal_rock", "core:mangrove", "core:tree", "core:rubble", "core:metal_rock"]) expect(stood.get(reg.index.get(id)!) ?? 0).toBeGreaterThan(10);
  // Read again, a resolved map is kept as it is: the rule is not asked again.
  expect(resolveNodes(map, reg)).toBe(map);
});

test("with only one sector's ground held and every other height poisoned, every node elsewhere is where and what it is", () => {
  const map = parseMap(writeMap(resolveNodes(hillsMap(), reg)));
  const hf = mapHeightfield(map);
  // The sector of chunks 8 to 23 along x and 4 to 19 along z is held; every other sample is noise.
  const rng = new Rng(5);
  const poisoned = new Heightfield(map.dims, TERRAIN_CELL, map.minY, map.stepY);
  poisoned.seaLevel = map.seaLevel;
  poisoned.water = map.water ?? null;
  for (let j = 0; j < poisoned.nz; j++) for (let i = 0; i < poisoned.nx; i++) poisoned.setSample(i, j, i >= 8 * 32 && j >= 4 * 32 ? hf.sample(i, j) : map.minY + rng.int(65536) * map.stepY);
  const [whole, held] = [mapNodes(map, hf, reg)!, mapNodes(map, poisoned, reg)!];
  const [a, b] = [spot(), spot()];
  let elsewhere = 0;
  for (let c = 0; c < chunkCount(map.dims); c++) {
    const inHeld = chunkCx(map.dims, c) >= 8 && chunkCz(map.dims, c) >= 4;
    for (let i = 0; i < whole.perChunk; i++) {
      whole.at(c, i, a);
      held.at(c, i, b);
      // Its place, kind, form and turn; and in the held sector its height too, which alone reads the ground.
      expect(b.kind === 0 ? [0] : [b.kind, b.form, b.x, b.z, b.yaw, inHeld ? b.y : 0]).toEqual(a.kind === 0 ? [0] : [a.kind, a.form, a.x, a.z, a.yaw, inHeld ? a.y : 0]);
      if (!inHeld && a.kind !== 0) elsewhere++;
    }
  }
  expect(elsewhere).toBeGreaterThan(2000);
});

test("a file that is damaged, foreign or unplayable is refused, and the reason says which", () => {
  const file = writeMap(flatMap(1));
  const headBytes = readHead(file).bytes;
  /** The file with one thing of its head changed and its hash made right again, as a faulty writer would leave it. */
  const rehashed = (change: (view: DataView) => void): Uint8Array => {
    const copy = file.slice();
    const view = new DataView(copy.buffer);
    change(view);
    view.setUint32(8, hashBytes(copy.subarray(12, headBytes)), true);
    return copy;
  };
  const flipped = file.slice();
  flipped[file.length - 100]! ^= 4;
  expect(() => parseMap(flipped)).toThrow(/^map: its part ground\.128-128\.[0-9a-f]{16}\.part is damaged/);
  expect(() => parseMap(file.subarray(0, file.length - 9))).toThrow("map: it is cut short");
  // Taken on trust, the bytes are read as they are, and the same bytes are the same map.
  expect(parseMap(file, false)).toEqual(parseMap(file));
  expect(() => parseMap(file.subarray(0, file.length - 9), false)).toThrow("map: it is cut short");
  expect(() => parseMap(new Uint8Array(100))).toThrow("map: this is not a map file");
  expect(() => parseMap(file.subarray(0, 20))).toThrow("map: it is cut short");
  expect(() => parseMap(rehashed((view) => view.setUint16(4, 3, true)))).toThrow("map: version 3 is not one this build reads: build the map again");
  expect(() => parseMap(rehashed((view) => view.setFloat32(28, 4, true)))).toThrow("map: its samples are 4 m apart");
  // Twice as wide, the head's coarse picture is read as twice the samples it holds (it was the overview's ground that ran
  // past its end until the head held the whole map coarse).
  expect(() => parseMap(rehashed((view) => view.setUint16(16, 2, true)))).toThrow("map: a section runs past its end");
  // Off the lattice's grid by a sector, its parts lie off the map.
  expect(() => parseMap(rehashed((view) => view.setUint16(20, 2064, true)))).toThrow(/^map: its part ground\.128-128\.[0-9a-f]{16}\.part lies off the map$/);
  // The first section's length, made to reach past the end of the file.
  const lengthAt = 56 + 1 + "test:flat".length + 4;
  expect(() => parseMap(rehashed((view) => view.setUint32(lengthAt, file.length, true)))).toThrow("map: a section runs past its end");

  const refused = (more: Partial<MapData>): (() => void) => () => void writeMap({ ...busyMap(), ...more });
  expect(refused({ spawns: [] })).toThrow("map: it has 0 spawn points");
  expect(refused({ spawns: [{ name: "Out", x: 129, z: 5, yaw: 0 }] })).toThrow('map: spawn point "Out" is off the map');
  expect(refused({ id: "two words" })).toThrow("map: its id must be");
  expect(refused({ stepY: 0 })).toThrow("map: its height range or its sea level is not a number");
  expect(refused({ dims: { chunksX: 2, chunksZ: 257 } })).toThrow("map: it is 2 by 257 chunks");
  // A map lies whole on the lattice, and its display origin is a sector's corner at or beyond its north-west corner.
  expect(refused({ dims: { chunksX: 2, chunksZ: 3, frameX: 4095 } })).toThrow("map: its south-east corner is at column 4095, row 2048, and it must lie whole on the lattice of 4096 chunks a side");
  expect(refused({ dims: { chunksX: 2, chunksZ: 3, frameZ: 4094, originZ: 4096 } })).toThrow("map: its south-east corner is at column 2048, row 4094");
  expect(refused({ dims: { chunksX: 2, chunksZ: 3, originX: 2048 } })).toThrow("map: its display origin is at column 2048, row 2064, and it must be a sector's corner at or west of column 2050 and at or north of row 2051");
  expect(refused({ dims: { chunksX: 2, chunksZ: 3, originX: 2070 } })).toThrow("map: its display origin is at column 2070");
  expect(refused({ dims: { chunksX: 2, chunksZ: 3, frameZ: 2061, originZ: 2048 } })).toThrow("map: its display origin is at column 2064, row 2048");
  expect(() => parseMap(rehashed((view) => view.setUint16(26, 2047, true)))).toThrow("map: its display origin is at column 2064, row 2047");
  expect(refused({ statics: [{ kind: "core:wall", x: 5, y: 5000, z: 5, yaw: 0 }] })).toThrow("map: a core:wall at 5, 5000, 5 is off the map");
  const scatter = busyMap().nodes[0] as NodeScatter;
  expect(refused({ nodes: [{ ...scatter, perChunk: 250 }, { ...scatter, perChunk: 7 }] })).toThrow("map: its nodes take 257 slots in a chunk");
  expect(refused({ nodes: [{ ...scatter, allowCell: 3 }] })).toThrow("map: where scattered nodes may stand");
  expect(refused({ nodes: [{ ...scatter, allow: scatter.allow!.subarray(1) }] })).toThrow("map: where scattered nodes may stand");
  expect(refused({ regions: [{ kind: "spawn", spawns: "core:spawns_beach", count: 70000, at: [10, 10], radius: 5 }] })).toThrow("map: a spawn region at 10, 10 names no spawns, or holds other than 0 to 65,535");
  expect(refused({ regions: [{ kind: "spawn", spawns: "core:spawns_beach", count: 5, at: [130, 10], radius: 5 }] })).toThrow("map: the spawn region of core:spawns_beach at 130, 10 is off the map or has no size");
  expect(refused({ vehicles: [{ kind: "core:compact", x: 20, z: 193, yaw: 0 }] })).toThrow("map: a core:compact parked at 20, 193 is off the map");
});

test("a map's nodes are its layers one after another: scattered where the map allows, and listed where the list says", () => {
  const map = parseMap(writeMap(busyMap()));
  const hf = mapHeightfield(map);
  const nodes = mapNodes(map, hf, reg)!;
  expect(nodes.perChunk).toBe(72);
  const tree = reg.index.get("core:tree")!;
  const rock = reg.index.get("core:rock")!;
  const bush = reg.index.get("core:bush")!;
  const kinds = [tree, tree, tree, tree, rock];
  const plain = scatterNodes(map.dims, hf, 77, 40, nodeForms(reg), (x) => (x >= 64 ? kinds : null));
  const a = spot();
  const b = spot();
  let scattered = 0;
  for (let chunk = 0; chunk < 6; chunk++) {
    for (let i = 0; i < 40; i++) {
      nodes.at(chunk, i, a);
      plain.at(chunk, i, b);
      // An empty slot leaves the rest of the spot as it was.
      expect(a.kind === 0 ? [b.kind] : a).toEqual(a.kind === 0 ? [0] : b);
      if (a.kind !== 0) scattered++;
    }
  }
  expect(scattered).toBeGreaterThan(20);
  const listed = (chunk: number, slot: number): number[] => {
    nodes.at(chunk, 40 + slot, a);
    return a.kind === 0 ? [0] : [a.kind, a.x, a.y, a.z, a.yaw];
  };
  const standing = (kind: number, x: number, z: number, yaw: number): number[] => [kind, x, hf.heightAt(x, z), z, yaw];
  expect(listed(0, 0)).toEqual(standing(bush, 1, 2, 0));
  expect(listed(0, 1)).toEqual(standing(rock, 40000 / 1024, 3 / 1024, 16384));
  expect(listed(2, 0)).toEqual(standing(bush, 7 / 1024, CHUNK_SIZE + 65535 / 1024, 65535));
  expect([listed(1, 0), listed(2, 1), listed(5, 0)]).toEqual([[0], [0], [0]]);
  nodes.at(3, 41, a);
  expect(a.kind).toBe(0);

  // The zoned layer: each node is of a kind its square's zone grows, bare ground takes its share, and a square of no zone grows
  // nothing. It is the scatter with the zone's kinds at each place.
  const zoned = map.nodes[2] as NodeZoned;
  const [palm, fig, fern] = ["core:palm", "core:fig", "core:fern"].map((id) => reg.index.get(id)!);
  const zones = [null, [palm!, 0, 0], [fig!, fern!, fern!]];
  const same = scatterNodes(map.dims, hf, 78, 30, nodeForms(reg), (x, z) => zones[zoned.zone[Math.floor(z / 16) * 8 + Math.floor(x / 16)]!]!);
  const grown = new Map<number, number>();
  let tried = 0;
  for (let chunk = 0; chunk < 6; chunk++) {
    for (let i = 0; i < 30; i++) {
      nodes.at(chunk, 42 + i, a);
      same.at(chunk, i, b);
      expect(a.kind === 0 ? [b.kind] : a).toEqual(a.kind === 0 ? [0] : b);
      if (a.kind === 0) continue;
      const square = zoned.zone[Math.floor(a.z / 16) * 8 + Math.floor(a.x / 16)]!;
      expect(square === 1 ? [palm] : [fig, fern]).toContain(a.kind);
      grown.set(a.kind, (grown.get(a.kind) ?? 0) + 1);
      tried++;
    }
  }
  expect(tried).toBeGreaterThan(40);
  expect([grown.get(palm!)! > 5, grown.get(fig!)! > 5, grown.get(fern!)! > grown.get(fig!)!]).toEqual([true, true, true]);
});

test("zoned nodes are refused where a square names a zone the layer lacks, or the squares do not cover the map", () => {
  const zoned = busyMap().nodes[2] as NodeZoned;
  const refused = (layer: Partial<NodeZoned>): (() => void) => () => void writeMap({ ...busyMap(), nodes: [{ ...zoned, ...layer }] });
  expect(refused({ zone: zoned.zone.map((z) => (z === 2 ? 3 : z)) })).toThrow("map: a square is in a zone the list of zones does not have");
  expect(refused({ zoneCell: 32 })).toThrow("map: the zones of zoned nodes are not a byte per square");
  expect(refused({ zones: [] })).toThrow("map: zoned nodes need");
  expect(refused({ zones: [{ bare: 0, kinds: [] }, zoned.zones[1]!] })).toThrow("map: zoned nodes need");
});

test("zoned layers of the same squares share one picture in the file and in memory, and grow as they did apart", () => {
  const zoned = busyMap().nodes[2] as NodeZoned;
  const other: NodeZoned = { ...zoned, seed: 5, zone: zoned.zone.map((z, i) => (i % 3 === 0 ? 0 : (z % 2) + 1)) };
  const apart = { ...busyMap(), nodes: [zoned, other] };
  const file = writeMap(apart);
  const [a, b] = parseMap(file).nodes as NodeZoned[];
  expect([a!.zone === b!.zone, a!.codes!.length, b!.codes!.length]).toEqual([true, 6, 6]);
  expect(writeMap(parseMap(file))).toEqual(file);
  const [shared, alone] = [mapNodes(parseMap(file), mapHeightfield(parseMap(file)), reg)!, mapNodes(apart, mapHeightfield(apart), reg)!];
  const [s, t] = [spot(), spot()];
  for (let chunk = 0; chunk < 6; chunk++) {
    for (let i = 0; i < shared.perChunk; i++) {
      shared.at(chunk, i, s);
      alone.at(chunk, i, t);
      expect(s.kind === 0 ? [0] : s).toEqual(t.kind === 0 ? [0] : t);
    }
  }
});

/**
 * Ground of 4 by 4 chunks: a shallow sea in the west (x under 80 m) at -0.5 m, a lake of 128 m a side at 4 m under a
 * surface of 5 m, land at 8 m, and in the south (z from 224 m) land at 0.5 m with a channel to the floor; tinted 7, 9 and 3.
 */
function coarseMap(): MapData {
  const n = 4 * 32 + 1;
  const unit = (m: number): number => (m + 32) * 256;
  const lake = (x: number, z: number): boolean => x >= 128 && x < 256 && z >= 64 && z < 192;
  const ground = (x: number, z: number): number => (x < 80 ? unit(-0.5) : lake(x, z) ? unit(4) : z < 224 ? unit(8) : x === 200 || x === 202 ? 0 : unit(0.5));
  const heights = Uint16Array.from({ length: n * n }, (_, k) => ground((k % n) * 2, Math.floor(k / n) * 2));
  const tint = Uint8Array.from({ length: n * n }, (_, k) => ((k % n) * 2 < 80 ? 7 : lake((k % n) * 2, Math.floor(k / n) * 2) ? 9 : 3));
  const grid = Uint16Array.from({ length: 32 * 32 }, (_, k) => (lake((k % 32) * 8, Math.floor(k / 32) * 8) ? 1 : 0));
  const water = MapWater.fromGrid({ chunksX: 4, chunksZ: 4 }, -32, 1 / 256, 8, [{ name: "Square Lake", level: unit(5) }], grid);
  return flatMap(4, { seaLevel: 0, heights, tint, water });
}

/** The tags and byte lengths of a head's sections, in its order. */
function sections(file: Uint8Array): [string, number][] {
  const view = new DataView(file.buffer, file.byteOffset);
  const out: [string, number][] = [];
  for (let at = 56 + 1 + file[56]!; at < view.getUint32(12, true); at += 8 + view.getUint32(at + 4, true)) out.push([String.fromCharCode(...file.subarray(at, at + 4)), view.getUint32(at + 4, true)]);
  return out;
}

test("the head holds the whole map at every chunk's corner: a square's mean, held under the sea or a lake where most of it is under, at or over the sea where most is dry, its commonest tint, its lake, and the chunks the overviews hold water for", () => {
  const file = writeMap(coarseMap());
  const { coarse, bodies } = { coarse: readHead(file).coarse, bodies: readHead(file).water!.bodies };
  const at = (i: number, j: number): [number, number, number] => [coarse.heights[j * 5 + i]!, coarse.tint[j * 5 + i]!, coarse.bodies![j * 5 + i]!];
  // All sea; most sea, the land in it lifting the mean over the sea, held a unit under; all lake; most lake, held a unit
  // under its surface; most dry with the channel taking the mean under the sea, held at it; dry.
  expect([at(0, 2), at(1, 2), at(3, 2), at(2, 2), at(3, 4), at(4, 4)]).toEqual([[8064, 7, 0], [8191, 7, 0], [9216, 9, 1], [9471, 9, 1], [8192, 3, 0], [8320, 3, 0]]);
  expect([coarse.heights.length, [...coarse.bodies!].flatMap((b, k) => (b > 0 ? [k] : [])), [...coarse.water], bodies.length]).toEqual([25, [8, 12, 13, 14], [6, 7, 10, 11], 1]);
  // Its bytes: 25 heights as a grid, their tints, their bodies as a grid and a bit for each of the 16 chunks.
  expect(sections(file).find(([tag]) => tag === "COAR")).toEqual(["COAR", 25 * 2 + 25 + 25 * 2 + 2]);
  // With no water, the heights and tints alone; a head without the picture, or naming a body it does not list, is refused.
  const dry = writeMap(flatMap(4));
  expect([sections(dry).find(([tag]) => tag === "COAR"), readHead(dry).coarse.bodies, [...readHead(dry).coarse.heights]]).toEqual([["COAR", 25 * 3], null, Array(25).fill(32 * 256)]);
  const rehashed = (change: (copy: Uint8Array) => void): Uint8Array => {
    const copy = file.slice();
    change(copy);
    new DataView(copy.buffer).setUint32(8, hashBytes(copy.subarray(12, readHead(file).bytes)), true);
    return copy;
  };
  const coar = (copy: Uint8Array): number => copy.findIndex((_, k) => String.fromCharCode(...copy.subarray(k, k + 4)) === "COAR");
  expect(() => readHead(rehashed((c) => c.set([..."CXAR"].map((ch) => ch.charCodeAt(0)), coar(c))))).toThrow("map: its head has no coarse picture (COAR): build the map again");
  // The low byte of the first sample's body in its zigzagged grid made 4: it names body 2.
  expect(() => readHead(rehashed((c) => (c[coar(c) + 8 + 75] = 4)))).toThrow("map: its coarse picture names a body of water its head does not list");
});

test("a map's static pieces are set down in the file's order, and a piece the content lacks stops the load", () => {
  const map = parseMap(writeMap(busyMap()));
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  expect(structs.count).toBe(3);
  const t = structs.chunks[2]!;
  expect([t.kind[0], t.x[0], t.y[0], t.z[0], t.yaw[0], t.owner[0], t.hp[0]]).toEqual([reg.index.get("core:wall")!, 12.5, 40.25, 100, 16384, 0, reg.maxHp[reg.index.get("core:wall")!]!]);
  expect(() => placeStatics({ ...map, statics: [{ kind: "core:nothing", x: 1, y: 1, z: 1, yaw: 0 }] }, structs, reg)).toThrow('map "test:busy" needs content "core:nothing"');
});

test("set down, a map's statics take just the slots they fill and no log of changes, lend their places to the tables, and each chunk stands as placed until anything in it changes", () => {
  // 300 pieces over four chunks, listed out of the chunks' order.
  const pieces = Array.from({ length: 300 }, (_, i) => ({ kind: i % 3 === 0 ? "core:wall" : "core:crate", x: 10 + ((i * 37) % 100), y: 1 + (i % 7), z: 20 + ((i * 53) % 90), yaw: (i * 4099) & 0xffff }));
  const file = writeMap(flatMap(4, { statics: pieces }));
  const map = parseMap(file);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const tables = structs.held.map((c) => structs.chunks[c]!);
  expect([structs.held, tables.map((t) => t.high)]).toEqual([[0, 1, 4, 5], [83, 64, 79, 74]]);
  expect([tables.reduce((n, t) => n + t.cap, 0), structs.count, tables.filter((t) => t.recentSlot !== null).length]).toEqual([300, 300, 0]);
  // A slot's place and turn are the map's own column until one of the chunk's is written.
  const [a, b, c, d] = tables;
  expect([a!.x.buffer === map.statics.x.buffer, d!.yaw.buffer === map.statics.yaw.buffer]).toEqual([true, true]);
  expect(structs.held.every((k) => structs.asPlaced(k)) && structs.asPlaced(2)).toBe(true);

  // A blow, a change of owner that takes in no piece of the map's, a removal, and a piece built where the map set none.
  const wall = reg.index.get("core:wall")!;
  expect(structs.damage(4 * 65536, 1)).toBeGreaterThan(0);
  expect(structs.reown(5, 6)).toBe(0);
  structs.remove(65536 + 3);
  expect(structs.add(wall, 150, 2, 20, 0, 9, 100)).toBe(2 * 65536);
  expect([0, 1, 2, 4, 5].map((k) => structs.asPlaced(k))).toEqual([true, false, false, false, true]);
  // A piece built there takes a slot past the map's. The map's columns stay the map's, and the table's are its own from the first write.
  expect(structs.add(wall, 70, 3, 30, 100, 9, 100)).toBe(65536 + 64);
  expect([b!.x.buffer === map.statics.x.buffer, b!.x[64], b!.yaw[64], c!.x.buffer === map.statics.x.buffer]).toEqual([false, 70, 100, true]);
  const again = parseMap(file).statics;
  expect([map.statics.x, map.statics.y, map.statics.z, map.statics.yaw]).toEqual([again.x, again.y, again.z, again.yaw]);
  // Kept by the server, the statics need not keep the map's order.
  expect([map.statics.unordered().row.length, map.statics.unordered().x === map.statics.x, map.statics.row.length]).toEqual([0, true, 300]);
});

test("a map slot emptied is never given to a player's piece", () => {
  const pieces = Array.from({ length: 40 }, (_, i) => ({ kind: "core:crate", x: 70 + (i % 8) * 6, y: 1 + Math.floor(i / 8) * 3, z: 10, yaw: 0 }));
  const map = parseMap(writeMap(flatMap(4, { statics: pieces })));
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const t = structs.chunks[1]!;
  const wall = reg.index.get("core:wall")!;
  const build = (): number => structs.add(wall, 100, 20, 40, 0, 9, 100) - 65536;
  expect([t.mapped, t.high]).toEqual([40, 40]);
  // One taken, one destroyed, three fallen together.
  structs.remove(65536 + 3);
  structs.damage(65536 + 9, 1e9);
  expect(structs.removeMany(Uint32Array.of(65536 + 20, 65536 + 21, 65536 + 39), 3, GONE_FELL, 0, 0, 0, 0)).toBe(3);
  expect([build(), build(), build()]).toEqual([40, 41, 42]);
  // A player's own slot is given again, before and after the free list is made again as a load makes it.
  structs.remove(65536 + 41);
  expect(build()).toBe(41);
  structs.remove(65536 + 40);
  structs.setVersion(1, t.version);
  expect([build(), build()]).toEqual([40, 43]);
  expect([3, 9, 20, 21, 39].map((s) => t.kind[s])).toEqual([0, 0, 0, 0, 0]);
  expect([t.mapped, t.live]).toEqual([40, 39]);
});

test("one map slot swapped or removed copies no columns", () => {
  const pieces = Array.from({ length: 60 }, (_, i) => ({ kind: i % 3 === 0 ? "core:wall" : "core:crate", x: 4 + (i % 10) * 5.5, y: 1 + Math.floor(i / 10) * 3, z: 12 + (i % 4) * 9, yaw: (i * 8191) & 0xffff }));
  const file = writeMap(flatMap(4, { statics: pieces }));
  const map = parseMap(file);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  // The same pieces built one by one, whose table owns its columns, and the same changes made to both.
  const twin = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  for (let i = 0; i < 60; i++) twin.add(reg.index.get(map.statics.kinds[map.statics.kind[i]!]!)!, map.statics.x[i]!, map.statics.y[i]!, map.statics.z[i]!, map.statics.yaw[i]!, 0, 1);
  const [wall, crate] = [reg.index.get("core:wall")!, reg.index.get("core:crate")!];
  const t = structs.chunks[0]!;
  const lent = (): boolean[] => [t.x.buffer === map.statics.x.buffer, t.y.buffer === map.statics.y.buffer, t.z.buffer === map.statics.z.buffer, t.yaw.buffer === map.statics.yaw.buffer];
  const found = (s: StructureStore): number[][] => {
    const out = new Found();
    return [[0, 0, 63, 63], [10, 10, 30, 30], [20, 0, 21, 63]].map(([x0, z0, x1, z1]) => [...out.refs.subarray(0, s.query(x0!, z0!, x1!, z1!, out))]);
  };
  for (const s of [structs, twin]) {
    expect(s.swap(7, wall)).toBe(true);
    expect(s.remove(12)).toBe(true);
    expect(s.damage(13, 1e9)).toBe(0);
    expect(s.removeMany(Uint32Array.of(30, 31, 45), 3, GONE_FELL, 0, 0, 0, 0)).toBe(3);
    expect(s.swap(7, crate)).toBe(true);
    expect(s.swap(8, wall)).toBe(true);
  }
  expect(lent()).toEqual([true, true, true, true]);
  // Bodies and rays meet the same pieces, listed in the same order.
  expect(found(structs)).toEqual(found(twin));
  expect([t.kind[12], t.x[12], t.yaw[12], t.owner[12], t.hp[12], t.live, structs.count]).toEqual([0, map.statics.x[12], map.statics.yaw[12], 0, 0, 55, 55]);
  // A loaded row that empties a map slot, and one that sets a piece back where the map has it, copy nothing either.
  structs.put(0, 20, 0, 0, 0, 0, 0, 0, 0, t.version);
  structs.put(0, 12, wall, t.x[12]!, t.y[12]!, t.z[12]!, t.yaw[12]!, 0, 50, t.version);
  expect([lent(), t.kind[12], t.kind[20], t.live]).toEqual([[true, true, true, true], wall, 0, 55]);
  const again = parseMap(file).statics;
  expect([map.statics.x, map.statics.y, map.statics.z, map.statics.yaw]).toEqual([again.x, again.y, again.z, again.yaw]);
  // A piece built in the chunk grows its table, which takes its own columns then.
  expect(structs.add(wall, 40, 30, 40, 0, 9, 100)).toBe(60);
  expect(lent()).toEqual([false, false, false, false]);
});

test("a chunk mended, swapped or set back to the map stands as placed again", () => {
  const pieces = Array.from({ length: 30 }, (_, i) => ({ kind: i % 3 === 0 ? "core:wall" : "core:crate", x: 70 + (i % 6) * 8, y: 1 + Math.floor(i / 6) * 3, z: 10, yaw: 0 }));
  const map = parseMap(writeMap(flatMap(4, { statics: pieces })));
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const t = structs.chunks[1]!;
  const [wall, crate] = [reg.index.get("core:wall")!, reg.index.get("core:crate")!];
  const ref = (s: number): number => 65536 + s;
  const state = (): unknown[] => [structs.asPlaced(1), t.changed, t.differs];
  expect([state(), structs.mapKind(1, 0), structs.mapKind(1, 1), structs.mapKind(1, 30), structs.asMap(1, 4), structs.asMap(1, 30)]).toEqual([[true, 0, 0], wall, crate, 0, true, false]);
  // Hurt and mended to its kind's health.
  structs.damage(ref(4), 1);
  structs.damage(ref(4), 1);
  expect([state(), structs.asMap(1, 4), structs.asMap(1, 5)]).toEqual([[false, 1, 1], false, true]);
  structs.mend(ref(4), reg.maxHp[crate]!);
  expect(state()).toEqual([true, 0, 0]);
  // Swapped to another kind and back.
  structs.swap(ref(4), wall);
  structs.swap(ref(5), wall);
  expect(state()).toEqual([false, 2, 2]);
  structs.swap(ref(4), crate);
  structs.swap(ref(5), crate);
  expect(state()).toEqual([true, 0, 0]);
  // Given to an owner with every piece nobody owns, and given back.
  expect(structs.reown(0, 5)).toBe(30);
  expect(state()).toEqual([false, 30, 30]);
  expect(structs.reown(5, 0)).toBe(30);
  expect(state()).toEqual([true, 0, 0]);
  // Taken away and set back as a load sets a map slot.
  structs.remove(ref(7));
  structs.removeMany(Uint32Array.of(ref(8), ref(9)), 2, GONE_FELL, 0, 0, 0, 0);
  expect(state()).toEqual([false, 3, 3]);
  for (const s of [7, 8, 9]) structs.putMapped(1, s, structs.mapKind(1, s), 0, reg.maxHp[structs.mapKind(1, s)]!, t.version);
  expect([state(), t.live, t.x.buffer === map.statics.x.buffer]).toEqual([[true, 0, 0], 30, true]);
  // Built in and cleared, with a map slot hurt meanwhile.
  const built = structs.add(wall, 100, 20, 40, 0, 9, 100);
  structs.damage(ref(2), 3);
  expect(state()).toEqual([false, 1, 2]);
  structs.remove(built);
  expect(state()).toEqual([false, 1, 1]);
  structs.mend(ref(2), reg.maxHp[crate]!);
  expect(state()).toEqual([true, 0, 0]);
  // The version has only gone up, as replication needs.
  expect(t.version).toBeGreaterThan(t.mapped);
  // A map slot is never given another place.
  expect(() => structs.put(1, 3, wall, 1, 2, 3, 0, 0, 100, t.version)).toThrow("chunk 1: slot 3 is the map's and keeps its place");
  // A chunk the map set nothing down in stands as placed while nothing stands in it.
  const far = structs.add(wall, 200, 2, 200, 0, 9, 100);
  expect(structs.asPlaced(Math.floor(far / 65536))).toBe(false);
  structs.remove(far);
  expect(structs.asPlaced(Math.floor(far / 65536))).toBe(true);
});

test("a chunk's changed map slots are listed once, until one more or fewer differs", () => {
  const pieces = Array.from({ length: 200 }, (_, i) => ({ kind: i % 3 === 0 ? "core:wall" : "core:crate", x: 66 + (i % 20) * 3, y: 1 + Math.floor(i / 20) * 3, z: 10, yaw: 0 }));
  const map = parseMap(writeMap(flatMap(4, { statics: pieces })));
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const t = structs.chunks[1]!;
  const [wall, crate] = [reg.index.get("core:wall")!, reg.index.get("core:crate")!];
  const brute = (): number[] => [...Array(t.mapped).keys()].filter((s) => !structs.asMap(1, s));
  expect([...structs.changedSlots(1)]).toEqual([]);
  const rng = new Rng(11);
  for (let n = 0; n < 400; n++) {
    const ref = 65536 + rng.int(200);
    const op = rng.int(5);
    if (op === 0) structs.remove(ref);
    else if (op === 1) structs.damage(ref, 1 + rng.int(60));
    else if (op === 2) structs.swap(ref, rng.int(2) === 0 ? wall : crate);
    else if (op === 3) structs.mend(ref, reg.maxHp[structs.mapKind(1, ref & 0xffff)]!);
    else structs.add(wall, 100, 30, 40, 0, 9, 100);
    if (n % 7 === 0) expect([n, [...structs.changedSlots(1)]]).toEqual([n, brute()]);
  }
  const list = structs.changedSlots(1);
  expect([[...list], list.length, t.differs]).toEqual([brute(), t.changed, t.changed + t.live - (t.mapped - brute().filter((s) => t.kind[s] === 0).length)]);
  // A blow to a slot already changed, and a piece built, leave the list as it is. A slot that comes to differ makes it again.
  const hurt = list.find((s) => t.kind[s] !== 0 && t.hp[s]! > 2)!;
  structs.damage(65536 + hurt, 1);
  structs.add(wall, 100, 40, 40, 0, 9, 100);
  expect(structs.changedSlots(1)).toBe(list);
  const whole = [...Array(200).keys()].find((s) => structs.asMap(1, s))!;
  structs.damage(65536 + whole, 1);
  expect([structs.changedSlots(1) === list, [...structs.changedSlots(1)]]).toEqual([false, brute()]);
});
