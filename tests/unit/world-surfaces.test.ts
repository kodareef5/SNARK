import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SURFACE_FINISHES, SURFACE_NAMES, surfaceIndex, surfaceMaterial } from "../../content/surfaces.ts";
import { GROUND_GRAIN, GROUND_WANDER, WORLD_ROUGH, WorldFinishes, citySurface, groundCover, groundMeet, groundWander, higher, secondShare, surfaceHash, surfaceNoise, worldPhase, worldSharp, worldSurface, worldVertex, type WorldSample } from "../../client/core/render/world-surfaces.ts";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX, LIT_TERRAIN_FRAGMENT, LIT_TERRAIN_VERTEX, PULLED_VERTEX } from "../../client/core/render/glsl.ts";
import type { PackMaterial, PackTexture } from "../../shared/pack/pack.ts";
import { WORLD_ART, paintedOf, worldMaterials } from "../../tools/surfaces/build.ts";
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

test("every finish reads its own layer, has bounded reflectance and unit normals near and far, on the ground and on walls", () => {
  const a = new Float64Array(3), o = new Float64Array(3), n = new Float64Array(3), city = new Float32Array(12);
  citySurface(city, "core:miami");
  for (let id = 0; id < 16; id++) for (const footprint of [0.001, 0.2, 3]) for (const normal of [[0, 1, 0], [0, 0, -1], [1, 0, 0]]) {
    const sample: WorldSample = (role, layer, _u, _v, spread, out) => {
      expect(layer).toBe(id);
      expect(Number.isFinite(spread)).toBe(true);
      out.set(role === 0 ? [0.3, 0.25, 0.2, 1] : role === 1 ? [0.75, 0.4, 0, 1] : [0.95, 0.9, 0, 0.5]);
    };
    worldSurface(a, o, n, [0.4, 0.4, 0.4], id, -1.32, 150, 8191.9, normal[0]!, normal[1]!, normal[2]!, footprint, city, sample);
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    for (const v of [...a, ...o]) expect(v).toBeWithin(0, 1);
  }
});

test("a finish reads its three maps once where its second copy does not show, both copies' where it shows through, and the second's alone where it is whole; the touch rule's reads one base colour", () => {
  const city = new Float32Array(12); citySurface(city, "core:default");
  const a = new Float64Array(3), o = new Float64Array(3), n = new Float64Array(3);
  const metres = SURFACE_FINISHES.asphalt.metres;
  // Points along x a tile apart where the second copy's share is 0, between, and 1.
  const shares = Array.from({ length: 400 }, (_, k) => ({ x: k * 0.37 * metres, t: secondShare(k * 0.37, 2 / metres) }));
  const none = shares.find((s) => s.t === 0)!, some = shares.find((s) => s.t > 0.2 && s.t < 0.8)!, whole = shares.find((s) => s.t === 1)!;
  const reads = (x: number, light = false): number[] => {
    const count = [0, 0, 0];
    worldSurface(a, o, n, [0.4, 0.4, 0.4], 6, x, 0, 2, 0, 1, 0, 0.01, city, (role, _layer, _u, _v, _spread, out) => { count[role]!++; out.fill(0.5); }, light);
    return count;
  };
  expect([reads(none.x), reads(some.x), reads(whole.x), reads(some.x, true)]).toEqual([[1, 1, 1], [2, 2, 2], [1, 1, 1], [1, 0, 0]]);
});

test("on a tier that reads the relief, a finish near the eye is read where the ray to the eye meets its painted height, and not far off or seen head on", () => {
  const city = new Float32Array(12); citySurface(city, "core:default");
  const a = new Float64Array(3), o = new Float64Array(3), n = new Float64Array(3);
  const f = SURFACE_FINISHES.clay, depth = f.height / 1000 / f.metres;
  // Clay seen from 45 degrees along +x, its height half way everywhere: the ray meets it half the relief down, along -x.
  const read = (eye: number[] | null, footprint: number): number[] => {
    let at: number[] = [];
    worldSurface(a, o, n, [0.4, 0.4, 0.4], 10, 20.2, 0, 4.4, 0, 1, 0, footprint, city, (role, _layer, u, v, _spread, out) => { if (role === 0) at = [u, v]; out.fill(0.5); }, false, null, eye);
    return at;
  };
  const flat = read(null, 0.0005), near = read([Math.SQRT1_2, Math.SQRT1_2, 0], 0.0005);
  expect(near[0]! - flat[0]!).toBeCloseTo(-depth / 2, 9);
  expect(near[1]).toBeCloseTo(flat[1]!, 9);
  expect(read([Math.SQRT1_2, Math.SQRT1_2, 0], 0.01)).toEqual(read(null, 0.01));
  expect(read([0, 1, 0], 0.0005)).toEqual(flat);
});

