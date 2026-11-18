// A road vehicle's wear story: which one a car takes, how it holds its layer back, that the client draws each car with
// its own, and that the rasterizer draws two stories of one body differently.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Assets } from "../../client/core/assets/assets.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { FramePacket, InstanceWriter } from "../../client/core/render/packet.ts";
import { LAYER_LEVELS, LAYER_STAGES, SURFACE_ANY, surfaceFragment, surfaceVertex } from "../../client/core/render/surface.ts";
import { WEAR, WEAR_KEY, WEAR_STORIES, wearAlpha, wearLate, wearOf } from "../../client/core/render/wear.ts";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import { COMPACT_ART } from "../../content/vehicles/compact-art.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { materialsOf } from "../../tools/art/materials.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { ModelView } from "../../tools/snap.ts";
import { rgbaOf } from "../../tools/snap/files.ts";
import { tubeMesh, TUBE_PIXELS } from "../fixtures/textured.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** Every way a kind's colour regions can be rolled. */
function rolls(regions: readonly ({ colors: readonly (readonly [number, number])[] } | null)[]): number[][] {
  let out: number[][] = [[]];
  for (let r = 0; r < 6; r++) {
    const colors = regions[r]?.colors.map(([c]) => c) ?? [0];
    out = out.flatMap((head) => colors.map((c) => [...head, c]));
  }
  return out;
}

test("each kind of the road fleet spreads its colour rolls over all five stories, and a roll always gives the same one", () => {
  expect(WEAR_KEY).toBeGreaterThan(LAYER_LEVELS);
  for (const kind of ROAD_FLEET) {
    const all = rolls(kind.regions!);
    const counts = new Array<number>(WEAR_STORIES + 1).fill(0);
    for (const colors of all) {
      const story = wearOf(colors);
      expect(wearOf(Uint8Array.from([9, 9, ...colors]), 2)).toBe(story);
      counts[story]!++;
    }
    expect(counts[0]).toBe(0);
    // No story is taken by fewer than half the rolls an even spread would give it.
    for (let s = 1; s <= WEAR_STORIES; s++) expect(counts[s]!).toBeGreaterThanOrEqual(Math.floor(all.length / WEAR_STORIES / 2));
  }
});

test("a story holds its value about each point of its grid and runs straight between, and story 0 holds nothing back", () => {
  const cells = WEAR.length / WEAR_STORIES;
  expect(cells).toBe(18);
  const xs = [-0.8, 0, 0.8], ys = [-0.35, 0.45], zs = [-0.7, 0, 0.7];
  for (let s = 1; s <= WEAR_STORIES; s++) {
    zs.forEach((z, iz) => ys.forEach((y, iy) => xs.forEach((x, ix) => {
      const want = WEAR[(s - 1) * cells + (iz * 2 + iy) * 3 + ix]!;
      expect(wearLate(s, x, y, z)).toBeCloseTo(want, 9);
      // Held about the point, and beyond the outer ones out to the box's edge.
      expect(wearLate(s, x + 0.1, y - 0.1, z + 0.1)).toBeCloseTo(want, 9);
      if (ix === 2 && iy === 1 && iz === 2) expect(wearLate(s, 1, 1, 1)).toBeCloseTo(want, 9);
    })));
    // Halfway between the middle and the nose, halfway between their values.
    const mid = WEAR[(s - 1) * cells + (1 * 2 + 1) * 3 + 1]!, nose = WEAR[(s - 1) * cells + (2 * 2 + 1) * 3 + 1]!;
    expect(wearLate(s, 0, 0.45, 0.35)).toBeCloseTo((mid + nose) / 2, 9);
  }
  expect(wearLate(0, 0.9, 0.9, 0.9)).toBe(0);
  // A hurt mark held back a stage shows a stage later, and however long it is held back it is whole by the last decay
  // stage; a decay mark is held back two stages at most.
  expect(wearAlpha(0.8, 1, LAYER_STAGES)).toBeCloseTo(0.8 - 1 / 6, 9);
  expect((1 - 1 + wearAlpha(0.6, 9, LAYER_STAGES)) * 26).toBeGreaterThanOrEqual(1 - 1e-9);
  expect(((LAYER_STAGES - 1) / LAYER_STAGES - 1 + wearAlpha(0.6, 9, LAYER_STAGES)) * 26).toBeLessThanOrEqual(0);
  expect(wearAlpha(0.3, 9, LAYER_STAGES)).toBeCloseTo(0.3 - 2 / 6, 9);
});

