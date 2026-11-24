import { expect, test } from "bun:test";
import { join } from "node:path";
import { B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { checkAsset } from "../../tools/art/check.ts";
import { fromAssets } from "../../tools/wiki/credits.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

const asset = (await findAssets()).find((a) => a.id === "core:plasma")!;
const pack = parsePack(await Bun.file(asset.file).bytes());
const meshes = unpackMeshes(pack);
const GUNS = ["core:rifle_plasma", "core:pistol_plasma"];

test("the packed plasma guns and their bolt pass the art check", () => {
  expect(checkAsset(asset, pack, true).faults).toEqual([]);
});

test("each plasma gun is held on the right prop bone, muzzle forward of its grip", () => {
  for (const id of GUNS) {
    const mesh = meshes.find((m) => m.id === id)!;
    expect(mesh.skeleton).toBe(HUMAN.id);
    expect(new Set(mesh.lods[0]!.bones)).toEqual(new Set([B_PROP_R]));
    const header = pack.header.meshes.find((m) => m.id === id)!;
    expect(header.center[2]).toBeGreaterThan(0);
    expect(header.half[2]).toBeGreaterThan(header.half[1]);
    expect(meshes.some((m) => m.id === `${id}/dropped`)).toBe(true);
  }
});

test("each plasma gun keeps to the held budget at every level, in two materials", () => {
  for (const id of GUNS) {
    const mesh = meshes.find((m) => m.id === id)!;
    // The held item's budget, level by level (HELD_TRIANGLES beside the weapons' art).
    mesh.lods.forEach((lod, level) => expect(lod.indices.length / 3).toBeLessThanOrEqual([1200, 480, 160, 48][level]!));
    expect(mesh.materials!.map((m) => m.id).sort()).toEqual(["core:plasma/glow", "core:plasma/tek"]);
    expect(new Set(mesh.lods[0]!.sections).size).toBe(2);
  }
});

test("the plasma guns share one small set of pictures", () => {
  const textures = new Map(meshes.flatMap((m) => m.textures ?? []).map((t) => [t.id, t.top]));
  expect([...textures.keys()].sort()).toEqual(["core:plasma/tek/base", "core:plasma/tek/mro", "core:plasma/tek/normal"]);
  for (const top of textures.values()) expect(top).toBeLessThanOrEqual(512);
});

test("the bolt, flash and burst are one glowing level each, under 100 triangles", () => {
  for (const id of ["core:plasma_bolt", "core:plasma_flash", "core:plasma_burst"]) {
    const mesh = meshes.find((m) => m.id === id)!;
    expect(mesh.lods.length).toBe(1);
    expect(mesh.flat).toBe(1);
    expect(mesh.lods[0]!.indices.length / 3).toBeLessThan(100);
    expect(mesh.materials!.map((m) => [m.id, m.emissive > 2, m.flags])).toEqual([["core:plasma/plasma", true, 0]]);
  }
});

test("the bolt's head is at its origin and its tail a metre behind", () => {
  const header = pack.header.meshes.find((m) => m.id === "core:plasma_bolt")!;
  expect(header.center[2] + header.half[2]).toBeCloseTo(0, 3);
  expect(header.center[2] - header.half[2]).toBeCloseTo(-1, 3);
});

test("the plasma gun credits follow each model into the wiki", async () => {
  const { credits } = await fromAssets();
  const attribution = await Bun.file(join(asset.dir, "ATTRIBUTION.md")).text();
  const license = "https://creativecommons.org/licenses/by/4.0/";
  const models = [
    ["core:rifle_plasma", "Electric Rifle by Jerd", "https://sketchfab.com/3d-models/electric-rifle-1a940582312e41cdadca0fbe948da754"],
    ["core:pistol_plasma", "Low Poly Pistol by Jerd", "https://sketchfab.com/3d-models/low-poly-pistol-77d5a6313555495ca2810b6a1fe707a9"],
  ] as const;
  for (const [id, name, source] of models) {
    expect(attribution).toContain(source);
    for (const mesh of [id, `${id}/dropped`]) {
      expect(credits.get(mesh)).toContain(name);
      expect(credits.get(mesh)).toContain(source);
      expect(credits.get(mesh)).toContain(license);
      expect(credits.get(mesh)).toContain("SNARK simplified and retextured the model");
    }
  }
  expect(credits.get("core:pistol_plasma")).toContain("Quaternius");
  expect(attribution).toContain(license);
  for (const id of ["core:plasma_bolt", "core:plasma_flash", "core:plasma_burst"]) {
    expect(credits.get(id)).toBe("made for the game");
  }
});
