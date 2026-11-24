import { expect, test } from "bun:test";
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

test("the wiki credits every plasma piece to the model's author", async () => {
  const { credits } = await fromAssets();
  for (const id of GUNS) expect(credits.get(id)).toBe(asset.spec.kind === "pieces" ? asset.spec.modelCredit : undefined);
  expect(credits.get(GUNS[0]!)).toContain("Jerd");
});
