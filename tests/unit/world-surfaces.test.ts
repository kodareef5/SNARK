import { expect, test } from "bun:test";
import { SURFACE_NAMES, surfaceIndex } from "../../content/surfaces.ts";
import { GROUND_GRAIN, GROUND_WANDER, citySurface, groundCover, groundWander, surfaceHash, surfaceNoise, WORLD_MEANS, worldSharp, worldSurface, worldVertex, type WorldSample } from "../../client/core/render/world-surfaces.ts";
import { TIERS, forTouch } from "../../client/core/assets/tiers.ts";
import { FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX, LIT_TERRAIN_FRAGMENT, LIT_TERRAIN_VERTEX, PULLED_VERTEX } from "../../client/core/render/glsl.ts";
import { worldMaterial } from "../../tools/surfaces/build.ts";
import { rgbaOf } from "../../tools/snap/files.ts";
import { artTest } from "../fixtures/needs-art.ts";

test("ground aliases and static finishes remain distinct; desert open land is gravel", () => {
  for (const [palette, ground, name] of [[10, true, "rock"], [10, false, "concrete"], [100, true, "gravel"], [100, false, "concrete"], [89, true, "paving"], [89, false, "steel"], [179, false, "rust"], [197, true, "grass"], [125, true, "sand"]] as const)
    expect(SURFACE_NAMES[surfaceIndex(palette, ground)]).toBe(name);
  expect(SURFACE_NAMES[surfaceIndex(123, true, "las-vegas")]).toBe("gravel");
  for (let i = 0; i < 256; i++) for (const ground of [true, false]) expect(surfaceIndex(i, ground)).toBeWithin(0, 16);
});

test("macro fields are continuous across negative and positive cell boundaries and do not repeat every eight metres", () => {
  for (const edge of [-8192, -31, -1, 0, 1, 31, 8192]) {
    expect(Math.abs(surfaceNoise(edge - 1e-6, 0.31) - surfaceNoise(edge + 1e-6, 0.31))).toBeLessThan(1e-5);
    expect(surfaceHash(edge, 43)).toBeWithin(0, 1);
  }
  expect(surfaceNoise(0.1, 0.7)).not.toBe(surfaceNoise(8.1, 0.7));
});

test("all finishes have bounded reflectance and unit normals at near and flyer footprints, without sampling adjacent cells", () => {
  const a = new Float64Array(3), o = new Float64Array(3), n = new Float64Array(3), city = new Float32Array(12);
  citySurface(city, "core:miami");
  for (let id = 0; id < 16; id++) for (const footprint of [0.001, 0.2, 3]) for (const normal of [[0, 1, 0], [0, 0, -1], [1, 0, 0]]) {
    const sample: WorldSample = (role, u, v, spread, out) => {
      expect(Math.floor(u * 4) + 4 * Math.floor(v * 4)).toBe(id);
      expect(Number.isFinite(spread)).toBe(true);
      out.set(role === 0 ? [0.3, 0.25, 0.2, 1] : role === 1 ? [0.55, 0.48, 0, 1] : [0.95, 0.9, 0, 1]);
    };
    worldSurface(a, o, n, [0.4, 0.4, 0.4], id, -1.32, 150, 8191.9, normal[0]!, normal[1]!, normal[2]!, footprint, city, sample);
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    for (const v of [...a, ...o]) expect(v).toBeWithin(0, 1);
  }
});

test("the textured mesh vertex variants carry semantic IDs while low-poly shader sources stay untouched; the lit ground chooses its cover a pixel", () => {
  for (const text of [FLAT_MESH_VERTEX, PULLED_VERTEX]) {
    expect(worldVertex(text)).toContain("vSurface = SURFACE_IDS[");
    expect(text).not.toContain("SURFACE_IDS");
  }
  expect([FLAT_TERRAIN_VERTEX.includes("uTint"), LIT_TERRAIN_VERTEX.includes("uTint")]).toEqual([true, false]);
  expect(LIT_TERRAIN_FRAGMENT).toContain("worldSurface(albedo, orm, n, geometric, groundSurface(tint))");
});

test("the ground takes the cover with most of the bilinear weight, so an edge between two curves through a cell and a corner's cover is a rounded bite", () => {
  const [A, B, C] = [12, 4, 1];
  // Two covers side by side meet halfway between their samples; a cover at one corner reaches halfway along the cell's sides.
  for (const f of [0.1, 0.3, 0.49, 0.51, 0.9]) {
    expect(groundCover(A, B, A, B, f, 0.37)).toBe(f < 0.5 ? A : B);
    expect(groundCover(B, A, A, A, f, 0)).toBe(f < 0.5 ? B : A);
  }
  // Along the diagonal, B at one corner holds where its weight passes a half: (1 - x)(1 - z) > 0.5.
  expect([groundCover(B, A, A, A, 0.28, 0.28), groundCover(B, A, A, A, 0.3, 0.3)]).toEqual([B, A]);
  // Three covers: the one with most weight, even where the nearest sample is another's; and the first where two tie.
  expect(groundCover(A, B, C, B, 0.2, 0.2)).toBe(A);
  expect(groundCover(A, B, C, B, 0.45, 0.2)).toBe(B);
  expect(groundCover(A, B, B, A, 0.5, 0.5)).toBe(A);
});

