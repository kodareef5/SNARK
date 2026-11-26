import { expect } from "bun:test";
import { nearestTriangle } from "../../client/core/assets/look.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { B_PROP_R } from "../../shared/anim/human.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { slotsOf } from "../../shared/content/slots.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { assetIconInputs, iconSubjects } from "../../tools/pack/icons.ts";
import { readPicture } from "../../tools/pack/image.ts";
import { boundsOf } from "../../tools/pack/lying.ts";
import { checkMasks } from "../../tools/pack/mask.ts";
import { spanOf } from "../../tools/pack/surface.ts";
import { weaponMeshes } from "../../tools/pack/weapons.ts";
import { unpackMeshes, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";

const handTools = ["torch", "slingshot", "club", "hatchet_metal", "pick_metal", "pike", "sickle", "sword"];
const camp = ["campfire", "storage_box", "sleeping_bag", "bed", "standing_torch", "cooking_pot", "storage_large", "fireplace"];
const campFires = ["campfire", "standing_torch", "cooking_pot", "fireplace"];
const projectiles = ["arrow_stone", "arrow_tranq", "grenade_smoke", "arrow_flame", "grenade_poison", "grappling_hook", "dart_tranq", "c4", "arrow_metal"];
const rounds = ["round_pistol", "round_rifle", "round_shotgun", "round_advanced", "round_advanced_rifle", "round_advanced_sniper", "rocket"];
const later = ["scope", "silencer", "flashlight", "pistol_fabricated", "shotgun_pump", "rifle_assault", "laser", "bow_compound", "rifle_sniper"];
const laterHeld = ["pistol_fabricated", "shotgun_pump", "rifle_assault", "bow_compound", "rifle_sniper"];
const industrial = ["generator", "refrigerator", "air_conditioner", "grinder", "vault", "forge_industrial", "chemistry_bench", "soul_vault", "cooker_industrial"];
const heldSlots = new Map(slotsOf(CORE_CONTENT).filter(slot => slot.slot === "held").map(slot => [slot.owner, slot.id]));

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

async function expectItemArt(pack: string, items: readonly string[], heldItems: readonly string[]): Promise<void> {
  const meshes = await meshesIn(pack);
  const icons = new Map(iconSubjects(CORE_CONTENT, (id) => meshes.has(id)).map((icon) => [icon.owner, icon]));
  for (const item of items) {
    const id = `core:${item}`;
    if (heldItems.includes(item)) {
      expect(heldSlots.get(id), id).toBe(id);
      const held = meshes.get(id);
      expect(held, id).toBeDefined();
      expect(held!.skeleton, id).toBe("human");
      for (const lod of held!.lods) expect(lod.bones?.every((bone) => bone === B_PROP_R), id).toBe(true);
      expectLevels(held!, 1000);
    }

    const drop = meshes.get(`${id}/dropped`);
    expect(drop, id).toBeDefined();
    expect(drop!.skeleton, id).toBeUndefined();
    expect(boundsOf(drop!.lods[0]!)[0][1], id).toBeCloseTo(0, 2);
    expectLevels(drop!, 500);
    expect(icons.get(id), id).toMatchObject({ icon: `${id}/icon`, mesh: drop!.id });
  }
}

artTest("hand tools ship grounded models, right-hand models and icons", async () => {
  await expectItemArt("core:hand-tools", handTools, handTools);
});

async function expectStationArt(pack: string, stations: readonly string[], fires: readonly string[]): Promise<void> {
  const meshes = await meshesIn(pack);
  const icons = new Map(iconSubjects(CORE_CONTENT, (id) => meshes.has(id)).map((icon) => [icon.owner, icon]));
  for (const station of stations) {
    const id = `core:${station}`;
    const piece = `core:piece_${station}`;
    expect(icons.get(piece), piece).toMatchObject({ icon: `${piece}/icon`, mesh: id });
    for (const state of fires.includes(station) ? [id, `${id}_lit`] : [id]) {
      const def = CORE_CONTENT.find((entry) => entry.type === "structure" && entry.id === state);
      const mesh = meshes.get(state);
      expect(def?.type, state).toBe("structure");
      expect(mesh, state).toBeDefined();
      expect(mesh!.skeleton, state).toBeUndefined();
      if (def?.type !== "structure") throw new Error(state);
      for (const lod of mesh!.lods) expect(boundsOf(lod)[0][1], state).toBeCloseTo(-def.half[1], 2);
      expectLevels(mesh!, 500);
    }
  }
}

artTest("camp stations ship centred models, lit variants and inventory icons", async () => {
  await expectStationArt("core:camp", camp, campFires);
});

artTest("projectiles ship grounded models and inventory icons", async () => {
  await expectItemArt("core:projectile-drops", projectiles, []);
});

artTest("rounds ship grounded models and inventory icons", async () => {
  await expectItemArt("core:rounds", rounds, []);
});

artTest("later equipment ships drop art, weapon grips and inventory icons", async () => {
  await expectItemArt("core:later-weapons", later, laterHeld);
});

artTest("industrial stations ship centred models and their working state", async () => {
  await expectStationArt("core:industrial-stations", industrial, ["soul_vault"]);
});


artTest("world loot replaces the grey boxes within their existing bounds", async () => {
  const meshes = await meshesIn("core:world-loot");
  const slots = slotsOf(CORE_CONTENT);
  for (const name of ["bag", "cache", "event_crate", "feces"]) {
    const id = `core:${name}`;
    const def = CORE_CONTENT.find(entry => entry.id === id);
    const mesh = meshes.get(id);
    expect(mesh, id).toBeDefined();
    if (def?.type !== "prop" || !mesh) throw new Error(id);
    expect(slots.find(slot => slot.owner === id && slot.slot === "mesh")?.id, id).toBe(id);
    expect(slots.some(slot => slot.owner === id && slot.slot === "icon"), id).toBe(false);
    for (const lod of mesh.lods) {
      const [from, to] = boundsOf(lod);
      expect(from[1], id).toBeCloseTo(0, 3);
      expect(to[1], id).toBeLessThanOrEqual(def.height + 0.001);
      for (const axis of [0, 2] as const) {
        expect(Math.max(-from[axis], to[axis]), id).toBeLessThanOrEqual(def.radius + 0.001);
      }
    }
    if (name === "bag" || name === "feces") expect(mesh.lods[0]!.indices.length / 3, id).toBeLessThan(300);
    expectLevels(mesh, 500);
  }

  const shot = meshes.get("core:stone_shot");
  const block = weaponMeshes().find(mesh => mesh.id === "core:stone_shot");
  expect(shot).toBeDefined();
  expect(block).toBeDefined();
  expect(slots.find(slot => slot.owner === "core:stone" && slot.slot === "shot")?.id).toBe("core:stone_shot");
  const [minimum, maximum] = boundsOf(block!.lods[0]!);
  for (const lod of shot!.lods) {
    const [from, to] = boundsOf(lod);
    for (const axis of [0, 1, 2] as const) {
      expect(from[axis]).toBeGreaterThanOrEqual(minimum[axis] - 0.001);
      expect(to[axis]).toBeLessThanOrEqual(maximum[axis] + 0.001);
    }
  }
  expectLevels(shot!, 500);
});

artTest("droppings ship distinct grounded pickups with icons", async () => {
  await expectItemArt("core:droppings", ["feces_small", "feces_medium", "feces_large", "feces_massive"], []);
});

artTest("egg pairs share the laid shell and colour only the fertile ring", async () => {
  const meshes = await meshesIn("core:eggs");
  const icons = new Map(iconSubjects(CORE_CONTENT, id => meshes.has(id)).map(icon => [icon.owner, icon]));
  const eggSizes = new Set<string>();
  for (const def of CORE_CONTENT) {
    if (def.type !== "prop" || def.class !== "egg" || !def.item || !def.fertile) continue;
    const plain = icons.get(def.item), fertile = icons.get(def.fertile);
    expect(plain, def.item).toMatchObject({ icon: `${def.item}/icon`, mesh: def.mesh });
    expect(fertile, def.fertile).toMatchObject({ icon: `${def.fertile}/icon`, mesh: def.mesh });
    expect(plain!.colors[5], def.item).toBe(plain!.colors[0]);
    expect(fertile!.colors.slice(0, 5), def.fertile).toEqual(plain!.colors.slice(0, 5));
    expect(fertile!.colors[5], def.fertile).not.toBe(plain!.colors[5]);
    const mesh = meshes.get(def.mesh)!;
    eggSizes.add(def.mesh);
    for (const lod of mesh.lods) {
      const [from, to] = boundsOf(lod);
      expect(from[1], def.id).toBeCloseTo(0, 3);
      expect(to[1], def.id).toBeLessThanOrEqual(def.height + 0.001);
      for (const axis of [0, 2] as const) expect(Math.max(-from[axis], to[axis]), def.id).toBeLessThanOrEqual(def.radius + 0.001);
    }
  }
  expect(icons.size).toBe(20);
  expect(eggSizes).toEqual(new Set(meshes.keys()));
  expect(eggSizes.size).toBe(5);
  for (const mesh of meshes.values()) expectLevels(mesh, 500);
});


function eggMarkShare(lod: SourceLod): number {
  const positions = lod.positions;
  const marks = (vertex: number): number => Number(lod.colors[vertex]! > REGION_BASE && lod.colors[vertex]! < REGION_BASE + 5);
  let marked = 0, total = 0;
  for (let i = 0; i < lod.indices.length; i += 3) {
    const [a, b, c] = [lod.indices[i]!, lod.indices[i + 1]!, lod.indices[i + 2]!];
    const edge = (from: number) => [0, 1, 2].map(axis => positions[from * 3 + axis]! - positions[a * 3 + axis]!);
    const [ux, uy, uz] = edge(b), [vx, vy, vz] = edge(c);
    const area = Math.hypot(uy! * vz! - uz! * vy!, uz! * vx! - ux! * vz!, ux! * vy! - uy! * vx!);
    marked += area * (marks(a) + marks(b) + marks(c)) / 3;
    total += area;
  }
  return marked / total;
}

artTest("distance eggs keep the fertile ring without enlarging shell markings", async () => {
  const asset = (await findAssets()).find(entry => entry.id === "core:eggs")!;
  const { cover } = checkMasks(readPicture(`${asset.dir}/tex/shell_mask.png`), readPicture(`${asset.dir}/tex/shell_mask2.png`));
  const painted = cover.slice(1, 5).reduce((sum, region) => sum + region, 0);
  expect(painted).toBeGreaterThan(0);
  for (const mesh of (await meshesIn(asset.id)).values()) {
    expect(mesh.lods.slice(mesh.flat!)).toHaveLength(2);
    for (const [level, lod] of mesh.lods.entries()) {
      const name = `${mesh.id} level ${level}`;
      expect(eggMarkShare(lod), name).toBeLessThanOrEqual(painted);
      expect(new Set(lod.colors), name).toEqual(new Set([REGION_BASE, REGION_BASE + 5]));
      if (level >= mesh.flat!) expect(lod.indices.length / 3, name).toBeLessThanOrEqual(level === mesh.flat ? 165 : 62);
    }
  }
});

artTest("skate surfaces follow their walked shapes at every level", async () => {
  const pack = "core:skate-camp-kits";
  await expectItemArt(pack, ["zzzzzskateboard_assembly", "boat_assembly", "helicopter_assembly"], []);
  await expectStationArt(pack, ["bunk_bed"], []);
  const meshes = await meshesIn(pack);
  const walked = new Map(grayboxMeshes(CORE_CONTENT).map(mesh => [mesh.id, mesh.lods[0]!]));
  const icons = new Map(iconSubjects(CORE_CONTENT, id => meshes.has(id)).map(icon => [icon.owner, icon]));
  const artHit = new Float64Array(1), walkedHit = new Float64Array(1);
  for (const name of ["kicker", "rail", "ledge"]) {
    const id = `core:zzzzzzskate_${name}`;
    const item = `${id}_item`;
    const mesh = meshes.get(id);
    expect(mesh, id).toBeDefined();
    expect(icons.get(item), item).toMatchObject({ icon: `${item}/icon`, mesh: id });
    expectLevels(mesh!, 500);
    const ref = walked.get(id)!;
    const [minimum, maximum] = boundsOf(ref);
    for (const lod of mesh!.lods) {
      const [from, to] = boundsOf(lod);
      for (const axis of [0, 1, 2] as const) {
        expect(from[axis], id).toBeCloseTo(minimum[axis], 3);
        expect(to[axis], id).toBeCloseTo(maximum[axis], 3);
      }
      for (const along of [.02, .11, .24, .44, .63, .84, .98]) {
        for (const across of [.035, .18, .41, .54, .8, .965]) {
          const x = minimum[0] + along * (maximum[0] - minimum[0]);
          const z = minimum[2] + across * (maximum[2] - minimum[2]);
          const hit = nearestTriangle(lod.positions, lod.indices, x, 2, z, 0, -1, 0, artHit);
          const walkedAt = nearestTriangle(ref.positions, ref.indices, x, 2, z, 0, -1, 0, walkedHit);
          expect(hit >= 0, id).toBe(walkedAt >= 0);
          if (walkedAt >= 0) expect(artHit[0]!, id).toBeCloseTo(walkedHit[0]!, 3);
        }
      }
    }
  }
});

artTest("resource nodes keep walked variants and mined remnants within bounds", async () => {
  const meshes = await meshesIn("core:resource-nodes");
  const registry = compileContent(CORE_CONTENT).registry!;
  const forms = nodeForms(registry);
  for (const name of ["oil_rock", "crystal_rock", "obsidian_rock", "clam"]) {
    const kind = registry.index.get(`core:${name}`)!;
    const def = registry.defs[kind];
    if (def?.type !== "node") throw new Error(name);
    expect(def.variants?.length, name).toBe(2);
    for (const [index, variant] of def.variants!.entries()) {
      const key = `core:${name}_${index + 1}`;
      const form = forms.first[kind]! + index * forms.steps[kind]!;
      const left = forms.left[form]!;
      expect([variant.mesh, forms.mesh[form], forms.mesh[left], forms.depleted[left]], key)
        .toEqual([key, key, `${key}_depleted`, 1]);
      const intact = meshes.get(key), spent = meshes.get(forms.mesh[left]!);
      expect(intact, key).toBeDefined();
      expect(spent, key).toBeDefined();
      expect(boundsOf(spent!.lods[0]!)[1][1], key).toBeLessThan(boundsOf(intact!.lods[0]!)[1][1]);
      for (const [mesh, boxes] of [[intact!, variant.boxes], [spent!, variant.depleted?.boxes]] as const) {
        expectLevels(mesh, 500);
        expect(boxes?.length, mesh.id).toBeGreaterThan(0);
        for (const box of boxes!) {
          expect(box.at[1] - box.half[1], mesh.id).toBeGreaterThanOrEqual(-.001);
          expect(box.at[1] + box.half[1], mesh.id).toBeLessThanOrEqual(2 * def.half[1] + .001);
          for (const axis of [0, 2] as const) {
            expect(Math.abs(box.at[axis]) + box.half[axis], mesh.id).toBeLessThanOrEqual(def.half[axis] + .001);
          }
        }
        for (const lod of mesh.lods) {
          const [from, to] = boundsOf(lod);
          expect(from[1], mesh.id).toBeCloseTo(0, 3);
          expect(to[1], mesh.id).toBeLessThanOrEqual(2 * def.half[1] + .001);
          for (const axis of [0, 2] as const) {
            expect(Math.max(-from[axis], to[axis]), mesh.id).toBeLessThanOrEqual(def.half[axis] + .001);
          }
        }
      }
    }
  }
});

artTest("end game pickups ship art and fitted jet equipment ships icons", async () => {
  const pack = "core:end-game";
  await expectItemArt(pack, ["prod", "plasma_charge", "dart_shock", "plasma_cell"], ["prod"]);
  const meshes = await meshesIn(pack);
  const { images, meshes: overrides } = await assetIconInputs();
  const subjects = iconSubjects(CORE_CONTENT, id => meshes.has(id));
  for (const name of ["jet_cannon", "jet_missile_rack", "cannon_round", "jet_missile"]) {
    const id = `core:${name}`;
    const def = CORE_CONTENT.find(entry => entry.id === id);
    if (def?.type !== "item") throw new Error(id);
    expect(def.craft, id).toBeUndefined();
    expect(CORE_CONTENT.some(entry => entry.type === "engram" && entry.item === id), id).toBe(false);
    expect(CORE_CONTENT.some(entry => entry.type === "species" && entry.drops?.some(drop => drop.item === id)), id).toBe(false);
    expect(subjects.some(subject => subject.owner === id), id).toBe(false);
    if (name === "jet_missile") {
      expect(def.ammo?.mesh, id).toBe("core:rocket_round");
      expect(iconSubjects(CORE_CONTENT, key => key === def.ammo?.mesh, overrides).find(subject => subject.owner === id)?.mesh, id)
        .toBe(def.ammo?.mesh);
      continue;
    }
    const icon = images.get(`${id}/icon`);
    expect(icon, id).toBeDefined();
    const picture = readPicture(icon!);
    expect([picture.width, picture.height, picture.channels, picture.depth], id).toEqual([128, 128, 4, 8]);
    const alpha = picture.data.filter((_, at) => at % 4 === 3);
    expect(alpha.some(opacity => opacity === 0) && alpha.some(opacity => opacity === 255), id).toBe(true);
  }
});
