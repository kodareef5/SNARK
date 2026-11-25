// The jet as a vehicle one boards: its pilot's door is beside the cockpit ahead of the wing, it may not be left in the
// air, a parked one sleeps once its engine has wound down, and what it is comes back from a save.

import { expect, test } from "bun:test";
import { restoreVehicle, startVehicle, VEHICLE_COMPONENT } from "../../server/vehicles/save.ts";
import { JET_VEHICLE } from "../../content/vehicles/jet.ts";
import { Body as SimBody, BTN_CROUCH, BTN_JUMP, BTN_MOD, BTN_USE } from "../../shared/sim/character.ts";
import { familyOf } from "../../shared/sim/families.ts";
import { afterburnerRatio, jetNozzleAt, jetSpoolAt } from "../../shared/sim/jet.ts";
import { JET_SPEED_CAP } from "../../shared/sim/vehicle.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { camp, drive, pilot, pos, press, restart, survivor, until, vehicle } from "../kit/kit.ts";

const def = JET_VEHICLE;

test("the pilot's door is beside the cockpit ahead of the wing, clear of the jet", () => {
  const { h, ada, at } = camp();
  const jet = vehicle(h, ada, "jet", { at: { x: at.x, z: at.z + 30 }, yaw: 0 });
  const door = [0, 0, 0], ents = h.world.ents, seat = def.seats[0]!;
  h.host.urban.door(jet.e, seat, .4, door);
  // Beside the fuselage at the seat, not out past the wing tip.
  expect(Math.abs(door[0]! - ents.x[jet.e]!)).toBeCloseTo(Math.abs(seat.entry[0]), 3);
  expect(door[2]! - ents.z[jet.e]!).toBeCloseTo(seat.entry[2], 3);
  expect(Math.abs(seat.entry[0])).toBeLessThan(def.spec.halfWidth / 2);
  const v = ents.vrow[jet.e]!;
  const frame = { x: ents.x[jet.e]!, y: ents.y[jet.e]!, z: ents.z[jet.e]!, yaw: ents.vehicleYaw[v]!, pitch: 0, roll: 0, qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! };
  expect(familyOf(def)!.meetsCapsule(def, frame, door[0]!, ents.y[jet.e]!, door[2]!, .4, 1.8)).toBeNull();
  // Under the wing the jet is in the way of a body standing there.
  expect(familyOf(def)!.meetsCapsule(def, frame, ents.x[jet.e]! + 3, ents.y[jet.e]! + 1.2, ents.z[jet.e]! - 3, .4, 1.8)).not.toBeNull();
  drive(h, ada, jet.e);
  expect(ada.driving).toBe(jet.e);
});

test("a jet in the air keeps its pilot; on the ground it lets them out", () => {
  const { h, ada, at } = camp();
  const jet = vehicle(h, ada, "jet", { at: { x: at.x, z: at.z + 30 }, yaw: 0, drive: true });
  const ents = h.world.ents, p = pilot(h, ada);
  p.buttons = BTN_MOD | BTN_JUMP;
  h.run(6000);
  expect(ents.y[jet.e]! - h.world.hf.heightAt(ents.x[jet.e]!, ents.z[jet.e]!)).toBeGreaterThan(10);
  expect(ents.flags[jet.e]! & F_GROUNDED).toBe(0);
  p.buttons = BTN_MOD;
  press(h, ada, BTN_USE);
  h.run(1500);
  expect(ada.driving).toBe(jet.e);
  p.buttons = BTN_MOD | BTN_CROUCH;
  expect(until(h, () => (ents.flags[jet.e]! & F_GROUNDED) !== 0, 30)).toBe(true);
  p.buttons = BTN_MOD;
  h.run(500);
  press(h, ada, BTN_USE);
  expect(until(h, () => ada.driving === -1, 5)).toBe(true);
  // Out by the cockpit's door, not round the wing.
  const me = pos(h, ada), door = [0, 0, 0];
  h.host.urban.door(jet.e, def.seats[0]!, .4, door);
  expect(Math.hypot(me.x - door[0]!, me.z - door[2]!)).toBeLessThan(1.5);
});

