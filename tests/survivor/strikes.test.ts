// The blows of shared/anim/strikes.ts as a body is posed with them: where they land, how they chain, and what the
// striker's own eye sees of them.

import { expect, test } from "bun:test";
import { ownArms } from "../../client/core/render/own-arms.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HAND_L, B_HAND_R, B_PROP_R, B_SHOULDER_R, B_UPPER_LEG_L, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, PITCH_STEPS, humanPose } from "../../shared/anim/pose.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { MOVES, SAMPLE, S_AT, S_LEFT, S_RIGHT, sampleMove } from "../../shared/anim/strikes.ts";
import { STANCE_CROUCH, STANCE_STAND } from "../../shared/sim/character.ts";
import { ACT_NONE, ACT_SWING, HOLD_HANDS, HOLD_PICK, HOLD_TOOL, SWING_TICKS } from "../../shared/sim/weapon.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { coreAnim } from "../fixtures/pack.ts";

/** Metres from a tool's grip to its head. */
const HEAD = 0.31;
/** The first tick of a swing: an even one takes a hold's first move and an odd one its second. */
const START = 1000;
const BLOWS = [
  ["a jab", HOLD_HANDS, START],
  ["a cross", HOLD_HANDS, START + 1],
  ["a steep chop", HOLD_TOOL, START],
  ["a flat chop", HOLD_TOOL, START + 1],
  ["a pick's blow", HOLD_TOOL | HOLD_PICK, START],
  ["a pick's blow from the shoulder", HOLD_TOOL | HOLD_PICK, START + 1],
] as const;

const pose = new Pose(HUMAN_BONES);
const solved = new Solved(HUMAN_BONES);

function state(hold: number, start: number, pitch = 0, stance = STANCE_STAND): AnimState {
  const st = new AnimState();
  st.pitch = pitch;
  st.stance = stance;
  st.setAction(start < 0 ? ACT_NONE : ACT_SWING, hold, start < 0 ? 0 : start);
  return st;
}

/** What strikes, in model space: the head of a tool, or the knuckles of the fist the swing punches with (or of the `left` or right, if said). */
function striker(st: AnimState, tick: number, eye: { y: number; ahead: number; pitch: number } | null = null, left = (st.actionStart & 1) === 0): number[] {
  const out = [0, 0, 0];
  humanPose(coreAnim(), st, tick, pose, null, eye !== null);
  if (eye) ownArms(pose, st, tick, eye.y, eye.ahead, eye.pitch, 0, 0);
  solve(HUMAN, pose, solved);
  if (st.action >>> 3 === HOLD_TOOL) boneToModel(solved, B_PROP_R, 0, 0, HEAD, out);
  else if (left) boneToModel(solved, B_HAND_L, 0.09, 0, 0, out);
  else boneToModel(solved, B_HAND_R, -0.09, 0, 0, out);
  return out;
}

artTest("a blow reaches farthest along the look about the tick it lands, whatever the pitch", () => {
  for (const [name, hold, start] of BLOWS) {
    for (const pitch of [-15, 0, 12]) {
      const st = state(hold, start, pitch);
      const a = (pitch / PITCH_STEPS) * (Math.PI / 2);
      let most = -Infinity, at = 0;
      for (let e = 0; e <= SWING_TICKS; e += 0.25) {
        const p = striker(st, start + e);
        const along = p[1]! * Math.sin(a) + p[2]! * Math.cos(a);
        if (along > most) (most = along), (at = e);
      }
      // The blow lands at tick 5 and goes a short way on.
      expect(at, `${name}, pitch ${pitch}`).toBeGreaterThanOrEqual(4.5);
      expect(at, `${name}, pitch ${pitch}`).toBeLessThanOrEqual(6.5);
    }
  }
});

artTest("a swing leaves and meets the pose without it, and a held one goes on with no jump", () => {
  for (const [name, hold, start] of BLOWS) {
    const resting = state(hold, -1);
    const first = state(hold, start), second = state(hold, start + SWING_TICKS);
    const left = (start & 1) === 0;
    expect(striker(first, start), name).toEqual(striker(resting, start, null, left));
    expect(striker(first, start + SWING_TICKS), name).toEqual(striker(resting, start + SWING_TICKS, null, left));
    // Four samples a tick through two swings, the second begun on the tick the first ends. One fist is followed through both.
    let was = striker(first, start), speedWas = 0;
    for (let e = 0.25; e <= 2 * SWING_TICKS; e += 0.25) {
      const now = striker(e < SWING_TICKS ? first : second, start + e, null, left);
      const speed = Math.hypot(now[0]! - was[0]!, now[1]! - was[1]!, now[2]! - was[2]!) * 4 * 30;
      // A tool's head whips through its stroke at under 32 m/s, and gains or loses under 14 m/s in a quarter tick.
      expect(speed, `${name} at tick ${e}`).toBeLessThan(32);
      expect(Math.abs(speed - speedWas), `${name} at tick ${e}`).toBeLessThan(14);
      was = now;
      speedWas = speed;
    }
  }
});

