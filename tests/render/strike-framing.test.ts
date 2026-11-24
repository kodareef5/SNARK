import { expect } from "bun:test";
import { BONE_FLOATS, DRAW_NEAR, type FramePacket } from "../../client/core/render/packet.ts";
import type { OwnBody } from "../../client/core/render/scene.ts";
import { B_FINGERTIPS_L, B_FINGERTIPS_R, B_HAND_L, B_HAND_R, B_PROP_L, B_PROP_R, B_THUMB_L, B_THUMB_R } from "../../shared/anim/human.ts";
import { defaultLook, LOOK_SEX, REGIONS, setRegion } from "../../shared/anim/look.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { INSTANCE_BYTES, lodVertices, VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { STANCE_CROUCH, STANCE_STAND } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../shared/sim/entities.ts";
import { ACT_NONE, ACT_SWING, HOLD_HANDS, HOLD_PICK, HOLD_TOOL, SWING_TICKS } from "../../shared/sim/weapon.ts";
import { provingView } from "../../tools/snap.ts";
import { test } from "../fixtures/needs-art.ts";

function ownBones(p: FramePacket): Float32Array {
  let draw = p.drawCount - 1;
  while (draw >= 0 && !(p.drawFlags[draw]! & DRAW_NEAR)) draw--;
  expect(draw).toBeGreaterThanOrEqual(0);
  const bytes = new DataView(p.transient.buffer, p.transient.byteOffset);
  const first = bytes.getUint16(p.drawFirst[draw]! * INSTANCE_BYTES + 12, true);
  return p.bones.subarray(first * BONE_FLOATS);
}

function skin(m: Float32Array, bone: number, x: number, y: number, z: number): number[] {
  const b = bone * BONE_FLOATS;
  return [0, 4, 8].map((r) => m[b + r]! * x + m[b + r + 1]! * y + m[b + r + 2]! * z + m[b + r + 3]!);
}

function point(m: Float32Array, rig: readonly number[], bone: number, x = 0, z = 0): number[] {
  return skin(m, bone, rig[bone * 3]! + x, rig[bone * 3 + 1]!, rig[bone * 3 + 2]! + z);
}

function scene() {
  const view = provingView(192, 108);
  const { reg, cam } = view;
  const own: OwnBody = { kind: reg.index.get("core:survivor")!, x: 256, y: view.hf.heightAt(256, 240), z: 240, yaw: 0, state: new AnimState(), tick: 0, firstPerson: true, colors: new Uint8Array(6), look: defaultLook(), gear: new Uint16Array(GEAR_COUNT), id: 7 };
  view.scene.own = own;
  view.remote.count = 0;
  cam.x = own.x;
  cam.z = own.z;
  cam.yaw = 0;
  return { view, own };
}

test("the tool head stays in view through the lift on wide and narrow screens", () => {
  const { view, own } = scene();
  const { cam } = view;
  for (const [fov, aspect, pitch, stance] of [[70, 16 / 9, 0, STANCE_STAND], [55, 4 / 3, -0.7, STANCE_CROUCH], [70, 0.6, -0.35, STANCE_STAND]] as const) {
    cam.fovY = fov * Math.PI / 180;
    cam.aspect = aspect;
    cam.pitch = pitch;
    cam.y = own.y + (stance === STANCE_CROUCH ? 1.05 : 1.62);
    own.state.stance = stance;
    own.state.setMotion(0, 0, 0, cam.pitch);
    for (const sex of [0, 1]) {
      own.look![LOOK_SEX] = sex;
      for (const region of ["Arm length", "Hands"]) setRegion(own.look!, REGIONS.findIndex((r) => r.label === region), sex === 0 ? 1 : -1);
      const rig = view.pack.header.rigs.find((r) => r.id === (sex ? "human_f" : "human_m"))!.rest;
      for (const item of ["pick", "hatchet"]) for (const start of [1000, 1015]) {
        own.gear[GEAR_HELD] = view.reg.index.get(`core:${item}`)!;
        own.state.setAction(ACT_SWING, item === "pick" ? HOLD_TOOL | HOLD_PICK : HOLD_TOOL, start);
        for (let t = 1.5; t <= 5; t += 0.5) {
          own.tick = start + t;
          const bones = ownBones(view.scene.build(cam, view.remote));
          const [x, y, z] = point(bones, rig, B_PROP_R, 0, 0.31);
          const at = [0, 0, 0];
          const sample = `${item}, sex ${sex}, ${fov} degrees, swing ${start}, tick ${t}`;
          expect(cam.project(cam.x + x!, cam.y + y!, cam.z + z!, at), sample).toBe(true);
          expect(Math.abs(at[0]! - 0.5), sample).toBeLessThan(0.5);
          expect(Math.abs(at[1]! - 0.5), sample).toBeLessThan(0.5);
          if (item !== "pick" || t < 3) continue;
          const upper = point(bones, rig, B_PROP_R, 0, 0.10);
          const palm = point(bones, rig, B_PROP_L);
          expect(Math.hypot(...palm.map((v, i) => v - upper[i]!)), sample).toBeLessThan(0.045);
        }
      }
    }
  }
});

