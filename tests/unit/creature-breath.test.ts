import { expect, test } from "bun:test";
import { posedSubmerged } from "../../shared/anim/breath.ts";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { AnimState, CUE_TORPOR } from "../../shared/anim/pose.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { MapWater } from "../../shared/world/water.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { withMotion } from "../../tools/pack/creature.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { breathingRig } from "../fixtures/breathing.ts";
import { flatWorld } from "../fixtures/world.ts";

test("paired airway source metadata roundtrips and malformed optional pairs preserve legacy behavior", () => {
  const f = breathingRig(), spec: CreatureAsset = { kind: "creature", source: { scripts: [] }, scale: 1,
    skeleton: { id: "dodo", root: "body" }, regions: [], zones: [], sockets: [], clips: [], feet: [], gaits: {}, budgets: { triangles: [32] }, breath: ["breath_l", "breath_r"] };
  const faults: string[] = [], packed = withMotion(f.rig, spec, f.clips.clips, faults);
  expect(faults).toEqual([]);
  const bytes = buildPack([], defaultPalette(), f.clips.clips, [packed]);
  const p = parsePack(bytes), rig = buildRig(p.header.rigs[0]!, p.clips)!;
  expect(p.header.rigs[0]!.breath).toEqual(["breath_l", "breath_r"]);
  expect(rig.breath).toEqual([rig.sockets.get("breath_l")!, rig.sockets.get("breath_r")!]);
  const boot = parsePack(splitPack(bytes, "breathing").files.find(file => file.role === "boot")!.bytes);
  expect(boot.header.rigs[0]!.breath).toEqual(["breath_l", "breath_r"]);
  expect(buildRig(boot.header.rigs[0]!, boot.clips)!.breath).not.toBeNull();
  expect(withMotion(f.rig, { ...spec, breath: undefined }, [], []).breath).toBeUndefined();
  for (const pair of [[], ["breath_l"], ["breath_l", "breath_l"], ["breath_l", "missing"], ["", "breath_r"], ["breath_l", "breath_r", "extra"], [null, "breath_r"]]) {
    const malformed = pair as unknown as [string, string], errors: string[] = [];
    withMotion(f.rig, { ...spec, breath: malformed }, [], errors);
    expect(errors.length).toBeGreaterThan(0);
    expect(buildRig({ ...f.rig, breath: malformed }, f.clips)!.breath).toBeNull();
  }
  for (const change of [{ bone: .5 }, { bone: 2 }, { x: NaN }, { z: Infinity }]) {
    const bad: PackRig = { ...f.rig, sockets: f.rig.sockets!.map((s, i) => i ? s : { ...s, ...change }) }, errors: string[] = [];
    withMotion(bad, spec, [], errors); expect(errors.length).toBeGreaterThan(0); expect(buildRig(bad, f.clips)!.breath).toBeNull();
  }
  const duplicate = { ...f.rig, sockets: [...f.rig.sockets!, f.rig.sockets![0]!] }, errors: string[] = [];
  withMotion(duplicate, spec, [], errors); expect(errors.length).toBeGreaterThan(0); expect(buildRig(duplicate, f.clips)!.breath).toBeNull();
});

test("paired breathing follows KO/recovery poses, yaw, juvenile scale and each airway's own shoreline", () => {
  const f = breathingRig(), a = new CreatureAnim(buildRig(f.rig, f.clips)!, 5, 2), st = new AnimState(), world = flatWorld();
  for (const size of [.25, .6, 1]) {
    st.out = true; st.cue = 0; world.hf.seaLevel = .5 * size - .001;
    expect(posedSubmerged(a, st, 100, world, 64, 0, 64, 0, size)).toBe(false);
    world.hf.seaLevel += .002;
    expect(posedSubmerged(a, st, 100, world, 64, 0, 64, 0, size)).toBe(true);
    st.out = false; st.cue = CUE_TORPOR; st.cueStart = 0;
    world.hf.seaLevel = .4 * size;
    expect(posedSubmerged(a, st, 45, world, 64, 0, 64, 0, size)).toBe(true);
    expect(posedSubmerged(a, st, 90, world, 64, 0, 64, 0, size)).toBe(false);
  }
  // A lake begins one metre ahead. The origin is dry; both actual nostrils face into its water.
  world.hf.seaLevel = -Infinity;
  const grid = new Uint16Array(world.hf.sizeX * world.hf.sizeZ);
  for (let z = 65; z < world.hf.sizeZ; z++) for (let x = 0; x < world.hf.sizeX; x++) grid[z * world.hf.sizeX + x] = 1;
  world.hf.water = MapWater.fromGrid(world.dims, 0, 1, 1, [{ name: "shore", level: 1 }], grid);
  st.out = true; st.cue = 0;
  expect(world.hf.waterAt(64, 64.1)).toBe(-Infinity);
  expect(posedSubmerged(a, st, 100, world, 64, 0, 64.1, 0)).toBe(true);
  expect(posedSubmerged(a, st, 100, world, 64, 0, 64.1, Math.PI)).toBe(false);
  // Turn sideways on the boundary: one nostril is submerged, the other is exposed.
  expect(posedSubmerged(a, st, 100, world, 64, 0, 65, Math.PI / 2)).toBe(false);
  st.out = false;
  expect(posedSubmerged(a, st, 100, world, 64, 0, 64.1, 0)).toBeNull();
  const old = breathingRig(false), legacy = new CreatureAnim(buildRig(old.rig, old.clips)!, 5, 2);
  st.out = true;
  expect(posedSubmerged(legacy, st, 100, world, 64, 0, 64.1, 0)).toBeNull();
});
