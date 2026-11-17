import { expect, test } from "bun:test";
import { History, Past } from "../../server/history.ts";
import { EntityRecord } from "../../server/records.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { anchorFrame } from "../../shared/anim/seat.ts";
import { seatedEye } from "../../shared/anim/seated-eye.ts";
import { ZONE_HEAD } from "../../shared/anim/human.ts";
import { EntityStore, GEAR_WORN } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function arena() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], entityStart: 2, entityMax: 2, map: writeMap(flatMap(4)) });
  h.world.ents.reserve = 0;
  return h;
}

test("rewound cars cross the old 6.5m pad, chunk rectangle, diagonal rejection and ray endpoint guards", () => {
  const h = arena();
  try {
    const { world } = h, { ents, history } = world;
    const e = h.host.spawnVehicle("core:compact", 123, 95, 0);
    expect(e).toBeGreaterThanOrEqual(0);
    history.track(e);
    for (let tick = 1; tick <= 16; tick++) {
      world.tick = tick;
      ents.setPosition(e, 123 + (tick - 1) * 1.1, 0, 95);
      history.record(tick);
    }
    expect(history.displacement(1, 16)).toBeCloseTo(16.5, 4);
    expect(h.host.combat.castBodies(-1, 123, .4, 85, 0, 0, 1, 20, 0, 1)).toBe(e);
    // Target now lies beyond the endpoint too, rather than just perpendicular to the ray.
    expect(h.host.combat.castBodies(-1, 110, .4, 95, 1, 0, 0, 15, 0, 1)).toBe(e);
    // An unusually large current-tick displacement is still motion unless explicitly marked as a teleport.
    // The short ray's old rectangle excludes this chunk; the long diagonal's rectangle includes it but its old
    // diagonal rejection excludes it. Both broadphase stages must use the same conservative displacement.
    ents.setPosition(e, 250, 0, 95);
    expect(h.host.combat.castBodies(-1, 123, .4, 85, 0, 0, 1, 20, 0, 1)).toBe(e);
    expect(h.host.combat.castBodies(-1, 33, .4, 5, Math.SQRT1_2, 0, Math.SQRT1_2, 260, 0, 1)).toBe(e);
    expect(h.host.combat.castBodies(-1, 123, .4, 85, 0, 0, 1, 20)).toBe(-1);
  } finally { h.host.shutdown(); }
});

test("unrecorded vertical impulse and downhill motion use actual displacement, and a multi-tick projectile sees a crossing", () => {
  const h = arena();
  try {
    const { world } = h, { ents, history } = world;
    const e = h.host.spawnVehicle("core:compact", 110, 90, 0);
    history.track(e);
    world.tick = 1; history.record(1);
    world.tick = 2; ents.setPosition(e, 130, 12, 90); history.record(2);
    world.tick = 3; ents.setPosition(e, 150, 24, 90);
    expect(history.displacement(1, 3)).toBeGreaterThan(46);
    expect(h.host.combat.castBodies(-1, 110, .4, 80, 0, 0, 1, 20, 0, 1)).toBe(e);
    // A segment spanning two ticks crosses a fast target; its current sphere is well away from the ray.
    ents.setPosition(e, 130, 0, 90);
    history.discontinuity(e); world.tick = 4; history.record(4);
    ents.setPosition(e, 150, 0, 90); world.tick = 5; history.record(5);
    ents.setPosition(e, 170, 0, 90); world.tick = 6;
    expect(h.host.combat.castBodies(-1, 150, .4, 80, 0, 0, 1, 20, 0, 6, 2)).toBe(e);
  } finally { h.host.shutdown(); }
});

