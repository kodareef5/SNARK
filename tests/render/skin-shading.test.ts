// People's shading terms (client/core/render/surface.ts): normals through stretched bones, skin's reflectance and
// scattered light, its fade toward the flat level, and the materials that take them.
import { describe, expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { DIELECTRIC, SKIN_F0, SKIN_GONE, SKIN_KEEP, SKIN_WRAP, lit, normalUnder, scattered, skinNear, surfaceFragment, surfaceVertex, SURFACE_ANY } from "../../client/core/render/surface.ts";
import { AIR } from "../../client/core/render/atmosphere.ts";
import { ENAMEL_ARMOR, EYE, SKIN, streetMaterial } from "../../content/street-finishes.ts";

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
/** Bone rows (three of four) of a turn about y by `a`, its columns stretched by `s`. */
function rows(a: number, s: readonly number[]): number[] {
  const [c, n] = [Math.cos(a), Math.sin(a)];
  const turn = [[c, 0, n], [0, 1, 0], [-n, 0, c]];
  return turn.flatMap((r, i) => [r[0]! * s[0]!, r[1]! * s[1]!, r[2]! * s[2]!, i]);
}
const apply = (m: number[], v: readonly number[]): number[] => [0, 1, 2].map((r) => m[r * 4]! * v[0]! + m[r * 4 + 1]! * v[1]! + m[r * 4 + 2]! * v[2]!);

describe("normals under a look's stretch", () => {
  test("a stretched normal stays square to the stretched surface", () => {
    const m = rows(0.7, [1.4, 0.9, 0.6]);
    const n = [0.6, 0.48, 0.64];
    // Two directions along the surface at rest, carried as positions are.
    const along = [[0.8, 0, -0.75], [0, 0.8, -0.6]].map((t) => apply(m, t));
    const out = [0, 0, 0];
    normalUnder(out, m, n[0]!, n[1]!, n[2]!);
    for (const t of along) expect(Math.abs(dot(out, t))).toBeLessThan(1e-12);
    // The old way, the rows themselves, leans off the surface.
    expect(Math.abs(dot(apply(m, n), along[0]!))).toBeGreaterThan(0.05);
  });

  test("a turn alone carries a normal as it carries a direction", () => {
    const m = rows(1.1, [1.2, 1.2, 1.2]);
    const out = [0, 0, 0];
    normalUnder(out, m, 0, 0.6, 0.8);
    const l = Math.hypot(...out);
    const want = apply(m, [0, 0.6, 0.8]);
    const lw = Math.hypot(...want);
    for (let c = 0; c < 3; c++) expect(out[c]! / l).toBeCloseTo(want[c]! / lw, 12);
  });

  test("the vertex text carries skinned normals by normalUnder", () => {
    const text = surfaceVertex(SURFACE_ANY);
    expect(text).toContain("n = normalUnder(m, nv.xyz);");
    expect(text).toContain("nv = vec4(normalUnder(s, nv.xyz), 0.0);");
  });
});

describe("skin", () => {
  const frame = new Float32Array(FRAME_FLOATS);
  frame.set([0, 1, 0], FRAME.sun);
  frame.set([3, 2.8, 2.6], FRAME.sunColor);
  frame.set([0, -1, 0], FRAME.moon);
  const albedo = [0.5, 0.3, 0.2];

  test("scattered light adds nothing face on to the sun, and a warm band at its edge", () => {
    const face = [0, 0, 0];
    scattered(face, albedo, 0, [0, 1, 0], frame, 1);
    expect(face).toEqual([0, 0, 0]);
    const edge = [0, 0, 0];
    scattered(edge, albedo, 0, [1, 0, 0], frame, 1);
    expect(edge[0]! / albedo[0]!).toBeGreaterThan(edge[1]! / albedo[1]!);
    expect(edge[1]! / albedo[1]!).toBeGreaterThan(edge[2]! / albedo[2]!);
    expect(edge[0]).toBeCloseTo(albedo[0]! * 3 * (SKIN_WRAP[0] / (1 + SKIN_WRAP[0])), 6);
    // Past the band the far side takes nothing, and a pixel with no skin takes nothing.
    const far = [0, 0, 0];
    scattered(far, albedo, 0, [0, -1, 0], frame, 1);
    expect(far).toEqual([0, 0, 0]);
    const none = [0, 0, 0];
    scattered(none, albedo, 0, [1, 0, 0], frame, 0);
    expect(none).toEqual([0, 0, 0]);
  });

  test("skin reflects less head on than other surfaces that are not metal", () => {
    const [a, b] = [[0, 0, 0], [0, 0, 0]];
    const n = [0, 0.8, 0.6], v = [0, 0.6, 0.8];
    lit(a, albedo, [1, 0.5, 0], n, v, frame, [1, 1, 1]);
    lit(b, albedo, [1, 0.5, 0], n, v, frame, [1, 1, 1], 1, SKIN_F0);
    for (let c = 0; c < 3; c++) expect(b[c]!).toBeLessThan(a[c]!);
    const same = [0, 0, 0];
    lit(same, albedo, [1, 0.5, 0], n, v, frame, [1, 1, 1], 1, DIELECTRIC);
    expect(same).toEqual(a);
  });

  test("skin's own light fades out before the flat level is drawn", () => {
    const t = tierOf("medium").threshold;
    expect(skinNear(SKIN_KEEP / t, t)).toBe(1);
    expect(skinNear(SKIN_GONE / t, t)).toBe(0);
    let last = 1;
    for (let k = 0; k <= 20; k++) {
      const near = skinNear(((SKIN_KEEP + ((SKIN_GONE - SKIN_KEEP) * k) / 20) / t), t);
      expect(near).toBeLessThanOrEqual(last);
      last = near;
    }
  });

  test("the people's skin and eyes take their terms, and the suit keeps its own", () => {
    for (const id of ["regular_m", "regular_f", "skin_mh_m", "skin_mh_f"]) expect(streetMaterial(`core:human-bodies/${id}`)).toBe(SKIN);
    expect(streetMaterial("core:human-bodies/eyes_mh")).toBe(EYE);
    expect(streetMaterial("core:human-bodies/brows_mh")).toBe(0);
    expect(streetMaterial("core:human-bodies/cloth")).toBe(0);
    expect(streetMaterial("core:human-bodies/meridian")).toBe(ENAMEL_ARMOR);
  });

  test("the fragment text sets skin's reflectance only where a draw is skin", () => {
    const text = surfaceFragment("rgba", AIR);
    expect(text).toContain(`gF0 = mix(0.04, ${SKIN_F0}, skin);`);
    expect(text).toContain(`if (int(uStreetMaterial) == ${SKIN}) {`);
    expect(text).toContain("radiance += scattered(albedo, mro.b, n, skin, shade);");
  });
});
