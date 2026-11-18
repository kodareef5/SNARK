import { expect, test } from "bun:test";
import { BITE_AIM, biteAimRotation, prepareBiteAim } from "../../shared/anim/bite-aim.ts";
import { AnimState, PITCH_AUTHORED, PITCH_STEPS } from "../../shared/anim/pose.ts";
import { quatAxis, quatMul, quatRotate } from "../../shared/math/quat.ts";
import { detCos, detSin } from "../../shared/math/scalar.ts";
import { ACT_SWING } from "../../shared/sim/weapon.ts";

test("the authored ground-attack pitch survives packed history; ordinary camera pitch never reaches its reserved value", () => {
  const st = new AnimState(), read = new AnimState(), q = new Float64Array(4);
  st.setAction(ACT_SWING, 0, 22); st.pitch = PITCH_AUTHORED;
  read.unpack(st.pack(), st.packCue());
  expect([read.pitch, read.action, read.actionStart]).toEqual([PITCH_AUTHORED, ACT_SWING, 22]);
  prepareBiteAim(read); biteAimRotation(read, 1, q); expect(Array.from(q)).toEqual([-0, 0, 0, 1]);
  for (const pitch of [-Math.PI, -Math.PI / 2, -.4, 0, .4, Math.PI / 2, Math.PI]) {
    st.setMotion(0, 0, 0, pitch); read.unpack(st.pack(), st.packCue());
    expect(read.pitch).toBeGreaterThanOrEqual(-PITCH_STEPS); expect(read.pitch).toBeLessThanOrEqual(PITCH_STEPS);
    expect(read.pitch).not.toBe(PITCH_AUTHORED);
  }
  st.setAction(0, 0, 0); st.setMotion(0, 0, 0, .3); read.unpack(st.pack()); prepareBiteAim(read);
  expect(read.pitch).toBe(st.pitch); expect([read.biteX, read.biteY, read.biteZ]).toEqual([0, 0, 1]);
});

test("supported neck aiming preserves camera-world pitch on compound slopes and caps the actual local cone", () => {
  const ground = new Float64Array(4), across = new Float64Array(4), q = new Float64Array(4), v = new Float64Array(3), st = new AnimState();
  st.setAction(ACT_SWING, 0, 0);
  for (const slope of [-.35, 0, .35]) for (const roll of [-.15, .15]) for (const pitch of [-6, 0, 6]) {
    quatAxis(ground, 0, 1, 0, 0, -slope); quatAxis(across, 0, 0, 0, 1, roll); quatMul(ground, 0, ground, 0, across, 0);
    st.pitch = pitch; prepareBiteAim(st, ground); biteAimRotation(st, 1, q);
    quatRotate(q, 0, 0, 0, 1, v, 0); quatRotate(ground, 0, v[0]!, v[1]!, v[2]!, v, 0);
    const wanted = pitch * Math.PI / (2 * PITCH_STEPS);
    expect(Math.hypot(v[0]!, v[1]! - detSin(wanted), v[2]! - detCos(wanted))).toBeLessThan(1e-8);
  }
  for (const pitch of [-31, 31]) {
    st.pitch = pitch; prepareBiteAim(st, ground);
    expect(st.biteZ).toBeCloseTo(detCos(BITE_AIM), 8);
    expect(Math.hypot(st.biteX, st.biteY, st.biteZ)).toBeCloseTo(1, 8);
  }
});
