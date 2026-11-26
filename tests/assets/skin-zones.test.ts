// Skin zones: a body level's triangles go zone by zone, the pack records each zone's runs, and a coarser level keeps each
// zone's border where it was.

import { expect, test } from "bun:test";
import { HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { SKIN_ZONE_COUNT, SKIN_ZONE_NAMES, SKIN_ZONE_OF_BONE, SKIN_ZONE_SLOT, skinZoneAt } from "../../shared/anim/skin-zones.ts";
import { describePack, parseManifest } from "../../shared/pack/manifest.ts";
import { MOST_ZONES, parsePack, type PackMaterial } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { AssetTable } from "../../client/core/assets/table.ts";
import { simplify, simplifySurface } from "../../tools/pack/simplify.ts";
import { buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";

/** A square of `n` by `n` cells lying flat, two metres across: zone 3 where x < 0, zone 7 where not. */
function plate(n: number, surface = false): SourceLod {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const zones: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    positions.push((i / n) * 2 - 1, 0, (j / n) * 2 - 1);
    uvs.push(i / n, j / n);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const at = j * (n + 1) + i;
    indices.push(at, at + n + 1, at + 1, at + 1, at + n + 1, at + n + 2);
    zones.push(i < n / 2 ? 3 : 7, i < n / 2 ? 3 : 7);
  }
  const count = positions.length / 3;
  const lod: SourceLod = { positions: Float32Array.from(positions), colors: new Uint8Array(count).fill(5), indices: Uint32Array.from(indices), zones: Uint8Array.from(zones) };
  if (surface) Object.assign(lod, { uvs: Float32Array.from(uvs), normals: Float32Array.from({ length: count * 3 }, (_, k) => (k % 3 === 1 ? 1 : 0)) });
  return lod;
}

const material = (id: string): PackMaterial => ({ id, base: -1, normal: -1, mro: -1, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 1 });

test("every bone's skin is in a zone of the bone's own slot, and the list is named", () => {
  expect(SKIN_ZONE_NAMES.length).toBe(SKIN_ZONE_COUNT);
  expect(SKIN_ZONE_SLOT.length).toBe(SKIN_ZONE_COUNT);
  expect(SKIN_ZONE_COUNT).toBeLessThanOrEqual(MOST_ZONES);
  for (let b = 0; b < HUMAN_BONES; b++) expect(SKIN_ZONE_SLOT[SKIN_ZONE_OF_BONE[b]!]).toBe(HUMAN.slot[b]!);
});

test("an upper arm and a thigh are cut in two at half their length", () => {
  const rest = HUMAN.rest;
  const along = (bone: number, end: number, t: number): number => skinZoneAt(bone, ...([0, 1, 2].map((k) => rest[bone * 3 + k]! + (rest[end * 3 + k]! - rest[bone * 3 + k]!) * t) as [number, number, number]), rest);
  expect(along(7, 8, 0.3)).not.toBe(along(7, 8, 0.7));
  expect(along(17, 18, 0.3)).not.toBe(along(17, 18, 0.7));
  expect(SKIN_ZONE_SLOT[along(7, 8, 0.7)]).toBe(SKIN_ZONE_SLOT[along(7, 8, 0.3)]);
});

test("a level cut by zone goes zone by zone within each material, and reads back", () => {
  const lod = plate(8, true);
  // Every other row drawn with the second material, so each zone has a run in each section.
  const sections = new Uint8Array(lod.indices.length / 3);
  for (let t = 0; t < sections.length; t++) sections[t] = Math.floor(t / 16) % 2;
  lod.sections = sections;
  const mesh: SourceMesh = { id: "test:plate", lods: [lod, { ...plate(4), sections: undefined }], flat: 1, materials: [material("test:a"), material("test:b")], textures: [] };
  const pack = parsePack(buildPack([mesh], defaultPalette()));
  const made = pack.header.meshes[0]!;
  const fine = made.lods[0]!;
  expect(fine.sections!.length).toBe(6);
  expect(fine.zones!.length).toBe(12);
  // Each zone run lies inside one section, and the runs cover the level in order.
  let next = 0;
  for (let k = 0; k < fine.zones!.length; k += 3) {
    expect(fine.zones![k + 1]).toBe(next);
    next += fine.zones![k + 2]!;
  }
  expect(next).toBe(fine.indexCount);
  expect(made.lods[1]!.zones).toEqual([3, 0, 48, 7, 48, 48]);
  // The triangles of a run are the ones that zone had, with their corners as they were.
  const back = unpackMeshes(pack)[0]!;
  const key = (l: SourceLod, t: number): string => `${l.zones![t]}:${[0, 1, 2].map((k) => [...l.positions.subarray(l.indices[t * 3 + k]! * 3, l.indices[t * 3 + k]! * 3 + 3)].map((v) => v.toFixed(3)).join()).join("|")}`;
  const before = [...Array(lod.indices.length / 3).keys()].map((t) => key(lod, t)).sort();
  const after = [...Array(back.lods[0]!.indices.length / 3).keys()].map((t) => key(back.lods[0]!, t)).sort();
  expect(after).toEqual(before);
  // Packed again, the runs come out the same.
  expect(parsePack(buildPack(unpackMeshes(pack), defaultPalette())).header.meshes[0]!.lods[0]!.zones).toEqual(fine.zones);
});

test("what the client knows of a level carries its zones, and a level without has none", () => {
  const zoned: SourceMesh = { id: "test:zoned", lods: [plate(4)] };
  const plain: SourceMesh = { id: "test:plain", lods: [{ ...plate(4), zones: undefined }] };
  const file = buildPack([zoned, plain], defaultPalette());
  const pack = parsePack(file);
  expect(pack.header.meshes[pack.meshIndex.get("test:plain")!]!.lods[0]!.zones).toBeUndefined();
  const manifest = parseManifest(JSON.stringify(describePack(pack, { name: "test.snpk", bytes: file.length })));
  const table = new AssetTable(manifest, pack);
  expect(table.zones[table.find("test:zoned")]![0]).toEqual([3, 0, 48, 7, 48, 48]);
  expect(table.zones[table.find("test:plain")]![0]).toEqual([]);
});

test("a pack or a manifest whose zones do not cover a level, or cross a section, is refused", () => {
  const file = buildPack([{ id: "test:zoned", lods: [plate(4)] }], defaultPalette());
  const text = JSON.stringify(describePack(parsePack(file), { name: "test.snpk", bytes: file.length }));
  const bad = (zones: number[]): (() => unknown) => () => {
    const m = JSON.parse(text);
    m.meshes[0].levels[0].zones = zones;
    return parseManifest(JSON.stringify(m));
  };
  expect(bad([3, 0, 48])).toThrow(/zones/);
  expect(bad([3, 0, 48, 7, 51, 45])).toThrow(/zone/);
  expect(bad([40, 0, 48, 7, 48, 48])).toThrow(/zone/);
  expect(bad([3, 0, 48, 7, 48, 48])).not.toThrow();
});

/** The points where triangles of two zones meet, as text. */
function border(lod: SourceLod): Set<string> {
  const zonesAt = new Map<string, Set<number>>();
  for (let t = 0; t < lod.indices.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const v = lod.indices[t * 3 + k]!;
      const key = [...lod.positions.subarray(v * 3, v * 3 + 3)].map((x) => x.toFixed(4)).join();
      (zonesAt.get(key) ?? zonesAt.set(key, new Set()).get(key)!).add(lod.zones![t]!);
    }
  }
  return new Set([...zonesAt].filter(([, z]) => z.size > 1).map(([k]) => k));
}