test("the cover's edge wanders by at most GROUND_WANDER, smoothly, and not once a pixel is half the noise's grain", () => {
  const out = new Float64Array(2);
  const last = new Float64Array(2);
  let [most, steps, mean] = [0, 0, 0];
  for (let k = 0; k < 20000; k++) {
    const x = 7.3 + k * 0.011;
    groundWander(x, 3.1 + Math.sin(k * 0.002) * 5, 0.05, out);
    most = Math.max(most, Math.abs(out[0]!), Math.abs(out[1]!));
    if (k > 0) steps = Math.max(steps, Math.abs(out[0]! - last[0]!), Math.abs(out[1]! - last[1]!));
    mean += out[0]! / 20000;
    last.set(out);
  }
  expect(most).toBeLessThanOrEqual(GROUND_WANDER);
  expect(most).toBeGreaterThan(GROUND_WANDER / 2);
  // Steps of 1.1 cm along x and at most 1 cm along z move it by at most the noise's steepest, 1.5 times its span a grain.
  expect(steps).toBeLessThan(0.02);
  expect(Math.abs(mean)).toBeLessThan(0.1);
  groundWander(31.7, 8.2, GROUND_GRAIN / 4, out);
  const full = [...out];
  groundWander(31.7, 8.2, (GROUND_GRAIN * 3) / 8, out);
  expect(out.map((v, k) => v / full[k]!)).toEqual(Float64Array.of(0.5, 0.5));
  groundWander(31.7, 8.2, GROUND_GRAIN / 2, out);
  expect([...out]).toEqual([0, 0]);
});

artTest("a distant finish fades to its mean in the atlas's 4 x 4 mip without reading it; the normal map's mean is flat", () => {
  const source = worldMaterial();
  for (const [role, at] of [["base", 0], ["mro", 3]] as const) {
    const mip = rgbaOf(source, role, 2048).pictures[2]!;
    for (let id = 0; id < 16; id++) for (let c = 0; c < (role === "base" ? 3 : 2); c++) expect(mip[id * 4 + c]).toBe(WORLD_MEANS[id * 5 + at + c]!);
  }
  expect([...new Set(rgbaOf(source, "normal", 2048).pictures[2])]).toEqual([128]);
});

test("a finish reads the base of its cells and the other maps of the heaviest, the normal only while it shows, and nothing far off", () => {
  const city = new Float32Array(12); citySurface(city, "core:default");
  const a = new Float64Array(3), o = new Float64Array(3), n = new Float64Array(3);
  const reads = (id: number, footprint: number, light = false): number[] => {
    const count = [0, 0, 0];
    worldSurface(a, o, n, [0.4, 0.4, 0.4], id, 31.3, 2, 17.9, 0, 1, 0, footprint, city, (role, _u, _v, _spread, out) => { count[role]!++; out.fill(0.5); }, light);
    return count;
  };
  // Grass's tile is 1.4 m: a pixel of 0.15 m is near, 0.3 m fading with relief, 1 m fading flat, 2 m far.
  expect([0.15, 0.3, 1, 2].map((footprint) => reads(0, footprint))).toEqual([[3, 1, 1], [3, 1, 1], [3, 0, 1], [0, 0, 0]]);
  expect([0.05, 2].map((footprint) => reads(9, footprint))).toEqual([[1, 1, 1], [0, 0, 0]]);
  // The touch rule's light finish: the base of one cell, near and fading, and nothing far off.
  expect([0.15, 1, 2].map((footprint) => reads(0, footprint, true))).toEqual([[1, 0, 0], [1, 0, 0], [0, 0, 0]]);
});

test("only a smooth finish mirrors the sky table; wetness makes mud one, and the light finish is the touch rule's", () => {
  const city = new Float32Array(12);
  citySurface(city, "core:default");
  expect(SURFACE_NAMES.filter((_, i) => worldSharp(i, city))).toEqual(["mud", "steel", "glass"]);
  for (const tier of TIERS) expect([tier.finish, forTouch(tier, true).finish]).toEqual(["full", tier.name === "medium" || tier.name === "high" ? "light" : "full"]);
});

test("city bump tuning changes relief without changing albedo or finish selection", () => {
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const a = new Float64Array(3), o = new Float64Array(3), n = new Float64Array(3);
  const sample: WorldSample = (role, _u, _v, _spread, out) => out.set(role === 0 ? [0.3, 0.25, 0.2, 1] : role === 1 ? [0.7, 0.55, 0, 1] : [1, 0.9, 0, 1]);
  const draw = (): void => worldSurface(a, o, n, [0.4, 0.4, 0.4], 9, 31, 2, 17, 0, 1, 0, 0.001, city, sample);
  draw(); const colour = a.slice(); expect(n[0]).not.toBe(0);
  city[8] = 0; draw(); expect(n).toEqual(Float64Array.of(0, 1, 0)); expect(a).toEqual(colour);
});
