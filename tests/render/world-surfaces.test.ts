import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MASK_MATERIALS, REPAIRS_LAYER, ROAD_LAYER, SURFACE_FINISHES, SURFACE_NAMES, SURFACE_WEATHERING, surfaceIndex, surfaceMaterial } from "../../content/surfaces.ts";
import { FIELD_LAYER, FORMWORK_LAYER, WEATHER_BAYS, WEATHER_GROUND } from "../../client/core/texgen/layers.ts";
import { EDGE_ROUND, GROUND_GRAIN, GROUND_WANDER, WEATHER_SEEN, WORLD_BASE, WORLD_FAR, WORLD_MRO, WORLD_EASE, WORLD_GLSL, WORLD_NEAR, WORLD_RISE, ROAD_GLSL, WorldFinishes, finishMetres, edgeOf, edged, roadFrameAt, roadWorn, walkMeet, walkWorn, ROAD_FRAME, ownVertex, wallFrame, weathered, bayStamp, citySurface, groundCover, groundMeet, groundWander, higher, secondShare, surfaceHash, surfaceNoise, worldPhase, worldSharp, worldSurface, worldVertex, type WorldSample } from "../../client/core/render/world-surfaces.ts";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { NEAR_GLASS, NEAR_WALL } from "../../client/core/render/finish-near.ts";
import { srgbToLinear } from "../../client/core/render/surface.ts";
import { ROAD_WEAR_SHIFT, RoadSectors, roadAcross, roadAlong, roadHalf } from "../../shared/world/roadframe.ts";
import { FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX, LIT_TERRAIN_FRAGMENT, LIT_TERRAIN_VERTEX, PULLED_VERTEX } from "../../client/core/render/glsl.ts";
import type { PackMaterial, PackTexture } from "../../shared/pack/pack.ts";
import { WORLD_ART, paintedOf, worldMaterials } from "../../tools/surfaces/build.ts";
import { rgbaOf } from "../../tools/snap/files.ts";
import { artTest } from "../fixtures/needs-art.ts";

test("ground aliases and static finishes remain distinct; desert open land is gravel", () => {
  for (const [palette, ground, name] of [[10, true, "rock"], [10, false, "concrete"], [100, true, "gravel"], [100, false, "concrete"], [89, true, "paving"], [89, false, "steel"], [179, false, "rust"], [197, true, "grass"], [125, true, "sand"]] as const)
    expect(SURFACE_NAMES[surfaceIndex(palette, ground)]).toBe(name);
  expect(SURFACE_NAMES[surfaceIndex(123, true, "las-vegas")]).toBe("gravel");
  for (let i = 0; i < 256; i++) for (const ground of [true, false]) expect(surfaceIndex(i, ground)).toBeWithin(0, SURFACE_NAMES.length);
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
    for (const v of [...a, ...o]) expect([v >= 0, v <= 1]).toEqual([true, true]);
  }
});