test("a coarser level keeps each zone's border on the line it was, flat or with a surface", () => {
  for (const coarse of [simplify(plate(16), [64])[0]!.lod, simplifySurface(plate(16, true), [64])[0]!.lod]) {
    expect(coarse.indices.length / 3).toBeLessThan(200);
    expect(coarse.zones!.length).toBe(coarse.indices.length / 3);
    const line = border(coarse);
    expect(line.size).toBeGreaterThan(1);
    // Every point two zones share is still on x = 0, and every triangle is wholly on its zone's side.
    for (const key of line) expect(Math.abs(Number(key.split(",")[0]))).toBeLessThan(1e-6);
    for (let t = 0; t < coarse.indices.length / 3; t++) {
      const x = [0, 1, 2].reduce((s, k) => s + coarse.positions[coarse.indices[t * 3 + k]! * 3]!, 0) / 3;
      expect(coarse.zones![t] === 3 ? x < 0 : x > 0).toBe(true);
    }
  }
});

test("each group of zones keeps at least half its share of a coarser level", () => {
  // The left half is flat and costs nothing to take; the right is bumped.
  const lod = plate(16);
  for (let v = 0; v < lod.positions.length / 3; v++) if (lod.positions[v * 3]! > 0) lod.positions[v * 3 + 1] = 0.05 * Math.sin(lod.positions[v * 3]! * 19) * Math.sin(lod.positions[v * 3 + 2]! * 23);
  const count = (l: SourceLod, zone: number): number => l.zones!.filter((z) => z === zone).length;
  const floor = Math.floor(0.5 * 40 * 0.5);
  expect(count(simplify(lod, [40])[0]!.lod, 3)).toBeLessThan(floor);
  const held = simplify(lod, [40], [], false, { groups: [0, 0, 0, 1, 0, 0, 0, 2] })[0]!.lod;
  expect(count(held, 3)).toBeGreaterThanOrEqual(floor);
  expect(count(held, 7)).toBeGreaterThanOrEqual(floor);
});
