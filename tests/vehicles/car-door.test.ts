// A car door held open by the one who sits by it (VEHICLE_DOOR, server/urban.ts) strikes whoever it passes at speed: they
// are hurt by the car's speed, thrown out the way the door stands and on with the car, everyone near is told of the blow
// (EVENT_IMPACT), and the door is knocked shut. Parked, or with the door shut, nobody is struck.
import { CUE_DOWN } from "../../shared/anim/pose.ts";
import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { IMPACT_VEHICLE } from "../../shared/net/protocol.ts";
import { vehicleDoor } from "../../shared/sim/vehicle-body.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function road() {
  const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], wild: false, map: writeMap(flatMap(4)) });
  const s = h.join("walker");
  h.run(600);
  const a = h.world.ents, c = h.client(s)!;
  const car = h.host.spawnVehicle("core:compact", 100, 60, 0);
  const driver = h.host.spawnCreature("core:civilian", 101.5, 60, 1);
  expect(h.host.urban.seatNpc(driver, car, "driver")).toBe(0);
  h.run(1500);
  expect(h.host.urban.seatedNpc(driver)).toBe(true);
  // The walker stands where the driver's door, on the car's +X side, swings as the car comes up the road along +Z.
  a.setPosition(c.ent, 100 + 1.25 + 0.4, 0, 80);
  h.world.history.discontinuity(c.ent);
  h.run(300);
  return { h, s, a, c, car, driver, rec: h.host.records.byPid.get(c.pid)! };
}

/** Drives the car up the road at `speed` m/s until it has passed the walker. */
function driveBy(h: Harness, a: Harness["world"]["ents"], car: number, speed: number): void {
  h.run(4000, () => {
    if (a.z[car]! < 90) { a.vz[car] = speed; a.vx[car] = 0; }
  });
}

test("a door held open on a passing car strikes, throws and hurts the walker, everyone is told, and it is knocked shut", () => {
  const { h, s, a, c, car, driver, rec } = road();
  try {
    expect(h.host.urban.toggleDoor(a.pid[driver]!)).toBe(true);
    h.run(500);
    expect(vehicleDoor(a.vehicleDoors[a.vrow[car]!]!, 0)).toBe(1);
    const health = h.host.survival.value(rec, V_HEALTH);
    s.impacts.length = 0;
    const x = a.x[c.ent]!;
    driveBy(h, a, car, 9);
    expect(h.host.urban.doorStruck).toBe(1);
    expect(h.host.survival.value(rec, V_HEALTH)).toBeLessThan(health - 10);
    // Thrown out from the car's side, and on up the road with it.
    expect(a.x[c.ent]!).toBeGreaterThan(x + 1);
    expect(a.z[c.ent]!).toBeGreaterThan(80.5);
    expect(s.impacts.some((im) => im.kind === IMPACT_VEHICLE && im.id === c.ent)).toBe(true);
    // The blow knocked the door shut and let go of it.
    expect(vehicleDoor(a.vehicleDoors[a.vrow[car]!]!, 0)).toBe(0);
  } finally { h.host.shutdown(); }
});

test("struck off their feet, a survivor falls as a ragdoll thrown by the door and gets up (Knockdowns); with the rule off, they keep their footing", () => {
  const far: number[] = [];
  for (const on of [true, false]) {
    const { h, a, c, car, driver, rec } = road();
    try {
      h.host.setSetting("Knockdowns", String(on));
      h.host.urban.toggleDoor(a.pid[driver]!);
      h.run(500);
      const x = a.x[c.ent]!;
      let down = false;
      h.run(6000, () => {
        if (a.z[car]! < 90) { a.vz[car] = 9; a.vx[car] = 0; }
        if ((a.cue[c.ent]! & CUE_DOWN) !== 0) down = true;
      });
      expect(h.host.urban.doorStruck).toBe(1);
      expect([down, h.host.falls.stats.rose, h.host.falls.isDown(c.ent)]).toEqual([on, on ? 1 : 0, false]);
      expect(rec.buffs.length).toBe(0);
      far.push(a.x[c.ent]! - x);
    } finally { h.host.shutdown(); }
  }
  // Knocked off their feet they go farther than one who keeps them.
  expect(far[0]).toBeGreaterThan(far[1]! + 0.3);
});

test("with the door shut, or the car slow, the walker is not struck", () => {
  for (const [open, speed] of [[false, 9], [true, 1.5]] as const) {
    const { h, a, car, driver } = road();
    try {
      if (open) h.host.urban.toggleDoor(a.pid[driver]!);
      h.run(500);
      driveBy(h, a, car, speed);
      expect(h.host.urban.doorStruck).toBe(0);
    } finally { h.host.shutdown(); }
  }
});
