import { expect, test } from "bun:test";
import { SURFACE_NAMES, surfaceIndex } from "../../content/surfaces.ts";
import { citySurface, surfaceHash, surfaceNoise, WORLD_MEANS, worldSharp, worldSurface, worldVertex, type WorldSample } from "../../client/core/render/world-surfaces.ts";
import { TIERS, forTouch } from "../../client/core/assets/tiers.ts";
import { FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX, PULLED_VERTEX } from "../../client/core/render/glsl.ts";
import { worldMaterial } from "../../tools/surfaces/build.ts";
import { rgbaOf } from "../../tools/snap/files.ts";

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

test("the textured vertex variants carry semantic IDs while low-poly shader sources stay untouched", () => {
  for (const [text, ground] of [[FLAT_MESH_VERTEX, false], [FLAT_TERRAIN_VERTEX, true], [PULLED_VERTEX, false]] as const) {
    const shader = worldVertex(text, ground);
    expect(shader).toContain("vSurface = SURFACE_IDS[");
    expect(text).not.toContain("SURFACE_IDS");
  }
});

test("a distant finish fades to its mean in the atlas's 4 x 4 mip without reading it; the normal map's mean is flat", () => {
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
