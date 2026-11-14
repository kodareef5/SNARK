// The asset library's table, binding and tiers.
import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { DEFAULT_TIER, TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const pack = corePack();
const { table, bind } = new Assets(coreRegistry(), pack);
const id = (mesh: number): string => (mesh < 0 ? "" : pack.header.meshes[mesh]!.id);

test("the table knows each mesh's levels, size and bone without reading its bytes again", () => {
  expect(table.count).toBe(pack.header.meshes.length);
  const head = table.find("core:human_m/head");
  expect([table.tris[head]!.length, table.skeleton[head], table.rig[head]! >= 0]).toEqual([3, "human", true]);
  expect(table.tris[head]![0]!).toBeGreaterThan(table.tris[head]![2]!);
  const wall = table.find("core:wall_wood");
  expect([table.tris[wall]!.length, table.skeleton[wall], table.rig[wall]]).toEqual([1, "", -1]);
  expect(table.radius[wall]!).toBeGreaterThan(1);
  // A held item hangs on a hand bone, and a body part's first vertex names a bone of its own.
  expect(table.bone[table.find("core:rifle")]!).toBeGreaterThan(20);
  expect(table.find("core:nothing")).toBe(-1);
  expect([table.has("mesh", "core:raptor"), table.has("rig", "core:raptor"), table.has("clip", "core:raptor/walk"), table.has("clip", "core:raptor/fly"), table.has("icon", "core:stone/icon")]).toEqual([true, true, true, false, false]);
});

test("a slot is bound to its own asset, to what stands in, or to nothing", () => {
  expect(id(bind.mesh("core:raptor", "body"))).toBe("core:raptor");
  expect(bind.id("core:raptor", "rig")).toBe("core:raptor");
  expect(id(bind.mesh("core:survivor", "body", "f/legs"))).toBe("core:human_f/legs");
  expect(id(bind.mesh("core:wall_wood", "mesh"))).toBe("core:wall_wood");
  // The dummy has no art of its own. With a stand-in it wears the mannequin, and it has no mesh that is its own.
  expect(id(bind.mesh("core:dummy", "body", "m/head"))).toBe("core:mannequin/head");
  expect(bind.own("core:dummy", "body", "m/head")).toBe(-1);
  expect(id(bind.own("core:flak_shirt", "worn", "human_m"))).toBe("core:human_m/armor/hide/torso");
  expect(id(bind.mesh("core:round_rifle", "shot"))).toBe("core:tracer");
  expect(bind.own("core:round_rifle", "shot")).toBe(-1);
  // No such slot, no such owner, and a slot only a word fills.
  expect([bind.mesh("core:raptor", "wings"), bind.mesh("core:nobody", "body"), bind.mesh("core:stone", "icon"), bind.id("core:stone", "icon")]).toEqual([-1, -1, -1, ""]);
});

test("the tiers ask for more as they go up, and the default is the textured middle", () => {
  expect(TIERS.map((t) => t.name)).toEqual(["lowpoly", "medium", "high", "ultra"]);
  expect([DEFAULT_TIER, tierOf("nonsense").name, tierOf("ultra").texture, tierOf("lowpoly").texture]).toEqual(["medium", "medium", 4096, 0]);
  for (let i = 1; i < TIERS.length; i++) {
    const [a, b] = [TIERS[i - 1]!, TIERS[i]!];
    expect([b.texture > a.texture, b.threshold < a.threshold, b.instanced > a.instanced, b.gpuBytes > a.gpuBytes, b.uploadBytes > a.uploadBytes, b.diskBytes > a.diskBytes]).toEqual([true, true, true, true, true, true]);
  }
});
