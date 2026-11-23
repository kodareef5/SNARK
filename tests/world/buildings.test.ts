// A map's buildings (shared/world/buildings.ts): what the file holds of each, which of a chunk's slots are its pieces, and
// a piece's storey and tile from its slot and its place. The city is three buildings the ruins' layouts made
// (tests/fixtures/buildings.ts).

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YAW_UNITS, chunkAt } from "../../shared/coords.ts";
import { BUILDING_NAMED, BUILDING_ROOF, BUILDING_SPANS, BUILDING_STAIRS, Buildings, SectorBuildings, addressParts, blankFrame, kindWords, place, placeOf, storeyAt, tileOf, type BuildingRow } from "../../shared/world/buildings.ts";
import { parseMap, partsOf, readHead, readPart, writeMap, type BuildingsPiece, type MapFile } from "../../shared/world/mapfile.ts";
import { readLayers, writeLayers } from "../../tools/map/layers.ts";
import { builtCity } from "../fixtures/buildings.ts";
import { flatMap, wideMap } from "../fixtures/map.ts";

const city = builtCity();
const file = writeMap(city.map);
const map = parseMap(file);
const built = map.buildings!;

/**
 * The chunk and slot each of the city's statics is read back in, found by its kind and place: a file lists its statics a
 * sector at a time, so a static's place in the city's list is not its place in the file's.
 */
function slotsOf(m: MapFile): [chunk: number, slot: number][] {
  const at = new Map<string, [number, number][]>();
  const key = (kind: string, x: number, y: number, z: number, yaw: number): string => `${kind} ${Math.round(x * 512)} ${Math.round(y * 512)} ${Math.round(z * 512)} ${yaw}`;
  for (let chunk = 0; chunk + 1 < m.statics.first.length; chunk++) {
    for (let r = m.statics.first[chunk]!; r < m.statics.first[chunk + 1]!; r++) {
      const k = key(m.statics.kinds[m.statics.kind[r]!]!, m.statics.x[r]!, m.statics.y[r]!, m.statics.z[r]!, m.statics.yaw[r]!);
      at.set(k, [...(at.get(k) ?? []), [chunk, r - m.statics.first[chunk]!]]);
    }
  }
  // Two alike at one place come in the list's order in their chunk.
  return city.statics.map((p) => at.get(key(p.kind, p.x, p.y, p.z, p.yaw))!.shift()!);
}
const slots = slotsOf(map);
const slotOf = (_: MapFile, i: number): [chunk: number, slot: number] => slots[i]!;

test("a map with buildings gives each piece its building and its storey", () => {
  expect(city.statics.length).toBeGreaterThan(400);
  const mine = [0, 0, 0];
  city.statics.forEach((_, i) => {
    const [chunk, slot] = slotOf(map, i);
    const b = built.buildingOf(chunk, slot);
    expect([i, b < 0 ? -1 : built.id(b), built.storeyOf(chunk, slot)]).toEqual([i, city.of[i]! < 0 ? -1 : city.buildings[city.of[i]!]!.id, city.of[i]! < 0 ? -1 : city.storey[i]!]);
    if (b >= 0) mine[city.of[i]!]!++;
  });
  // Every building has pieces, the tower on six storeys, and the crates between them are no building's.
  expect(mine.every((n) => n > 20)).toBe(true);
  expect(city.of.filter((b) => b < 0).length).toBe(4);
  expect(new Set(city.storey.filter((_, i) => city.of[i] === 0)).size).toBeGreaterThanOrEqual(6);
});

