// The asset library's table, binding and tiers.
import { expect, test } from "bun:test";
import { Assets, HYSTERESIS } from "../../client/core/assets/assets.ts";
import { DEFAULT_TIER, TIERS, forTouch, offeredTiers, startingTier, tierOf } from "../../client/core/assets/tiers.ts";
import { DOWNLOAD_ROW, SETTING_ROWS, Settings } from "../../client/core/settings.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const pack = corePack();
const { table, bind } = new Assets(coreRegistry(), pack);
const id = (mesh: number): string => (mesh < 0 ? "" : pack.header.meshes[mesh]!.id);

artTest("the table knows each mesh's levels, size and bone without reading its bytes again", () => {
  expect(table.count).toBe(pack.header.meshes.length);
  const head = table.find("core:human_m/head");
  // Four levels: the source's own and one drawn with materials, then two flat (tools/pack/body.ts).
  expect([table.tris[head]!.length, table.skeleton[head], table.rig[head]! >= 0]).toEqual([4, "human", true]);
  expect(table.tris[head]![0]!).toBeGreaterThan(table.tris[head]![3]!);
  // A rigid mesh of one level: the vault's grey box, which no building tier's art replaces.
  const box = table.find("core:vault");
  expect([table.tris[box]!.length, table.skeleton[box], table.rig[box]]).toEqual([1, "", -1]);
  expect(table.radius[box]!).toBeGreaterThan(1);
  // A held item hangs on a hand bone, and a body part's first vertex names a bone of its own.
  expect(table.bone[table.find("core:rifle")]!).toBeGreaterThan(20);
  expect(table.find("core:nothing")).toBe(-1);
  expect([table.has("mesh", "core:raptor"), table.has("rig", "core:raptor"), table.has("clip", "core:raptor/walk"), table.has("clip", "core:raptor/fly"), table.has("icon", "core:stone/icon")]).toEqual([true, true, true, false, false]);
});

artTest("a slot is bound to its own asset, to what stands in, or to nothing", () => {
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
  return [0, 1, 2, 3].map((level) => parts.reduce((sum, e) => sum + e[level]!, 0) / parts.length);
};

artTest("a level is chosen by its error on screen: a body goes coarser near 11, 22 and 74 m at 720p", () => {
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
    // MakeHuman's body at 26,000, 3,400, 1,480 and 420 triangles (tools/pack/body.ts); Quaternius's turned near 9, 19 and 58 m.
    const [near, mid, far] = [from(errors, 1), from(errors, 2), from(errors, 3)];
    expect([sex, near > 11 * 0.8 && near < 11 * 1.2, mid > 22 * 0.8 && mid < 22 * 1.2, far > 74 * 0.8 && far < 74 * 1.2]).toEqual([sex, true, true, true]);
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

artTest("a level is left only when another is right by a margin, and a mesh is never asked for a level it lacks", () => {
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
  expect([assets.choose(errors, 1, 3), assets.choose(errors, 1000, 0)]).toEqual([0, 3]);

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
  // A touch-first device is offered low poly to high, and draws medium's and high's shadows as their touch rule says, with high's card a third smaller.
  s.touchFirst = true;
  row.step(s, 1);
  expect(row.value(s)).toBe("high");
  expect(offeredTiers(true).map((t) => t.name)).toEqual(["lowpoly", "medium", "high"]);
  for (const name of ["medium", "high"]) {
    const [tier, touched] = [tierOf(name), forTouch(tierOf(name), true)];
    expect([touched.shadows.size, touched.shadows.taps, touched.shadows.cascades]).toEqual([1024, 1, tier.shadows.cascades]);
    expect(forTouch(tier, true)).toBe(touched);
    expect(forTouch(tier, false)).toBe(tier);
  }
  expect([forTouch(tierOf("medium"), true).gpuBytes, forTouch(tierOf("high"), true).gpuBytes]).toEqual([tierOf("medium").gpuBytes, 1024 * 1048576]);
  expect(forTouch(tierOf("lowpoly"), true)).toBe(tierOf("lowpoly"));
  // Steady frame is automatic unless turned off.
  const steady = SETTING_ROWS.find((r) => r.label === "Steady frame")!;
  expect(steady.value(s)).toBe("automatic");
  steady.step(s, 1);
  expect([steady.value(s), s.steady]).toEqual(["off", false]);
});

test("a desktop with a GPU and a light target starts on high; a phone, the CPU drawing, a small memory or no light target start on medium, and a tier chosen is kept", () => {
  const gpu = "ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)";
  const desk = { touchFirst: false, renderer: gpu, light: true };
  expect(startingTier(desk)).toBe("high");
  expect([startingTier({ ...desk, memory: 8 }), startingTier({ ...desk, memory: 4 }), startingTier({ ...desk, memory: 2 })]).toEqual(["high", "high", DEFAULT_TIER]);
  expect([startingTier({ ...desk, touchFirst: true }), startingTier({ ...desk, light: false })]).toEqual([DEFAULT_TIER, DEFAULT_TIER]);
  expect(startingTier({ ...desk, renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)" })).toBe(DEFAULT_TIER);
  const s = new Settings();
  s.start({ renderer: gpu, light: true });
  expect([s.tier, s.chosen]).toEqual(["high", false]);
  s.touchFirst = true;
  s.start({ renderer: gpu, light: true });
  expect(s.tier).toBe(DEFAULT_TIER);
  SETTING_ROWS.find((r) => r.label === "Graphics")!.step(s, 1);
  s.touchFirst = false;
  s.start({ renderer: gpu, light: true });
  expect([s.tier, s.chosen]).toEqual(["high", true]);
  s.tier = "lowpoly";
  s.start({ renderer: gpu, light: true });
  expect(s.tier).toBe("lowpoly");
});

test("Download all goes on, pauses and resumes, and is remembered between visits with its pause", () => {
  const s = new Settings();
  const row = SETTING_ROWS[DOWNLOAD_ROW]!;
  expect([row.label, row.value(s)]).toEqual(["Download all", "off"]);
  const seen: string[] = [];
  for (let k = 0; k < 3; k++) {
    row.step(s, 1);
    seen.push(row.value(s));
  }
  expect(seen).toEqual(["on", "paused", "on"]);
  row.step(s, 1);
  const later = new Settings();
  later.restoreInterface(s.interfacePreferences());
  expect([later.keepAll, later.keepPaused, row.value(later)]).toEqual([true, true, "paused"]);
});