test("the layered program reads the same table of stories as the rasterizer, from the vertex's place in its bounds", () => {
  const fragment = surfaceFragment("bc", "", { ...SURFACE_ANY, layered: true }), vertex = surfaceVertex({ ...SURFACE_ANY, layered: true });
  const table = /const float WEAR\[(\d+)\] = float\[\d+\]\(([^)]*)\);/.exec(fragment)!;
  expect(Number(table[1])).toBe(WEAR.length);
  expect(table[2]!.split(",").map(Number)).toEqual([...WEAR]);
  expect(fragment).toContain("wearAlpha(layer.a, wearLate(),");
  expect(vertex).toContain("vBox = aPos;");
  expect(surfaceVertex(SURFACE_ANY)).not.toContain("vBox");
});

// The tube of the scene fixture as the compact: one level, one material with a hurt and decay layer, on the compact's rig.
const CAR_RIG: PackRig = {
  id: "core:compact", skeleton: "core:compact",
  names: ["chassis", "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right", "door_left", "door_right", "steering_wheel"],
  parent: [-1, 0, 0, 0, 0, 0, 0, 0],
  rest: [0, 0, 0, .78, .3, 1.25, -.78, .3, 1.25, .78, .3, -1.25, -.78, .3, -1.25, .84, .76, .65, -.84, .76, .65, .42, .89, .55],
};
function layeredCar() {
  const tube = tubeMesh();
  const textures = [...tube.textures!, { id: "core:compact/layer", role: "layer" as const, top: TUBE_PIXELS }];
  const materials = tube.materials!.map((m, k) => ({ ...m, id: `core:compact/${k}`, ...(k === 0 ? { layer: textures.length - 1 } : {}) }));
  return parsePack(buildPack([{ ...tube, id: "core:compact", skeleton: "core:compact", rig: "core:compact", materials, textures }], defaultPalette(), [], [CAR_RIG]));
}

test("two hurt cars of a kind are drawn with the stories their colours give them, at the same level, and a creature with none", () => {
  const reg = coreRegistry(), pack = layeredCar(), compact = reg.index.get("core:compact")!;
  const characters = new Characters(reg, pack, new Assets(reg, pack)), packet = new FramePacket();
  characters.begin();
  // Two rolls of the compact's colours that give it different stories.
  const all = rolls(ROAD_FLEET[0].regions!);
  const first = all[0]!, other = all.find((c) => wearOf(c) !== wearOf(first))!;
  const colors = Uint8Array.from([...first, ...other]);
  const hurt = new AnimState();
  hurt.hurt = 2;
  const frame = { pitch: 0, roll: 0, steering: 0, wheelAngle: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  expect(characters.add(packet, compact, 0, 0, -6, 0, hurt, 5, null, 0, colors, 0, null, 0, 11, false, false, 1, false, false, null, 0, frame)).toBe(true);
  expect(characters.add(packet, compact, 3, 0, -6, 0, hurt, 5, null, 0, colors, 6, null, 0, 12, false, false, 1, false, false, null, 0, frame)).toBe(true);
  const drawn: number[] = [];
  characters.flush(packet, new InstanceWriter(packet.transient), false, (mesh, _lod, _first, _count, _flags, layer) => {
    if (pack.header.meshes[mesh]!.id === "core:compact") drawn.push(layer);
  });
  const level = (2 * LAYER_LEVELS) / LAYER_STAGES;
  expect(drawn.sort()).toEqual([level + wearOf(first) * WEAR_KEY, level + wearOf(other) * WEAR_KEY].sort());
});

artTest("the rasterizer draws a hurt compact differently in each story, and the same story the same way every time", async () => {
  const asset = (await findAssets()).find((a) => a.id === COMPACT_ART.id)!;
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const mesh = pack.meshIndex.get(COMPACT_ART.id)!;
  const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
  rig.a.rest();
  solve(rig, rig.a, rig.solved);
  const materials = materialsOf(asset);
  const view = new ModelView(pack, 160, 100, [0.8, 0.8, 0.8]);
  (pack.header.textures ?? []).forEach((t, slot) => view.texture(slot, t.role, rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top).pictures));
  // From the front on the driver's side and from the rear on the passenger's, side by side.
  const shot = (wear: number) => {
    const both = [35, 215].map((around) => {
      view.draw({ mesh, level: 0, centre: [0, 0.7, 0], radius: 2.2, around, above: 14, rig, colors: [41, 220, 91, 0, 0, 0], textured: true, layer: (2 * LAYER_LEVELS) / LAYER_STAGES, wear });
      return view.raster.color.slice();
    });
    return Uint8ClampedArray.from([...both[0]!, ...both[1]!]);
  };
  const pictures = Array.from({ length: WEAR_STORIES + 1 }, (_, s) => shot(s));
  expect(shot(3)).toEqual(pictures[3]!);
  const differ = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 24) n++;
    return n;
  };
  for (let s = 1; s <= WEAR_STORIES; s++) for (let t = s + 1; t <= WEAR_STORIES; t++) expect(differ(pictures[s]!, pictures[t]!)).toBeGreaterThan(40);
});
