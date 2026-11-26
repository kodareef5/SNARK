import { describe, expect, test } from "bun:test";
import { bodyField, nearestOnTriangle, refitPiece, TriangleGrid, type Nearest, type RefitPiece } from "../../tools/pack/refit.ts";

/** A sphere of `r` about `c` in rings and segments, wound outward. */
function sphere(r: number, c: readonly number[] = [0, 0, 0], rings = 16, segments = 24): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j < segments; j++) {
    const th = (i / rings) * Math.PI, ph = (j / segments) * Math.PI * 2;
    positions.push(c[0]! + r * Math.sin(th) * Math.cos(ph), c[1]! + r * Math.cos(th), c[2]! + r * Math.sin(th) * Math.sin(ph));
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) {
    const a = i * segments + j, b = i * segments + ((j + 1) % segments), d = a + segments, e = b + segments;
    indices.push(a, b, d, b, e, d);
  }
  return { positions, indices };
}

const radius = (p: readonly number[], v: number, c: readonly number[]): number => Math.hypot(p[v * 3]! - c[0]!, p[v * 3 + 1]! - c[1]!, p[v * 3 + 2]! - c[2]!);

/** A body that is a sphere: its skin on `bone`, in slot `slot`. */
function body(r: number, bone: number, slot: number, c?: readonly number[]) {
  const s = sphere(r, c);
  const n = s.positions.length / 3;
  return { ...s, joints: Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? bone : 0)), weights: Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), slots: new Array(s.indices.length / 3).fill(slot) };
}

/** A piece of two shells, a lining at `inner` and the cloth at `outer`, all on bone 0 and in zone `zone`. */
function piece(inner: number, outer: number, zone: number): RefitPiece {
  const a = sphere(inner, [0, 0, 0], 12, 18), b = sphere(outer, [0, 0, 0], 12, 18);
  const positions = [...a.positions, ...b.positions];
  const n = positions.length / 3;
  return {
    positions, normals: new Array(n * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), indices: [...a.indices, ...b.indices.map((i) => i + a.positions.length / 3)],
    bones: new Array(n).fill(0), joints: new Array(n * 4).fill(0), weights: new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), zones: new Array((a.indices.length + b.indices.length) / 3).fill(zone),
  };
}

describe("refit", () => {
  test("the nearest point of a triangle is found inside, on an edge and at a corner", () => {
    const p = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const out: Nearest = { triangle: 0, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
    nearestOnTriangle(p, 0, 3, 6, 0.2, 0.2, 0.5, out);
    for (const [got, want] of [[out.x, 0.2], [out.y, 0.2], [out.z, 0], [out.d2, 0.25]] as const) expect(got).toBeCloseTo(want, 12);
    nearestOnTriangle(p, 0, 3, 6, 0.5, -1, 0, out);
    expect([out.x, out.y, out.u, out.v]).toEqual([0.5, 0, 0.5, 0.5]);
    nearestOnTriangle(p, 0, 3, 6, 2, 2, 0, out);
    expect(out.d2).toBeCloseTo(4.5, 9);
  });

  test("the grid finds the same nearest point as a search of every triangle", () => {
    const s = sphere(0.1);
    const grid = new TriangleGrid(s.positions, s.indices, 0.02);
    const got: Nearest = { triangle: 0, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 }, each = { ...got };
    for (const q of [[0.13, 0.01, 0.02], [0.02, -0.09, 0.0], [0.05, 0.05, 0.05]]) {
      expect(grid.nearest(q[0]!, q[1]!, q[2]!, 0.2, got)).toBe(true);
      let best = Infinity;
      for (let t = 0; t < s.indices.length / 3; t++) {
        nearestOnTriangle(s.positions, s.indices[t * 3]! * 3, s.indices[t * 3 + 1]! * 3, s.indices[t * 3 + 2]! * 3, q[0]!, q[1]!, q[2]!, each);
        best = Math.min(best, each.d2);
      }
      expect(got.d2).toBeCloseTo(best, 12);
    }
  });

  test("a piece moves out with a larger body, takes its weights and keeps its layers", () => {
    // The old body is a sphere of 10 cm, the new one 12 cm on bone 3; the piece hugs the old at 1 and 2 cm out.
    const field = bodyField(sphere(0.1), body(0.12, 3, 0), 30);
    const p = piece(0.11, 0.12, 0);
    const half = p.positions.length / 6;
    // Shown with skin of another slot, as a collar is with the neck.
    const r = refitPiece(p, field, new Set(), () => true, () => 1);
    let lining = Infinity, cloth = Infinity, order = Infinity;
    for (let v = 0; v < half; v++) {
      lining = Math.min(lining, radius(p.positions, v, [0, 0, 0]));
      cloth = Math.min(cloth, radius(p.positions, v + half, [0, 0, 0]));
    }
    for (let v = 0; v < half; v++) order = Math.min(order, radius(p.positions, v + half, [0, 0, 0]) - radius(p.positions, v, [0, 0, 0]));
    // Moved by the 2 cm the skin moved, so neither layer is in the new skin and the cloth stays over the lining.
    expect(lining).toBeGreaterThan(0.12);
    expect(cloth).toBeGreaterThan(lining);
    expect(order).toBeGreaterThan(0.005);
    expect(r.most).toBeGreaterThan(0.015);
    for (let v = 0; v < p.bones.length; v++) expect([p.bones[v], p.joints[v * 4], p.weights[v * 4]]).toEqual([3, 3, 1]);
  });

  test("skin a piece stands in for does not push it, and skin drawn with it does", () => {
    // The new body is 3 cm larger than the old, then pushed out where the field leaves the piece inside it.
    const old = sphere(0.1), wide = body(0.13, 0, 2);
    const field = bodyField(old, wide, 30);
    // A field that leaves every point where it was: the same body on both sides, so only the push moves the piece.
    const still = bodyField(old, body(0.1, 0, 2), 30);
    still.to = field.to;
    still.toGrid = field.toGrid;
    still.toSlots = field.toSlots;
    const hidden = piece(0.105, 0.11, 0), shown = piece(0.105, 0.11, 0);
    refitPiece(hidden, still, new Set(), (worn, skin) => skin !== worn, () => 2);
    refitPiece(shown, still, new Set(), (worn, skin) => skin !== worn, () => 1);
    expect(radius(hidden.positions, 0, [0, 0, 0])).toBeCloseTo(0.105, 6);
    for (let v = 0; v < shown.positions.length / 3; v++) expect(radius(shown.positions, v, [0, 0, 0])).toBeGreaterThan(0.13);
  });
});