test("a parked jet does not rest until its engine has wound down, then rests", () => {
  const { h, ada, at } = camp();
  const jet = vehicle(h, ada, "jet", { at: { x: at.x, z: at.z + 30 }, yaw: 0, drive: true });
  const ents = h.world.ents, v = ents.vrow[jet.e]!, p = pilot(h, ada);
  p.moveZ = 1;
  h.run(2000);
  p.moveZ = 0;
  p.buttons = BTN_JUMP;
  h.run(1000);
  expect(jetSpoolAt(ents, v)).toBeGreaterThan(.1);
  p.buttons = 0;
  press(h, ada, BTN_USE);
  expect(until(h, () => ada.driving === -1, 5)).toBe(true);
  expect(h.host.urban.resting(jet.e)).toBe(false);
  expect(until(h, () => jetSpoolAt(ents, v) === 0 && ents.vehicleEngineOn[v] === 0, 10)).toBe(true);
  expect(until(h, () => h.host.urban.resting(jet.e), 10)).toBe(true);
});

test("a parked jet comes back from a save with its wheels, nozzle and fuel as they were", () => {
  const { h, ada, at } = camp({ save: true });
  const jet = vehicle(h, ada, "jet", { at: { x: at.x, z: at.z + 30 }, yaw: .5 });
  const ents = h.world.ents, v = ents.vrow[jet.e]!;
  const saved = jet.rec.extra.get(VEHICLE_COMPONENT)!;
  expect([saved[0], saved.length]).toEqual([10, 119]);
  const was = { gear: ents.vehicleGear[v], nozzle: jetNozzleAt(ents, v), fuel: ents.fuel[v], x: ents.x[jet.e] };
  const yaw = ents.vehicleYaw[v]!, y = ents.y[jet.e]!;
  expect([was.gear, was.nozzle]).toEqual([1, 1]);
  ada.close();
  h.run(500);
  const next = restart(h);
  survivor(next, "ada");
  const e = next.host.records.entOf.get(jet.rec.pid)!, n = next.world.ents, w = n.vrow[e]!;
  expect({ gear: n.vehicleGear[w], nozzle: jetNozzleAt(n, w), fuel: n.fuel[w], x: n.x[e] }).toEqual(was);
  expect(n.vehicleYaw[w]!).toBeCloseTo(yaw, 4);
  expect(n.y[e]!).toBeCloseTo(y, 3);
  expect(n.flags[e]! & F_GROUNDED).not.toBe(0);
});

test("a saved jet is read back within its limits: speed, wheels, spool and nozzle", () => {
  const b = new SimBody();
  b.yaw = 0;
  startVehicle(b, def);
  expect([b.vehicleGear, b.vehicleRotorPhase, b.grounded]).toEqual([1, 1, true]);
  const rec = { pid: 7, extra: new Map<number, Uint8Array>() };
  b.vx = 400; b.vy = -400; b.vehicleGear = 6; b.vehicleRotorRpm = 9; b.vehicleRotorPhase = 3; b.vehicleCollective = 2;
  const bytes = new Uint8Array(119), view = new DataView(bytes.buffer);
  // Written by hand in the version 10 layout: the base fields, then the rotor fields.
  const base = ["vehicleYaw", "vehiclePitch", "vehicleRoll", "steering", "wheelAngle", "fuel", "vehicleYawRate", "vehiclePitchRate", "vehicleRollRate", "vehicleGroundPitch", "vehicleGroundRoll", "vehicleRideOffset", "vehicleRideVelocity", "vx", "vy", "vz", "vehicleGear", "vehicleRpm", "vehicleShiftTime", "vehiclePayloadMass"] as const;
  const rotor = ["vehicleRotorRpm", "vehicleRotorPhase", "vehicleEngineCondition", "vehicleRotorCondition", "vehicleQx", "vehicleQy", "vehicleQz", "vehicleQw", "vehicleCollective"] as const;
  bytes[0] = 10;
  base.forEach((f, i) => view.setFloat32(1 + i * 4, b[f], true));
  bytes[81] = 1;
  rotor.forEach((f, i) => view.setFloat32(82 + i * 4, b[f], true));
  const back = new SimBody();
  restoreVehicle(back, rec.pid, bytes, def);
  expect([back.vx, back.vy, back.vehicleGear, back.vehicleRotorRpm, back.vehicleRotorPhase, back.vehicleCollective, back.steering])
    .toEqual([JET_SPEED_CAP, -JET_SPEED_CAP, 1, Math.fround(afterburnerRatio(def.spec)), 1, 1, 0]);
  expect(() => restoreVehicle(back, rec.pid, bytes.subarray(0, 90), def)).toThrow("version 10");
});
