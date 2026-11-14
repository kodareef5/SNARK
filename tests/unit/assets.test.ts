// The asset library's table, binding and tiers.
import { expect, test } from "bun:test";
import { Assets, HYSTERESIS } from "../../client/core/assets/assets.ts";
import { DEFAULT_TIER, TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { SETTING_ROWS, Settings, keptLine } from "../../client/core/settings.ts";
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
  // A rigid mesh of one level: the vault's grey box, which no building tier's art replaces.
  const box = table.find("core:vault");
  expect([table.tris[box]!.length, table.skeleton[box], table.rig[box]]).toEqual([1, "", -1]);
  expect(table.radius[box]!).toBeGreaterThan(1);
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

/** How far each level of a whole body lies from its finest: the average of its five parts, as the scene takes it. */
const bodyErrors = (sex: string): number[] => {
  const parts = ["head", "torso", "hands", "legs", "feet"].map((part) => table.error[table.find(`core:human_${sex}/${part}`)]!);
  return [0, 1, 2].map((level) => parts.reduce((sum, e) => sum + e[level]!, 0) / parts.length);
};

test("a level is chosen by its error on screen: a body goes coarser near 14 and 45 metres at 720p", () => {
  const assets = new Assets(coreRegistry(), pack);
  /** The distance at which something seen afresh is first drawn at `level`. */
  const from = (errors: number[], level: number): number => {
    for (let d = 0.5; d < 2000; d += 0.1) if (assets.choose(errors, d, -1) >= level) return d;
    return Infinity;
  };
  for (const sex of ["m", "f"]) {
    const errors = bodyErrors(sex);
    assets.tier = tierOf("medium");
    assets.begin(0, 720, 1.2217);
    const [near, far] = [from(errors, 1), from(errors, 2)];
    expect([sex, near > 14 * 0.8 && near < 14 * 1.2, far > 45 * 0.8 && far < 45 * 1.2]).toEqual([sex, true, true]);
    // Twice the pixels, or a scope's narrow view, and the finer level is held further out.
    assets.begin(0, 1440, 1.2217);
    expect(from(errors, 1)).toBeCloseTo(near * 2, 0);
    assets.begin(0, 720, 1.2217 * 0.25);
    expect(from(errors, 1)).toBeGreaterThan(near * 4);
    assets.begin(0, 720, 1.2217);
    // Each tier holds detail further than the one below it, and the lowest never draws the finest level.
    const nears = TIERS.map((t) => ((assets.tier = t), from(errors, 2)));
    expect(nears.every((d, i) => i === 0 || d > nears[i - 1]!)).toBe(true);
    assets.tier = tierOf("lowpoly");
    expect([assets.choose(errors, 0, -1), assets.choose(errors, 1, 0), assets.choose([0], 500, -1)]).toEqual([1, 1, 0]);
  }
});

test("a level is left only when another is right by a margin, and a mesh is never asked for a level it lacks", () => {
  const assets = new Assets(coreRegistry(), pack);
  const errors = bodyErrors("m");
  let edge = 0.5;
  while (assets.choose(errors, edge, -1) === 0) edge += 0.01;
  const m = HYSTERESIS - 0.03;
  // Out past the edge and back in: it changes only when clear of it either way.
  expect(assets.choose(errors, edge * (1 + m), 0)).toBe(0);
  expect(assets.choose(errors, edge * (1 + HYSTERESIS + 0.06), 0)).toBe(1);
  expect(assets.choose(errors, edge * (1 - m), 1)).toBe(1);
  expect(assets.choose(errors, edge * (1 - HYSTERESIS - 0.03), 1)).toBe(0);
  // From far off to near in one step, and back.
  expect([assets.choose(errors, 1, 2), assets.choose(errors, 1000, 0)]).toEqual([0, 2]);

  const [box, head] = [table.find("core:vault"), table.find("core:human_m/head")];
  expect([assets.level(box, 2), assets.level(head, 2), assets.level(head, 1)]).toEqual([0, 2, 1]);
});

test("the graphics setting steps through the tiers and stops at either end", () => {
  const s = new Settings();
  const row = SETTING_ROWS.find((r) => r.label === "Graphics")!;
  expect([row.label, row.value(s), s.tier]).toEqual(["Graphics", "medium", DEFAULT_TIER]);
  const seen: string[] = [];
  for (const by of [-1, -1, 1, 1, 1, 1]) {
    row.step(s, by);
    seen.push(row.value(s));
  }
  expect(seen).toEqual(["low poly", "low poly", "medium", "high", "ultra", "ultra"]);
});

test("the settings screen says what is kept of the assets between visits, and asks for all of them when told", () => {
  expect(keptLine(null)).toBe("all here");
  expect(keptLine({ used: 0, mode: "memory", filling: 0 })).toBe("not kept");
  expect(keptLine({ used: 3.5 * 1048576, mode: "disk", filling: 0 })).toBe("3.5 MB kept");
  expect(keptLine({ used: 1200 * 1048576, mode: "disk", filling: 0 })).toBe("1200 MB kept");
  expect(keptLine({ used: 1048576, mode: "disk", filling: 14 })).toBe("14 to fetch");
  const s = new Settings();
  const row = SETTING_ROWS.find((r) => r.label === "Keep all assets")!;
  expect(s.download).toBe(false);
  row.step(s, 1);
  expect(s.download).toBe(true);
});