test("held punches meet in guard and hands drop after the button is released", () => {
  const { view, own } = scene();
  const { cam } = view;
  cam.y = own.y + 1.62;
  cam.pitch = 0;
  const rig = view.pack.header.rigs.find((r) => r.id === "human_m")!.rest;
  let seam: number[] = [];
  for (let t = 0; t <= SWING_TICKS * 2 + 9; t += 0.5) {
    const start = 1000 + (t >= SWING_TICKS ? SWING_TICKS : 0);
    own.tick = 1000 + t;
    own.state.setAction(t < 2 * SWING_TICKS ? ACT_SWING : ACT_NONE, HOLD_HANDS, start);
    const bones = ownBones(view.scene.build(cam, view.remote));
    const fist = point(bones, rig, B_HAND_R, -0.09);
    if (t === SWING_TICKS - 0.5) seam = fist;
    if (t === SWING_TICKS) expect(Math.hypot(...fist.map((v, i) => v - seam[i]!))).toBeLessThan(0.025);
    if (t < 2 || t > SWING_TICKS * 2) continue;
    for (const [bone, x] of [[B_HAND_L, 0.09], [B_HAND_R, -0.09]] as const) {
      const p = point(bones, rig, bone, x);
      const height = p[1]! / (Math.tan(cam.fovY / 2) * p[2]!);
      expect(height, `tick ${t}, bone ${bone}`).toBeGreaterThan(-1);
    }
  }
  const p = point(ownBones(view.scene.build(cam, view.remote)), rig, B_HAND_R, -0.09);
  expect(p[1]!).toBeLessThan(-Math.max(0, p[2]!) * Math.tan(cam.fovY / 2));
});

test("the thumb folds across the fingertips on each native hand mesh", () => {
  const { view, own } = scene();
  const { cam, pack } = view;
  cam.y = own.y + 1.62;
  for (const sex of [0, 1]) {
    own.look![LOOK_SEX] = sex;
    const type = sex ? "human_f" : "human_m";
    const mesh = pack.header.meshes.find((m) => m.id === `core:${type}/hands`)!;
    const rig = pack.header.rigs.find((r) => r.id === type)!.rest;
    const verts = lodVertices(pack, mesh.lods[0]!);
    const bytes = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
    for (const [thumb, tips] of [[B_THUMB_L, B_FINGERTIPS_L], [B_THUMB_R, B_FINGERTIPS_R]] as const) {
      let end: number[] = [], longest = -1;
      const fingers: number[][] = [];
      for (let off = 0; off < verts.length; off += VERTEX_BYTES) {
        const bone = verts[off + 7];
        if (bone !== thumb && bone !== tips) continue;
        const p = [0, 1, 2].map((i) => mesh.center[i]! + mesh.half[i]! * bytes.getInt16(off + 2 * i, true) / 32767);
        if (bone === tips) fingers.push(p);
        else {
          const d = Math.hypot(...p.map((v, i) => v - rig[bone * 3 + i]!));
          if (d > longest) { longest = d; end = p; }
        }
      }
      expect(end).toHaveLength(3);
      expect(fingers.length).toBeGreaterThan(0);
      for (const hold of [HOLD_HANDS, HOLD_TOOL | HOLD_PICK]) {
        own.gear[GEAR_HELD] = hold === HOLD_HANDS ? 0 : view.reg.index.get("core:pick")!;
        own.state.setAction(ACT_SWING, hold, 1000);
        own.tick = 1002;
        view.scene.build(cam, view.remote);
        own.tick = 1005;
        const bones = ownBones(view.scene.build(cam, view.remote));
        const t = skin(bones, thumb, end[0]!, end[1]!, end[2]!);
        const nearest = Math.min(...fingers.map((p) => {
          const f = skin(bones, tips, p[0]!, p[1]!, p[2]!);
          return Math.hypot(...f.map((v, i) => v - t[i]!));
        }));
        expect(nearest, `${type}, bone ${thumb}, hold ${hold}`).toBeLessThan(0.055);
      }
    }
  }
});
