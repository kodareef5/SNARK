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
import { capsuleFree } from "../../shared/world/collide.ts";
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


test("a real ledge fall can settle nose-down, release its driver, and report obstructed rather than busy recovery", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const session = h.join("nose-exit"); h.run(400);
    const c = h.client(session)!, a = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
    h.host.survival.gods.add(owner.pid);
    const wall = h.reg.index.get("core:wall")!, hy = h.reg.halfY[wall]!, hx = h.reg.halfX[wall]!, hz = h.reg.halfZ[wall]!;
    for (let z = 50 + hz; z < 70; z += hz * 2) for (let x = 120 + hx; x < 136; x += hx * 2) h.world.structs.add(wall, x, hy, z, 0, 0, 1e6);
    for (const dx of [-3, 0, 3]) h.world.structs.add(wall, 128 + dx, 1.5, 73 + hz, 0, 0, 1e6);
    const e = h.host.spawnVehicle("core:compact", 128, 58, owner.team, 0, { y: 3.02 }), v = a.vrow[e]!;
    a.setPosition(c.ent, 129.6, 3.05, 58.12); h.world.history.discontinuity(c.ent); h.run(200);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1000);
    a.vz[e] = 12; h.world.history.discontinuity(e);
    h.pilots[0]!.moveZ = .3; h.run(1000); h.pilots[0]!.moveZ = 0; h.run(15000);
    expect(Math.abs(2 * (a.vehicleQy[v]! * a.vehicleQz[v]! - a.vehicleQw[v]! * a.vehicleQx[v]!))).toBeGreaterThan(.8);
    expect(Math.hypot(a.vx[e]!, a.vy[e]!, a.vz[e]!)).toBe(0);
    h.host.urban.dismount(c); h.run(1000); expect(a.seat[c.ent]).toBe(0);
    const move = h.reg.move[a.kind[c.ent]!]!;
    expect(capsuleFree(h.world, a.x[c.ent]!, a.y[c.ent]!, a.z[c.ent]!, move.radius, move.height)).toBe(true);
    // The three-metre gap cannot fit the upright longitudinal hull. Preserve that real obstruction.
    a.setPosition(c.ent, a.x[e]! + 1.7, .1, a.z[e]!); h.world.history.discontinuity(c.ent);
    expect(h.host.vehicles.flip(c, makeHandle(e, a.gen[e]!))).toBe(RESULT_OBSTRUCTED);
  } finally { h.host.shutdown(); }
});

test("a clipped seated capsule cannot use a low ceiling as a new escape floor", () => {
  const { h, c, a, e, v } = camp();
  try {
    a.setPosition(c.ent, 65.8, 0, 64.12); h.world.history.discontinuity(c.ent);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1000);
    a.setPosition(e, 64, 1.52722, 64); a.vehicleQx[v] = .4890127; a.vehicleQw[v] = .8722767;
    h.world.history.discontinuity(e); h.host.urban.syncAfterContact(e);
    const ceiling = h.reg.index.get("core:ceiling")!, y = a.y[c.ent]! + .8;
    for (let x = -6; x <= 6; x += 3) for (let z = -6; z <= 6; z += 3) h.world.structs.add(ceiling, 64 + x, y, 64 + z, 0, 0, 100);
    h.host.urban.dismount(c);
    const pending = h.host.urban.occupancy.pending(c.pid);
    if (pending) { h.world.tick = pending.dueAt; h.host.urban.beforeStep(); }
    expect(a.seat[c.ent]).toBe(e + 1);
  } finally { h.host.shutdown(); }
});