test("a finish reads its three maps once where its second copy does not show, both copies' where it shows through, and the second's alone where it is whole; from afar and on the touch rule it reads one base colour", () => {
  const city = new Float32Array(12); citySurface(city, "core:default");
  const a = new Float64Array(3), o = new Float64Array(3), n = new Float64Array(3);
  const metres = SURFACE_FINISHES.asphalt.metres;
  // Points along x a tile apart where the second copy's share is 0, between, and 1.
  const shares = Array.from({ length: 400 }, (_, k) => ({ x: k * 0.37 * metres, t: secondShare(k * 0.37, 2 / metres) }));
  const none = shares.find((s) => s.t === 0)!, some = shares.find((s) => s.t > 0.2 && s.t < 0.8)!, whole = shares.find((s) => s.t === 1)!;
  const reads = (x: number, light = false, footprint = 0.01): number[] => {
    const count = [0, 0, 0];
    worldSurface(a, o, n, [0.4, 0.4, 0.4], 6, x, 0, 2, 0, 1, 0, footprint, city, (role, _layer, _u, _v, _spread, out) => { count[role]!++; out.fill(0.5); }, light);
    return count;
  };
  expect([reads(none.x), reads(some.x), reads(whole.x), reads(some.x, true)]).toEqual([[1, 1, 1], [2, 2, 2], [1, 1, 1], [1, 0, 0]]);
  // A pixel past a sixteenth of a tile begins to read it as from afar, and past an eighth reads one base colour.
  const tile = metres * 2 ** WORLD_FAR;
  expect([reads(some.x, false, tile * 0.9), reads(some.x, false, tile * 1.4), reads(some.x, false, tile * 2.1), reads(whole.x, false, 40)]).toEqual([[2, 2, 2], [2, 2, 2], [1, 0, 0], [1, 0, 0]]);
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
  expect(LIT_TERRAIN_FRAGMENT).toContain("int other = streets ? streetOther : groundMeet(tint, tints, s - vec2(i), share);");
  // Near a street, on the tiers that draw them, the cover is the street's band's and meets the next on its line.
  expect(LIT_TERRAIN_FRAGMENT).toContain("streets = streetsAt(world, streetE, streetK);");
  expect(LIT_TERRAIN_FRAGMENT).toContain("streets = streetCover(tints, s - vec2(i), streetE, streetK, world, footprint, tint, streetOther, streetShare);");
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

artTest("each finish's painted size, relief and module are the ones the renderers draw it at, and what a finish from afar and the touch rule's are lit with is its packed map's mean", () => {
  const materials = worldMaterials();
  SURFACE_NAMES.forEach((name, k) => {
    const painted = paintedOf(name), f = SURFACE_FINISHES[name];
    expect([name, painted.metres, painted.height_mm, painted.module?.map((m) => m.toFixed(6))]).toEqual([name, f.metres, f.height, f.module?.map((m) => m.toFixed(6))]);
    expect([name, [...rgbaOf(materials[k]!, "mro", 1024).pictures[0]!].slice(0, 3)]).toEqual([name, [...WORLD_MRO[k]!]]);
    expect([name, [...rgbaOf(materials[k]!, "base", 2048).pictures[0]!].slice(0, 4)]).toEqual([name, [...WORLD_BASE[k]!]]);
  });
  expect(JSON.parse(readFileSync(join(WORLD_ART, "grass", "material.json"), "utf8")).metres).toBe(SURFACE_FINISHES.grass.metres);
});

/** Each finish's material and its three maps, then the masks' where `masks`, as a pack lists them: base colour and normal 2048 across, the packed map 1024. */
function finishPack(masks: boolean): { materials: PackMaterial[]; textures: PackTexture[] } {
  const roles = ["base", "normal", "mro"] as const;
  const ids = [...SURFACE_NAMES.map(surfaceMaterial), ...(masks ? MASK_MATERIALS : [])];
  const materials: PackMaterial[] = ids.map((id, k) => ({ id, base: 3 * k, normal: 3 * k + 1, mro: 3 * k + 2, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 0 }));
  return { materials, textures: materials.flatMap((m, k) => roles.map((role) => ({ id: `${m.id}/${role}`, role, top: role === "mro" ? 1024 : k >= SURFACE_NAMES.length ? 64 : 2048 }))) };
}
/** A residency that holds `held` steps by texture and keeps the pixels each texture was last asked for at. */
function finishResidency(held: Int8Array, again: number[] = []) {
  const asked = new Map<number, number>(), asks: string[] = [];
  return { asked, asks, format: "bc" as const, shown: (t: number, px: number, weight: number, needed: boolean) => void (asked.set(t, px), asks.push(`${weight} ${needed}`)), holds: (t: number) => held[t]!, canHave: () => true, again: (t: number) => void (again.push(t), (held[t] = -1)) };
}
/** Every surface at the eye, and none within reach. */
const AT_EYE = new Float32Array(NEAR_GLASS + 1), NONE = new Float32Array(NEAR_GLASS + 1).fill(Infinity);

test("a frame asks for each finish's maps no wider than its tier keeps them, tells the card the finest level any layer has come to and each layer's own over it, and has them taken again when that side changes", () => {
  const { materials, textures } = finishPack(false);
  const n = SURFACE_NAMES.length, held = new Int8Array(n * 3).fill(-1), again: number[] = [];
  const residency = finishResidency(held, again);
  const finishes = new WorldFinishes(materials, textures), p = new FramePacket();
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect([residency.asked.size, residency.asked.get(0), residency.asked.get(1), residency.asked.get(2), [...p.worldSide], [...p.worldLevel], again.length]).toEqual([n * 3, 1024, 1024, 512, [1024, 1024, 512], [-1, -1, -1], n * 3]);
  // Every texture at its first step but one base colour a step further: its array is read from that one's 128-pixel
  // level, every other layer held a level over it, at its 64.
  held.fill(0); held[0] = 1;
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect([[...p.worldLevel], p.worldLeast[0], p.worldLeast[3], p.worldLeast[1], p.worldLeast[2]]).toEqual([[3, 4, 3], 0, 1, 0, 0]);
  // Come to their widest, the arrays are read from their widest; a layer that came down eases to it, WORLD_EASE a frame.
  held.fill(4); held[2] = 3;
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect([[...p.worldLevel], p.worldLeast[0], p.worldLeast[3]]).toEqual([[0, 0, 0], 3 - WORLD_EASE, 4 - WORLD_EASE]);
  for (let f = 0; f < 4 / WORLD_EASE; f++) finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect(p.worldLeast.every((v) => v === 0)).toBe(true);
  // One let go to its first step is held there at once.
  held[3] = 0;
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect([p.worldLevel[0], p.worldLeast[3]]).toEqual([0, 4]);
  again.length = 0;
  // A frame drawn without the edges (`?off=edges`) is followed by one with them.
  p.frame[FRAME.edgesOff] = 1;
  finishes.frame(p, residency, tierOf("ultra"), AT_EYE, 1000);
  expect(p.frame[FRAME.edgesOff]).toBe(0);
  expect([[...p.worldSide], [...p.worldLevel], again.length]).toEqual([[2048, 2048, 1024], [-1, -1, -1], n * 3]);
  // The touch rule's light finish reads the base colour alone: only that is asked for and held, and the rest let go.
  held.fill(4); residency.asked.clear(); again.length = 0;
  finishes.frame(p, residency, forTouch(tierOf("high"), true), AT_EYE, 1000);
  expect([residency.asked.size, residency.asked.get(0), [...p.worldSide], [...p.worldLevel], again.length]).toEqual([n, 1024, [1024, 0, 0], [-1, -1, -1], n * 3]);
  held.fill(4);
  finishes.frame(p, residency, forTouch(tierOf("high"), true), AT_EYE, 1000);
  expect([...p.worldLevel]).toEqual([0, -1, -1]);
  finishes.frame(p, residency, tierOf("lowpoly"), AT_EYE, 1000);
  expect([[...p.worldSide], [...p.worldLevel]]).toEqual([[0, 0, 0], [-1, -1, -1]]);
  for (const tier of TIERS) expect([tier.name, tier.finishes]).toEqual([tier.name, { lowpoly: 0, medium: 512, high: 1024, ultra: 2048 }[tier.name]]);
});

test("the card makes its textures from the frame every finish's maps have come, at the tier's side, and goes on while one is let go; the card's budget holds them from the first", () => {
  const { materials, textures } = finishPack(false);
  const held = new Int8Array(SURFACE_NAMES.length * 3).fill(-1), residency = finishResidency(held);
  const finishes = new WorldFinishes(materials, textures), p = new FramePacket();
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect([p.texgenSide, finishes.wanted]).toEqual([0, 512]);
  held.fill(0);
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect(p.texgenSide).toBe(512);
  held[4] = -1;
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect(p.texgenSide).toBe(512);
  // Ultra's array is as wide (layers.ts TEXGEN_BUDGET), so the making goes on; the phones' light finish and low poly make none.
  finishes.frame(p, residency, tierOf("ultra"), AT_EYE, 1000);
  expect([p.texgenSide, finishes.wanted]).toEqual([512, 512]);
  for (const tier of [forTouch(tierOf("high"), true), tierOf("lowpoly")]) {
    held.fill(4);
    finishes.frame(p, residency, tier, AT_EYE, 1000);
    expect([p.texgenSide, finishes.wanted]).toEqual([0, 0]);
  }
});

test("each finish is asked for as wide as its nearest surface shows it, twice where the tier reads at a slant; a mask as the nearest of what reads it needs, concrete where paint lets go to it; never wider than the tier keeps, and its first step alone where nothing shows it", () => {
  const { materials, textures } = finishPack(true);
  const n = SURFACE_NAMES.length, held = new Int8Array(textures.length).fill(4);
  const residency = finishResidency(held);
  const finishes = new WorldFinishes(materials, textures), p = new FramePacket();
  const id = (name: string): number => (SURFACE_NAMES as readonly string[]).indexOf(name);
  const near = NONE.slice();
  near[id("asphalt")] = 2.5;
  near[id("plaster")] = 10;
  near[NEAR_WALL] = 8;
  const at = (finish: number, role: number): number => residency.asked.get(3 * finish + role)!;
  finishes.frame(p, residency, tierOf("high"), near, 500);
  // 500 pixels a metre a metre off, a tile of asphalt 2.5 m across 2.5 m off, twice: 1000; plaster 10 m off, 250. Their
  // packed maps as wide, but no wider than the packed array's 512.
  expect([at(id("asphalt"), 0), at(id("asphalt"), 1), at(id("asphalt"), 2), at(id("plaster"), 0), at(id("plaster"), 2)]).toEqual([1000, 1000, 512, 250, 250]);
  expect([SURFACE_WEATHERING.plaster.peel > 0, at(id("concrete"), 0), at(id("grass"), 0), at(id("grass"), 2)]).toEqual([true, (2 * 500 * finishMetres(id("concrete"), p.surfaceCity)) / 10, 0, 0]);
  // The road's macro and its repairs on the asphalt, to the array's side; the walls' weathering is made, not asked for.
  expect([at(n, 2), at(n + 1, 2), residency.asked.has(3 * n), residency.asked.has(3 * (n + 2) + 2)]).toEqual([512, 512, false, false]);
  // Read head on, once: half as wide; and no wider than medium keeps them.
  finishes.frame(p, residency, { ...tierOf("high"), anisotropy: 1 }, near, 500);
  expect([at(id("asphalt"), 0), at(id("plaster"), 0)]).toEqual([500, 125]);
  finishes.frame(p, residency, tierOf("medium"), AT_EYE, 500);
  expect([at(id("asphalt"), 0), at(id("asphalt"), 2)]).toEqual([512, 256]);
});

test("every read of the finishes' arrays goes through worldGrad, held to its layer's finest level on the card, which widens a read only where a level less than that could be read; the weathering masks, made whole on the card, are read directly", () => {
  for (const text of [WORLD_GLSL, ROAD_GLSL]) expect(text.match(/textureGrad\(uWorld/g)).toBeNull();
  expect(WORLD_GLSL.match(/textureGrad\((?!uTexgen)/g)!.length).toBe(1);
  expect(WORLD_GLSL.match(/textureGrad\(uTexgen/g)!.length).toBe(3);
  for (const read of ["worldBase(q, id, dx, dy)", "worldOrm(q, id, dx, dy)", "worldNormal(qb, id, bx, by)"]) expect(WORLD_GLSL).toContain(read);
  for (const layer of [ROAD_LAYER, REPAIRS_LAYER]) expect(ROAD_GLSL).toContain(`, ${layer}, `);
});

test("the eye's place in each finish's tiles is given to the card without its whole tiles, so a far corner of the map reads its texture as finely as the middle", () => {
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const phase = new Float32Array(SURFACE_NAMES.length * 3);
  worldPhase(phase, 16383.7, 12.3, 8191.4, city);
  for (let k = 0; k < SURFACE_NAMES.length; k++) {
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

test("a static's own frame is in its vertex text: its point in its frame, its place and its face", () => {
  const text = ownVertex(worldVertex(FLAT_MESH_VERTEX));
  for (const line of ["out vec3 vOwn;", "flat out vec2 vPlace;", "  vOwn = l;"]) expect(text).toContain(line);
  expect(() => ownVertex("void main() {}")).toThrow();
});

test("a wall's bays are keyed in the world: the same either side of a chunk's edge and along a wall a little off the axes, another for a wall a few metres off or facing the other way, and none on a roof", () => {
  const out = new Float64Array(6), key = (x: number, z: number, nx: number, nz: number): number => (wallFrame(x, z, nx, 0, nz, out), out[3]! < 0.5 ? out[1]! : out[2]!);
  // A wall facing north along x at z = 52.3: one key along a bay, another bay along, the same key whichever chunk draws it.
  expect(key(1001, 52.3, 0, 1)).toBe(key(1006.9, 52.3, 0, 1));
  wallFrame(1001, 52.3, 0, 0, 1, out);
  expect([out[0], out[3], out[4], out[5]]).toEqual([1001, 1, 2, 1]);
  // Two degrees off x: its plane moves 0.28 m a bay, yet every pixel of a bay has its middle's key.
  const n = [-Math.sin(0.035), Math.cos(0.035)], along = (t: number): [number, number] => [1000 + t * Math.cos(0.035), 52.3 + t * Math.sin(0.035)];
  const keys = new Set<number>();
  for (let t = 0.01; t < 7.99; t += 0.05) {
    const [x, z] = along(t);
    keys.add(key(x, z, n[0]!, n[1]!));
  }
  expect(keys.size).toBe(1);
  expect(key(1001, 55.3, 0, 1)).not.toBe(key(1001, 52.3, 0, 1));
  expect(key(1001, 52.3, 0, -1)).not.toBe(key(1001, 52.3, 0, 1));
  wallFrame(1001, 52.3, 0, 1, 0, out);
  expect(out[5]).toBe(0);
});

test("a wall on a plane cell's edge, or a millimetre either side of a whole metre, weathers the same as the float's last bits move: it takes a share of both keys", () => {
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const plaster = (SURFACE_NAMES as readonly string[]).indexOf("plaster");
  // Masks unlike from layer to layer and across each: a key that flipped would show.
  const masks: WorldSample = (_role, layer, u, v, _spread, out) => out.set([0.5 + 0.5 * Math.sin(layer * 2.1 + u * 9 + v * 13), 0.5 + 0.5 * Math.cos(layer * 1.3 + u * 7), 0.5 + 0.5 * Math.sin(layer + v * 5), 0.4]);
  const albedo = new Float64Array(3), orm = new Float64Array(3);
  const at = (x: number, z: number, nx: number, nz: number): number[] => {
    albedo.fill(0.5);
    orm.set([1, 0.8, 0]);
    weathered(albedo, orm, plaster, x, 6, z, nx, 0, nz, 6, 0.8, 0.004, city, masks, 1, masks);
    return [...albedo];
  };
  const out = new Float64Array(6);
  for (const turn of [0, 0.035]) {
    const nx = -Math.sin(turn), nz = Math.cos(turn);
    // A cell's edge (an eighth off the even metres), and two whole metres: each moved a millimetre either way.
    for (const plane of [52.125, 52, 53]) {
      for (const t of [1.3, 4.1, 6.6]) {
        const x = 1000 + t * Math.cos(turn), z = plane + t * Math.sin(turn);
        const here = at(x, z, nx, nz);
        // A part in a hundred, or under half a step of 255 where a channel is near black.
        for (const mm of [-0.001, 0.001]) at(x + nx * mm, z + nz * mm, nx, nz).forEach((c, k) => expect(Math.abs(c - here[k]!)).toBeLessThan(Math.max(0.01 * here[k]!, 0.5 / 255)));
      }
    }
  }
  // On the edge a wall's bays take half of each key; on a whole metre or a quarter they are far from one.
  wallFrame(1001, 52.125, 0, 0, 1, out);
  expect(out[3]).toBeCloseTo(0.5, 6);
  for (const plane of [52, 52.25, 52.5, 52.75, 53]) {
    wallFrame(1001, plane, 0, 0, 1, out);
    expect([0, 1]).toContain(out[3]!);
  }
});

test("a bay's choices are bits of one hash: every stamp about as often as the next, the ground storey from its own, each mirrored about half the time; and no bay takes the stamp of the bay beside it along or up the wall", () => {
  const out = new Float64Array(3), stamps = (WEATHER_BAYS + WEATHER_GROUND) * 2, mirrored = new Array(stamps).fill(0), seen = new Array(stamps).fill(0);
  let n = 0, ground = 0;
  const stamp = (bay: number, storey: number, key: number): number => (bayStamp(bay, storey, key, out), out[0]! * 2 + out[1]!);
  for (let key = 0; key < 100; key++) {
    for (let bay = -32; bay < 32; bay++) {
      for (let storey = 0; storey < 16; storey++) {
        const s = stamp(bay, storey, key);
        expect(s >= WEATHER_BAYS * 2).toBe(storey === 0);
        seen[s]++;
        if (out[2]) mirrored[s]++;
        storey === 0 ? ground++ : n++;
        expect(stamp(bay + 1, storey, key)).not.toBe(s);
        expect(stamp(bay, storey + 1, key)).not.toBe(s);
      }
    }
  }
  for (let s = 0; s < stamps; s++) {
    expect(seen[s] / (s < WEATHER_BAYS * 2 ? n / (WEATHER_BAYS * 2) : ground / (WEATHER_GROUND * 2))).toBeWithin(0.8, 1.2);
    expect(mirrored[s] / seen[s]).toBeWithin(0.4, 0.6);
  }
});

test("a wall weathers by the layers it is given, each with a tap and a mix: the field's tone on every face however wide its pixel, the stamp's light more under open sky, its stain rust up the wall and growth at the foot, its runoff in the finish's own colour, its damp smoothing the foot; plaster let go to concrete; sun bleaching facing the sun and a green film facing away; formwork on concrete up close; nothing while they are being made", () => {
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const id = (name: string): number => (SURFACE_NAMES as readonly string[]).indexOf(name);
  // The layers as nothing: half light (none), no cover.
  const bay = [0.5, 0, 0, 0], field = [0.5, 0, 0, 0], form = [0, 0, 0, 0];
  const sample: WorldSample = (role, layer, _u, _v, _spread, out) => out.set(role === 3 ? (layer < FIELD_LAYER ? bay : layer === FORMWORK_LAYER ? form : field) : [0.05, 0.05, 0.05, 1]);
  const at = (finish: string, o: { ny?: number; nz?: number; over?: number; open?: number; ready?: number; footprint?: number } = {}): number[] => {
    const albedo = Float64Array.of(0.5, 0.5, 0.5), orm = Float64Array.of(1, 0.8, 0);
    const ny = o.ny ?? 0, nz = o.nz ?? (ny ? 0 : 1);
    weathered(albedo, orm, id(finish), 10.7, 3, 30.2, 0, ny, nz, o.over ?? 3, o.open ?? 1, o.footprint ?? 0.01, city, sample, o.ready ?? 1, sample);
    return [...albedo, orm[1]!];
  };
  const none = [0.5, 0.5, 0.5, 0.8];
  for (const finish of ["concrete", "plaster", "brick", "steel"]) expect(at(finish)).toEqual(none);
  // The field's tone lightens a wall seen near or far and a roof, but nothing else reaches a roof or a wall whose pixel is twice WEATHER_SEEN.
  field[0] = 0.6;
  for (const o of [{}, { ny: 1 }, { footprint: 2 * WEATHER_SEEN }]) expect(at("concrete", o)[0]!).toBeGreaterThan(0.5);
  field[0] = 0.5;
  bay.splice(0, 4, 0.3, 1, 1, 1);
  for (const o of [{ ny: 1 }, { footprint: 2 * WEATHER_SEEN }]) expect(at("concrete", o)).toEqual(none);
  // It fades as the pixel grows past WEATHER_SEEN, as the finishes go to their means.
  expect(at("concrete", { footprint: WEATHER_SEEN })).not.toEqual(none);
  expect(Math.abs(at("concrete", { footprint: 1.5 * WEATHER_SEEN })[0]! - 0.5)).toBeLessThan(Math.abs(at("concrete")[0]! - 0.5));
  // The stamp's light darkens more under the open sky; its damp smooths the finish.
  bay.splice(0, 4, 0.3, 0, 0, 1);
  const open = at("concrete"), shut = at("concrete", { open: 0 });
  expect(open[0]!).toBeLessThan(shut[0]!);
  expect(open[3]!).toBeLessThan(0.8);
  // Its stain is rust up the wall and growth under GROWTH_TOP.
  bay.splice(0, 4, 0.5, 1, 0, 0);
  const rust = at("concrete", { over: 3 }), growth = at("concrete", { over: 0.3 });
  expect(rust[0]! / rust[2]!).toBeGreaterThan(1.5);
  expect(growth[1]! / growth[0]!).toBeGreaterThan(1.1);
  // Its runoff takes the finish's own colour: grime on concrete, salt on brick, rust on steel.
  bay.splice(0, 4, 0.5, 0, 1, 0);
  expect(at("concrete")[0]!).toBeLessThan(0.4);
  expect(at("brick")[0]!).toBeGreaterThan(0.55);
  expect(at("steel")[0]! / at("steel")[2]!).toBeGreaterThan(1.5);
  bay.splice(0, 4, 0.5, 0, 0, 0);
  // Plaster lets go to the concrete under it, darker here, and is darker at a loss's rim; concrete does neither.
  field[3] = 1;
  expect(at("plaster")[0]!).toBeLessThan(0.1);
  field[3] = 0.5;
  expect(at("plaster")[0]!).toBeCloseTo(0.35, 6);
  expect(at("concrete")).toEqual(none);
  field[3] = 0;
  // Facing the afternoon sun plaster bleaches; facing away in the shade it greens.
  field.splice(1, 2, 1, 1);
  const sun = at("plaster", { nz: -1 }), shade = at("plaster", { nz: 1, open: 0 });
  expect(sun[0]!).toBeGreaterThan(0.5);
  expect(shade[1]! / shade[0]!).toBeGreaterThan(1.05);
  field.splice(1, 2, 0, 0);
  // The formwork darkens concrete near the eye, not plaster, and lets go as the pixel grows.
  form[0] = 1;
  expect(at("concrete")[0]!).toBeLessThan(0.35);
  expect([at("plaster"), at("concrete", { footprint: 0.1 })]).toEqual([none, none]);
  // While the layers are made nothing of them shows.
  bay.splice(0, 4, 0.2, 1, 1, 1);
  field.splice(0, 4, 0.9, 1, 1, 1);
  expect(at("plaster", { ready: 0 })).toEqual(none);
});

test("with the masks in the pack, a frame asks for their packed maps alone, as wide as the packed array keeps, and the array is not drawn until they are in", () => {
  const { materials, textures } = finishPack(true);
  const n = SURFACE_NAMES.length, held = new Int8Array(textures.length).fill(4);
  const residency = finishResidency(held);
  const finishes = new WorldFinishes(materials, textures), p = new FramePacket();
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect([residency.asked.size, residency.asked.get(3 * n + 2), residency.asked.has(3 * n)]).toEqual([n * 3 + 2, 512, false]);
  held.fill(4); held[n * 3 + 2] = -1;
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect([...p.worldLevel]).toEqual([0, 0, -1]);
  held[n * 3 + 2] = 3;
  finishes.frame(p, residency, tierOf("high"), AT_EYE, 1000);
  expect([...p.worldLevel]).toEqual([0, 0, 0]);
});

test("a static's face finds its nearest outer border from its corners, and its edge turns, wears and chips there, less as a pixel grows and not at all on a border that is a join", () => {
  const out = new Float64Array(4), pu = [0, 2, 0], pv = [0, 0, 1];
  edgeOf(0.01, 0.5, 0b0001, pu, pv, out);
  expect([out[0]!, ...out.slice(1)].map((c) => +c.toFixed(9))).toEqual([0.02, 0, -1, 0]);
  edgeOf(0.01, 0.97, 0b1010, pu, pv, out);
  expect([out[0]!, ...out.slice(1)].map((c) => +c.toFixed(9))).toEqual([0.03, 0, 0, 1]);
  edgeOf(0.5, 0.5, 0, pu, pv, out);
  expect(out[0]).toBe(-1);
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const concrete = (SURFACE_NAMES as readonly string[]).indexOf("concrete"), steel = (SURFACE_NAMES as readonly string[]).indexOf("steel");
  const at = (index: number, dist: number, footprint = 0.002, line = false, painted = 7): number[] => {
    const albedo = Float64Array.of(0.4, 0.4, 0.4), orm = Float64Array.of(1, 0.8, 0), normal = Float64Array.of(1, 0, 0);
    edged(albedo, orm, normal, index, dist, 0, 1, 0, painted, 4, 5, 6, footprint, city, line);
    return [...albedo, ...orm, ...normal];
  };
  const inside = at(concrete, 1), edge = at(concrete, 0.001);
  expect(inside).toEqual([0.4, 0.4, 0.4, 1, 0.8, 0, 1, 0, 0]);
  // On the arris the normal leans out across the edge and the edge is lighter; a pixel wider than it sees neither.
  expect(edge[7]!).toBeGreaterThan(0.3);
  expect(edge[0]!).toBeGreaterThan(0.4);
  expect(at(concrete, 0.001, EDGE_ROUND * 10)).toEqual(inside);
  expect(at(concrete, 0.001, 0.002, true)[7]).toBe(0);
  // Where the painted height is low by the edge it is chipped: concrete to darker, rougher aggregate, steel to bare metal.
  const chipped = at(concrete, 0.005, 0.002, false, 0), sound = at(concrete, 0.005);
  expect(chipped[0]!).toBeLessThan(sound[0]!);
  expect(chipped[4]!).toBeGreaterThan(sound[4]!);
  expect(at(steel, 0.005, 0.002, false, 0)[5]!).toBeGreaterThan(0.5);
});

test("the finishes are drawn from their base colours as soon as those have all come, asked for ahead of other textures, and come up to every map over a moment once the rest have", () => {
  const roles = ["base", "normal", "mro"] as const;
  const materials: PackMaterial[] = SURFACE_NAMES.map((name, k) => ({ id: surfaceMaterial(name), base: 3 * k, normal: 3 * k + 1, mro: 3 * k + 2, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 0 }));
  const textures: PackTexture[] = materials.flatMap((m) => roles.map((role) => ({ id: `${m.id}/${role}`, role, top: role === "mro" ? 1024 : 2048 })));
  const n = SURFACE_NAMES.length, held = new Int8Array(n * 3).fill(-1);
  const residency = finishResidency(held);
  const finishes = new WorldFinishes(materials, textures), p = new FramePacket();
  // Nothing in: drawn as their means while they can come. Every map is asked for as if WORLD_NEAR off, and needed.
  finishes.frame(p, residency, tierOf("high"), NONE, 1000);
  expect([[...p.worldLevel], p.worldEarly, p.worldComing, [...new Set(residency.asks)]]).toEqual([[-1, -1, -1], 1, true, [1, 0.5, 0.25].map((w) => `${w / WORLD_NEAR} true`)]);
  // Where nothing can bring them (a picture made with no network), they are not drawn early but plain, as before them.
  finishes.frame(p, { ...residency, canHave: () => false }, tierOf("high"), NONE, 1000);
  expect(p.worldComing).toBe(false);
  // The base colours in: drawn from them alone, early.
  for (let k = 0; k < n; k++) held[3 * k] = 0;
  finishes.frame(p, residency, tierOf("high"), NONE, 1000);
  expect([p.worldLevel[0]! >= 0, p.worldLevel[1], p.worldLevel[2], p.worldEarly]).toEqual([true, -1, -1, 1]);
  // All in: early falls to 0 over WORLD_RISE frames, and comes back to 1 if a map is let go.
  held.fill(0);
  const rise: number[] = [];
  for (let f = 0; f < WORLD_RISE + 2; f++) {
    finishes.frame(p, residency, tierOf("high"), NONE, 1000);
    rise.push(p.worldEarly);
  }
  expect([rise[0]!, rise.every((e, k) => k === 0 || e <= rise[k - 1]!), rise.at(-1)]).toEqual([1 - 1 / WORLD_RISE, true, 0]);
  held[5] = -1;
  finishes.frame(p, residency, tierOf("high"), NONE, 1000);
  expect(p.worldEarly).toBe(1);
});

test("drawn early, a finish keeps its base colours and stands at its packed map's means with no lean: what the missing maps would add is all that changes as they come", () => {
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const id = (SURFACE_NAMES as readonly string[]).indexOf("concrete"), mean = WORLD_MRO[id]!.map((b) => b / 255);
  // A place where the finish's second copy does not show, where the heights would decide nothing between the copies.
  const metres = finishMetres(id, city);
  let x = 0.1;
  while (secondShare(x / metres, 7.1 / metres) > 0) x += 0.37;
  const at = (early: number, mro: number[], normal: number[]): number[] => {
    const sample: WorldSample = (role, _layer, u, v, _spread, out) => out.set(role === 0 ? [0.3 + 0.2 * (u - Math.floor(u)), 0.25, 0.2 + 0.1 * (v - Math.floor(v)), 1] : role === 1 ? normal : mro);
    const albedo = Float64Array.of(0.4, 0.4, 0.4), orm = new Float64Array(3), normalOut = new Float64Array(3);
    worldSurface(albedo, orm, normalOut, albedo, id, x, 0, 7.1, 0, 1, 0, 0.002, city, sample, false, null, null, early);
    return [...albedo, ...orm, ...normalOut].map((c) => Number(c.toFixed(6)));
  };
  // Maps that add nothing: a flat normal and the packed map's means. Early or not, the same picture.
  const flat = [128 / 255, 128 / 255, 1, 1], plain = [...mean, 0.5];
  expect(at(1, [0.2, 0.9, 0.3, 0.8], [0.9, 0.1, 1, 1])).toEqual(at(0, plain, flat));
  expect(at(0.5, plain, flat)).toEqual(at(0, plain, flat));
  // Before anything has come, the finish is its means, its base colour's too, and reads no map at all; that mean is what
  // the base colour map comes to at its coarsest, so the first of it to come sharpens the picture and does not recolour it.
  const read = (early: number, sample: WorldSample): number[] => {
    const albedo = Float64Array.of(0.4, 0.4, 0.4), orm = new Float64Array(3), normalOut = new Float64Array(3);
    worldSurface(albedo, orm, normalOut, albedo, id, x, 0, 7.1, 0, 1, 0, 0.002, city, sample, false, null, null, early);
    return [...albedo, ...orm, ...normalOut].map((c) => Number(c.toFixed(6)));
  };
  const base = WORLD_BASE[id]!.map((b, c) => (c < 3 ? srgbToLinear(b / 255) : b / 255));
  expect(read(2, (role) => { throw new Error(`read role ${role}`); })).toEqual(read(1, (role, _layer, _u, _v, _spread, out) => out.set(role === 0 ? base : role === 1 ? flat : plain)));
  // Maps that do add something: early, none of it; risen, all of it; between, between.
  const [none, half, all] = [1, 0.5, 0].map((e) => at(e, [0.6, 0.4, 0, 0.8], [0.7, 0.4, 1, 1]));
  expect(none).toEqual(at(1, plain, flat));
  expect(all).not.toEqual(none);
  expect(half.every((c, k) => c >= Math.min(none[k]!, all[k]!) - 1e-6 && c <= Math.max(none[k]!, all[k]!) + 1e-6)).toBe(true);
});

test("asphalt wears by its macro and its repairs in 8 m squares, sand by the beach's macro, and nothing else wears", () => {
  const id = (name: string): number => (SURFACE_NAMES as readonly string[]).indexOf(name);
  const masks = { road: [0.5, 0.5, 0.5, 0.5], repairs: [0, 0, 0, 0] };
  const sample: WorldSample = (_role, layer, _u, _v, _spread, out) => out.set(layer === ROAD_LAYER ? masks.road : layer === REPAIRS_LAYER ? masks.repairs : [0, 0, 0, 0]);
  const at = (finish: string, x = 10, z = 10): number[] => {
    const albedo = Float64Array.of(0.2, 0.2, 0.2), orm = Float64Array.of(1, 0.8, 0);
    roadWorn(albedo, orm, id(finish), x, z, 0.002, sample);
    return [albedo[0]!, orm[1]!];
  };
  const plain = at("asphalt");
  expect(plain).toEqual([0.2, 0.8]);
  // The macro lightens and roughens where it says; sand takes its own, and paving none.
  masks.road = [0.9, 0.9, 0.9, 0.5];
  expect(at("asphalt")[0]!).toBeGreaterThan(plain[0]!);
  expect(at("asphalt")[1]!).toBeGreaterThan(plain[1]!);
  expect(at("sand")[0]!).toBeGreaterThan(0.2);
  expect(at("paving")).toEqual([0.2, 0.8]);
  // Open cracks darken every square away from its edge; seams and seals are tar in some squares only.
  masks.road = [0.5, 0.5, 0.5, 0.5];
  masks.repairs = [0, 0, 0, 1];
  expect(at("asphalt")[0]!).toBeLessThan(plain[0]!);
  expect(at("asphalt", 8, 10)).toEqual(plain);
  masks.repairs = [0, 1, 1, 0];
  const squares = Array.from({ length: 64 }, (_, k) => at("asphalt", 4 + (k % 8) * 8, 4 + Math.floor(k / 8) * 8)[0]!);
  expect(squares.some((v) => v < 0.1)).toBe(true);
  expect(squares.some((v) => v === 0.2)).toBe(true);
});

test("along a road's frame asphalt wears by its lanes: a wheel path under each pair of wheels, dirt in its gutters, and its repairs a lane wide", () => {
  // A two-way street of two lanes along x, 5 m either side of z = 40, on 33 cells a side 4 m apart.
  const cells = 33, planes = [0, 1, 2, 3].map(() => new Uint8Array(cells * cells));
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const across = j * 4 - 40, k = j * cells + i;
    if (Math.abs(across) > 8) continue;
    [roadAcross(across), roadAlong(i * 4), roadHalf(5), 2 | (2 << ROAD_WEAR_SHIFT)].forEach((v, p) => (planes[p]![k] = v));
  }
  const road = new RoadSectors();
  road.put(0, 0, 0, cells, { across: planes[0]!, along: planes[1]!, half: planes[2]!, lanes: planes[3]! });
  const frame = new Float64Array(ROAD_FRAME);
  roadFrameAt(road, 50, 41, frame);
  expect([...frame].map((v) => Number(v.toFixed(4)))).toEqual([50, 1, 1, 1, 0, 0, 1, 5, 2, 0, Number((2 / 6).toFixed(4))]);
  // Off the road, and where the four cells are not one carriageway's, there is no frame.
  roadFrameAt(road, 50, 60, frame);
  expect(frame[2]).toBe(0);
  const id = (SURFACE_NAMES as readonly string[]).indexOf("asphalt");
  let masks = { road: [0.5, 0.5, 0.5, 0.5], repairs: [0, 0, 0, 0] };
  const sample: WorldSample = (_role, layer, _u, _v, _spread, out) => out.set(layer === ROAD_LAYER ? masks.road : masks.repairs);
  const at = (x: number, z: number): number => {
    const albedo = Float64Array.of(0.2, 0.2, 0.2), orm = Float64Array.of(1, 0.8, 0), f = new Float64Array(ROAD_FRAME);
    roadFrameAt(road, x, z, f);
    roadWorn(albedo, orm, id, x, z, 0.002, sample, f);
    return albedo[0]!;
  };
  // A lane is 5 m from the kerb at z = 35: its wheel path at 0.27 of it is darker than between the paths, and so is the gutter.
  expect(at(50, 35 + 0.27 * 5)).toBeLessThan(at(50, 35 + 0.4 * 5));
  expect(at(50, 35.25)).toBeLessThan(at(50, 35 + 0.4 * 5));
  // With every repair patched where its cell is, the two lanes' cells side by side differ somewhere along the road.
  masks = { road: [0.5, 0.5, 0.5, 0.5], repairs: [1, 0, 0, 0] };
  const lanes = Array.from({ length: 12 }, (_, k) => [at(4 + k * 8, 37.5), at(4 + k * 8, 42.5)]);
  expect(lanes.some(([a, b]) => a !== b)).toBe(true);
});

test("a walk wears by its 1.5 m panels and their joints, each by where it is, and nothing else does", () => {
  const city = new Float32Array(12); citySurface(city, "core:miami");
  const panel = finishMetres((SURFACE_NAMES as readonly string[]).indexOf("sidewalk"), city) / 2;
  let mask = [0.9, 0.9, 0.9, 0.9];
  const sample: WorldSample = (_role, _layer, _u, _v, _spread, out) => out.set(mask);
  const at = (finish: string, x: number, z: number, footprint = 0.002): number[] => {
    const albedo = Float64Array.of(0.3, 0.3, 0.3), orm = Float64Array.of(1, 0.8, 0), normal = Float64Array.of(0, 1, 0);
    walkWorn(albedo, orm, normal, (SURFACE_NAMES as readonly string[]).indexOf(finish), x, z, footprint, city, sample);
    return [...albedo, orm[1]!, ...normal];
  };
  expect(at("asphalt", 1, 1)).toEqual([0.3, 0.3, 0.3, 0.8, 0, 1, 0]);
  // Inside a panel one look throughout; panels differ from each other in tone, and some lean.
  const middles = Array.from({ length: 100 }, (_, k) => at("sidewalk", ((k % 10) + 0.5) * panel, (Math.floor(k / 10) + 0.5) * panel));
  expect(at("sidewalk", 0.4 * panel, 0.6 * panel)[0]).toBe(at("sidewalk", 0.6 * panel, 0.4 * panel)[0]!);
  expect(new Set(middles.map((m) => m[0]!.toFixed(4))).size).toBeGreaterThan(50);
  expect(middles.some((m) => m[5]! < 1)).toBe(true);
  expect(middles.some((m) => m[5] === 1)).toBe(true);
  // Stains and cracks follow the masks; with masks that mark nothing, no panel is darker than its tone.
  mask = [0, 0, 0, 0];
  const bare = Array.from({ length: 100 }, (_, k) => at("sidewalk", ((k % 10) + 0.5) * panel, (Math.floor(k / 10) + 0.5) * panel)[0]!);
  expect(bare.filter((v, k) => v > middles[k]![0]! + 1e-9).length).toBeGreaterThan(0);
  // Some joints hold grass or dirt and some nothing; a far pixel sees little of either.
  const joints = Array.from({ length: 200 }, (_, k) => at("sidewalk", (Math.floor(k / 2) + 0.5) * panel, (k % 2) * panel * 7));
  expect(joints.some((j) => j[1]! > j[0]! * 1.3)).toBe(true);
  expect(joints.some((j) => j[3]! > 0.85 && j[1]! < j[0]! * 1.3)).toBe(true);
  const near = joints.map((j) => j[0]!), far = Array.from({ length: 200 }, (_, k) => at("sidewalk", (Math.floor(k / 2) + 0.5) * panel, (k % 2) * panel * 7, 0.5)[0]!);
  const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
  expect(spread(far)).toBeLessThan(spread(near));
});

test("a walk meets another finish on a line, over a pixel across it", () => {
  // A pixel 1 cm wide is a hundredth of the share across a 2 m sample.
  expect(walkMeet(0.5, 0.01)).toBe(0.5);
  expect(walkMeet(0.495, 0.01)).toBe(0);
  expect(walkMeet(0.2, 0.01)).toBe(0);
  // Where the other finish weighs more than the cover's own (its samples split between two tints), all of it shows.
  expect(walkMeet(0.505, 0.01)).toBe(1);
  expect(walkMeet(0.8, 0.01)).toBe(1);
  const ramp = [0.496, 0.498, 0.5, 0.502, 0.504].map((s) => walkMeet(s, 0.01));
  expect(ramp.every((v, k) => k === 0 || v > ramp[k - 1]!)).toBe(true);
});