test("a piece's tile comes from its place in its building's frame: its tile's middle, edge or corner", () => {
  const frames = city.buildings.map((b) => built.frame(built.byId(b.id)));
  let placed = 0;
  city.statics.forEach((p, i) => {
    const k = city.known[i];
    if (city.of[i]! < 0 || !k || k.i < 0) return;
    // A merged slab or wall is as wide as two bays and stands between them: within a tile of the one it was placed from.
    const wide = /_(floor16|zpanel16|zshaft16|zpitch16)_/.test(p.kind) ? 2 : 0;
    placeOf(frames[city.of[i]!]!, p.x, p.z);
    expect([p.kind, Math.abs(place.hi - (2 * k.i + 1)) <= 1 + wide, Math.abs(place.hj - (2 * k.j + 1)) <= 1 + wide]).toEqual([p.kind, true, true]);
    placed++;
  });
  expect(placed).toBeGreaterThan(400);
  // A point of the frame, turned and moved as the frame is: tile (4, 1) of the flats, its middle, an edge and a corner.
  const f = frames[1]!, at = (u: number, v: number): [number, number] => [f.x + u * f.c + v * f.s, f.z - u * f.s + v * f.c];
  const [cols, rows] = [f.cols, f.rows];
  expect([cols, rows, f.bay]).toEqual([6, 3, 8]);
  for (const [u, v, hi, hj, tile] of [[12, 0, 9, 3, 1 * cols + 4], [16, 0, 10, 3, 1 * cols + 5], [16, 4, 10, 4, 2 * cols + 5], [24, -12, 12, 0, 5], [-30, 0, -2, 3, 1 * cols]] as const) {
    placeOf(f, ...at(u, v));
    expect([u, v, place.hi, place.hj, tileOf(f, ...at(u, v))]).toEqual([u, v, hi, hj, tile]);
  }
  expect([storeyAt(f, 0.5), storeyAt(f, 4.2), storeyAt(f, 4.3), storeyAt(f, 8.5), storeyAt(f, -3)]).toEqual([0, 0, 1, 2, 0]);
});

test("one building's storey in one chunk is one run of slots", () => {
  const runs = new Map<string, { slots: number[]; storeys: number[] }>();
  city.statics.forEach((_, i) => {
    if (city.of[i]! < 0) return;
    const [chunk, slot] = slotOf(map, i);
    const key = `${city.of[i]} ${chunk}`;
    if (!runs.has(key)) runs.set(key, { slots: [], storeys: [] });
    runs.get(key)!.slots.push(slot);
    runs.get(key)!.storeys.push(city.storey[i]!);
  });
  // The tower stands in four chunks and the flats across two sectors.
  expect(runs.size).toBeGreaterThanOrEqual(6);
  for (const [key, r] of runs) {
    const order = r.slots.map((s, k) => [s, r.storeys[k]!] as const).sort((a, b) => a[0] - b[0]);
    // The slots are next to each other and the storeys never go down along them, so a storey's slots are too.
    expect([key, order.every(([s], k) => k === 0 || s === order[k - 1]![0] + 1), order.every(([, storey], k) => k === 0 || storey >= order[k - 1]![1])]).toEqual([key, true, true]);
  }
  // The table says the same runs: one a building a chunk, its storeys' slots counted in turn.
  for (const h of built.handles()) {
    const seen = new Set<number>();
    built.eachRun(h, (chunk, slot, count, run) => {
      expect(seen.has(chunk)).toBe(false);
      seen.add(chunk);
      const t = built.table(h);
      expect(t.steps[t.stepAt[run + 1]! - 1]).toBe(count);
      for (let s = slot; s < slot + count; s++) expect(built.buildingOf(chunk, s)).toBe(h);
    });
    expect(seen.size).toBeGreaterThan(0);
  }
});

test("buildingOf agrees with a search of every piece of the city", () => {
  const whose = new Map<number, number>();
  city.statics.forEach((_, i) => {
    const [chunk, slot] = slotOf(map, i);
    whose.set(chunk * 65536 + slot, city.of[i]!);
  });
  let asked = 0;
  for (let chunk = 0; chunk < 18; chunk++) {
    const here = new Set<number>();
    for (let slot = 0; slot < 400; slot++, asked++) {
      const b = built.buildingOf(chunk, slot), want = whose.get(chunk * 65536 + slot) ?? -1;
      expect([chunk, slot, b < 0 ? -1 : built.id(b)]).toEqual([chunk, slot, want < 0 ? -1 : city.buildings[want]!.id]);
      if (b >= 0) here.add(b);
    }
    expect(built.inChunk(chunk).sort()).toEqual([...here].sort());
  }
  expect(asked).toBe(7200);
  // By id: each building once in each sector it stands in.
  const both: number[] = [];
  expect([built.byId(city.buildings[1]!.id, both) >= 0, both.length, built.byId(12345)]).toEqual([true, 2, -1]);
  expect(built.count).toBe(4);
});

