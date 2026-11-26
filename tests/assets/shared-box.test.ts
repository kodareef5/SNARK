// Meshes stored in one shared box keep it through a repack, so points two of them share stay the same points.

import { expect, test } from "bun:test";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { boxMesh, buildPack, unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";

test("a mesh in a shared box keeps the box when unpacked and packed again", () => {
  const bounds = { center: [0.1, 0.5, 0] as [number, number, number], half: [1, 1, 1] as [number, number, number] };
  const meshes: SourceMesh[] = [{ id: "a", lods: [boxMesh([0.2, 0.3, 0.1], 1)], bounds }, { id: "b", lods: [boxMesh([0.2, 0.3, 0.1], 1)] }];
  const first = parsePack(buildPack(meshes, defaultPalette()));
  const a = first.header.meshes.find((m) => m.id === "a")!, b = first.header.meshes.find((m) => m.id === "b")!;
  expect([a.center, a.half]).toEqual([bounds.center, bounds.half]);
  expect(b.half.map((h) => Math.round(h * 1e6) / 1e6)).toEqual([0.2, 0.3, 0.1]);
  const again = unpackMeshes(first);
  expect(again.find((m) => m.id === "a")!.bounds).toEqual(bounds);
  expect(again.find((m) => m.id === "b")!.bounds).toBeUndefined();
  expect(buildPack(again, defaultPalette())).toEqual(buildPack(unpackMeshes(parsePack(buildPack(again, defaultPalette()))), defaultPalette()));
});

test("a position outside its shared box is refused", () => {
  const bounds = { center: [0, 0, 0] as [number, number, number], half: [0.1, 0.1, 0.1] as [number, number, number] };
  expect(() => buildPack([{ id: "a", lods: [boxMesh([0.2, 0.3, 0.1], 1)], bounds }], defaultPalette())).toThrow("outside the box");
});
