// How far two levels lie apart, found through a grid of cells: the same answer as trying every triangle.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePack } from "../../shared/pack/pack.ts";
import { filesUnder, readPacks } from "../../tools/art/source.ts";
import { ERROR_SHARE, surfaceError, toTriangle } from "../../tools/pack/error.ts";
import { simplify } from "../../tools/pack/simplify.ts";
import { boxMesh, unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";
import { tubeMesh } from "../fixtures/textured.ts";

/** surfaceError as it was first written: every point against every triangle. */
function plain(fine: SourceLod, coarse: SourceLod): number {
  const distances = (from: SourceLod, to: SourceLod): Float64Array => {
    const p = from.positions;
    const out: number[] = [];
    const near = (x: number, y: number, z: number): void => {
      let best = Infinity;
      for (let i = 0; i < to.indices.length; i += 3) best = Math.min(best, toTriangle(x, y, z, to.positions, to.indices[i]! * 3, to.indices[i + 1]! * 3, to.indices[i + 2]! * 3));
      out.push(best);
    };
    for (let v = 0; v < p.length; v += 3) near(p[v]!, p[v + 1]!, p[v + 2]!);
    for (let i = 0; i < from.indices.length; i += 3) {
      const [a, b, c] = [from.indices[i]! * 3, from.indices[i + 1]! * 3, from.indices[i + 2]! * 3];
      near((p[a]! + p[b]! + p[c]!) / 3, (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3, (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3);
    }
    return Float64Array.from(out).sort();
  };
  const at = (d: Float64Array): number => d[Math.min(d.length - 1, Math.floor(d.length * ERROR_SHARE))]!;
  return Math.max(at(distances(coarse, fine)), at(distances(fine, coarse)));
}

test("the distance between two levels is exactly what trying every triangle gives, on the meshes there are", () => {
  // Every modelled mesh small enough to try the slow way: the building pieces, the examples and the creatures' coarser levels.
  const meshes = [...readPacks().meshes, ...filesUnder(join(import.meta.dir, "../../tools/blender/example"), ".snpk").flatMap((file) => unpackMeshes(parsePack(new Uint8Array(readFileSync(file))))), tubeMesh()];
  let pairs = 0;
  for (const mesh of meshes) {
    for (let level = 1; level < mesh.lods.length; level++) {
      const [fine, coarse] = [mesh.lods[level - 1]!, mesh.lods[level]!];
      if (fine.indices.length / 3 > 800) continue;
      expect([mesh.id, level, surfaceError(fine, coarse)]).toEqual([mesh.id, level, plain(fine, coarse)]);
      pairs++;
    }
  }
  expect(pairs).toBeGreaterThan(20);
});

test("it holds for levels that lie apart, for a single triangle and for a flat sheet", () => {
  const box = boxMesh([0.5, 1, 2], 1);
  const moved = (lod: SourceLod, by: number): SourceLod => ({ ...lod, positions: lod.positions.map((v, i) => (i % 3 === 0 ? v + by : v)) });
  // A point far outside the other's cells still finds its nearest triangle.
  for (const by of [0, 0.3, 7, -40]) expect(surfaceError(box, moved(box, by))).toBe(plain(box, moved(box, by)));
  const one: SourceLod = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), colors: new Uint8Array(3), indices: Uint32Array.from([0, 1, 2]) };
  expect([surfaceError(box, one), surfaceError(one, one)]).toEqual([plain(box, one), plain(one, one)]);
  // A fine, lumpy sheet against what the simplifier makes of it: many cells, and triangles of very different sizes.
  const n = 24;
  const sheet: SourceLod = { positions: new Float32Array((n + 1) * (n + 1) * 3), colors: new Uint8Array((n + 1) * (n + 1)), indices: new Uint32Array(n * n * 6) };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) sheet.positions.set([i / n, 0.05 * Math.sin(i * 0.9) * Math.sin(j * 0.7), j / n], (j * (n + 1) + i) * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) sheet.indices.set([j * (n + 1) + i, (j + 1) * (n + 1) + i, j * (n + 1) + i + 1, j * (n + 1) + i + 1, (j + 1) * (n + 1) + i, (j + 1) * (n + 1) + i + 1], (j * n + i) * 6);
  for (const made of simplify(sheet, [400, 100, 20])) expect(surfaceError(sheet, made.lod)).toBe(plain(sheet, made.lod));
});
