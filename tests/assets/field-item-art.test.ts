import { expect } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { B_PROP_R } from "../../shared/anim/human.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { iconSubjects } from "../../tools/pack/icons.ts";
import { spanOf } from "../../tools/pack/surface.ts";
import { unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";

const families = {
  "core:food": ["meat", "meat_cooked", "meat_prime", "meat_prime_cooked", "spoiled_meat", "jerky", "jerky_prime"],
  "core:field-supplies": ["berry", "narcoberry", "stimberry", "narcotic", "stimulant", "waterskin", "water_jar", "canteen"],
  "core:instruments": ["spyglass", "template_hammer", "compass", "magnifying_glass", "radio", "gps"],
  "core:saddles-early": ["saddle_parasaur", "saddle_pteranodon", "saddle_raptor", "saddle_trike", "saddle_carbonemys"],
  "core:saddles-heavy": ["saddle_stego", "saddle_rex", "saddle_spino", "saddle_brachio"],
};

function expectFlatColours(mesh: SourceMesh): void {
  for (const [level, lod] of mesh.lods.entries()) {
    if (!lod.sections) expect(new Set(lod.colors).size, `${mesh.id} at flat level ${level}`).toBeGreaterThan(1);
  }
}

artTest("field item packs ship grounded drops and inventory icons", async () => {
  const assets = await findAssets();
  const drops = new Set<string>();
  for (const [id, items] of Object.entries(families)) {
    const asset = assets.find((a) => a.id === id);
    expect(asset, id).toBeDefined();
    const pack = parsePack(await Bun.file(asset!.file).bytes());
    const meshes = unpackMeshes(pack);
    for (const item of items) {
      const drop = `core:${item}/dropped`;
      const mesh = pack.header.meshes.find((m) => m.id === drop);
      const source = meshes.find((m) => m.id === drop);
      expect(mesh, drop).toBeDefined();
      expect(source, drop).toBeDefined();
      expect(mesh!.center[1] - mesh!.half[1], drop).toBeCloseTo(0, 2);
      expect(mesh!.skeleton, drop).toBeUndefined();
      expect(source!.lods[0]!.sections, drop).toBeDefined();
      expect(source!.lods.length, drop).toBeGreaterThan(1);
      if (id === "core:instruments" || id === "core:saddles-early") expectFlatColours(source!);
      for (const [level, lod] of source!.lods.entries()) {
        if (level > 0) {
          const previous = source!.lods[level - 1]!;
          expect(lod.indices.length, drop).toBeLessThan(previous.indices.length);
          expect(lod.error, drop).toBeGreaterThan(previous.error ?? 0);
        }
        for (const material of new Set(lod.sections)) {
          const base = source!.materials![material]!.base;
          const density = source!.textures![base]!.top / spanOf(lod, material);
          expect(density, `${drop} at level ${level}, material ${material}`).toBeGreaterThanOrEqual(500);
        }
      }
      drops.add(drop);
    }
  }
  const icons = new Map(iconSubjects(CORE_CONTENT, (id) => drops.has(id)).map((i) => [i.mesh, i]));
  for (const drop of drops) {
    expect(icons.get(drop), drop).toMatchObject({ icon: `${drop.slice(0, -"/dropped".length)}/icon` });
  }
});

artTest("instruments and water carriers attach to the right hand", async () => {
  const assets = await findAssets();
  const held = {
    "core:field-supplies": ["waterskin", "water_jar", "canteen"],
    "core:instruments": families["core:instruments"],
  };
  for (const [family, items] of Object.entries(held)) {
    const asset = assets.find((a) => a.id === family);
    expect(asset, family).toBeDefined();
    const meshes = unpackMeshes(parsePack(await Bun.file(asset!.file).bytes()));
    for (const item of items) {
      const id = `core:${item}`;
      const mesh = meshes.find((m) => m.id === id);
      expect(mesh, id).toBeDefined();
      expect(mesh!.skeleton, id).toBe("human");
      if (family === "core:instruments") expectFlatColours(mesh!);
      for (const lod of mesh!.lods) {
        expect(lod.bones?.every((bone) => bone === B_PROP_R), id).toBe(true);
      }
    }
  }
});