artTest("a pick is swung as a pick and a hatchet chops", () => {
  const chop = striker(state(HOLD_TOOL, START), START + 3), pick = striker(state(HOLD_TOOL | HOLD_PICK, START), START + 3);
  expect(Math.hypot(chop[0]! - pick[0]!, chop[1]! - pick[1]!, chop[2]! - pick[2]!)).toBeGreaterThan(0.1);
  // A pick's blow has the left hand up on the haft, and a chop leaves it down.
  const left = (hold: number): number => {
    humanPose(coreAnim(), state(hold, START), START + 5, pose);
    solve(HUMAN, pose, solved);
    return solved.pos[B_HAND_L * 3 + 1]!;
  };
  expect(left(HOLD_TOOL | HOLD_PICK)).toBeGreaterThan(left(HOLD_TOOL) + 0.2);
});

test("a pick's swing travels in the pose word as the act no body has", () => {
  const a = new AnimState(), b = new AnimState();
  a.setAction(ACT_SWING, HOLD_TOOL | HOLD_PICK, 77);
  expect([a.action & 7, a.action >>> 3, a.pick]).toEqual([ACT_SWING, HOLD_TOOL, true]);
  b.unpack(a.pack());
  expect([b.action, b.actionStart, b.pick]).toEqual([a.action, 77, true]);
  // A chop packs as a swing always did.
  a.setAction(ACT_SWING, HOLD_TOOL, 77);
  expect((a.pack() >>> 18) & 7).toBe(ACT_SWING);
  b.unpack(a.pack());
  expect(b.pick).toBe(false);
  // A pick at rest is a tool at rest.
  a.setAction(ACT_NONE, HOLD_TOOL | HOLD_PICK, 0);
  expect([a.pick, a.pack() >>> 18]).toEqual([false, HOLD_TOOL << 3]);
});

artTest("a carried tool changes the right arm alone", () => {
  const bare = new Pose(HUMAN_BONES);
  humanPose(coreAnim(), state(HOLD_HANDS, -1), START, bare);
  humanPose(coreAnim(), state(HOLD_TOOL, -1), START, pose);
  for (let bone = 0; bone < B_UPPER_LEG_L; bone++) {
    const same = [0, 1, 2, 3].every((k) => pose.rot[bone * 4 + k] === bare.rot[bone * 4 + k]);
    expect(same, HUMAN.names[bone]).toBe(bone < B_SHOULDER_R);
  }
});

test("every move starts and ends where its hold rests", () => {
  const first = new Float64Array(SAMPLE), last = new Float64Array(SAMPLE), carry = new Float64Array(SAMPLE);
  sampleMove(MOVES.get("human/tool_carry")!, 0, carry);
  for (const [id, m] of MOVES) {
    sampleMove(m, 0, first);
    sampleMove(m, SWING_TICKS, last);
    for (const arm of [S_RIGHT, S_LEFT]) for (let k = 0; k < 3; k++) expect(last[arm + S_AT + k], id).toBe(first[arm + S_AT + k]!);
    if (id.includes("chop") || id.includes("pick")) for (let k = 0; k < 3; k++) expect(first[S_RIGHT + S_AT + k], id).toBe(carry[S_RIGHT + S_AT + k]!);
  }
});

/** Where a point of the model is seen from an eye `y` up and `ahead`, pitched: across and up the view, -1 to 1 at its edges, and metres off. */
function seen(p: readonly number[], eye: { y: number; ahead: number; pitch: number }): { across: number; up: number; off: number } {
  const y = p[1]! - eye.y, z = p[2]! - eye.ahead;
  const off = z * Math.cos(eye.pitch) + y * Math.sin(eye.pitch), up = y * Math.cos(eye.pitch) - z * Math.sin(eye.pitch);
  // A 70 degree view, 16 to 9.
  const half = Math.tan((35 * Math.PI) / 180);
  return { across: -p[0]! / (off * half * (16 / 9)), up: up / (off * half), off };
}

artTest("the striker's own eye sees a blow land in the middle of its view, at any pitch, standing or crouched", () => {
  for (const [name, hold, start] of BLOWS) {
    for (const [stance, y] of [[STANCE_STAND, 1.62], [STANCE_CROUCH, 1.05]] as const) {
      for (const pitch of [-0.8, 0, 0.5]) {
        const eye = { y, ahead: 0.12, pitch };
        const s = seen(striker(state(hold, start, 0, stance), start + 5, eye), eye);
        const where = `${name}, eye at ${y} m, pitch ${pitch}`;
        expect(s.off, where).toBeGreaterThan(0.2);
        expect(Math.abs(s.across), where).toBeLessThan(0.3);
        expect(s.up, where).toBeGreaterThan(-0.55);
        expect(s.up, where).toBeLessThan(0.2);
      }
    }
  }
});

artTest("a carried tool shows low and to the right of its own view, and bare hands at rest are left alone", () => {
  const eye = { y: 1.62, ahead: 0.05, pitch: 0 };
  const s = seen(striker(state(HOLD_TOOL, -1), START, eye), eye);
  expect(s.across).toBeGreaterThan(0.15);
  expect(s.across).toBeLessThan(0.7);
  expect(s.up).toBeGreaterThan(-0.7);
  expect(s.up).toBeLessThan(-0.05);
  humanPose(coreAnim(), state(HOLD_HANDS, -1), START, pose, null, true);
  expect(ownArms(pose, state(HOLD_HANDS, -1), START, eye.y, eye.ahead, eye.pitch, 0, 0)).toBe(false);
});
