// The mesh simplifier: coarser levels keep the shape, the outline of each colour, and the bone of every vertex.
import { expect, test } from "bun:test";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePackBytes, frozenPack } from "../fixtures/pack.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { measureSurface } from "../../tools/art/check.ts";
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

/**
 * A closed flat ring half a millimetre thick, 0.58 m across, at height 0.5, `sides` round, beside twelve solid 4 cm
 * crumbs: a wheel's disc among bolts, as a vehicle's parts are.
 */
function ringAndCrumbs(sides: number): SourceLod {
  const positions: number[] = [];
  const indices: number[] = [];
  // Four rings, outer top, inner top, inner bottom, outer bottom, each joined to the next by a band.
  for (const [r, y] of [[0.29, 0.50025], [0.2, 0.50025], [0.2, 0.49975], [0.29, 0.49975]] as const) {
    for (let i = 0; i < sides; i++) positions.push(r * Math.cos((i / sides) * Math.PI * 2), y, r * Math.sin((i / sides) * Math.PI * 2));
  }
  for (let k = 0; k < 4; k++) {
    const [a, b] = [k * sides, ((k + 1) % 4) * sides];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      indices.push(a + i, a + j, b + i, b + i, a + j, b + j);
    }
  }
  for (let c = 0; c < 12; c++) {
    const cube = boxMesh([0.02, 0.02, 0.02], 4);
    const base = positions.length / 3;
    for (let v = 0; v < cube.positions.length; v += 3) positions.push(cube.positions[v]! - 0.55 + c * 0.1, cube.positions[v + 1]!, cube.positions[v + 2]!);
    indices.push(...cube.indices.map((i) => i + base));
  }
  return { positions: Float32Array.from(positions), colors: new Uint8Array(positions.length / 3).fill(4), indices: Uint32Array.from(indices) };
}

test("held, a thin part keeps its extent where it would have shrunk, and nothing turns over", () => {
  const fine = ringAndCrumbs(28);
  /** How far across what is left of the ring reaches, and how many triangles it keeps. */
  const ring = (lod: SourceLod): [number, number] => {
    let [lo, hi, kept] = [Infinity, -Infinity, 0];
    for (let t = 0; t < lod.indices.length; t += 3) {
      const corners = [0, 1, 2].map((k) => lod.indices[t + k]! * 3);
      if (!corners.every((v) => lod.positions[v + 1]! > 0.3)) continue;
      kept++;
      for (const v of corners) [lo, hi] = [Math.min(lo, lod.positions[v]!), Math.max(hi, lod.positions[v]!)];
    }
    return [hi - lo, kept];
  };
  const [loose] = simplify(fine, [120]);
  const [held] = simplify(fine, [120], [], true);
  // Without, the rim's points slide round onto each other for almost nothing and the ring draws in.
  expect(ring(loose!.lod)[0]).toBeLessThan(0.55);
  // Held, its furthest points along the axes stay where they were, and it keeps at least the triangles it had.
  expect(ring(held!.lod)[0]).toBeCloseTo(0.58, 4);
  expect(ring(held!.lod)[1]).toBeGreaterThanOrEqual(ring(loose!.lod)[1]);
  for (const made of [loose!, held!]) {
    expect(tris(made.lod)).toBe(120);
    const facts = measureSurface(made.lod);
    expect([facts.parts, facts.holes, facts.flipped, facts.insideOut]).toEqual([13, 0, 0, 0]);
  }
  // Asked not to, it makes the levels it always made.
  expect(simplify(fine, [120], [], false)[0]!.lod).toEqual(loose!.lod);
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
  const legacy = unpackMeshes(frozenPack()).filter(m => m.id === "core:raptor" || m.id === "core:parasaur");
  expect(legacy.map(m => m.id).sort()).toEqual(["core:parasaur", "core:raptor"]);
  for (const mesh of legacy) {
    const again = simplify(mesh.lods[0]!, mesh.lods.slice(1).map(tris));
    for (const [i, made] of again.entries()) {
      for (const part of ["positions", "colors", "bones", "indices"] as const) expect([mesh.id, i, part, made.lod[part]]).toEqual([mesh.id, i, part, mesh.lods[i + 1]![part]]);
    }
  }
});

artTest("the native Parasaur streams seven decreasing body meshes across its textured and flat levels", () => {
  const pack = parsePack(corePackBytes());
  const mesh = pack.header.meshes[pack.meshIndex.get("core:parasaur")!]!;
  expect(mesh.lods.length).toBe(7);
  expect(mesh.flat!).toBeGreaterThan(0);
  expect(mesh.flat!).toBeLessThan(7);
  for (const [level, lod] of mesh.lods.entries()) {
    expect((lod.sections?.length ?? 0) > 0).toBe(level < mesh.flat!);
    if (level > 0) {
      expect(lod.indexCount).toBeLessThan(mesh.lods[level - 1]!.indexCount);
      expect(lod.error).toBeGreaterThan(mesh.lods[level - 1]!.error);
    }
  }
});