test("where two heights meet the higher shows: none of the second at its share 0 and all of it at 1, the higher on an even share", () => {
  for (const [a, b] of [[0, 1], [1, 0], [0.3, 0.7]]) {
    expect(higher(a!, b!, 0)).toBe(0);
    expect(higher(a!, b!, 1)).toBe(1);
  }
  expect(higher(0.9, 0.2, 0.5)).toBe(0);
  expect(higher(0.2, 0.9, 0.5)).toBe(1);
  expect(higher(0.5, 0.55, 0.5)).toBeWithin(0.4, 0.9);
  // The ground's: millimetres, a finish 30 mm higher showing through on an even share, none of it far from the edge.
  expect([higher(30, 0, 0.5, 40, 6), higher(0, 30, 0.5, 40, 6), higher(0, 30, 0, 40, 6)]).toEqual([0, 1, 0]);
});

test("the ground's cover meets the other finish with most weight, wanted from none away from the edge to half on it; two tints of one finish do not meet", () => {
  const finish = (tint: number): number => surfaceIndex(tint, true);
  const out = new Float64Array(2);
  const [grass, grass2, sand] = [197, 150, 125];
  groundMeet(grass, grass, sand, grass, sand, 0.5, 0.3, finish, out);
  expect([out[0], out[1]]).toEqual([sand, 0.5]);
  groundMeet(grass, grass, sand, grass, sand, 0.2, 0.3, finish, out);
  expect(out[0]).toBe(sand);
  expect(out[1]).toBeCloseTo(0, 9);
  groundMeet(grass, grass, sand, grass, sand, 0.4, 0.3, finish, out);
  expect(out[1]).toBeCloseTo(0.3, 9);
  groundMeet(grass, grass, grass2, grass, grass2, 0.5, 0.3, finish, out);
  expect([out[0], out[1]]).toEqual([-1, 0]);
});

