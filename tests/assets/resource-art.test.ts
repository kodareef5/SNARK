import { expect } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { iconSubjects } from "../../tools/pack/icons.ts";
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
