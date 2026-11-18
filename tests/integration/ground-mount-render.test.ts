import { expect, test } from 'bun:test';
import { Assets } from '../../client/core/assets/assets.ts';
import { Characters } from '../../client/core/render/characters.ts';
import { BONE_FLOATS, FramePacket } from '../../client/core/render/packet.ts';
import { AnimState } from '../../shared/anim/pose.ts';
import { creaturePose } from '../../shared/anim/creature.ts';
import { SEAT_FLOATS, seatOn } from '../../shared/anim/seat.ts';
import { solve } from '../../shared/anim/skeleton.ts';
import { Body, stepBody } from '../../shared/sim/character.ts';
import { GEAR_COUNT, GEAR_WORN } from '../../shared/sim/entities.ts';
import { groundUnder } from '../../shared/world/collide.ts';
import { GroundMountFrame, groundMountFrame } from '../../shared/world/ground-mount.ts';
import { frozenPack } from '../fixtures/pack.ts';
import { flatWorld } from '../fixtures/world.ts';

function point(p: FramePacket, bone: number, at: ArrayLike<number>): number[] {
  const o = bone * BONE_FLOATS;
  return [0, 1, 2].map(k => p.bones[o + k * 4]! * at[0]! + p.bones[o + k * 4 + 1]! * at[1]! + p.bones[o + k * 4 + 2]! * at[2]! + p.bones[o + k * 4 + 3]!);
}

test('driver and observer saddle transforms agree with authority and drawn feet on both compound slope directions', () => {
  const pack = frozenPack();
  for (const species of ['raptor', 'parasaur']) for (const direction of [-1, 1]) for (const speed of [0, 6]) {
    const w = flatWorld(4), along = direction * Math.tan(Math.PI / 9), across = .15;
    for (let j = 0; j < w.hf.nz; j++) for (let i = 0; i < w.hf.nx; i++) w.hf.setSample(i, j, 20 + (i * w.hf.cell - 128) * across + (j * w.hf.cell - 128) * along);
    const kind = w.kind(`core:${species}`), move = w.reg.tamedMove[kind]!, saddle = w.kind(`core:saddle_${species}`);
    const chars = new Characters(w.reg, pack, new Assets(w.reg, pack), w), anim = chars.creature(kind)!;
    const st = new AnimState(), y = groundUnder(w.hf, 128, 128, move.radius), authority = new Float64Array(SEAT_FLOATS), driver = new Float64Array(SEAT_FLOATS), observer = new Float64Array(SEAT_FLOATS);
    st.speed = speed;
    const seat = w.reg.saddleSeats[saddle]![0]!, gear = new Uint16Array(GEAR_COUNT); gear[GEAR_WORN] = saddle;
    const packet = new FramePacket(); packet.camX = 120; packet.camY = 17; packet.camZ = 120; chars.begin(packet);
    seatOn(anim, seat, st, 30, 128, y, 128, 0, authority, w, move);
    expect(chars.seat(kind, 128, y, 128, 0, st, 30, driver, 1, undefined, saddle)).toBe(true);
    expect(chars.seat(kind, 8, y - 17, 8, 0, st, 30, observer, 1, undefined, saddle, 12)).toBe(true);
    for (let axis = 0; axis < 12; axis++) {
      expect(driver[axis]).toBeCloseTo(authority[axis]!, 5);
      expect(observer[axis]! + (axis === 0 || axis === 2 ? 120 : axis === 1 ? 17 : 0)).toBeCloseTo(authority[axis]!, 5);
    }
    expect(chars.add(packet, kind, 8, y - 17, 8, 0, st, 30, null, 0, new Uint8Array(6), 0, gear, 0, 12, true, false)).toBe(true);
    creaturePose(anim, st, 30, anim.rig.a); solve(anim.rig, anim.rig.a, anim.rig.solved);
    const length = Math.sqrt(1 + along * along + across * across);
    // Frozen pre-foot-metadata packs still name both hind feet; never turn this into a vacuous measurement.
    const feet = ['BackFoot.L', 'BackFoot.R'].map(name => anim.rig.names.indexOf(name));
    expect(feet.every(foot => foot >= 0)).toBe(true);
    for (const foot of feet) {
      const at = point(packet, foot, anim.rig.rest.subarray(foot * 3, foot * 3 + 3));
      const x = at[0]! + 120, fy = at[1]! + 17, z = at[2]! + 120;
      const planeDistance = (fy - 20 - (x - 128) * across - (z - 128) * along) / length;
      // Tilting and the capsule's floor offset preserve the authored foot height above the support plane.
      expect(Math.abs(planeDistance - anim.rig.solved.pos[foot * 3 + 1]!)).toBeLessThan(.002); // Below a 1/256 m terrain sample.
    }
    const drawn = packet.bones.slice(0, packet.boneCount * BONE_FLOATS);
    for (let repeat = 0; repeat < 3; repeat++) {
      packet.beginFrame(); chars.begin(packet);
      expect(chars.add(packet, kind, 8, y - 17, 8, 0, st, 30, null, 0, new Uint8Array(6), 0, gear, 0, 12, true, false)).toBe(true);
      expect(packet.bones.subarray(0, drawn.length)).toEqual(drawn);
    }
  }
});

test('a moving ground mount falls when its actual elevated ramp support is removed', () => {
  for (const species of ['raptor', 'parasaur']) {
    const w = flatWorld(4), p = w.reg.tamedMove[w.kind(`core:${species}`)]!, frame = new GroundMountFrame();
    const ref = w.structs.add(w.kind('core:zslope_ramp'), 128, 5, 128, 0, 0, 1), b = new Body();
    b.x = b.z = 128; b.y = 8; b.staminaMax = 1000; b.stamina = 1000000;
    for (let tick = 0; tick < 60; tick++) stepBody(w, b, 0, 0, 0, 0, 0, p, 1 / 30);
    expect(b.grounded).toBe(true); expect(b.y).toBeGreaterThan(4);
    for (let tick = 0; tick < 5; tick++) stepBody(w, b, 0, 127, 0, 0, 0, p, 1 / 30);
    expect(b.grounded).toBe(true);
    groundMountFrame(w, p, b.x, b.y, b.z, 0, frame);
    expect(frame.supported).toBe(true); expect(frame.ny).toBeLessThan(.99);
    const y = b.y; expect(w.structs.remove(ref)).toBe(true);
    for (let tick = 0; tick < 10; tick++) stepBody(w, b, 0, 127, 0, 0, 0, p, 1 / 30);
    expect(b.grounded).toBe(false); expect(b.y).toBeLessThan(y - .5);
    groundMountFrame(w, p, b.x, b.y, b.z, 0, frame); expect(frame.supported).toBe(false);
  }
});
