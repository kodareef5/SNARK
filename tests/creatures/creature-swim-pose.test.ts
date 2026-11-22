import { expect } from "bun:test";
import { Pose, type Clip } from "../../shared/anim/clip.ts";
import { CreatureAnim, creaturePose } from "../../shared/anim/creature.ts";
import { AnimState, CUE_LAND, CUE_STARTLE, CUE_TORPOR } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { test } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";

function fixture(waterReactions: boolean): CreatureAnim {
  const pack = corePack(), source = buildRigs(pack.header.rigs, pack.clips).get("core:raptor")!;
  const clip = (id: string, y: number, loop = false): Clip => {
    const frames = 42, pose = new Pose(source.bones), rot = new Float32Array(frames * pose.rot.length), root = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) { rot.set(pose.rot, f * pose.rot.length); root[f * 3 + 1] = y; }
    return { id, bones: source.bones, frames, loop, rot, root };
  };
  const clips = new Map<string, Clip>();
  for (const name of ["idle", "swim", "swim_idle"]) clips.set(name, clip(name, .6, true));
  for (const name of ["startled", "land", "torpor_idle", "torpor_out", "fall"]) clips.set(name, clip(name, -.5));
  if (waterReactions) for (const name of ["startled_swim", "land_swim", "torpor_out_swim"]) clips.set(name, clip(name, .8));
  return new CreatureAnim({ ...source, clips, strides: new Map() }, 4, 2);
}

test("awake swimming never falls back to ground startle, landing or get-up poses", () => {
  const a = fixture(false), st = new AnimState(), out = new Pose(a.rig.bones);
  st.mode = MODE_SWIM; st.grounded = false; st.cueStart = 100;
  for (const cue of [CUE_STARTLE, CUE_LAND, CUE_TORPOR]) {
    st.cue = cue;
    for (let age = 0; age < 65; age += .5) {
      creaturePose(a, st, 100 + age, out);
      expect(out.root[1]).toBeCloseTo(.6, 6);
    }
  }
  // The same cues still play their ground reactions when standing on land.
  st.mode = new AnimState().mode; st.grounded = true;
  for (const cue of [CUE_STARTLE, CUE_LAND, CUE_TORPOR]) {
    st.cue = cue;
    creaturePose(a, st, 112, out);
    expect(out.root[1]).toBeCloseTo(-.5, 6);
  }
});

test("authored swimming reactions blend from and back to the raised swimming pose", () => {
  const a = fixture(true), st = new AnimState(), out = new Pose(a.rig.bones);
  st.mode = MODE_SWIM; st.grounded = false; st.cueStart = 100;
  for (const cue of [CUE_STARTLE, CUE_LAND, CUE_TORPOR]) {
    st.cue = cue;
    for (let age = 0; age < 65; age += .5) {
      creaturePose(a, st, 100 + age, out);
      expect(out.root[1]).toBeGreaterThanOrEqual(.6 - 1e-6);
      expect(out.root[1]).toBeLessThanOrEqual(.8 + 1e-6);
      if (age === 12) expect(out.root[1]).toBeCloseTo(.8, 6);
      if (age === 60) expect(out.root[1]).toBeCloseTo(.6, 6);
    }
  }
});
