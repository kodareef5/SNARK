// Inspect the delivered native geometry, independently of the source model's declared dimensions.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Assets } from "../../client/core/assets/assets.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { KORU_CONTENT, KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { nearestColour } from "../../shared/pack/palette.ts";
import { bothWays, measureSurface } from "../../tools/art/check.ts";
import { unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";

const pack = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/landmarks/koru/koru.snpk", import.meta.url))));
const meshes = unpackMeshes(pack), byId = new Map(meshes.map(mesh => [mesh.id, mesh]));
const compiled = compileContent(KORU_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg = compiled.registry;

test("every authored yacht section has six delivered native levels within the shared art budgets", () => {
  expect([...byId.keys()].sort()).toEqual(KORU_LAYOUT.modules.map(module => module.mesh).sort());
  const triangles = new Array<number>(6).fill(0);
  for (const mesh of meshes) {
    expect(mesh.lods.length, mesh.id).toBe(6);
    expect(mesh.flat, mesh.id).toBe(1);
    expect(mesh.materials!.length, mesh.id).toBeLessThanOrEqual(3);
    expect(mesh.materials!.length, mesh.id).toBeGreaterThan(0);
    mesh.lods.forEach((lod, level) => {
      triangles[level]! += lod.indices.length / 3;
      expect(lod.indices.length, `${mesh.id} level ${level}`).toBeGreaterThan(0);
      expect(lod.positions.every(Number.isFinite), mesh.id).toBe(true);
      if (level < mesh.flat!) expect(bothWays(lod), mesh.id).toEqual([]);
    });
  }
  expect(triangles[0]!).toBeLessThanOrEqual(360_000);
  for (let level = 1; level < 6; level++) expect(triangles[level]!).toBeLessThanOrEqual(triangles[level - 1]!);
  expect(triangles[5]!).toBeLessThan(triangles[0]! / 3);
  // The native card holds RGBA mip chains. Count shared textures once, as the built pack does.
  const bytes = (pack.header.textures ?? []).reduce((sum, texture) => {
    let pixels = 0; for (let side = texture.top; side >= 1; side = Math.floor(side / 2)) pixels += side * side;
    return sum + pixels * 4;
  }, 0);
  expect(bytes).toBeGreaterThan(0);
  expect(bytes / 1024 ** 2).toBeLessThanOrEqual(96);
});

test("packed yacht geometry stays within its native culling bounds and its published hull scale", () => {
  const hullLow = [Infinity, Infinity, Infinity], hullHigh = [-Infinity, -Infinity, -Infinity];
  let bowspritTip = -Infinity;
  for (const module of KORU_LAYOUT.modules) {
    const mesh = byId.get(module.mesh)!, kind = reg.index.get(module.id)!;
    const half = [reg.halfX[kind]!, reg.halfY[kind]!, reg.halfZ[kind]!];
    for (const lod of mesh.lods) {
      const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
      for (let vertex = 0; vertex < lod.positions.length; vertex += 3) for (let axis = 0; axis < 3; axis++) {
        const coordinate = lod.positions[vertex + axis]!;
        low[axis] = Math.min(low[axis]!, coordinate); high[axis] = Math.max(high[axis]!, coordinate);
      }
      for (let axis = 0; axis < 3; axis++) {
        expect(low[axis]!, `${module.id} axis ${axis}`).toBeGreaterThanOrEqual(-half[axis]! - .006);
        expect(high[axis]!, `${module.id} axis ${axis}`).toBeLessThanOrEqual(half[axis]! + .006);
        expect(low[axis]!, module.id).toBeGreaterThanOrEqual(module.visualBounds.min[axis]! - .006);
        expect(high[axis]!, module.id).toBeLessThanOrEqual(module.visualBounds.max[axis]! + .006);
      }
    }
    const fine = mesh.lods[0]!;
    if (module.category === "hull") for (let vertex = 0; vertex < fine.positions.length; vertex += 3) for (let axis = 0; axis < 3; axis++) {
      const coordinate = fine.positions[vertex + axis]! + module.origin[axis]!;
      hullLow[axis] = Math.min(hullLow[axis]!, coordinate); hullHigh[axis] = Math.max(hullHigh[axis]!, coordinate);
    }
    if (module.category === "bowsprit") for (let vertex = 2; vertex < fine.positions.length; vertex += 3) {
      bowspritTip = Math.max(bowspritTip, fine.positions[vertex]! + module.origin[2]!);
    }
  }
  expect(hullHigh[0]! - hullLow[0]!).toBeCloseTo(17.2, 2);
  expect(hullLow[2]!).toBeCloseTo(-54.5, 2);
  expect(hullHigh[2]!).toBeCloseTo(54.5, 2);
  expect(bowspritTip - hullLow[2]!).toBeCloseTo(125, 2);
  expect(hullLow[1]!).toBeLessThan(-6);
});

test("all yacht levels retain closed outward solid surfaces", () => {
  const faults: string[] = [];
  for (const mesh of meshes) mesh.lods.forEach((lod, level) => {
    const { holes, flipped, insideOut } = measureSurface(lod);
    if (holes || flipped || insideOut) faults.push(`${mesh.id} L${level}: ${JSON.stringify({ holes, flipped, insideOut })}`);
  });
  expect(faults).toEqual([]);
});

test("flat yacht levels preserve navy hull, teak decks and distinct furniture finishes", () => {
  const navy = nearestColour(pack.palette, 22, 32, 43), teak = nearestColour(pack.palette, 153, 111, 72);
  const linen = nearestColour(pack.palette, 216, 208, 188), joinery = nearestColour(pack.palette, 104, 66, 43);
  for (const module of KORU_LAYOUT.modules) {
    const mesh = byId.get(module.mesh)!;
    for (const lod of mesh.lods.slice(1)) {
      if (module.category === "hull") expect(lod.colors.includes(navy), module.id).toBe(true);
      if (module.category === "floor") expect(lod.colors.includes(teak), module.id).toBe(true);
    }
  }
  for (const level of [1, 2, 3]) {
    const colors = byId.get("core:koru_furniture_main_salon")!.lods[level]!.colors;
    expect(colors.includes(linen), `salon L${level}`).toBe(true);
    expect(colors.includes(joinery), `salon L${level}`).toBe(true);
  }
});

test("ordinary detail selection retains nearby interior finishes and still simplifies distant sections", () => {
  const assets = new Assets(reg, pack);
  const interiors = KORU_LAYOUT.modules.filter(module => ["furniture", "facade", "wall", "floor", "roof", "door"].includes(module.category));
  for (const tier of ["medium", "high"] as const) {
    assets.tier = tierOf(tier); assets.begin(0, 800, 1.2217);
    let distant = 0;
    for (const module of interiors) {
      const errors = assets.table.error[assets.table.find(module.mesh)]!;
      expect(assets.choose(errors, 5, -1), `${tier} nearby ${module.id}`).toBe(0);
      if (assets.choose(errors, 300, -1) > 0) distant++;
    }
    expect(distant).toBeGreaterThan(interiors.length / 2);
  }
  assets.tier = tierOf("lowpoly"); assets.begin(0, 800, 1.2217);
  for (const module of interiors) {
    const errors = assets.table.error[assets.table.find(module.mesh)]!;
    expect(assets.choose(errors, 1, -1), module.id).toBeGreaterThanOrEqual(1);
  }
});

interface WindowAperture {
  module: string;
  center: number[];
  normal: number[];
  clearWidth: number;
  clearHeight: number;
}

/** A short axial segment through one window plane, measured on the real triangles rather than its safety collider. */
function windowObstructions(lod: SourceLod, point: readonly number[], axis: number): number {
  const uAxis = (axis + 1) % 3, vAxis = (axis + 2) % 3;
  let hits = 0;
  for (let triangle = 0; triangle < lod.indices.length; triangle += 3) {
    const a = lod.indices[triangle]! * 3, b = lod.indices[triangle + 1]! * 3, c = lod.indices[triangle + 2]! * 3, p = lod.positions;
    const au = p[a + uAxis]!, av = p[a + vAxis]!, bu = p[b + uAxis]!, bv = p[b + vAxis]!, cu = p[c + uAxis]!, cv = p[c + vAxis]!;
    const denominator = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
    if (Math.abs(denominator) < 1e-10) continue;
    const u = ((bv - cv) * (point[uAxis]! - cu) + (cu - bu) * (point[vAxis]! - cv)) / denominator;
    const v = ((cv - av) * (point[uAxis]! - cu) + (au - cu) * (point[vAxis]! - cv)) / denominator;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const coordinate = u * p[a + axis]! + v * p[b + axis]! + (1 - u - v) * p[c + axis]!;
    if (Math.abs(coordinate - point[axis]!) < .3) hits++;
  }
  return hits;
}

test("deckhouse windows remain open to the eye in textured and near flat native geometry", () => {
  const windows = (KORU_LAYOUT as typeof KORU_LAYOUT & { windows: WindowAperture[] }).windows;
  expect(windows.length).toBeGreaterThan(24);
  const faults: string[] = [];
  for (const aperture of windows) {
    const module = KORU_LAYOUT.modules.find(module => module.id === aperture.module)!;
    expect(module.yaw).toBe(0);
    const mesh = byId.get(module.mesh)!, axis = aperture.normal.findIndex(value => Math.abs(value) > .5), across = axis === 0 ? 2 : 0;
    for (const level of [0, 1]) for (const x of [-.3, 0, .3]) for (const y of [-.3, 0, .3]) {
      const point = aperture.center.map((coordinate, axis) => coordinate - module.origin[axis]!);
      point[across]! += x * aperture.clearWidth; point[1]! += y * aperture.clearHeight;
      if (windowObstructions(mesh.lods[level]!, point, axis)) faults.push(`${module.id} L${level} window ${aperture.center.join(",")} sample ${x},${y}`);
    }
  }
  expect(faults).toEqual([]);
});
