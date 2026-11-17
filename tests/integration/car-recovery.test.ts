import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { StaticVehicleSolids } from "../../shared/world/vehicle-solid.ts";
import { carShapes } from "../../shared/world/vehicle-shapes.ts";
import { recoveryFrame } from "../../server/vehicle-recovery.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function camp(bank = false) {
  const map = flatMap(2, { seaLevel: bank ? .7 : -Infinity });
  if (bank) {
    const side = Math.sqrt(map.heights.length);
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) map.heights[z * side + x] = Math.round((Math.max(0, (64 - z * 2) * .1) - map.minY) / map.stepY);
  }
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(map) });
  const s = h.join("recovery"); h.run(400);
  const c = h.client(s)!, actor = h.host.records.byPid.get(c.pid)!, a = h.world.ents;
  a.setPosition(c.ent, 66.8, 0, 64); h.world.history.discontinuity(c.ent);
  const e = h.host.spawnVehicle("core:compact", 64, 64, actor.team), v = a.vrow[e]!, def = h.reg.vehicle[a.kind[e]!]!;
  if (!isWheelVehicle(def)) throw new Error("compact must be wheeled");
  return { h, c, a, e, v, def, handle: makeHandle(e, a.gen[e]!) };
}

for (const roll of [Math.PI / 2, -Math.PI / 2, Math.PI]) test(`manual recovery rights a stopped car rolled ${roll} through clear geometry`, () => {
  const { h, c, a, e, v, def, handle } = camp();
  try {
    a.setPosition(e, 64, (Math.abs(roll) === Math.PI ? def.spec.height : def.spec.halfWidth) + .015, 64);
    a.vehicleQz[v] = Math.sin(roll / 2); a.vehicleQw[v] = Math.cos(roll / 2); a.vehicleRoll[v] = roll;
    a.flags[e] = a.flags[e]! & ~F_GROUNDED;
    a.vehicleEngineCondition[v] = 0; a.vehicleFlooding[v] = 1;
    expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_OK);
    expect(a.vehicleRoll[v]).toBe(0); expect(a.vehicleQw[v]).toBe(1);
    const solids = new StaticVehicleSolids(h.world), at = recoveryFrame(h.world, e);
    expect(solids.blocked(at, at, carShapes(def.spec), undefined, false, 0)).toBeNull();
    expect(a.vehicleEngineCondition[v]).toBe(0); expect(a.vehicleFlooding[v]).toBe(1);
    h.run(1500);
    expect(a.y[e]!).toBeLessThan(.15); expect(Math.abs(a.vehicleRoll[v]!)).toBeLessThan(.05);
  } finally { h.host.shutdown(); }
});

test("a rolled, flooded car settles on its roof underwater and a diver can right it", () => {
  const { h, c, a, e, v, def, handle } = camp();
  try {
    h.world.hf.seaLevel = 3;
    a.setPosition(e, 64, def.spec.height + .015, 64);
    a.vehicleQz[v] = 1; a.vehicleQw[v] = 0; a.vehicleRoll[v] = Math.PI;
    a.vehicleFlooding[v] = 1; a.vehicleEngineCondition[v] = 0;
    a.flags[e] = a.flags[e]! & ~F_GROUNDED;
    h.world.history.discontinuity(e); h.host.urban.syncAfterContact(e);
    h.run(10000);
    expect(a.flags[e]! & F_GROUNDED).not.toBe(0);
    expect(Math.hypot(a.vx[e]!, a.vy[e]!, a.vz[e]!)).toBe(0);
    a.setPosition(c.ent, a.x[e]!, a.y[e]!, a.z[e]! + def.spec.halfLength + 1);
    h.world.history.discontinuity(c.ent);
    expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_OK);
    h.run(1500);
    expect(a.vehicleQw[v]!).toBeGreaterThan(.99);
    expect(a.vehicleEngineCondition[v]).toBe(0);
  } finally { h.host.shutdown(); }
});

test("manual flip refuses a blocked arc, moving hull, and airborne hull without changing its pose", () => {
  const { h, c, a, e, v, def, handle } = camp();
  try {
    a.setPosition(e, 64, def.spec.halfWidth + .015, 64);
    a.vehicleQz[v] = Math.SQRT1_2; a.vehicleQw[v] = Math.SQRT1_2; a.vehicleRoll[v] = Math.PI / 2;
    a.flags[e] = a.flags[e]! & ~F_GROUNDED;
    const before = recoveryFrame(h.world, e);
    const ceiling = h.reg.index.get("core:ceiling")!;
    const roof = h.world.structs.add(ceiling, 63.3, 1.95, 64, 0, 0, 100);
    expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_OBSTRUCTED);
    expect(recoveryFrame(h.world, e)).toEqual(before);
    h.world.structs.remove(roof);
    h.world.tick += 90; a.vz[e] = 1; expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_BUSY);
    h.world.tick += 90; a.vz[e] = 0; a.y[e] = 3; expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_BUSY);
  } finally { h.host.shutdown(); }
});

