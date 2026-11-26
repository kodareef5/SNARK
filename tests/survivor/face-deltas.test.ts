import { expect, test } from "bun:test";
import { FACE_COUNT, defaultLook, faceOf, setFace } from "../../shared/anim/look.ts";
import { blendFace, decodeFaces, encodeFaces, faceValues, remapFaces, sideStep, type FaceSide, type FaceTable } from "../../shared/people/faces.ts";
import { Rng } from "../../shared/rng.ts";

/** A table of `modifiers` modifiers on `count` vertices, each side moving a random few by up to `most` metres. */
function randomTable(seed: number, count: number, modifiers: number, most = 0.012): FaceTable {
  const rng = new Rng(seed);
  const side = (): FaceSide => {
    const vertices: number[] = [];
    // None in the middle third, so a gap needs two varint bytes when there are over 384.
    for (let v = 0; v < count; v++) if (rng.float() < 0.3 && (v < count / 3 || v > (count * 2) / 3)) vertices.push(v);
    return { vertices: Uint32Array.from(vertices), deltas: Float32Array.from({ length: vertices.length * 3 }, () => rng.range(-most, most)) };
  };
  return { vertexCount: count, modifiers: Array.from({ length: modifiers }, () => ({ minus: side(), plus: side() })) };
}

test("a face table comes back within half a step of every delta", () => {
  const table = randomTable(1, 400, FACE_COUNT);
  const back = decodeFaces(encodeFaces(table));
  expect(back.vertexCount).toBe(table.vertexCount);
  expect(back.modifiers.length).toBe(table.modifiers.length);
  table.modifiers.forEach((m, i) => {
    for (const which of ["minus", "plus"] as const) {
      const a = m[which], b = back.modifiers[i]![which];
      const step = sideStep(a);
      const at = new Map([...b.vertices].map((v, k) => [v, k]));
      for (let e = 0; e < a.vertices.length; e++) {
        const k = at.get(a.vertices[e]!);
        for (let c = 0; c < 3; c++) {
          const got = k === undefined ? 0 : b.deltas[k * 3 + c]!;
          expect(Math.abs(got - a.deltas[e * 3 + c]!)).toBeLessThanOrEqual(step / 2 + 1e-9);
        }
      }
      for (let k = 1; k < b.vertices.length; k++) expect(b.vertices[k]!).toBeGreaterThan(b.vertices[k - 1]!);
    }
  });
});

test("moves that round to no step are left out and the bytes repeat", () => {
  const table: FaceTable = {
    vertexCount: 10,
    modifiers: [{ minus: { vertices: Uint32Array.of(2, 5, 9), deltas: Float32Array.of(0.01, 0, 0, 1e-6, -1e-6, 0, 0, 0, -0.005) }, plus: { vertices: new Uint32Array(), deltas: new Float32Array() } }],
  };
  const bytes = encodeFaces(table);
  expect([...decodeFaces(bytes).modifiers[0]!.minus.vertices]).toEqual([2, 9]);
  expect(decodeFaces(bytes).modifiers[0]!.plus.vertices.length).toBe(0);
  expect(encodeFaces(table)).toEqual(bytes);
  expect(encodeFaces(decodeFaces(bytes))).toEqual(bytes);
});

test("a cut-short or foreign face table is refused", () => {
  const bytes = encodeFaces(randomTable(2, 50, 3));
  expect(() => decodeFaces(bytes.subarray(0, bytes.length - 1))).toThrow();
  expect(() => decodeFaces(Uint8Array.of(...bytes, 0))).toThrow();
  const other = bytes.slice();
  other[0] = 0;
  expect(() => decodeFaces(other)).toThrow();
});

test("a face sums each modifier's side by its value's sign and size", () => {
  const table: FaceTable = {
    vertexCount: 3,
    modifiers: [
      { minus: { vertices: Uint32Array.of(0), deltas: Float32Array.of(1, 0, 0) }, plus: { vertices: Uint32Array.of(1), deltas: Float32Array.of(0, 2, 0) } },
      { minus: { vertices: Uint32Array.of(1), deltas: Float32Array.of(0, 0, 4) }, plus: { vertices: Uint32Array.of(2), deltas: Float32Array.of(8, 0, 0) } },
    ],
  };
  const base = Float32Array.of(0, 0, 0, 1, 1, 1, 2, 2, 2);
  expect([...blendFace(table, [0, 0], base, new Float32Array(9))]).toEqual([...base]);
  expect([...blendFace(table, [0.5, -0.25], base, new Float32Array(9))]).toEqual([0, 0, 0, 1, 2, 2, 2, 2, 2]);
  expect([...blendFace(table, [-1, 1], base, new Float32Array(9))]).toEqual([1, 0, 0, 1, 1, 1, 10, 2, 2]);
  const inPlace = base.slice();
  blendFace(table, [-1, 0], inPlace, inPlace);
  expect([...inPlace]).toEqual([1, 0, 0, 1, 1, 1, 2, 2, 2]);
});

test("face values read a look's face bytes as look.ts does", () => {
  const look = defaultLook();
  const rng = new Rng(3);
  for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, rng.range(-1, 1));
  const values = faceValues(look);
  for (let f = 0; f < FACE_COUNT; f++) expect(values[f]).toBeCloseTo(faceOf(look, f), 6);
});

test("a table follows its vertices onto a mesh that splits and drops them", () => {
  const table = randomTable(4, 6, 2, 0.01);
  // New vertex 0 is old 5, 1 and 2 are old 1 split at a seam, 3 is new, 4 is old 0.
  const sourceOf = Int32Array.of(5, 1, 1, -1, 0);
  const moved = remapFaces(table, sourceOf);
  const oldBase = new Float32Array(18), newBase = new Float32Array(15);
  const values = [0.7, -0.4];
  const oldFace = blendFace(table, values, oldBase, new Float32Array(18));
  const newFace = blendFace(moved, values, newBase, new Float32Array(15));
  sourceOf.forEach((from, v) => {
    for (let c = 0; c < 3; c++) expect(newFace[v * 3 + c]).toBe(from < 0 ? 0 : oldFace[from * 3 + c]!);
  });
});
