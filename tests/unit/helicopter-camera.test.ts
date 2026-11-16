import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { Controls } from "../../client/core/controls.ts";
import { CockpitLook, Viewpoint } from "../../client/core/viewpoint.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { vehicleRotation, type VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import { BTN_MOD, BTN_PRIMARY } from "../../shared/sim/character.ts";

const frame = (yaw = 0, pitch = 0, roll = 0): VehicleFrame => ({ x: 30, y: 40, z: 50, yaw, pitch, roll });

test("cockpit forward and up follow yaw, vertical flight, full loops and inversion without a forced upright horizon", () => {
  const view = new Viewpoint(), cam = new Camera(), q = new Float64Array(4), expected = new Float64Array(3), ray = new Float64Array(3), screen = new Float32Array(3);
  for (const attitude of [frame(Math.PI / 2), frame(0, 0, Math.PI), frame(0, Math.PI / 2), frame(0, Math.PI), frame(.8, -Math.PI / 2, 1.2)]) for (const [yaw, pitch] of [[0, 0], [.24, -.17]] as const) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    view.placeCockpit(cam, 3, 4, 5, attitude, yaw, pitch); cam.update(); vehicleRotation(attitude, q);
    quatRotate(q, 0, sy * cp, sp, cy * cp, expected, 0); cam.ray(.5, .5, ray);
    for (let i = 0; i < 3; i++) expect(ray[i]!).toBeCloseTo(expected[i]!, 6);
    // A point above the pilot's local gaze remains above on screen even when the aircraft is upside down.
    const fx = expected[0]!, fy = expected[1]!, fz = expected[2]!;
    quatRotate(q, 0, -sy * sp, cp, -cy * sp, expected, 0);
    expect(cam.project(cam.x + fx * 10 + expected[0]!, cam.y + fy * 10 + expected[1]!, cam.z + fz * 10 + expected[2]!, screen)).toBe(true);
    expect(screen[0]!).toBeCloseTo(.5, 6); expect(screen[1]!).toBeLessThan(.5);
    // Off-centre selection rays and projection agree, including roll, before and after update().
    cam.ray(.23, .71, ray);
    expect(cam.project(cam.x + ray[0]! * 20, cam.y + ray[1]! * 20, cam.z + ray[2]! * 20, screen)).toBe(true);
    expect(screen[0]!).toBeCloseTo(.23, 6); expect(screen[1]!).toBeCloseTo(.71, 6);
    expect([cam.x, cam.y, cam.z]).toEqual([3, 4, 5]);
  }
});

test("cockpit offsets and chase look are independent of flight input and survive repeated view switches", () => {
  const c = new Controls(), look = new CockpitLook(), cam = new Camera(), view = new Viewpoint();
  c.heli(true); c.key("KeyC", true); c.key("KeyC", false); c.key("KeyQ", true); c.key("KeyW", true);
  c.yaw = -.7; c.pitch = .2;
  look.sync(12, false, c, frame()); look.sync(12, true, c, frame());
  expect(c.yaw).toBe(0); expect(c.pitch).toBe(0);
  look.look(.3, .1); look.sync(12, true, c, frame(Math.PI / 2));
  expect(c.yaw).toBeCloseTo(Math.PI / 2 + .3, 6); expect(c.pitch).toBeCloseTo(.1, 6);
  expect(c.buttons).toBe(BTN_MOD | BTN_PRIMARY); expect(c.moveZ).toBe(1);
  view.placeCockpit(cam, 0, 1, 0, frame(0, 0, Math.PI), look.yaw, look.pitch);
  expect(Math.abs(cam.roll)).toBeCloseTo(Math.PI, 6);
  look.sync(12, false, c, frame());
  expect(c.yaw).toBe(-.7); expect(c.pitch).toBe(.2);
  view.placeVehicle(cam, null, 0, 1, 0, c.yaw, c.pitch, 0, 0, 16, false);
  expect(cam.roll).toBe(0);
  c.look(40, -20); const chase = [c.yaw, c.pitch];
  look.sync(12, true, c, frame()); expect(c.yaw).toBeCloseTo(.3, 6); expect(c.pitch).toBeCloseTo(.1, 6);
  look.sync(12, false, c, frame()); expect([c.yaw, c.pitch]).toEqual(chase);
  look.sync(12, true, c, frame()); const exiting = [c.yaw, c.pitch];
  look.sync(-1, false, c); expect([c.yaw, c.pitch]).toEqual(exiting);
  view.place(cam, null, 0, 1, 0, c.yaw, c.pitch); expect(cam.roll).toBe(0);
  look.sync(15, true, c, frame()); expect(c.yaw).toBe(0); expect(c.pitch).toBe(0);
});