test("teleport invalidates old poses and never creates a projectile sweep across the skipped map", () => {
  const h = arena();
  try {
    const { world } = h, { ents, history } = world;
    const e = h.host.spawnVehicle("core:compact", 30, 90, 0);
    history.track(e); world.tick = 1; history.record(1);
    world.tick = 2; ents.setPosition(e, 220, 0, 90); history.discontinuity(e);
    expect(history.displacement(1, 2)).toBe(0);
    expect(history.at(1, e, new Past())).toBe(false);
    expect(h.host.combat.castBodies(-1, 125, .4, 80, 0, 0, 1, 20, 0, 2, 1)).toBe(-1);
    expect(h.host.combat.castBodies(-1, 30, .4, 80, 0, 0, 1, 20, 0, 1)).toBe(-1);
    history.record(2);
    expect(history.sample(1.5, e, new Past())).toBe(false);
    expect(history.at(2, e, new Past())).toBe(true);
  } finally { h.host.shutdown(); }
});

test("a fast carrier's seated survivor stays in the historical candidate set, and car hits use recorded full attitude", () => {
  const h = arena();
  try {
    const { world } = h, { ents, history, reg } = world;
    const car = h.host.spawnVehicle("core:compact", 123, 95, 0);
    const rider = ents.create(reg.index.get("core:survivor")!, 123, 3, 95, 0);
    ents.seat[rider] = car + 1; ents.seatGen[rider] = ents.gen[car]!; ents.seatSlot[rider] = 2;
    history.track(car); history.track(rider);
    for (let tick = 1; tick <= 16; tick++) {
      world.tick = tick;
      ents.setPosition(car, 123 + (tick - 1) * 1.1, 0, 95);
      ents.setPosition(rider, 123 + (tick - 1) * 1.1, 3, 95);
      history.record(tick);
    }
    // The seated body has no own walking speed; the authoritative pin movement still expands both query guards.
    expect(ents.vx[rider]).toBe(0);
    expect(h.host.combat.castBodies(-1, 123, 4.62, 92, 0, 0, 1, 5, 0, 1)).toBe(rider);
    const v = ents.vrow[car]!;
    ents.setPosition(car, 90, 2, 90); history.discontinuity(car);
    ents.vehicleQz[v] = 1; ents.vehicleQw[v] = 0;
    world.tick = 17; history.record(17);
    ents.vehicleQz[v] = 0; ents.vehicleQw[v] = 1;
    world.tick = 18;
    expect(h.host.combat.castBodies(-1, 90, 1.6, 85, 0, 0, 1, 10, 0, 17)).toBe(car);
    expect(h.host.combat.castBodies(-1, 90, 1.6, 85, 0, 0, 1, 10)).toBe(-1);
  } finally { h.host.shutdown(); }
});

