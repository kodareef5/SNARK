// How a survivor holds the rocket launcher (shared/anim/pose.ts): the pose set comes from the held item, which the
// server and every client know, so a rifle is posed as it always was. Its reload passes its keys in order, its kick is
// its own, and the places on the held launcher follow the prop bone it hangs on (client/core/render/characters.ts).

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { Pose, sampleClip, type Clip } from "../../shared/anim/clip.ts";
import { B_HAND_L, B_HAND_R, B_LOWER_ARM_L, B_PROP_L, B_PROP_R, B_SHOULDER_R, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, LAUNCHER_AT_MUZZLE, LAUNCHER_FETCHED, LAUNCHER_HOME, humanPose } from "../../shared/anim/pose.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { wield } from "../../shared/anim/wield.ts";
import { HELD_MUZZLE, HELD_ROUND, HELD_VENT } from "../../shared/content/kinds/weapons.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../shared/sim/entities.ts";
import { ACT_COOL, ACT_EQUIP, ACT_NONE, ACT_RELOAD, HOLD_RIFLE, POSE_LAUNCHER, POSE_PLAIN } from "../../shared/sim/weapon.ts";
import { coreAnim, corePack } from "../fixtures/pack.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const LAUNCHER = reg.index.get("core:rocket_launcher")!;
const RIFLE = reg.index.get("core:rifle")!;
const anim = coreAnim();
const TICK = 1000;

/** The pose of a survivor standing still with `item` in a rifle's hold, `into` ticks into `act`. */
function posed(item: number, act = ACT_NONE, into = 0, given = true): Pose {
  const st = new AnimState();
  // An act begins on a whole tick; a pose may be drawn between two.
  st.setAction(act, HOLD_RIFLE, TICK);
  if (given) wield(st, reg, item);
  const pose = new Pose(HUMAN_BONES);
  humanPose(anim, st, TICK + into, pose);
  return pose;
}

const clip = (id: string): Clip => anim.set.clips[anim.set.index.get(id)!]!;
const turnOf = (p: Pose, bone: number): number[] => [...p.rot.subarray(bone * 4, bone * 4 + 4)];
/** Whether `bone` of `p` is turned as the one-frame clip `id` has it. */
function as(p: Pose, bone: number, id: string): boolean {
  const want = new Pose(HUMAN_BONES);
  sampleClip(clip(id), 0, want);
  return turnOf(p, bone).every((v, k) => Math.abs(v - want.rot[bone * 4 + k]!) < 1e-4);
}
const ARMS = [B_UPPER_ARM_R, B_LOWER_ARM_L, B_UPPER_ARM_L] as const;

test("the launcher's pose is a tube on the shoulder, and a rifle's is as it was", () => {
  expect([reg.holdPose[LAUNCHER], reg.holdPose[RIFLE]]).toEqual([POSE_LAUNCHER, POSE_PLAIN]);
  const tube = posed(LAUNCHER), rifle = posed(RIFLE);
  for (const bone of ARMS) {
    expect(as(tube, bone, "human/launcher_aimed")).toBe(true);
    expect(as(rifle, bone, "human/gun_aimed")).toBe(true);
    expect(as(tube, bone, "human/gun_aimed")).toBe(false);
  }
  // A rifle's pose is the same bits whether or not its item is given, at rest, firing, loading and coming up.
  for (const [act, into] of [[ACT_NONE, 0], [ACT_COOL, 2], [ACT_RELOAD, 3], [ACT_EQUIP, 6]] as const) {
    expect([...posed(RIFLE, act, into).rot]).toEqual([...posed(RIFLE, act, into, false).rot]);
  }
  // A launcher whose item is not given poses as a rifle: the word alone does not say which.
  expect([...posed(LAUNCHER, ACT_NONE, 0, false).rot]).toEqual([...rifle.rot]);
  // Unpacking the word forgets the item.
  const st = new AnimState();
  wield(st, reg, LAUNCHER);
  st.unpack(st.pack());
  expect([st.wields, st.kickTicks, st.reloadTicks]).toEqual([POSE_PLAIN, 0, 0]);
});

