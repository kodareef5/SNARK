// One skeleton is hit for every survivor, whatever its look (shared/anim/look.ts). A drawn body's joints over its hips
// are the hit body's, and the stretches that move its head are bounded, so in any pose on foot its head stays near the
// head shots are judged on and never outgrows it.
import { expect, test } from "bun:test";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FOOT_L, B_FOOT_R, B_HEAD, B_LOWER_LEG_L, B_LOWER_LEG_R, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { defaultLook, HEAD_GROW, HEAD_SLACK, LOOK_SEX, lookJoints, plantLookFeet, lookScales, REGION_COUNT, setRegion } from "../../shared/anim/look.ts";
import { AnimState, HumanAnim, humanPose, PITCH_STEPS, SPEED_MAX } from "../../shared/anim/pose.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { Rng } from "../../shared/rng.ts";
import { STANCE_CROUCH, STANCE_STAND } from "../../shared/sim/character.ts";
import { ACT_HOLD, HOLD_RIFLE } from "../../shared/sim/weapon.ts";
import { frozenPack } from "../fixtures/pack.ts";

const pack = frozenPack(), anim = new HumanAnim(pack.clips);

/** The middle of a solved head, stretched by `scale`. */
function headMiddle(s: Solved, scale: Float32Array | null): number[] {
  const k = (a: number): number => (scale ? scale[B_HEAD * 3 + a]! : 1), out = [0, 0, 0];
  boneToModel(s, B_HEAD, ((HUMAN.capA[B_HEAD * 3]! + HUMAN.capB[B_HEAD * 3]!) / 2) * k(0), ((HUMAN.capA[B_HEAD * 3 + 1]! + HUMAN.capB[B_HEAD * 3 + 1]!) / 2) * k(1), ((HUMAN.capA[B_HEAD * 3 + 2]! + HUMAN.capB[B_HEAD * 3 + 2]!) / 2) * k(2), out);
  return out;
}

test("a look's head stays within 2 cm of the hit head in any pose on foot", () => {
  const rng = new Rng(3), drawn = new Solved(HUMAN_BONES), hit = new Solved(HUMAN_BONES), pose = new Pose(HUMAN_BONES);
  const sliders: ((r: number) => number)[] = [() => 0, () => -1, () => 1];
  for (let r = 0; r < REGION_COUNT; r++) for (const v of [-1, 1]) sliders.push((q) => (q === r ? v : 0));
  for (let k = 0; k < 40; k++) {
    const values = Array.from({ length: REGION_COUNT }, () => rng.range(-1, 1));
    sliders.push((q) => values[q]!);
  }
  const bodies = pack.header.rigs.filter((r) => r.id === "human_m" || r.id === "human_f").flatMap((rig) => sliders.map((slider) => {
    const rest = Float32Array.from(rig.rest), look = defaultLook(), scale = new Float32Array(HUMAN_BONES * 3), joints = new Float32Array(HUMAN_BONES * 3);
    look[LOOK_SEX] = rig.id === "human_f" ? 1 : 0;
    for (let r = 0; r < REGION_COUNT; r++) setRegion(look, r, slider(r));
    lookScales(look, scale, rest);
    lookJoints(rest, scale, joints);
    return { rest, scale, joints };
  }));
  let worst = 0, tried = 0;
  // Standing and crouched, still, walking and running, looking from far down to far up, empty-handed and aiming.
  for (const stance of [STANCE_STAND, STANCE_CROUCH]) for (const speed of [0, 5, SPEED_MAX]) for (const pitch of [-80, -40, 0, 40, 80]) for (const action of [0, (HOLD_RIFLE << 3) | ACT_HOLD]) for (const tick of [30, 37, 44]) {
    const st = new AnimState();
    st.stance = stance; st.speed = speed; st.pitch = Math.round((pitch / 90) * PITCH_STEPS); st.action = action;
    humanPose(anim, st, tick, pose);
    solve(HUMAN, pose, hit);
    const at = headMiddle(hit, null), root = pose.root[1]!;
    for (const { rest, scale, joints } of bodies) {
      // Drawn as the renderer draws it: its legs lift its hips so its feet stay on the ground.
      solve(HUMAN, pose, drawn, rest, scale, joints);
      plantLookFeet(pose, drawn, scale, rest);
      pose.root[1] = root;
      const m = headMiddle(drawn, scale);
      worst = Math.max(worst, Math.hypot(m[0]! - at[0]!, m[1]! - at[1]!, m[2]! - at[2]!));
      tried++;
    }
  }
  expect(tried).toBeGreaterThan(30000);
  expect(worst).toBeLessThanOrEqual(HEAD_SLACK + 1e-6);
  for (const { scale } of bodies) for (let a = 0; a < 3; a++) expect(scale[B_HEAD * 3 + a]!).toBeLessThanOrEqual(Math.fround(HEAD_GROW));
});

test("a rig whose own hips sit past the slack keeps no head-moving stretch, and no other harm", () => {
  const rest = Float32Array.from(HUMAN.rest), scale = new Float32Array(HUMAN_BONES * 3), look = defaultLook();
  rest[1] = rest[1]! + 0.05;
  for (const value of [0, 1]) {
    for (let r = 0; r < REGION_COUNT; r++) setRegion(look, r, value);
    lookScales(look, scale, rest);
    expect(scale.every((v) => Number.isFinite(v))).toBe(true);
    expect(scale[B_HEAD * 3 + 1]).toBe(1);
  }
});

test("long and short legs keep the planted ankle on the crouching gait", () => {
  const st = new AnimState(), pose = new Pose(HUMAN_BONES), base = new Solved(HUMAN_BONES), drawn = new Solved(HUMAN_BONES);
  st.stance = STANCE_CROUCH; st.speed = 4;
  for (const length of [.85, 1.15]) for (let tick = 0; tick < 30; tick++) {
    humanPose(anim, st, tick, pose);
    solve(HUMAN, pose, base);
    const scales = new Float32Array(HUMAN_BONES * 3).fill(1);
    for (const bone of [B_UPPER_LEG_L, B_UPPER_LEG_R, B_LOWER_LEG_L, B_LOWER_LEG_R]) scales[bone * 3 + 1] = length;
    solve(HUMAN, pose, drawn, HUMAN.rest, scales);
    const ankle = drawn.pos[B_FOOT_L * 3 + 1]! <= drawn.pos[B_FOOT_R * 3 + 1]! ? B_FOOT_L : B_FOOT_R;
    plantLookFeet(pose, drawn, scales, HUMAN.rest);
    expect(drawn.pos[ankle * 3 + 1]).toBeCloseTo(base.pos[ankle * 3 + 1]!, 5);
  }
});
