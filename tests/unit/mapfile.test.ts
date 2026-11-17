import { expect, test } from "bun:test";
import { CHUNK_SIZE, chunkCount, framed } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { MapStatics, OVERVIEW_STEP, blankLayers, joinParts, mapHeightfield, mapNodes, parseMap, partSteps, placeStatics, readHead, readPart, setGround, writeMap, type GroundPiece, type MapData, type NodeScatter, type NodeZoned, type OverviewPiece, type StaticsPiece } from "../../shared/world/mapfile.ts";
import { nodeForms, scatterNodes, type NodeSpot } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
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
  expect(Bun.gzipSync(writeMap(flatMap(4))).length).toBeLessThan(500);
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
  const city = writeMap({ ...flatMap(1), statics: many });
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
  // The high byte of the last piece's x, in the third of x's planes, after the part's count and 6 planes.
  off[part.at + 4 + 6 * 70000 + 69999]! = 0x7f;
  expect(() => readPart(cityHead, part, off.subarray(part.at, part.at + part.length), false)).toThrow("is off the map");
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

test("slots taken out of a scattered layer stand empty, and the rest are the scatter's", () => {
  const zoned = busyMap().nodes[2] as NodeZoned;
  // Bits past the last chunk's slots are not kept.
  const out = new Uint8Array(Math.ceil((6 * zoned.perChunk) / 8)).fill(0x55).fill(0x05, 22);
  const map = parseMap(writeMap({ ...busyMap(), nodes: [{ ...zoned, out }] }));
  expect((map.nodes[0] as NodeZoned).out).toEqual(out);
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
  expect(() => writeMap({ ...busyMap(), nodes: [{ ...zoned, out: out.subarray(1) }] })).toThrow("map: the slots taken out of scattered nodes are not a bit per slot of every chunk");
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
  // Twice as wide, its overview's ground is read as twice the samples it holds.
  expect(() => parseMap(rehashed((view) => view.setUint16(16, 2, true)))).toThrow(/^map: its part overview\.32-32\.[0-9a-f]{16}\.part runs past its end$/);
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
  // The slot freed is built in again. The map's columns stay the map's, and the table's are its own from the first write.
  expect(structs.add(wall, 70, 3, 30, 100, 9, 100)).toBe(65536 + 3);
  expect([b!.x.buffer === map.statics.x.buffer, b!.x[3], b!.yaw[3], c!.x.buffer === map.statics.x.buffer]).toEqual([false, 70, 100, true]);
  const again = parseMap(file).statics;
  expect([map.statics.x, map.statics.y, map.statics.z, map.statics.yaw]).toEqual([again.x, again.y, again.z, again.yaw]);
  // Kept by the server, the statics need not keep the map's order.
  expect([map.statics.unordered().row.length, map.statics.unordered().x === map.statics.x, map.statics.row.length]).toEqual([0, true, 300]);
});
