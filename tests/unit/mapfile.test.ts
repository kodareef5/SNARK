import { expect, test } from "bun:test";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { MapStatics, groundBytes, mapHeightfield, mapNodes, parseMap, parseStatics, placeStatics, staticsSteps, writeMap, type MapData, type NodeScatter, type NodeZoned } from "../../shared/world/mapfile.ts";
import { nodeForms, scatterNodes, type NodeSpot } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { busyMap, flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const spot = (): NodeSpot => ({ kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 });

test("a map written to a file is read back whole, and the same map is the same bytes", () => {
  const map = busyMap();
  const file = writeMap(map);
  const back = parseMap(file);
  expect({ ...back, statics: [...back.statics] }).toEqual({ ...map, statics: [...map.statics], hash: hashBytes(file.subarray(12)) });
  expect(writeMap(back)).toEqual(file);
  // A map with nothing on it and no water.
  const bare = parseMap(writeMap(flatMap(1)));
  expect([bare.seaLevel, [...bare.statics], bare.nodes, mapNodes(bare, mapHeightfield(bare), reg)]).toEqual([-Infinity, [], [], null]);
  // Smooth ground costs little once the file is compressed for the wire.
  expect(Bun.gzipSync(writeMap(flatMap(4))).length).toBeLessThan(400);
});

test("a file's ground comes before its statics, and each reads alone: the ground as the map with none, the rest as its statics", () => {
  const map = busyMap();
  const file = writeMap(map);
  const ground = groundBytes(file);
  expect(ground).toBeLessThan(file.length);
  const first = parseMap(file.subarray(0, ground), false);
  expect([first.hash, first.statics.length, first.heights, first.nodes]).toEqual([parseMap(file).hash, 0, map.heights, map.nodes]);
  expect(() => parseMap(file.subarray(0, ground))).toThrow("map: the file is damaged");
  expect([...parseStatics(file.subarray(ground), map.dims)]).toEqual([...MapStatics.of(map.dims, map.statics)]);
  expect(parseStatics(new Uint8Array(0), map.dims).length).toBe(0);
  // Pieces from one end of the widest map to the other, and from the lowest to the highest, come back where they were.
  const dims = { chunksX: 256, chunksZ: 1 };
  const samples = (256 * 32 + 1) * 33;
  const far = [{ kind: "core:wall", x: 0, y: -1024, z: 64, yaw: 65535 }, { kind: "core:wall", x: 16384, y: 3072, z: 0, yaw: 0 }, { kind: "core:wall", x: 0.5, y: 0, z: 63.5, yaw: 1 }];
  const wide = writeMap({ ...flatMap(1), dims, heights: new Uint16Array(samples), tint: new Uint8Array(samples), statics: far });
  expect([...parseStatics(wide.subarray(groundBytes(wide)), dims)]).toEqual([...MapStatics.of(dims, far)]);
  // Read a step at a time, a city's pieces come to the same table, a slice of them a step.
  const many = Array.from({ length: 70000 }, (_, i) => ({ kind: i % 3 ? "core:wall" : "core:crate", x: (i % 250) / 4, y: 1 + (i % 7), z: (i * 7) % 64, yaw: i % 65536 }));
  const city = writeMap({ ...flatMap(1), statics: many });
  const steps = staticsSteps(city.subarray(groundBytes(city)), { chunksX: 1, chunksZ: 1 });
  let step = steps.next();
  let taken = 0;
  for (; !step.done; step = steps.next()) taken++;
  expect([taken >= 4, [...step.value].slice(-3)]).toEqual([true, [...MapStatics.of({ chunksX: 1, chunksZ: 1 }, many)].slice(-3)]);
  // A piece off the map in the file itself is refused as one in a map written so would be.
  const off = city.slice();
  // The high byte of the last piece's x, in the third of x's planes: the columns end the file.
  off[off.length - 13 * many.length + 6 * many.length + many.length - 1]! = 0x7f;
  expect(() => parseStatics(off.subarray(groundBytes(city)), { chunksX: 1, chunksZ: 1 })).toThrow("is off the map");
});

test("slots taken out of a scattered layer stand empty, and the rest are the scatter's", () => {
  const zoned = busyMap().nodes[2] as NodeZoned;
  const out = new Uint8Array(Math.ceil((6 * zoned.perChunk) / 8)).fill(0x55);
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
  /** The file with one thing changed and its hash made right again, as a faulty writer would leave it. */
  const rehashed = (change: (view: DataView) => void): Uint8Array => {
    const copy = file.slice();
    const view = new DataView(copy.buffer);
    change(view);
    view.setUint32(8, hashBytes(copy.subarray(12)), true);
    return copy;
  };
  const flipped = file.slice();
  flipped[file.length >> 1]! ^= 4;
  expect(() => parseMap(flipped)).toThrow("map: the file is damaged");
  expect(() => parseMap(file.subarray(0, file.length - 9))).toThrow("map: it is cut short");
  const busy = writeMap(busyMap());
  expect(() => parseMap(busy.subarray(0, busy.length - 9))).toThrow("map: the file is damaged");
  // A page fetched the file by its SHA-256, so it reads the body without hashing it again.
  expect(parseMap(file, false)).toEqual(parseMap(file));
  expect(() => parseMap(file.subarray(0, file.length - 9), false)).toThrow("map: it is cut short");
  expect(() => parseMap(new Uint8Array(100))).toThrow("map: this is not a map file");
  expect(() => parseMap(file.subarray(0, 20))).toThrow("map: it is cut short");
  expect(() => parseMap(rehashed((view) => view.setUint16(4, 3, true)))).toThrow("map: version 3 is not one this build reads: build the map again");
  expect(() => parseMap(rehashed((view) => view.setFloat32(20, 4, true)))).toThrow("map: its samples are 4 m apart");
  expect(() => parseMap(rehashed((view) => view.setUint16(16, 2, true)))).toThrow("map: it has 1089 heights and 1089 tints, and its size takes 2145 of each");
  // The first section's length, made to reach past the end of the file.
  const lengthAt = 48 + 1 + "test:flat".length + 4;
  expect(() => parseMap(rehashed((view) => view.setUint32(lengthAt, file.length, true)))).toThrow("map: a section runs past its end");

  const refused = (more: Partial<MapData>): (() => void) => () => void writeMap({ ...busyMap(), ...more });
  expect(refused({ spawns: [] })).toThrow("map: it has 0 spawn points");
  expect(refused({ spawns: [{ name: "Out", x: 129, z: 5, yaw: 0 }] })).toThrow('map: spawn point "Out" is off the map');
  expect(refused({ id: "two words" })).toThrow("map: its id must be");
  expect(refused({ stepY: 0 })).toThrow("map: its height range or its sea level is not a number");
  expect(refused({ dims: { chunksX: 2, chunksZ: 257 } })).toThrow("map: it is 2 by 257 chunks");
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
      expect(a).toEqual(b);
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
      expect(a).toEqual(b);
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
