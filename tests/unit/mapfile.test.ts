import { expect, test } from "bun:test";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics, writeMap, type MapData, type NodeScatter, type NodeZoned } from "../../shared/world/mapfile.ts";
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
  expect(() => parseMap(file.subarray(0, file.length - 9))).toThrow("map: the file is damaged");
  // A page fetched the file by its SHA-256, so it reads the body without hashing it again.
  expect(parseMap(file, false)).toEqual(parseMap(file));
  expect(() => parseMap(file.subarray(0, file.length - 9), false)).toThrow("map: a section runs past its end");
  expect(() => parseMap(new Uint8Array(100))).toThrow("map: this is not a map file");
  expect(() => parseMap(file.subarray(0, 20))).toThrow("map: this is not a map file");
  expect(() => parseMap(rehashed((view) => view.setUint16(4, 4, true)))).toThrow("map: version 4 is not one this build reads");
  // A file of the version before zoned nodes is read as it was.
  expect(parseMap(rehashed((view) => view.setUint16(4, 1, true))).heights).toEqual(parseMap(file).heights);
  expect(() => parseMap(rehashed((view) => view.setFloat32(16, 4, true)))).toThrow("map: its samples are 4 m apart");
  expect(() => parseMap(rehashed((view) => view.setUint16(12, 2, true)))).toThrow("map: it has 1089 heights and 1089 tints, and its size takes 2145 of each");
  // The first section's length, made to reach past the end of the file.
  const lengthAt = 44 + 1 + "test:flat".length + 4;
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

test("a map's static pieces are set down in the file's order, and a piece the content lacks stops the load", () => {
  const map = parseMap(writeMap(busyMap()));
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  expect(structs.count).toBe(3);
  const t = structs.chunks[2]!;
  expect([t.kind[0], t.x[0], t.y[0], t.z[0], t.yaw[0], t.owner[0], t.hp[0]]).toEqual([reg.index.get("core:wall")!, 12.5, 40.25, 100, 16384, 0, reg.maxHp[reg.index.get("core:wall")!]!]);
  expect(() => placeStatics({ ...map, statics: [{ kind: "core:nothing", x: 1, y: 1, z: 1, yaw: 0 }] }, structs, reg)).toThrow('map "test:busy" needs content "core:nothing"');
});
