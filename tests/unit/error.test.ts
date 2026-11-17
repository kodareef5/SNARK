// How far two levels lie apart, found through a grid of cells: the same answer as trying every triangle.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePack } from "../../shared/pack/pack.ts";
import { isNode } from "../../tools/art/assets.ts";
import { filesUnder } from "../../tools/art/source.ts";
import { SLOW_MOST, slowSurfaceError, surfaceError, toTriangle } from "../../tools/pack/error.ts";
import { simplify } from "../../tools/pack/simplify.ts";
import { boxMesh, unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";
import { ASSETS } from "../fixtures/assets.ts";
import { tubeMesh } from "../fixtures/textured.ts";

test("packed triangles collapsed to segments or points have finite, order-independent distances", () => {
  // Actual packed cruise cell 0183: the first two corners coincide after quantization.
  const collapsed = Float32Array.from([8, 4.799951076507568, 4.884670734405518, 8, 4.799951076507568, 4.884670734405518, 8, 6.699911594390869, 2.3267312049865723]);
  const orders = [[0, 3, 6], [0, 6, 3], [3, 0, 6], [3, 6, 0], [6, 0, 3], [6, 3, 0]];
  for (const [a, b, c] of orders) expect(toTriangle(-8, 4.799951076507568, 2.941251754760742, collapsed, a!, b!, c!)).toBeCloseTo(16.041909582621248, 12);
  const line = Float32Array.from([0, 0, 0, 1, 0, 0, 3, 0, 0]);
  for (const [a, b, c] of orders) {
    expect(toTriangle(2, 4, 0, line, a!, b!, c!)).toBe(4);
    expect(toTriangle(-3, 4, 0, line, a!, b!, c!)).toBe(5);
    expect(toTriangle(6, 4, 0, line, a!, b!, c!)).toBe(5);
  }
  expect(toTriangle(3, 4, 0, new Float32Array(9), 0, 3, 6)).toBe(5);
  const box = boxMesh([0.5, 1, 2], 1);
  for (const positions of [collapsed, line, new Float32Array(9)]) {
    const degenerate: SourceLod = { positions, colors: new Uint8Array(3), indices: Uint32Array.from([0, 1, 2]) };
    const actual = surfaceError(box, degenerate);
    expect(Number.isFinite(actual)).toBe(true);
    expect(actual).toBe(slowSurfaceError(box, degenerate));
    expect(surfaceError(degenerate, box)).toBe(actual);
  }
});

test("the distance between two levels is exactly what trying every triangle gives, on the meshes there are", () => {
  // Every modelled mesh small enough to try the slow way: the building pieces, the bodies, the examples and the creatures'
  // coarser levels. A node pack's crowns and cards are tried by `bun run art -- <id> --check`: they are many, and more
  // with every tree, plant or rock.
  const packs = [...ASSETS.filter((a) => !isNode(a)).map((a) => a.file), ...filesUnder(join(import.meta.dir, "../../tools/blender/example"), ".snpk")];
  const meshes = [...packs.flatMap((file) => unpackMeshes(parsePack(new Uint8Array(readFileSync(file))))), tubeMesh()];
  let pairs = 0;
  for (const mesh of meshes) {
    for (let level = 1; level < mesh.lods.length; level++) {
      const [fine, coarse] = [mesh.lods[level - 1]!, mesh.lods[level]!];
      if (fine.indices.length / 3 > SLOW_MOST) continue;
      expect([mesh.id, level, surfaceError(fine, coarse)]).toEqual([mesh.id, level, slowSurfaceError(fine, coarse)]);
      pairs++;
    }
  }
  expect(pairs).toBeGreaterThan(20);
});

test("it holds for levels that lie apart, for a single triangle and for a flat sheet", () => {
  const box = boxMesh([0.5, 1, 2], 1);
  const moved = (lod: SourceLod, by: number): SourceLod => ({ ...lod, positions: lod.positions.map((v, i) => (i % 3 === 0 ? v + by : v)) });
  // A point far outside the other's cells still finds its nearest triangle.
  for (const by of [0, 0.3, 7, -40]) expect(surfaceError(box, moved(box, by))).toBe(slowSurfaceError(box, moved(box, by)));
  const one: SourceLod = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), colors: new Uint8Array(3), indices: Uint32Array.from([0, 1, 2]) };
  expect([surfaceError(box, one), surfaceError(one, one)]).toEqual([slowSurfaceError(box, one), slowSurfaceError(one, one)]);
  // A fine, lumpy sheet against what the simplifier makes of it: many cells, and triangles of very different sizes.
  const n = 24;
  const sheet: SourceLod = { positions: new Float32Array((n + 1) * (n + 1) * 3), colors: new Uint8Array((n + 1) * (n + 1)), indices: new Uint32Array(n * n * 6) };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) sheet.positions.set([i / n, 0.05 * Math.sin(i * 0.9) * Math.sin(j * 0.7), j / n], (j * (n + 1) + i) * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) sheet.indices.set([j * (n + 1) + i, (j + 1) * (n + 1) + i, j * (n + 1) + i + 1, j * (n + 1) + i + 1, (j + 1) * (n + 1) + i, (j + 1) * (n + 1) + i + 1], (j * n + i) * 6);
  for (const made of simplify(sheet, [400, 100, 20])) expect(surfaceError(sheet, made.lod)).toBe(slowSurfaceError(sheet, made.lod));
});