test("seated hit history survives dismount, changed saddle and host slot reuse; pre-mount shots use the old standing body", () => {
  const h = arena();
  try {
    const { world } = h, { ents, history, reg } = world;
    const rider = ents.create(reg.index.get("core:survivor")!, 95, 0, 95, 0);
    const mount = ents.create(reg.index.get("core:parasaur")!, 110, 0, 95, 0);
    const saddle = reg.index.get("core:saddle_parasaur")!, gear = new Uint16Array(4);
    gear[GEAR_WORN] = saddle; ents.gears.set(mount, gear);
    history.track(rider); history.track(mount);
    world.tick = 1; history.record(1);
    const frame = new Float64Array(12), eye = new Float64Array(3), seat = reg.saddleSeats[saddle]![0]!;
    anchorFrame(seat.anchor, 110, 0, 95, 0, frame);
    ents.seat[rider] = mount + 1; ents.seatGen[rider] = ents.gen[mount]!; ents.seatSlot[rider] = 1;
    ents.setPosition(rider, frame[0]!, frame[1]!, frame[2]!);
    world.tick = 2; history.record(2);
    seatedEye(world.anim, new AnimState(), 2, frame, true, eye);
    expect(h.host.combat.castBodies(-1, eye[0]!, eye[1]!, eye[2]! - 3, 0, 0, 1, 4, 0, 2)).toBe(rider);
    expect(h.host.combat.zone).toBe(ZONE_HEAD);
    ents.seat[rider] = ents.seatGen[rider] = ents.seatSlot[rider] = 0;
    ents.setPosition(rider, 115, 0, 95);
    ents.destroy(mount);
    const reused = ents.create(reg.index.get("core:raptor")!, 200, 0, 200, 0);
    expect(reused).toBe(mount);
    world.tick = 3; history.record(3);
    expect(h.host.combat.castBodies(-1, eye[0]!, eye[1]!, eye[2]! - 3, 0, 0, 1, 4, 0, 2)).toBe(rider);
    expect(h.host.combat.zone).toBe(ZONE_HEAD);
    expect(h.host.combat.castBodies(-1, 95, 1.62, 92, 0, 0, 1, 5, 0, 1)).toBe(rider);
    const past = new Past();
    expect(history.sample(1.25, rider, past)).toBe(true); expect(past.seat).toBe(0); expect(past.x).toBe(95);
    expect(history.sample(1.75, rider, past)).toBe(true); expect(past.seat).toBe(mount + 1); expect(past.x).toBe(frame[0]!);
    // The same entity slot now carries a different species/saddle. Remounting must not replace tick 2's frame.
    gear[GEAR_WORN] = reg.index.get("core:saddle_raptor")!; ents.gears.set(reused, gear);
    ents.seat[rider] = reused + 1; ents.seatGen[rider] = ents.gen[reused]!; ents.seatSlot[rider] = 1;
    world.tick = 4; history.record(4);
    expect(history.at(4, rider, past)).toBe(true); expect(past.saddle).toBe(gear[GEAR_WORN]!);
    expect(history.at(2, rider, past)).toBe(true); expect(past.saddle).toBe(saddle);
    expect(h.host.combat.castBodies(-1, eye[0]!, eye[1]!, eye[2]! - 3, 0, 0, 1, 4, 0, 2)).toBe(rider);
  } finally { h.host.shutdown(); }
});

test("path maxima cover accumulated within-tick movement and reset correctly after row compaction and slot reuse", () => {
  const ents = new EntityStore({ chunksX: 4, chunksZ: 4 }, 2, 2), history = new History(ents, 1);
  const a = ents.create(1, 50, 0, 50, 0), b = ents.create(1, 50, 0, 50, 0);
  history.track(a); history.track(b); history.record(1);
  ents.setPosition(b, 53, 0, 50); ents.setPosition(b, 50, 0, 50);
  expect(history.displacement(1, 2)).toBe(6);
  history.untrack(a); expect(history.displacement(1, 2)).toBe(6);
  history.record(2); expect(history.displacement(1, 2)).toBe(6);
  ents.destroy(b); const c = ents.create(1, 200, 0, 50, 0); expect(c).toBe(b);
  expect(history.at(1, c, new Past())).toBe(false);
  ents.setPosition(c, 201, 0, 50);
  expect(history.displacement(2, 3)).toBe(1);
});

test("physical protection leaves protected players and tames fixed while ordinary owned vehicles remain finite", () => {
  const h = arena();
  try {
    const reg = h.reg, combat = h.host.combat;
    const vehicle = new EntityRecord(1, reg.index.get("core:compact")!), driver = new EntityRecord(2, reg.index.get("core:survivor")!);
    const tame = new EntityRecord(3, reg.index.get("core:parasaur")!), otherCar = new EntityRecord(4, vehicle.kind);
    driver.team = vehicle.team = 10; tame.team = otherCar.team = 11;
    expect(h.host.setSetting("serverPVE", "True")).toBe("");
    expect(combat.vehicleDisplaces(driver, vehicle, tame)).toBe(false);
    expect(combat.vehicleDisplaces(driver, vehicle, otherCar)).toBe(true);
    vehicle.team = 0;
    expect(combat.vehicleDisplaces(null, vehicle, tame)).toBe(false);
    tame.team = 0;
    expect(combat.vehicleDisplaces(null, vehicle, tame)).toBe(true);
    tame.team = 10;
    expect(combat.vehicleDisplaces(driver, vehicle, tame)).toBe(false);
    expect(combat.hits).toBe(0);
  } finally { h.host.shutdown(); }
});
