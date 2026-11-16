// Levels ordered for the vertex cache and then for fetching, with nothing drawn differently.
import { expect, test } from "bun:test";
import { MATERIAL_CUTOUT, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, lodSkin, lodSurface, lodVertices, parsePack, readIndices, type Pack, type PackLod } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { cacheOrder, fetchOrder, missRatio, orderPack } from "../../tools/pack/order.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { TUBE_RIG, tubeClips, tubeMesh } from "../fixtures/textured.ts";

/** A grid of `n` by `n` quads, two triangles each, in an order shuffled by `seed`. */
function shuffledGrid(n: number, seed: number): Uint32Array {
  const tris: number[][] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      tris.push([a, a + 1, a + n + 2], [a, a + n + 2, a + n + 1]);
    }
  }
  const rng = new Rng(seed);
  for (let i = tris.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [tris[i], tris[j]] = [tris[j]!, tris[i]!];
  }
  return Uint32Array.from(tris.flat());
}

const triangles = (indices: ArrayLike<number>, from: ArrayLike<number> = { length: 0 }): string[] =>
  Array.from({ length: indices.length / 3 }, (_, t) => [0, 1, 2].map((c) => (from.length ? from[indices[t * 3 + c]!]! : indices[t * 3 + c]!)).join(",")).sort();

test("a shuffled grid ordered for the cache misses near the least it can, keeps every triangle as it was wound, and has its vertices in the order first used", () => {
  const n = 24;
  const verts = (n + 1) * (n + 1);
  const indices = shuffledGrid(n, 3);
  const was = triangles(indices);
  expect(missRatio(indices, verts)).toBeGreaterThan(2.5);
  cacheOrder(indices, 0, indices.length, verts);
  // Each vertex has to be fetched once: 625 for 1,152 triangles is 0.54 a triangle.
  expect(missRatio(indices, verts)).toBeLessThan(0.75);
  expect(triangles(indices)).toEqual(was);
  const from = fetchOrder(indices, verts);
  expect(triangles(indices, from)).toEqual(was);
  let next = 0;
  for (const v of indices) {
    expect(v).toBeLessThanOrEqual(next);
    if (v === next) next++;
  }
  expect([next, [...from].sort((a, b) => a - b)]).toEqual([verts, Array.from({ length: verts }, (_, v) => v)]);
});

/** Each triangle of a run as the bytes of its three corners: vertex, surface and skin. In the order drawn unless `sorted`. */
function corners(pack: Pack, lod: PackLod, first: number, count: number, sorted = true): string[] {
  const ix = readIndices(pack, lod);
  const [v, s, k] = [lodVertices(pack, lod), lodSurface(pack, lod), lodSkin(pack, lod)];
  const corner = (i: number): string => [...v.subarray(i * VERTEX_BYTES, (i + 1) * VERTEX_BYTES), ...(s?.subarray(i * SURFACE_BYTES, (i + 1) * SURFACE_BYTES) ?? []), ...(k?.subarray(i * SKIN_BYTES, (i + 1) * SKIN_BYTES) ?? [])].join(".");
  const out: string[] = [];
  for (let t = first; t < first + count; t += 3) out.push([0, 1, 2].map((c) => corner(ix[t + c]!)).join("|"));
  return sorted ? out.sort() : out;
}

/** The tube with its horn cut out, and a box: one flat level, its 8 corners each written for 3 faces. */
function cutPack(): Uint8Array {
  const tube = tubeMesh();
  tube.materials![1]!.flags |= MATERIAL_CUTOUT;
  return buildPack([tube, { id: "test:box", lods: [boxMesh([0.5, 1, 0.25], 7)] }], defaultPalette(), tubeClips(), [TUBE_RIG]);
}

test("a pack ordered draws the same triangles in each run, a cut-out run's in the order they came, and a flat level from welded vertices", () => {
  const before = parsePack(cutPack());
  const after = parsePack(orderPack(cutPack()));
  const cut = (m: number): boolean => (before.header.materials![m]!.flags & MATERIAL_CUTOUT) !== 0;
  expect(before.header.materials!.map((m) => m.flags & MATERIAL_CUTOUT)).toEqual([0, MATERIAL_CUTOUT]);
  const fetched: number[][] = [];
  before.header.meshes.forEach((mesh, i) => {
    mesh.lods.forEach((lod, l) => {
      const now = after.header.meshes[i]!.lods[l]!;
      const [was, is] = [missRatio(readIndices(before, lod), lod.vertexCount), missRatio(readIndices(after, now), now.vertexCount)];
      if (!lod.sections) {
        expect(corners(after, now, 0, now.indexCount)).toEqual(corners(before, lod, 0, lod.indexCount));
        const kept = new Set(Array.from({ length: now.vertexCount }, (_, v) => lodVertices(after, now).subarray(v * VERTEX_BYTES, (v + 1) * VERTEX_BYTES).join(".")));
        expect(kept.size).toBe(now.vertexCount);
        fetched.push([lod.vertexCount, now.vertexCount, Math.sign(is - was)]);
        return;
      }
      expect([now.vertexCount, now.sections]).toEqual([lod.vertexCount, lod.sections]);
      for (let k = 0; k < lod.sections.length; k += 3) {
        const [m, first, count] = [lod.sections[k]!, lod.sections[k + 1]!, lod.sections[k + 2]!];
        // A cut-out run is drawn a share at a time from its start, which the writer made its best seen.
        expect(corners(after, now, first, count, !cut(m))).toEqual(corners(before, lod, first, count, !cut(m)));
      }
      expect(is).toBeLessThan(was);
    });
  });
  // The box is its 8 corners; the tube's coarsest level welds only at the seam of the horn, which is one colour.
  expect(fetched).toEqual([[24, 8, -1], [30, 28, -1]]);
  // The same pack in gives the same bytes out.
  expect(orderPack(cutPack())).toEqual(orderPack(cutPack()));
});
