// The mesh simplifier: coarser levels keep the shape, the outline of each colour, and the bone of every vertex.
import { expect, test } from "bun:test";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { surfaceError } from "../../tools/pack/error.ts";
import { FEWEST, simplify, withLevels } from "../../tools/pack/simplify.ts";
import { boxMesh, buildPack, unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";

/** A square of `n` by `n` cells, two metres across, lying flat. Its left half is colour 1 and its right half colour 2. */
function plate(n: number): SourceLod {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const at = positions.length / 3;
      for (const [u, v] of [[i, j], [i, j + 1], [i + 1, j], [i + 1, j + 1]] as const) {
        positions.push((u / n) * 2 - 1, 0, (v / n) * 2 - 1);
        colors.push(i < n / 2 ? 1 : 2);
      }
      indices.push(at, at + 1, at + 2, at + 2, at + 1, at + 3);
    }
  }
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) };
}

/** A ball of radius 1. Each vertex follows bone 1 above the middle and bone 2 below it. */
function ball(around: number, up: number): SourceLod {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= up; j++) {
    for (let i = 0; i < around; i++) {
      const [a, b] = [(i / around) * Math.PI * 2, (j / up) * Math.PI];
      positions.push(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a));
    }
  }
  for (let j = 0; j < up; j++) {
    for (let i = 0; i < around; i++) {
      const [a, b] = [j * around + i, j * around + ((i + 1) % around)];
      if (j > 0) indices.push(a, b, a + around);
      if (j < up - 1) indices.push(b, b + around, a + around);
    }
  }
  const p = Float32Array.from(positions);
  return { positions: p, colors: new Uint8Array(p.length / 3).fill(3), bones: Uint8Array.from({ length: p.length / 3 }, (_, v) => (p[v * 3 + 1]! >= 0 ? 1 : 2)), indices: Uint32Array.from(indices) };
}

const tris = (lod: SourceLod): number => lod.indices.length / 3;

test("a flat plate loses triangles and keeps its plane, its edge, and the line where its colour changes", () => {
  const fine = plate(16);
  const [half, least] = simplify(fine, [256, 16]);
  expect([tris(fine), tris(half!.lod) <= 256, tris(least!.lod) <= 16]).toEqual([512, true, true]);
  for (const made of [half!, least!]) {
    const { positions, colors, indices } = made.lod;
    expect(surfaceError(fine, made.lod)).toBeLessThan(1e-6);
    expect(made.moved).toBeLessThan(1e-6);
    let area = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3];
      // Twice the area, signed: every triangle still faces up, and together they still cover the square.
      const twice = (positions[b + 2]! - positions[a + 2]!) * (positions[c]! - positions[a]!) - (positions[b]! - positions[a]!) * (positions[c + 2]! - positions[a + 2]!);
      expect(twice).toBeGreaterThan(0);
      area += twice / 2;
      // A triangle is the colour of the half its middle is in.
      const middle = (positions[a]! + positions[b]! + positions[c]!) / 3;
      expect(colors[indices[t + 2]!]).toBe(middle < 0 ? 1 : 2);
    }
    expect(area).toBeCloseTo(4, 6);
  }
});

test("a ball's levels lie further from it as they get coarser, by about what the simplifier says, on the bones they had", () => {
  const fine = ball(32, 16);
  const made = simplify(fine, [480, 240, 120]);
  expect(made.map((m) => tris(m.lod))).toEqual([480, 240, 120]);
  const errors = made.map((m) => surfaceError(fine, m.lod));
  expect(errors[0]!).toBeGreaterThan(0);
  expect(errors[1]!).toBeGreaterThan(errors[0]!);
  expect(errors[2]!).toBeGreaterThan(errors[1]!);
  expect(errors[2]!).toBeLessThan(0.08);
  for (const [i, m] of made.entries()) {
    // What the simplifier says it moved is the measured distance to within a few times, either way.
    expect(m.moved / errors[i]!).toBeGreaterThan(0.25);
    expect(m.moved / errors[i]!).toBeLessThan(8);
    // No point is new: each is a point of the ball, and above the middle it still follows bone 1.
    for (let v = 0; v < m.lod.bones!.length; v++) {
      const [x, y, z] = [m.lod.positions[v * 3]!, m.lod.positions[v * 3 + 1]!, m.lod.positions[v * 3 + 2]!];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(m.lod.bones![v]).toBe(y >= 0 ? 1 : 2);
    }
  }
});

artTest("a mesh with one level gets more only if it has the triangles for them, and a creature that brings one gets five", () => {
  const box = withLevels({ id: "t:box", lods: [boxMesh([1, 1, 1], 3)] });
  expect(box.lods.length).toBe(1);
  expect(withLevels({ id: "t:small", lods: [ball(8, 6)] }).lods.map(tris)).toEqual([80]);
  expect(FEWEST).toBe(48);
  const round = withLevels({ id: "t:ball", lods: [ball(32, 16)] });
  expect(round.lods.map(tris)).toEqual([960, 480, 240, 120, 60]);
  expect(round.lods.map((l) => l.error === undefined)).toEqual([true, false, false, false, false]);
  expect(round.lods[2]!.error).toBe(surfaceError(round.lods[0]!, round.lods[2]!));
  // Levels a mesh came with are left as they are.
  const given = { id: "t:given", lods: [ball(32, 16), ball(8, 6)] };
  expect(withLevels(given)).toBe(given);
  // The levels are kept by the pack, with what was measured.
  const packed = parsePack(buildPack([round], defaultPalette())).header.meshes[0]!;
  expect(packed.lods.map((l) => l.indexCount / 3)).toEqual([960, 480, 240, 120, 60]);
  expect(packed.lods[4]!.error).toBeCloseTo(round.lods[4]!.error!, 4);

  // A creature converted from a model as it came has one level of its own, so the rest are ours.
  const core = parsePack(corePackBytes());
  for (const { id, spec } of CREATURE_ASSETS) {
    if (!("raw" in spec.source)) continue;
    const mesh = core.header.meshes[core.meshIndex.get(id)!]!;
    expect([id, mesh.lods.length]).toEqual([id, 5]);
    for (let l = 1; l < 5; l++) {
      expect(mesh.lods[l]!.indexCount).toBeLessThanOrEqual(mesh.lods[l - 1]!.indexCount * 0.51);
      expect(mesh.lods[l]!.error).toBeGreaterThan(mesh.lods[l - 1]!.error);
    }
    // Half the triangles within a hundredth of the creature's length.
    expect(mesh.lods[1]!.error).toBeLessThan(mesh.half[2] * 2 * 0.01);
  }
  // The levels in the pack were made before the simplifier learned to keep a surface. It still makes those very levels
  // of a mesh that has none, vertex for vertex.
  const ours = CREATURE_ASSETS.filter(({ spec }) => "raw" in spec.source).map(({ id }) => id);
  expect(ours.length).toBeGreaterThanOrEqual(2);
  for (const mesh of unpackMeshes(core).filter((m) => ours.includes(m.id))) {
    const again = simplify(mesh.lods[0]!, mesh.lods.slice(1).map(tris));
    for (const [i, made] of again.entries()) {
      for (const part of ["positions", "colors", "bones", "indices"] as const) expect([mesh.id, i, part, made.lod[part]]).toEqual([mesh.id, i, part, mesh.lods[i + 1]![part]]);
    }
  }
});