for (const pull of [false, true]) test(`a local ${pull ? "pull" : "push"} actually moves a flooded car and leaves its engine broken`, () => {
  const { h, c, a, e, v, handle } = camp();
  try {
    h.world.hf.seaLevel = .5; a.vehicleEngineCondition[v] = 0; a.vehicleFlooding[v] = 1;
    a.setPosition(c.ent, 64, 0, 67.2); h.world.history.discontinuity(c.ent);
    const z = a.z[e]!;
    expect(h.host.vehicles.recover(c, handle, pull)).toBe(RESULT_OK);
    h.run(1000);
    expect((a.z[e]! - z) * (pull ? 1 : -1)).toBeGreaterThan(.25);
    expect(a.vehicleEngineCondition[v]).toBe(0); expect(a.vehicleEngineOn[v]).toBe(0);
    expect(h.host.vehicles.recover(c, handle, pull)).toBe(RESULT_BUSY);
  } finally { h.host.shutdown(); }
});

test("occupied cars cannot be pushed or flipped by a nearby survivor", () => {
  const { h, c, a, e, handle } = camp();
  try {
    a.setPosition(c.ent, 65.8, 0, 64.12);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1300);
    expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_DENIED);
    expect(h.host.vehicles.recover(c, handle)).toBe(RESULT_DENIED);
  } finally { h.host.shutdown(); }
});

test("repeated local pushes recover a flooded car up a shallow bank before a paid repair", () => {
  const { h, c, a, e, v, def, handle } = camp(true);
  try {
    const actor = h.host.records.byPid.get(c.pid)!;
    for (const name of ["core:ingot", "core:polymer", "core:electronics"]) h.host.items.mint(actor, h.reg.index.get(name)!, 100);
    a.vehicleEngineCondition[v] = 0; a.vehicleFlooding[v] = 1;
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_BUSY);
    for (let attempt = 0; attempt < 12 && a.y[e]! + def.spec.clearance < .75; attempt++) {
      const z = a.z[e]! + 3.2;
      a.setPosition(c.ent, a.x[e]!, h.world.hf.heightAt(a.x[e]!, z) + .05, z);
      a.vx[c.ent] = a.vy[c.ent] = a.vz[c.ent] = 0;
      h.world.history.discontinuity(c.ent);
      expect(h.host.vehicles.recover(c, handle)).toBe(RESULT_OK);
      h.run(3100);
    }
    expect(a.y[e]! + def.spec.clearance).toBeGreaterThan(.7);
    expect(a.z[e]!).toBeLessThan(60);
    expect(a.vehicleEngineCondition[v]).toBe(0);
    const z = a.z[e]! + 3.2;
    a.setPosition(c.ent, a.x[e]!, h.world.hf.heightAt(a.x[e]!, z) + .05, z);
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_OK);
    expect(a.vehicleEngineCondition[v]).toBeCloseTo(.25, 6);
  } finally { h.host.shutdown(); }
});

test("recovery cannot push through a wall or flip through a nearby survivor", () => {
  const { h, c, a, e, v, def, handle } = camp();
  try {
    const other = h.join("beside-flip"); h.run(300);
    const observer = h.client(other)!;
    a.setPosition(e, 64, def.spec.halfWidth + .015, 64);
    a.vehicleQz[v] = Math.SQRT1_2; a.vehicleQw[v] = Math.SQRT1_2; a.vehicleRoll[v] = Math.PI / 2;
    a.flags[e] = a.flags[e]! & ~F_GROUNDED;
    a.setPosition(observer.ent, 63, 0, 64);
    expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_OBSTRUCTED);
    a.setPosition(observer.ent, 50, 0, 50);
    expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_BUSY);
    h.world.tick += 90;
    expect(h.host.vehicles.flip(c, handle)).toBe(RESULT_OK);
    h.run(1500);
    a.setPosition(c.ent, a.x[e]!, 0, a.z[e]! + 3.2);
    expect(h.host.vehicles.recover(c, handle)).toBe(RESULT_DENIED);
    a.vehicleFlooding[v] = 1;
    const z = a.z[e]!, wall = h.reg.index.get("core:wall")!;
    h.world.structs.add(wall, a.x[e]!, 1.5, z - def.spec.halfLength - .15, 0, 0, 10000);
    expect(h.host.vehicles.recover(c, handle)).toBe(RESULT_OK);
    h.run(1500);
    expect(a.z[e]!).toBeGreaterThan(z - .3);
    expect(Math.hypot(a.vx[e]!, a.vz[e]!)).toBeLessThan(.15);
  } finally { h.host.shutdown(); }
});

test("ground-spawned cars park across a hillside and regain rest after a small shove", () => {
  const map = flatMap(2), side = Math.sqrt(map.heights.length);
  const grade = Math.tan(18 * Math.PI / 180);
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    map.heights[z * side + x] = Math.round(((x * 2 - 64) * grade - map.minY) / map.stepY);
  }
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(map) });
  try {
    const a = h.world.ents, e = h.host.spawnVehicle("core:compact", 64, 64), v = a.vrow[e]!;
    expect(e).toBeGreaterThanOrEqual(0);
    expect(a.vehicleRoll[v]!).toBeCloseTo(Math.atan(grade), 2);
    a.vx[e] = -1; h.run(8000);
    expect(Math.abs(a.x[e]! - 64)).toBeLessThan(.6);
    expect(a.vx[e]).toBe(0);
    const placed = h.host.spawnVehicle("core:compact", 40, 64, 0, 0, { y: 8 });
    expect(a.y[placed]).toBe(8); expect(a.vehicleRoll[a.vrow[placed]!]).toBe(0);
  } finally { h.host.shutdown(); }
});
