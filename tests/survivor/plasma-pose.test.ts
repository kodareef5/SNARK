import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_NEAR, DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { Scene, type OwnBody } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { AnimState, PITCH_STEPS } from "../../shared/anim/pose.ts";
import { HELD_MUZZLE } from "../../shared/content/kinds/weapons.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../shared/sim/entities.ts";
import { ACT_EQUIP, ACT_NONE, ACT_RELOAD, HOLD_PISTOL, HOLD_RIFLE } from "../../shared/sim/weapon.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const item = (s: string) => reg.index.get("core:" + s)!;
const guns = [["rifle_plasma", "plasma_cell", HOLD_RIFLE], ["pistol_plasma", "plasma_charge", HOLD_PISTOL]] as const;

function cast(firstPerson: boolean, yaw: number, pitch: number, gun: string, hold: number, act = ACT_NONE, elapsed = 2) {
  const w = flatWorld(4);
  const scene = new Scene({ dims: w.dims, hf: w.hf, structs: w.structs }, reg, corePack());
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw] = [100, 1.62, firstPerson ? 100 : 96, 0];
  const st = new AnimState();
  st.setMotion(0, 0, yaw, pitch);
  st.setAction(act, hold, 100 - elapsed);
  const gear = new Uint16Array(GEAR_COUNT);
  gear[GEAR_HELD] = item(gun);
  const own: OwnBody = { id: 8, kind: item("survivor"), x: 100, y: 0, z: 100, yaw, tick: 100, firstPerson,
    state: st, gear, look: null, colors: new Uint8Array(6) };
  scene.own = own;
  const rem = new RemoteSample();
  rem.count = 2;
  rem.tick = 100;
  for (let i = 0; i < rem.count; i++) {
    rem.id[i] = i === 0 ? 9 : 0;
    rem.kind[i] = own.kind;
    rem.flags[i] = 1;
    rem.x[i] = 100.4 + i * .2;
    rem.z[i] = 100.9;
    rem.yaw[i] = yaw;
    rem.anim[i] = st.pack();
    rem.gear[i * GEAR_COUNT + GEAR_HELD] = gear[GEAR_HELD]!;
  }
  const packet = scene.build(cam, rem);
  return { ch: scene.characters, packet, scene, cam, rem };
}

for (const [gun, ammo, hold] of guns) {
  test(gun + " sights its drawn barrel in first and third person", () => {
    for (const first of [false, true]) {
      for (const [yaw, pitch] of [[-1.1, -.65], [.3, 0], [1.7, .65]] as const) {
        const { ch, packet } = cast(first, yaw, pitch, gun, hold);
        const tip = [0, 0, 0], axis = [0, 0, 0], held = [0, 0, 0];
        expect(ch.plasmaBore(100, 1.62, 100, item(ammo), true, tip, axis)).toBe(true);
        expect(ch.heldPoint(8, HELD_MUZZLE, held)).toBe(true);
        expect(tip).toEqual(held);
        const mesh = corePack().header.meshes.findIndex(m => m.id === "core:" + gun);
        const drawn = packet.drawMesh.subarray(0, packet.drawCount).some((m, i) =>
          m === mesh && (packet.drawFlags[i]! & (DRAW_SKINNED | DRAW_NEAR)) === (DRAW_SKINNED | (first ? DRAW_NEAR : 0)));
        expect(drawn).toBe(true);
        const step = Math.PI / (2 * PITCH_STEPS), look = Math.round(pitch / step) * step;
        expect(Math.hypot(...axis)).toBeCloseTo(1, 6);
        expect(Math.atan2(axis[0]!, axis[2]!)).toBeCloseTo(yaw, 3);
        expect(Math.asin(axis[1]!)).toBeCloseTo(look, 3);
      }
    }
  });

  test(gun + " follows the hands when lowered to equip or reload", () => {
    for (const [act, elapsed] of [[ACT_EQUIP, 0], [ACT_RELOAD, 18]] as const) {
      const { ch } = cast(false, 0, 0, gun, hold, act, elapsed);
      const axis = [0, 0, 0];
      expect(ch.plasmaBore(100, 1.62, 100, item(ammo), true, [0, 0, 0], axis)).toBe(true);
      expect(Math.abs(axis[1]!)).toBeGreaterThan(.1);
    }
  });
}

test("a passing player's plasma round selects the correct nearby gun and body", () => {
  const { ch } = cast(false, 0, 0, guns[0][0], HOLD_RIFLE);
  const tip = [0, 0, 0], dir = [0, 0, 0], other = [0, 0, 0];
  expect(ch.plasmaBore(100, 1.62, 100, item("plasma_cell"), false, tip, dir)).toBe(true);
  expect(ch.heldPoint(9, HELD_MUZZLE, other)).toBe(true);
  expect(tip).toEqual(other);
  expect(ch.plasmaBore(100, 1.62, 100, item("plasma_cell"), false, tip, dir, 0)).toBe(true);
  expect(ch.heldPoint(0, HELD_MUZZLE, other)).toBe(true);
  expect(tip).toEqual(other);
  expect(ch.plasmaBore(100, 1.62, 100, item("plasma_cell"), false, tip, dir, 37)).toBe(false);
  expect(ch.plasmaBore(100, 1.62, 100, item("plasma_charge"), false, tip, dir)).toBe(false);
  expect(ch.heldNear(100, 1.62, 100, HELD_MUZZLE, tip, item("rocket"))).toBe(false);
  expect(ch.plasmaBore(114, 1.62, 100, item("plasma_cell"), false, tip, dir)).toBe(false);
});

test("a delayed shot follows its named moving shooter past another rifle", () => {
  const { ch, scene, cam, rem } = cast(false, 0, 0, guns[0][0], HOLD_RIFLE);
  const oldX = rem.x[1]!, oldZ = rem.z[1]!, ammo = item("plasma_cell");
  rem.x[1]! += 3;
  rem.tick += 6;
  scene.build(cam, rem);
  const tip = [0, 0, 0], dir = [0, 0, 0], held = [0, 0, 0];
  expect(ch.plasmaBore(oldX, 1.62, oldZ, ammo, false, tip, dir, rem.id[1])).toBe(true);
  expect(ch.heldPoint(rem.id[1]!, HELD_MUZZLE, held)).toBe(true);
  expect(tip).toEqual(held);
  expect(ch.plasmaBore(oldX, 1.62, oldZ, ammo, false, tip, dir)).toBe(true);
  expect(ch.heldPoint(rem.id[0]!, HELD_MUZZLE, held)).toBe(true);
  expect(tip).toEqual(held);
});