test("the launcher's reload passes its keys in order", () => {
  const ticks = reg.weapon[LAUNCHER]!.reloadTicks;
  expect(ticks).toBe(120);
  const at = (share: number): Pose => posed(LAUNCHER, ACT_RELOAD, share * ticks);
  const keys: [number, string][] = [[0.12, "lowered"], [LAUNCHER_FETCHED, "fetch"], [0.36, "fetch"], [LAUNCHER_AT_MUZZLE, "load"], [LAUNCHER_HOME, "push"], [0.78, "push"]];
  for (const [share, name] of keys) for (const bone of [...ARMS, B_HAND_L, B_HAND_R]) expect([name, bone, as(at(share), bone, `human/launcher_${name}`)]).toEqual([name, bone, true]);
  // Between two keys it is at neither, and it ends at the shoulder.
  expect(as(at(0.47), B_UPPER_ARM_L, "human/launcher_fetch") || as(at(0.47), B_UPPER_ARM_L, "human/launcher_load")).toBe(false);
  for (const bone of ARMS) expect(as(posed(LAUNCHER, ACT_NONE, 0), bone, "human/launcher_aimed")).toBe(true);
  // The off hand goes from the fore grip down to the hip, up to the muzzle, and back along the tube as it pushes home.
  const solved = new Solved(HUMAN_BONES), hand = [0, 0, 0], grip = [0, 0, 0];
  const along = (share: number): number[] => {
    solve(HUMAN, at(share), solved);
    boneToModel(solved, B_PROP_L, 0, 0, 0, hand);
    boneToModel(solved, B_PROP_R, 0, 0, 0, grip);
    return [hand[1]!, Math.hypot(hand[0]! - grip[0]!, hand[1]! - grip[1]!, hand[2]! - grip[2]!)];
  };
  const [hipY] = along(0.325), [muzzleY, muzzleFar] = along(LAUNCHER_AT_MUZZLE), [, homeFar] = along(LAUNCHER_HOME);
  expect(hipY).toBeLessThan(1.05);
  expect(muzzleY).toBeGreaterThan(hipY! + 0.2);
  // At the muzzle it holds the round a hand's length past the tube's end, half a metre from the grip; home, 20 cm nearer.
  expect(muzzleFar).toBeGreaterThan(0.7);
  expect(muzzleFar! - homeFar!).toBeCloseTo(0.2, 1);
});

test("the launcher kicks by its own angle and time, on into the reload that follows", () => {
  const w = reg.weapon[LAUNCHER]!;
  expect([reg.kickTicks[LAUNCHER], reg.kickAngle[LAUNCHER]! > 0.15, reg.kickTicks[RIFLE]]).toEqual([9, true, 0]);
  const lift = (p: Pose): number => Math.abs(p.rot[B_SHOULDER_R * 4]! - posed(LAUNCHER).rot[B_SHOULDER_R * 4]!);
  const rest = lift(posed(LAUNCHER));
  expect(rest).toBe(0);
  // It comes up within two ticks and is still up when a rifle's kick is over.
  expect(lift(posed(LAUNCHER, ACT_COOL, 2))).toBeGreaterThan(0.04);
  expect(lift(posed(LAUNCHER, ACT_COOL, 2))).toBeGreaterThan(lift(posed(LAUNCHER, ACT_COOL, 0.3)));
  // The pause after its shot is shorter than its kick: the reload that follows takes the kick on from where it was.
  expect(w.swingTicks).toBeLessThan(reg.kickTicks[LAUNCHER]!);
  const before = posed(LAUNCHER, ACT_COOL, w.swingTicks - 0.001), after = posed(LAUNCHER, ACT_RELOAD, 0);
  for (const bone of [B_SHOULDER_R, B_UPPER_ARM_R, B_HAND_R]) turnOf(before, bone).forEach((v, k) => expect(Math.abs(v - turnOf(after, bone)[k]!)).toBeLessThan(2e-3));
  expect(lift(posed(LAUNCHER, ACT_RELOAD, 0))).toBeGreaterThan(0.02);
});

/** A scene with one survivor at (100, 0, 100) holding `item`, facing `yaw` radians, `into` ticks into `act`. */
function drawn(item: number, yaw: number, act = ACT_NONE, into = 0) {
  const world = flatWorld(4);
  const pack = corePack();
  const scene = new Scene({ dims: world.dims, hf: world.hf, structs: world.structs }, reg, pack);
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw] = [100, 1.6, 94, 0];
  const r = new RemoteSample();
  const st = new AnimState();
  const set = (a: number, e: number): void => {
    st.unpack(0);
    st.setAction(a, HOLD_RIFLE, TICK - e);
    r.anim[0] = st.pack();
  };
  r.count = 1;
  r.tick = TICK;
  r.id[0] = 77;
  r.kind[0] = reg.index.get("core:survivor")!;
  [r.x[0], r.y[0], r.z[0], r.yaw[0], r.flags[0]] = [100, 0, 100, yaw, 1];
  r.gear[GEAR_HELD] = item;
  set(act, into);
  const meshes = (): string[] => {
    const p = scene.build(cam, r);
    return [...p.drawMesh.subarray(0, p.drawCount)].filter((_, d) => (p.drawFlags[d]! & DRAW_SKINNED) !== 0).map((m) => pack.header.meshes[m]!.id);
  };
  return { scene, r, set, meshes };
}

