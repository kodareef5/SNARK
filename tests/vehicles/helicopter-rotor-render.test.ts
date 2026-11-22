import { expect, test } from "bun:test";
import { HELICOPTER_VEHICLE } from "../../content/vehicles/helicopter.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_ROTOR, FramePacket } from "../../client/core/render/packet.ts";
import { rotorOf } from "../../client/core/render/detailtext.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { MAX_ROTOR_CARDS, RotorBlur, rotorPassages } from "../../client/core/render/rotor-blur.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { validateVehicleDefinition } from "../../shared/sim/vehicle.ts";

const main = HELICOPTER_VEHICLE.rotors[0]!, tail = HELICOPTER_VEHICLE.rotors[1]!;
const identity = new Float64Array([0, 0, 0, 1]);
function pose(p: FramePacket, bone = 0): void {
  p.bones.set([1, 0, 0, 20, 0, 1, 0, 30, 0, 0, 1, 40], bone * 12);
}

test("spool-up hands authored blades to bounded blur before 30Hz aliasing; spool-down has hysteresis", () => {
  const p = new FramePacket(), blur = new RotorBlur();
  const frame = (rpm: number) => { p.beginFrame(); blur.begin(); pose(p); const hidden = blur.add(p, 0, 0, main, rpm, identity, 20, 30, 40, 1); blur.write(p); return hidden; };
  expect(frame(0)).toBe(false); expect(p.detailCount).toBe(0); expect(p.bones[0]).toBe(1);
  expect(frame(120)).toBe(false); expect(p.detailCount).toBe(1); expect(p.bones[0]).toBe(1);
  const shows = p.detailWords[DETAIL.misc]! >>> 16 & 255;
  expect(shows).toBeGreaterThan(0); expect(shows).toBeLessThan(255);
  expect(frame(190)).toBe(true); expect(p.bones[0]).toBeGreaterThan(0); expect(p.bones[0]).toBeLessThan(1e-5);
  expect(frame(175)).toBe(true); expect(frame(145)).toBe(false); expect(p.bones[0]).toBe(1);
  expect(frame(0)).toBe(false); expect(p.detailCount).toBe(0);
  expect(rotorPassages(main, 410)).toBeCloseTo(27.333);
  expect(rotorPassages(tail, 410)).toBeCloseTo(68.333);
});

test("blur keeps the measured rotor plane and radius through a bank; suppression preserves its pivot and other bones", () => {
  const p = new FramePacket(), blur = new RotorBlur(), q = new Float64Array([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  pose(p); pose(p, 1); const hardware = p.bones.slice(12, 24);
  blur.add(p, 0, 1, main, 410, q, 20, 30, 40, 1); blur.write(p);
  expect([...p.bones.slice(12, 24)]).toEqual([...hardware]);
  for (let row = 0; row < 3; row++) {
    const i = row * 4;
    const pivot = p.bones[i]! * main.at[0] + p.bones[i + 1]! * main.at[1] + p.bones[i + 2]! * main.at[2] + p.bones[i + 3]!;
    expect(pivot).toBeCloseTo([20 + main.at[0], 30 + main.at[1], 40 + main.at[2]][row]!, 4);
  }
  const [f, o] = [p.details, DETAIL];
  expect(Math.hypot(f[o.along]!, f[o.along + 1]!, f[o.along + 2]!)).toBeCloseTo(main.radius);
  expect(Math.hypot(f[o.across]!, f[o.across + 1]!, f[o.across + 2]!)).toBeCloseTo(main.radius);
  const normal = new Float64Array(3); quatRotate(q, 0, ...main.axis, normal, 0);
  for (const start of [o.along, o.across]) expect(f[start]! * normal[0]! + f[start + 1]! * normal[1]! + f[start + 2]! * normal[2]!).toBeCloseTo(0);
  expect(p.detailWords[DETAIL.misc]! & (DETAIL_ROTOR << 8)).not.toBe(0);
  expect([...p.bones.subarray(0, 24)].every(Number.isFinite)).toBe(true);
});

test("a crowded scene keeps a fixed card budget and falls back to authored blades without disappearing rotors", () => {
  const p = new FramePacket(), blur = new RotorBlur();
  for (let i = 0; i < MAX_ROTOR_CARDS + 3; i++) {
    pose(p);
    const hidden = blur.add(p, 0, i, main, 410, identity, 0, 0, 10 + i, 1);
    expect(hidden).toBe(i < MAX_ROTOR_CARDS);
  }
  expect(p.bones[0]).toBe(1);
  blur.write(p); expect(p.detailCount).toBe(MAX_ROTOR_CARDS);
  expect(p.details[2]).toBeGreaterThan(p.details[(p.detailCount - 1) * DETAIL_FLOATS + 2]!);
});

test("a rotor crossing the depth split is kept in both ranges and a distant rotor keeps its far draw", () => {
  const p = new FramePacket(), blur = new RotorBlur(), cam = new Camera();
  cam.split = 384; cam.update();
  const passes = (z: number) => {
    blur.begin(); pose(p);
    blur.add(p, 0, 0, { ...main, at: [0, 0, 0] }, 410, identity, 0, 0, z, 1);
    return blur.passes(cam);
  };
  expect(passes(20)).toBe(1); expect(passes(384)).toBe(3); expect(passes(500)).toBe(2);
});

test("swept blade coverage is phase invariant and transparent outside the authored disc and root", () => {
  const a = [0, 0, 0], b = [0, 0, 0], density = main.blur!.blades * main.blur!.chord / (Math.PI * 2 * main.radius);
  for (const radius of [0, .05, .1, .3, .8, .96, 1, 1.1]) {
    rotorOf(radius, 0, density, a); rotorOf(radius * Math.cos(1.37), radius * Math.sin(1.37), density, b);
    expect(a[0]).toBeCloseTo(b[0]!); expect(a[0]).toBeLessThanOrEqual(.65);
    if (radius <= .05 || radius >= 1) expect(a[0]).toBe(0);
  }
  rotorOf(.5, 0, density, a); expect(a[0]).toBeCloseTo(density * 2);
  expect(() => validateVehicleDefinition({ ...HELICOPTER_VEHICLE, rotors: [{ ...main, blur: { blades: 0, chord: .2 } }] })).toThrow("invalid helicopter rotor blur");
});