test("a building comes back as it was written: its strings, its frame, its stairs and what it is", () => {
  const [tower, flats, house] = city.buildings.map((b) => built.byId(b.id));
  expect([built.name(tower!), built.address(tower!), built.kind(tower!), built.recipe(tower!), built.form(tower!), built.district(tower!), built.collapse(tower!)]).toEqual(["Bâoli Tower", "5700 Northwest 10th Avenue", "tower_office", "tower", "tower", "Downtown", "shear"]);
  expect([built.name(flats!), built.address(flats!), built.name(house!), built.address(house!), built.district(house!)]).toEqual([null, "Ocean Drive", null, null, "Unzoned"]);
  expect([built.flags(tower!), built.flags(flats!), built.flags(house!)]).toEqual([BUILDING_STAIRS | BUILDING_ROOF | BUILDING_NAMED, BUILDING_STAIRS | BUILDING_ROOF | BUILDING_SPANS, 0]);
  expect([built.storeys(tower!), built.playable(tower!), built.storeys(house!)]).toEqual([6, 6, 2]);
  city.buildings.forEach((b) => {
    const h = built.byId(b.id), f = built.frame(h);
    expect([f.x, f.z, f.yaw, f.bay, f.cols, f.rows, f.width, f.depth, f.base]).toEqual([b.x, b.z, Math.round((b.yaw / 360) * YAW_UNITS), b.bay, b.cols, b.rows, b.width, b.depth, b.base]);
    expect(built.stairs(h)).toEqual([...b.stairs]);
    for (const s of b.stairs) expect([built.stairAt(h, s.i, s.j), built.stairAt(h, s.i, s.j + 7)]).toEqual([true, false]);
  });
  expect(built.stairs(tower!).map((s) => s.escape)).toEqual([false, true]);
  // Names in other alphabets, one longer than a string holds, and addresses with and without a number.
  const row = (id: number, name: string | null, address: string | null): BuildingRow => ({ id, kind: "house", recipe: "house", form: "house", district: "Unzoned", collapse: "burnt", storeys: 1, playable: 1, roof: false, named: false, name, address, x: 32, z: 32, yaw: 0, bay: 4, cols: 2, rows: 2, width: 8, depth: 8, base: 0, stairs: [] });
  const names = ["Nuestra Señora de la Merced", "L’Etoile Apartments", "東京タワー", "Salón Del Reino 🏛", "é".repeat(200)];
  const rows = [...names.map((name, k) => row(k + 1, name, k % 2 ? "12B Calle Ocho" : "Calle Ocho")), row(9, null, "1 Açaí Way"), row(10, "", "")];
  const pieces = rows.map((_, k) => ({ kind: "core:crate", x: 10 + k, z: 10 }));
  const back = parseMap(writeMap(flatMap(1, { statics: pieces.map((p) => ({ ...p, y: 0, yaw: 0 })), buildings: Buildings.of({ chunksX: 1, chunksZ: 1 }, rows, pieces, rows.map((_, k) => k), rows.map(() => 0)) }))).buildings!;
  expect([...back.handles()].map((h) => [back.name(h), back.address(h)])).toEqual([...names.slice(0, 4).map((name, k) => [name, k % 2 ? "12B Calle Ocho" : "Calle Ocho"]), ["é".repeat(127), "Calle Ocho"], [null, "1 Açaí Way"], [null, null]]);
  // A sector of many buildings, each of one piece on a storey of its own.
  const many = Array.from({ length: 400 }, (_, k) => row(100 + k, `Block ${k}`, `${k + 1} Flagler Street`));
  const spots = many.map((_, k) => ({ kind: "core:crate", x: 2 + (k % 20) * 3, z: 2 + Math.floor(k / 20) * 3 }));
  const big = parseMap(writeMap(flatMap(1, { statics: spots.map((p) => ({ ...p, y: 0, yaw: 0 })), buildings: Buildings.of({ chunksX: 1, chunksZ: 1 }, many, spots, many.map((_, k) => k), many.map((_, k) => k % 5)) }))).buildings!;
  expect([big.count, big.name(big.byId(499)), big.address(big.byId(100)), big.storeyOf(0, 399), big.id(big.buildingOf(0, 123))]).toEqual([400, "Block 399", "1 Flagler Street", 4, 223]);
  expect([addressParts("5700 Northwest 10th Avenue"), addressParts("Ocean Drive"), addressParts("77"), addressParts(null)]).toEqual([["5700", "Northwest 10th Avenue"], [null, "Ocean Drive"], [null, "77"], [null, null]]);
  expect([kindWords("apartment_block"), kindWords("house")]).toEqual(["Apartment block", "House"]);
});

