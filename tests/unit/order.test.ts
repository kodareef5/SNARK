// Levels drawn with materials ordered for the vertex cache and then for fetching, with nothing drawn differently.
import { expect, test } from "bun:test";
import { SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, lodSkin, lodSurface, lodVertices, parsePack, readIndices, type Pack, type PackLod } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { cacheOrder, fetchOrder, missRatio, orderPack } from "../../tools/pack/order.ts";
import { tubePack } from "../fixtures/textured.ts";

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

/** Each triangle of a run as the bytes of its three corners: vertex, surface and skin. */
function corners(pack: Pack, lod: PackLod, first: number, count: number): string[] {
  const ix = readIndices(pack, lod);
  const [v, s, k] = [lodVertices(pack, lod), lodSurface(pack, lod), lodSkin(pack, lod)];
  const corner = (i: number): string => [...v.subarray(i * VERTEX_BYTES, (i + 1) * VERTEX_BYTES), ...(s?.subarray(i * SURFACE_BYTES, (i + 1) * SURFACE_BYTES) ?? []), ...(k?.subarray(i * SKIN_BYTES, (i + 1) * SKIN_BYTES) ?? [])].join(".");
  const out: string[] = [];
  for (let t = first; t < first + count; t += 3) out.push([0, 1, 2].map((c) => corner(ix[t + c]!)).join("|"));
  return out.sort();
}

test("a pack ordered draws the same triangles in each run, with a flat level byte for byte as it was", () => {
  const before = parsePack(tubePack());
  const after = parsePack(orderPack(tubePack()));
  expect(after.header).toEqual(before.header);
  const mesh = before.header.meshes[0]!;
  mesh.lods.forEach((lod, l) => {
    const now = after.header.meshes[0]!.lods[l]!;
    if (!lod.sections) {
      expect(lodVertices(after, now)).toEqual(lodVertices(before, lod));
      expect(readIndices(after, now)).toEqual(readIndices(before, lod));
      return;
    }
    for (let k = 0; k < lod.sections.length; k += 3) expect(corners(after, now, lod.sections[k + 1]!, lod.sections[k + 2]!)).toEqual(corners(before, lod, lod.sections[k + 1]!, lod.sections[k + 2]!));
    expect(missRatio(readIndices(after, now), now.vertexCount)).toBeLessThan(missRatio(readIndices(before, lod), lod.vertexCount));
  });
  // The same pack in gives the same bytes out.
  expect(orderPack(tubePack())).toEqual(orderPack(tubePack()));
});