test("a held launcher's muzzle and vent follow the prop bone it hangs on", () => {
  const at = (yaw: number, act = ACT_NONE, into = 0): { m: number[]; v: number[]; ok: boolean } => {
    const d = drawn(LAUNCHER, yaw, act, into);
    d.meshes();
    const m = [0, 0, 0], v = [0, 0, 0];
    const ok = d.scene.characters.heldPoint(77, HELD_MUZZLE, m) && d.scene.characters.heldPoint(77, HELD_VENT, v);
    // The body its shot would leave is found by where its eye is.
    const near = [0, 0, 0];
    expect(d.scene.characters.heldNear(100, 1.62, 100, HELD_MUZZLE, near)).toBe(true);
    expect(near).toEqual(m);
    expect(d.scene.characters.heldNear(110, 1.62, 100, HELD_MUZZLE, near)).toBe(false);
    expect(d.scene.characters.heldPoint(78, HELD_MUZZLE, near)).toBe(false);
    return { m, v, ok };
  };
  for (const yaw of [0, 1.2, -2.5]) {
    const { m, v, ok } = at(yaw);
    expect(ok).toBe(true);
    // The tube is a rigid 1.02 m from vent to muzzle, level and along the body's facing when aimed, over the right shoulder.
    const d = [m[0]! - v[0]!, m[1]! - v[1]!, m[2]! - v[2]!];
    expect(Math.hypot(...d)).toBeCloseTo(1.02, 2);
    expect((d[0]! * Math.sin(yaw) + d[2]! * Math.cos(yaw)) / 1.02).toBeGreaterThan(0.995);
    expect(Math.abs(d[1]!)).toBeLessThan(0.05);
    expect(m[1]).toBeGreaterThan(1.4);
    expect(m[1]).toBeLessThan(1.7);
    // To the body's right of where it stands: its left is +X at no yaw.
    const mid = [(m[0]! + v[0]!) / 2 - 100, (m[2]! + v[2]!) / 2 - 100];
    expect(mid[0]! * Math.cos(yaw) - mid[1]! * Math.sin(yaw)).toBeLessThan(-0.08);
  }
  // Brought down to be loaded, the muzzle is lower and tipped up.
  const low = at(0, ACT_RELOAD, 70);
  expect(low.m[1]).toBeLessThan(1.4);
  expect(low.m[1]! - low.v[1]!).toBeGreaterThan(0.15);
  // A rifle has no such places.
  const rifle = drawn(RIFLE, 0);
  rifle.meshes();
  expect(rifle.scene.characters.heldPoint(77, HELD_MUZZLE, [0, 0, 0])).toBe(false);
});

test("the round is drawn in a loaded tube and in the hand, not in a tube just fired", () => {
  expect(reg.heldHas[LAUNCHER]! & (1 << HELD_ROUND)).not.toBe(0);
  const d = drawn(LAUNCHER, 0);
  const rounds = (): number => d.meshes().filter((id) => id === "core:rocket_round").length;
  // A body first seen has its round in.
  expect(rounds()).toBe(1);
  // It fires: the tube is empty, and stays so with nothing to load.
  d.set(ACT_COOL, 1);
  expect(rounds()).toBe(0);
  d.set(ACT_NONE, 0);
  expect(rounds()).toBe(0);
  // Its reload: none until the hand has one from the pouch, then one, in the hand and then in the tube.
  d.set(ACT_RELOAD, 20);
  expect(rounds()).toBe(0);
  for (const into of [40, 60, 75, 100]) {
    d.set(ACT_RELOAD, into);
    expect(rounds()).toBe(1);
  }
  d.set(ACT_NONE, 0);
  expect(rounds()).toBe(1);
  // Another body's tube says nothing of this one's: the gear slots are GEAR_COUNT apart.
  expect(GEAR_COUNT).toBeGreaterThan(GEAR_HELD);
});
