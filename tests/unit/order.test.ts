// Levels ordered for the vertex cache and then for fetching, with nothing drawn differently.
import { expect, test } from "bun:test";
import { MATERIAL_CUTOUT, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, lodSkin, lodSurface, lodVertices, parsePack, readIndices, type Pack, type PackLod } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { cacheOrder, fetchOrder, missRatio, orderPack } from "../../tools/pack/order.ts";
import { boxMesh, buildPack, type SourceMesh } from "../../tools/pack/write.ts";
import { squareMesh } from "../fixtures/stage.ts";
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

/**
 * Six cut-out cards in a row, of sizes the writer ranks otherwise than they came, each with corners of its own: every
 * other one a grid of 2 by 2 quads, whose middle corner is shared more, so the cache would take the others first.
 */
function cards(): SourceMesh {
  const mesh = squareMesh("test:cards", 1, ["base"], { flags: MATERIAL_CUTOUT, cutoff: 0.5 });
  const [positions, uvs, indices]: number[][] = [[], [], []];
  [0.3, 1.2, 0.6, 0.9, 0.45, 1.5].forEach((s, k) => {
    const across = 1 + (k % 2);
    const first = positions.length / 3;
    for (let j = 0; j <= across; j++) for (let i = 0; i <= across; i++) positions.push(2 * k + (s * i) / across, (s * j) / across, 0), uvs.push(i / across, 1 - j / across);
    for (let j = 0; j < across; j++) {
      for (let i = 0; i < across; i++) {
        const a = first + j * (across + 1) + i;
        indices.push(a, a + 1, a + across + 2, a, a + across + 2, a + across + 1);
      }
    }
  });
  const n = positions.length / 3;
  mesh.lods = [{ positions: Float32Array.from(positions), colors: new Uint8Array(n).fill(15), indices: Uint32Array.from(indices), uvs: Float32Array.from(uvs), normals: Float32Array.from({ length: n * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0)) }];
  return mesh;
}

/** The tube with its horn cut out, the cards, and a box: one flat level, its 8 corners each written for 3 faces. */
function cutPack(): Uint8Array {
  const tube = tubeMesh();
  tube.materials![1]!.flags |= MATERIAL_CUTOUT;
  return buildPack([tube, cards(), { id: "test:box", lods: [boxMesh([0.5, 1, 0.25], 7)] }], defaultPalette(), tubeClips(), [TUBE_RIG]);
}

/** Which card each triangle of the cards is part of, in the order drawn. */
function cardsOf(pack: Pack): number[] {
  const mesh = pack.header.meshes[pack.meshIndex.get("test:cards")!]!;
  const lod = mesh.lods[0]!;
  const [ix, v] = [readIndices(pack, lod), lodVertices(pack, lod)];
  const x = (i: number): number => mesh.center[0] + (new DataView(v.buffer, v.byteOffset).getInt16(i * VERTEX_BYTES, true) / 32767) * mesh.half[0];
  return Array.from({ length: lod.indexCount / 3 }, (_, t) => Math.floor(x(ix[t * 3]!) / 2 + 0.1));
}

test("a pack ordered draws the same triangles in each run, a cut-out run's sprays in the order the writer ranked them, and a flat level from welded vertices", () => {
  const before = parsePack(cutPack());
  const after = parsePack(orderPack(cutPack()));
  const fetched: (string | number)[][] = [];
  before.header.meshes.forEach((mesh, i) => {
    mesh.lods.forEach((lod, l) => {
      const now = after.header.meshes[i]!.lods[l]!;
      const [was, is] = [missRatio(readIndices(before, lod), lod.vertexCount), missRatio(readIndices(after, now), now.vertexCount)];
      fetched.push([mesh.id, lod.vertexCount, now.vertexCount, Math.sign(is - was)]);
      if (!lod.sections) {
        expect(corners(after, now, 0, now.indexCount)).toEqual(corners(before, lod, 0, lod.indexCount));
        const kept = new Set(Array.from({ length: now.vertexCount }, (_, v) => lodVertices(after, now).subarray(v * VERTEX_BYTES, (v + 1) * VERTEX_BYTES).join(".")));
        expect(kept.size).toBe(now.vertexCount);
        return;
      }
      expect(now.sections).toEqual(lod.sections);
      for (let k = 0; k < lod.sections.length; k += 3) expect(corners(after, now, lod.sections[k + 1]!, lod.sections[k + 2]!)).toEqual(corners(before, lod, lod.sections[k + 1]!, lod.sections[k + 2]!));
    });
  });
  // The box is its 8 corners; the tube's coarsest level welds only at the seam of the horn, which is one colour. The
  // tube's levels with materials, horn and all, fetch fewer vertices.
  expect(fetched.filter((row) => row[0] !== "test:cards")).toEqual([["test:box", 24, 8, -1], ["test:tube", 306, 306, -1], ["test:tube", 90, 90, -1], ["test:tube", 30, 28, -1]]);
  // The frame budget draws a first share of a cut-out run: the cards, largest first as the writer put them, stay so.
  const ranked = cardsOf(before);
  expect([ranked.filter((c, t) => c !== ranked[t - 1]), cardsOf(after)]).toEqual([[5, 1, 3, 2, 4, 0], ranked]);
  // The same pack in gives the same bytes out.
  expect(orderPack(cutPack())).toEqual(orderPack(cutPack()));
});