test("the textured mesh vertex variants carry semantic IDs while low-poly shader sources stay untouched; the lit ground chooses its cover a pixel and meets the next by height", () => {
  for (const text of [FLAT_MESH_VERTEX, PULLED_VERTEX]) {
    expect(worldVertex(text)).toContain("vSurface = SURFACE_IDS[");
    expect(text).not.toContain("SURFACE_IDS");
  }
  expect([FLAT_TERRAIN_VERTEX.includes("uTint"), LIT_TERRAIN_VERTEX.includes("uTint")]).toEqual([true, false]);
  expect(LIT_TERRAIN_FRAGMENT).toContain("worldSurface(albedo, orm, n, geometric, groundSurface(tint), vRel, dx, dy)");
  expect(LIT_TERRAIN_FRAGMENT).toContain("int other = groundMeet(tint, tints, s - vec2(i), share);");
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

artTest("each finish's painted size, relief and module are the ones the renderers draw it at, and the touch rule's roughness is its packed map's mean", () => {
  const materials = worldMaterials();
  SURFACE_NAMES.forEach((name, k) => {
    const painted = paintedOf(name), f = SURFACE_FINISHES[name];
    expect([name, painted.metres, painted.height_mm, painted.module?.map((m) => m.toFixed(6))]).toEqual([name, f.metres, f.height, f.module?.map((m) => m.toFixed(6))]);
    expect([name, rgbaOf(materials[k]!, "mro", 1024).pictures[0]![1]]).toEqual([name, WORLD_ROUGH[k]]);
  });
  expect(JSON.parse(readFileSync(join(WORLD_ART, "grass", "material.json"), "utf8")).metres).toBe(SURFACE_FINISHES.grass.metres);
});

test("a frame asks for every finish as wide as its tier keeps them, tells the card the finest level all have come to, and has them taken again when that side changes", () => {
  const roles = ["base", "normal", "mro"] as const;
  const materials: PackMaterial[] = SURFACE_NAMES.map((name, k) => ({ id: surfaceMaterial(name), base: 3 * k, normal: 3 * k + 1, mro: 3 * k + 2, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 0 }));
  const textures: PackTexture[] = materials.flatMap((m) => roles.map((role) => ({ id: `${m.id}/${role}`, role, top: role === "mro" ? 1024 : 2048 })));
  const held = new Int8Array(48).fill(-1), asked: number[] = [], again: number[] = [];
  const residency = { format: "bc" as const, material: (m: number, pixels: number, _distance: number, roles = 3) => asked.push(m * 10000 + pixels + (roles === 3 ? 0 : roles / 10)), holds: (t: number) => held[t]!, again: (t: number) => { again.push(t); held[t] = -1; } };
  const finishes = new WorldFinishes(materials, textures), p = new FramePacket();
  finishes.frame(p, residency, tierOf("high"));
  expect([asked.length, asked[0], [...p.worldSide], [...p.worldLevel], again.length]).toEqual([16, 1024, [1024, 1024, 512], [-1, -1, -1], 48]);
  // Every texture at its first step but one base colour a step further: the arrays are drawn from their 64-pixel level.
  held.fill(0); held[0] = 1;
  finishes.frame(p, residency, tierOf("high"));
  expect([...p.worldLevel]).toEqual([4, 4, 3]);
  held.fill(4); held[2] = 3;
  finishes.frame(p, residency, tierOf("high"));
  expect([...p.worldLevel]).toEqual([0, 0, 0]);
  again.length = 0;
  finishes.frame(p, residency, tierOf("ultra"));
  expect([[...p.worldSide], [...p.worldLevel], again.length]).toEqual([[2048, 2048, 1024], [-1, -1, -1], 48]);
  // The touch rule's light finish reads the base colour alone: only that is asked for and held, and the rest let go.
  held.fill(4); asked.length = 0; again.length = 0;
  finishes.frame(p, residency, forTouch(tierOf("high"), true));
  expect([asked.length, asked[0], [...p.worldSide], [...p.worldLevel], again.length]).toEqual([16, 1024.1, [1024, 0, 0], [-1, -1, -1], 48]);
  held.fill(4);
  finishes.frame(p, residency, forTouch(tierOf("high"), true));
  expect([...p.worldLevel]).toEqual([0, -1, -1]);
  finishes.frame(p, residency, tierOf("lowpoly"));
  expect([[...p.worldSide], [...p.worldLevel]]).toEqual([[0, 0, 0], [-1, -1, -1]]);
  for (const tier of TIERS) expect([tier.name, tier.finishes]).toEqual([tier.name, { lowpoly: 0, medium: 512, high: 1024, ultra: 2048 }[tier.name]]);
});

test("the eye's place in each finish's tiles is given to the card without its whole tiles, so a far corner of the map reads its texture as finely as the middle", () => {
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const phase = new Float32Array(48);
  worldPhase(phase, 16383.7, 12.3, 8191.4, city);
  for (let k = 0; k < 16; k++) {
    const m = SURFACE_FINISHES[SURFACE_NAMES[k]!].metres;
    expect(phase[k * 3]).toBeCloseTo(16383.7 / m - Math.floor(16383.7 / m), 4);
    for (const c of [0, 1, 2]) expect(phase[k * 3 + c]).toBeWithin(0, 1);
  }
});

test("only a smooth finish mirrors the sky table, and the light finish is the touch rule's", () => {
  expect([worldSharp(0.3), worldSharp(0.59), worldSharp(0.6), worldSharp(0.9)]).toEqual([true, true, false, false]);
  for (const tier of TIERS) expect([tier.finish, forTouch(tier, true).finish]).toEqual(["full", tier.name === "medium" || tier.name === "high" ? "light" : "full"]);
});

test("city bump tuning changes relief without changing albedo or finish selection", () => {
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const a = new Float64Array(3), o = new Float64Array(3), n = new Float64Array(3);
  const sample: WorldSample = (role, _layer, _u, _v, _spread, out) => out.set(role === 0 ? [0.3, 0.25, 0.2, 1] : role === 1 ? [0.7, 0.55, 0, 1] : [1, 0.9, 0, 0.5]);
  const draw = (): void => void worldSurface(a, o, n, [0.4, 0.4, 0.4], 9, 31, 2, 17, 0, 1, 0, 0.001, city, sample);
  draw(); const colour = a.slice(); expect(n[0]).not.toBe(0);
  city[8] = 0; draw(); expect(n[0]).toBe(0); expect(n[2]).toBe(0); expect(a).toEqual(colour);
});
