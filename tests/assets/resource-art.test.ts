import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { CORE_CONTENT } from "../../content/core.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { iconSubjects } from "../../tools/pack/icons.ts";
import { spanOf } from "../../tools/pack/surface.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";

const resources = [
  "angler_gel", "charcoal", "chitin", "crystal", "electronics", "fiber", "flint", "freight_order", "gasoline",
  "gunpowder", "hide", "ingot", "keratin", "obsidian", "oil", "ore", "organic_polymer", "paste", "pelt", "polymer",
  "silica_pearls", "sparkpowder", "stone", "thatch", "wood",
].map((name) => `core:${name}`);
const families = new Set(["core:resource-minerals", "core:resource-organics", "core:resource-supplies"]);

artTest("resource packs supply grounded drop meshes and inventory icons", async () => {
  const assets = (await findAssets()).filter((asset) => families.has(asset.id));
  expect(new Set(assets.map((asset) => asset.id))).toEqual(families);
  const meshes = [];
  for (const asset of assets) {
    const pack = parsePack(await Bun.file(asset.file).bytes());
    meshes.push(...pack.header.meshes);
    const family = unpackMeshes(pack);
    const organic = asset.id === "core:resource-organics";
    const minerals = asset.id === "core:resource-minerals";
    for (const mesh of family) {
      expect(mesh.lods[0]!.sections, mesh.id).toBeDefined();
      for (const [level, lod] of mesh.lods.entries()) {
        for (const index of new Set(lod.sections)) {
          const material = mesh.materials![index]!;
          const density = mesh.textures![material.base]!.top / spanOf(lod, index);
          expect(density, `${mesh.id}, level ${level}, ${material.id}`).toBeGreaterThanOrEqual(500);
        }
      }
    }
    if (minerals) {
      const materialsOf = (id: string) => family.find((mesh) => mesh.id === id)?.materials?.map((material) => material.id);
      expect(materialsOf("core:stone/dropped")).toContain("core:resource-minerals/stone");
      expect(materialsOf("core:flint/dropped")).toContain("core:stone-tools/flint");
    }
    if (organic) {
      const flat = family.map((mesh) => mesh.lods.at(-1)!.colors[0]);
      expect(new Set(flat).size).toBe(family.length);
    }
  }

  const expected = resources.map((id) => `${id}/dropped`);
  expect(meshes.map((mesh) => mesh.id).sort()).toEqual(expected);
  for (const mesh of meshes) {
    expect(mesh.skeleton, mesh.id).toBeUndefined();
    expect(mesh.center[1] - mesh.half[1], mesh.id).toBeCloseTo(0, 2);
    expect(mesh.lods.length, mesh.id).toBeGreaterThan(1);
    for (let level = 1; level < mesh.lods.length; level++) {
      const previous = mesh.lods[level - 1]!;
      const current = mesh.lods[level]!;
      expect(current.indexCount, mesh.id).toBeLessThan(previous.indexCount);
      expect(current.error, mesh.id).toBeGreaterThan(previous.error);
    }
  }

  const ids = new Set(expected);
  const icons = new Map(iconSubjects(CORE_CONTENT, (id) => ids.has(id)).map((icon) => [icon.owner, icon]));
  for (const id of resources) expect(icons.get(id)).toMatchObject({ icon: `${id}/icon`, mesh: `${id}/dropped` });
});

test("resource UV charts keep ring spans continuous and in metres", () => {
  const result = Bun.spawnSync(["python3", "-c", `
from math import dist, isclose
from runpy import run_path
import sys

uv = run_path(sys.argv[1])
ring = [(0, 0), (0.2, 0), (0.2, 0.2), (0, 0.2)]
loft = uv["loft_uv"]([[(x, y, z) for x, y in ring] for z in (0.0, 0.015, 0.18)])
thin, tall = loft[0][0], loft[1][0]
assert thin[2] == tall[1] and thin[3] == tall[0]
assert isclose(dist(thin[0], thin[1]), 0.2)
assert isclose(dist(thin[0], thin[3]), 0.015)
assert isclose(dist(tall[0], tall[3]), 0.165)
chart = uv["planar_uv"]([(0, 0, 0), (0.24, 0, 0), (0.24, 0, 0.04), (0, 0, 0.04)])
tile = uv["atlas_uv"](chart, span=0.48)
assert isclose(dist(tile[0], tile[1]), 0.5)
assert isclose(dist(tile[1], tile[2]), 0.04 / 0.48)
repeat = uv["atlas_uv"](chart, span=0.20)
assert isclose(dist(repeat[0], repeat[1]), 1.20)
`, fileURLToPath(new URL("../../assets/source/core/items/resource_uv.py", import.meta.url))]);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
