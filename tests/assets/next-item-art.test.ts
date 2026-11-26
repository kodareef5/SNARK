import { expect } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { B_PROP_R } from "../../shared/anim/human.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { iconSubjects } from "../../tools/pack/icons.ts";
import { boundsOf } from "../../tools/pack/lying.ts";
import { spanOf } from "../../tools/pack/surface.ts";
import { unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";

const handTools = ["torch", "slingshot", "club", "hatchet_metal", "pick_metal", "pike", "sickle", "sword"];

function expectLevels(mesh: SourceMesh, densityFloor: number): void {
  expect(mesh.lods[0]!.sections, mesh.id).toBeDefined();
  expect(mesh.flat, mesh.id).toBeGreaterThan(0);
  expect(mesh.flat, mesh.id).toBeLessThan(mesh.lods.length);
  for (const [level, lod] of mesh.lods.entries()) {
    const label = `${mesh.id} level ${level}`;
    const previous = mesh.lods[level - 1];
    if (previous) {
      expect(lod.indices.length / previous.indices.length, label).toBeLessThanOrEqual(0.55);
      expect(lod.error, label).toBeGreaterThan(previous.error ?? 0);
    }
    if (!lod.sections) {
      expect(new Set(lod.colors).size, label).toBeGreaterThan(1);
      continue;
    }
    const uses = new Set(lod.sections);
    expect(uses.size, label).toBeLessThanOrEqual(3);
    for (const material of uses) {
      const base = mesh.materials![material]!.base;
      const density = mesh.textures![base]!.top / spanOf(lod, material);
      expect(density, `${label} material ${material}`).toBeGreaterThanOrEqual(densityFloor);
    }
  }
}

async function meshesIn(id: string): Promise<Map<string, SourceMesh>> {
  const asset = (await findAssets()).find((entry) => entry.id === id);
  expect(asset, id).toBeDefined();
  const pack = parsePack(await Bun.file(asset!.file).bytes());
  return new Map(unpackMeshes(pack).map((mesh) => [mesh.id, mesh]));
}

artTest("hand tools ship grounded models, right-hand models and icons", async () => {
  const meshes = await meshesIn("core:hand-tools");
  const icons = new Map(iconSubjects(CORE_CONTENT, (id) => meshes.has(id)).map((icon) => [icon.owner, icon]));
  for (const tool of handTools) {
    const id = `core:${tool}`;
    const held = meshes.get(id);
    expect(held, id).toBeDefined();
    expect(held!.skeleton, id).toBe("human");
    for (const lod of held!.lods) expect(lod.bones?.every((bone) => bone === B_PROP_R), id).toBe(true);
    expectLevels(held!, 1000);

    const drop = meshes.get(`${id}/dropped`);
    expect(drop, id).toBeDefined();
    expect(drop!.skeleton, id).toBeUndefined();
    expect(boundsOf(drop!.lods[0]!)[0][1], id).toBeCloseTo(0, 2);
    expectLevels(drop!, 500);
    expect(icons.get(id), id).toMatchObject({ icon: `${id}/icon`, mesh: drop!.id });
  }
});
