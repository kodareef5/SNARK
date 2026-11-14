// Meshes drawn with materials: the lighting of client/core/render/surface.ts.
import { expect, test } from "bun:test";
import { AMBIENT, DIFFUSE } from "../../client/core/render/shading.ts";
import { DIELECTRIC, SKY, SUN, SURFACE_VERTEX, dyed, lit, linearToSrgb, skyShare, srgbToLinear, surfaceFragment } from "../../client/core/render/surface.ts";

/** The furthest any two numbers of two lists are apart. */
function apart(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let most = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i]! - b[i]!));
  return most;
}

test("the sun and the sky are as strong as makes a mid-grey rough surface the flat renderer's grey, in the sun and out of it", () => {
  // The flat renderer shows a colour at AMBIENT of its display value out of the sun, and at AMBIENT + DIFFUSE facing it.
  const grey = 128 / 255;
  const albedo = srgbToLinear(grey);
  const shaded = srgbToLinear(AMBIENT * grey);
  const sunlit = srgbToLinear((AMBIENT + DIFFUSE) * grey);
  // Seen and lit head on, a fully rough surface that is not metal sends back, besides its colour, DIELECTRIC of the
  // sun through a GGX of width 1 (1 / pi) and Smith's term (1 / 4), and of the sky the share its highlight takes,
  // which there is DIELECTRIC * (1 - ln 2). Out of the sun: SKY * ofSky = shaded. Facing it: that and SUN * ofSun = sunlit.
  const ofSun = albedo + DIELECTRIC / 4;
  const ofSky = albedo + DIELECTRIC * (1 - Math.log(2));
  expect(skyShare(DIELECTRIC, 1, 1)).toBeCloseTo(DIELECTRIC * (1 - Math.log(2)), 12);
  expect(SKY).toBe(Math.round((shaded / ofSky) * 1e4) / 1e4);
  expect(SUN).toBe(Math.round(((sunlit - shaded) / ofSun) * 1e4) / 1e4);

  // The functions agree, whatever colour the sky is: a rough highlight takes the sky's light as white.
  const out = [0, 0, 0];
  const front = [0, 0, 1];
  for (const sky of [[0.3, 0.5, 0.8], [0, 0, 0]]) {
    lit(out, [albedo, albedo, albedo], [1, 1, 0], front, front, front, sky);
    for (const c of out) expect(linearToSrgb(c) * 255).toBeCloseTo(128, 1);
    lit(out, [albedo, albedo, albedo], [1, 1, 0], front, front, [0, 0, -1], sky);
    for (const c of out) expect(linearToSrgb(c) * 255).toBeCloseTo(AMBIENT * 128, 1);
  }
});

test("the sky's share of a highlight is what the sun's highlight comes to over the whole sky", () => {
  // The sun's light in `lit`, with no colour under the highlight and no sky, summed over every place the sun could be.
  const over = (albedo: number, metal: number, rough: number, nv: number): number => {
    const out = [0, 0, 0];
    const eye = [Math.sqrt(1 - nv * nv), 0, nv];
    const n = 96;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n * 2; j++) {
        const z = (i + 0.5) / n;
        const turn = ((j + 0.5) / n) * Math.PI;
        lit(out, [albedo, albedo, albedo], [0, rough, metal], [0, 0, 1], eye, [Math.sqrt(1 - z * z) * Math.cos(turn), Math.sqrt(1 - z * z) * Math.sin(turn), z], [0, 0, 0]);
        sum += out[0]!;
      }
    }
    // Each sample stands for pi / (n n) of the sky, and the sun's strength is in terms of pi of it.
    return sum / (n * n) / SUN;
  };
  for (const [rough, nv] of [[1, 1], [1, 0.3], [0.7, 0.8], [0.7, 0.25], [0.45, 0.6], [0.45, 0.2]] as const) {
    // A white metal reflects all its highlight. A surface that is not metal reflects DIELECTRIC of it, and more at its edges.
    expect(Math.abs(skyShare(1, rough, nv) - over(1, 1, rough, nv))).toBeLessThan(0.03);
    expect(Math.abs(skyShare(DIELECTRIC, rough, nv) - over(0, 0, rough, nv))).toBeLessThan(0.015);
  }
});

test("each mask channel dyes with its own region's colour, and what the weights leave of 1 keeps the base colour", () => {
  const out = [0, 0, 0];
  const dyes = Array.from({ length: 18 }, (_, i) => 0.1 + i * 0.05);
  for (let k = 0; k < 6; k++) {
    const weights = Array.from({ length: 6 }, (_, j) => (j === k ? 1 : 0));
    dyed(out, [1, 0.5, 0.25], [1, 1, 2], dyes, weights.slice(0, 3), weights.slice(3));
    expect(apart(out, [dyes[k * 3]!, dyes[k * 3 + 1]! * 0.5, dyes[k * 3 + 2]! * 0.5])).toBeLessThan(1e-12);
  }
  // Half in region 0 and half in region 5 is the even mix of the two. A quarter in region 1 leaves three quarters as they were.
  dyed(out, [1, 1, 1], [1, 1, 1], dyes, [0.5, 0, 0], [0, 0, 0.5]);
  expect(apart(out, [0, 1, 2].map((c) => (dyes[c]! + dyes[15 + c]!) / 2))).toBeLessThan(1e-12);
  dyed(out, [1, 1, 1], [1, 1, 1], dyes, [0, 0.25, 0], [0, 0, 0]);
  expect(apart(out, [0, 1, 2].map((c) => 0.75 + dyes[3 + c]! / 4))).toBeLessThan(1e-12);
});

test("the SURFACE program's text is written from the same numbers", () => {
  const text = surfaceFragment("bc");
  for (const n of [SUN, SKY, DIELECTRIC]) expect(text.split(String(n)).length).toBeGreaterThan(1);
  // A normal's x and y are in red and green, but in the astc variant in the colours and alpha.
  expect([text.includes("texture(uNormal, vUv).rg;"), surfaceFragment("rgba") === text, surfaceFragment("astc").includes("texture(uNormal, vUv).ra;")]).toEqual([true, true, true]);
  for (const part of [text, SURFACE_VERTEX]) {
    expect(part.startsWith("#version 300 es\n")).toBe(true);
    expect([part.split("{").length, part.split("(").length]).toEqual([part.split("}").length, part.split(")").length]);
  }
});