test("the buildings survive the file: written again the same, read a part at a time and unpacked into layers", () => {
  expect(writeMap(map)).toEqual(file);
  const head = readHead(file);
  const parts = head.parts.filter((p) => p.kind === "buildings");
  expect([parts.map((p) => `${p.col}-${p.row}`), head.buildings?.kinds, head.parts.at(-1)!.kind]).toEqual([["127-128", "128-128"], ["apartment_block", "house", "tower_office"], "buildings"]);
  // Each sector's alone, in any order: the same table.
  const alone = new Buildings(head.dims, head.buildings!);
  for (const p of [...parts].reverse()) alone.set((readPart(head, p, file.subarray(p.at, p.at + p.length)) as BuildingsPiece).table);
  const same = (a: Buildings, slots = 300): void => {
    for (let chunk = 0; chunk < 18; chunk++) for (let slot = 0; slot < slots; slot++) expect([chunk, slot, a.buildingOf(chunk, slot), a.storeyOf(chunk, slot)]).toEqual([chunk, slot, built.buildingOf(chunk, slot), built.storeyOf(chunk, slot)]);
  };
  same(alone);
  // A folder of layers builds the same file.
  const folder = mkdtempSync(join(tmpdir(), "snark-buildings-"));
  writeLayers(map, folder);
  expect(writeMap(readLayers(folder))).toEqual(file);
  rmSync(folder, { recursive: true });
  // A part cut short, a run past its chunk's statics and a building of no kind are refused.
  const part = parts[0]!, bytes = file.slice(part.at, part.at + part.length);
  expect(() => SectorBuildings.decode(head.dims, head.buildings!, head.counts, part.col, part.row, bytes.subarray(0, bytes.length - 3))).toThrow();
  expect(() => SectorBuildings.decode(head.dims, head.buildings!, new Uint16Array(head.counts.length), part.col, part.row, bytes)).toThrow("do not lie in their chunks' statics");
  expect(() => SectorBuildings.decode(head.dims, { ...head.buildings!, kinds: [] }, head.counts, part.col, part.row, bytes)).toThrow("its head does not name");
  expect(() => writeMap({ ...city.map, statics: city.statics.slice(0, 50) })).toThrow("do not lie in their chunks' statics");
});

test("a map without buildings is read as before, and buildings with no piece write no section", () => {
  for (const plain of [flatMap(2), wideMap()]) {
    const bytes = writeMap(plain), head = readHead(bytes), back = parseMap(bytes);
    expect([head.buildings, head.parts.some((p) => p.kind === "buildings"), back.buildings, "buildings" in back]).toEqual([null, false, undefined, false]);
  }
  expect(readHead(writeMap({ ...flatMap(2), buildings: new Buildings({ chunksX: 2, chunksZ: 2 }, map.buildings!.names) })).buildings).toBeNull();
});
