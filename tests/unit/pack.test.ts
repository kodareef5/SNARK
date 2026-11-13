import { expect, test } from "bun:test";
import { VERTEX_BYTES, lodIndices, lodVertices, parsePack } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { MISSING_MESH, buildCorePack } from "../../tools/pack/build.ts";
import { importGlb } from "../../tools/pack/glb.ts";
import { sampleGlb } from "../fixtures/glb.ts";

test("a glTF export becomes a pack mesh with levels of detail, colour regions and a collider", () => {
  const palette = defaultPalette();
  const report = importGlb(sampleGlb(palette, 3), "test:pyramid", palette);
  expect(report.warnings).toEqual([]);
  expect(report.worstColorError).toBeLessThan(1);

  const pack = parsePack(buildCorePack([report.mesh]));
  const mesh = pack.header.meshes[pack.meshIndex.get("test:pyramid")!]!;
  expect(mesh.lods.map((l) => [l.vertexCount, l.indexCount])).toEqual([[9, 18], [3, 3]]);
  expect(mesh.collider).toEqual([1, 2, 1]);
  // Node transforms are baked: scale 2, lifted 1. Both levels share bounds x,z in [-1,1], y in [0,3].
  expect(mesh.center.map((v) => +v.toFixed(4))).toEqual([0, 1.5, 0]);
  expect(mesh.half.map((v) => +v.toFixed(4))).toEqual([1, 1.5, 1]);

  const verts = lodVertices(pack, mesh.lods[0]!);
  const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  const position = (v: number) => [0, 1, 2].map((a) => mesh.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * mesh.half[a]!);
  expect(position(0).map((v) => +v.toFixed(3))).toEqual([0, 3, 0]); // apex
  expect(position(1).map((v) => +v.toFixed(3))).toEqual([-1, 1, -1]);
  const colors = Array.from({ length: 9 }, (_, v) => verts[v * VERTEX_BYTES + 6]);
  expect(colors).toEqual([3, 3, 3, 3, 3, REGION_BASE, REGION_BASE, REGION_BASE, REGION_BASE]);
  const idx = lodIndices(pack, mesh.lods[0]!);
  expect(idx.length).toBe(36);
  expect(Math.max(...new Uint16Array(idx.slice().buffer))).toBe(8);

  // The 90 degree turn on the low-detail node maps +X to -Z.
  const low = lodVertices(pack, mesh.lods[1]!);
  const lv = new DataView(low.buffer, low.byteOffset, low.byteLength);
  expect(lv.getInt16(VERTEX_BYTES + 4, true)).toBe(-32767);
});

test("the core pack has a mesh for every graybox definition and rejects damaged files", () => {
  const file = buildCorePack();
  const pack = parsePack(file);
  for (const id of [MISSING_MESH, "core:wall", "core:survivor", "core:slab"]) expect(pack.meshIndex.has(id)).toBe(true);
  const wall = pack.header.meshes[pack.meshIndex.get("core:wall")!]!;
  expect(wall.half.map((v) => +v.toFixed(4))).toEqual([1.5, 1.5, 0.1]);
  expect(wall.lods[0]!.indexCount).toBe(36);
  const survivor = pack.header.meshes[pack.meshIndex.get("core:survivor")!]!;
  expect(survivor.center[1]).toBeCloseTo(0.9, 4); // stands on its origin
  expect(pack.palette.length).toBe(1024);

  expect(() => parsePack(file.subarray(0, 40))).toThrow();
  const bad = file.slice();
  bad[0] = 0;
  expect(() => parsePack(bad)).toThrow(/magic/);
  const future = file.slice();
  future[4] = 9;
  expect(() => parsePack(future)).toThrow(/version/);
});
