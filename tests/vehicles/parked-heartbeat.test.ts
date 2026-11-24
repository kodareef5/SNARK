// A parked car's heartbeat that left it exactly as it found it answers the next ones (server/vehicle-rest.ts) while the car
// and what it stands among stay as they were: every answer is what the step would have given, and a change of the world's
// shapes or of the car makes the next heartbeat a real step, so a car whose floor goes still falls.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_JUMP, Body } from "../../shared/sim/character.ts";
import { ROLE_FOUNDATION } from "../../shared/world/snap.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { start } from "../fixtures/slots.ts";

const FIELDS = Object.keys(new Body()) as (keyof Body)[];

/** Four compact cars parked on flat ground, settled, and a survivor on the map, who keeps them awake: with nobody near they sleep, and take no heartbeat (vehicles-asleep.test.ts). */
function lot() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  h.join("watcher");
  h.run(400);
  const cars = [[40, 40, 0], [60, 40, 0.5], [40, 70, 1.5], [80, 90, 3]].map(([x, z, yaw]) => h.host.spawnVehicle("core:compact", x!, z!, 0, yaw!));
  expect(cars.every((e) => e >= 0)).toBe(true);
  const urban = h.host.urban;
  const run = (ticks: number): { steps: number; kept: number } => {
    const steps = urban.stepped, kept = urban.restingKept;
    for (let k = 0; k < ticks; k++) h.server.tick();
    return { steps: urban.stepped - steps, kept: urban.restingKept - kept };
  };
  run(900);
  return { h, cars, run };
}

test("settled cars' heartbeats are answered from the last, and each answer is what the car's own step gives", () => {
  const { h, cars, run } = lot();
  try {
    for (const e of cars) expect(h.host.urban.resting(e)).toBe(true);
    // Each car is looked at once in thirty ticks, and every look but none is answered.
    expect(run(60)).toEqual({ steps: cars.length * 2, kept: cars.length * 2 });
    // The step itself, from each car as it stands, leaves it exactly so.
    const def = h.reg.vehicle[h.reg.index.get("core:compact")!]!;
    for (const e of cars) {
      const now = new Body(), stepped = new Body();
      h.world.ents.loadBody(e, now);
      stepped.copy(now);
      h.server.players.vehicleStep(h.world, stepped, 0, 0, BTN_JUMP, def, undefined, stepped.yaw, false);
      expect(FIELDS.filter((k) => stepped[k] !== now[k])).toEqual([]);
    }
  } finally {
    h.host.shutdown();
  }
});

test("a change of shape anywhere, or to the car, makes the next heartbeat a real step, and a car whose floor goes falls", () => {
  const { h, cars, run } = lot();
  try {
    const foundation = h.reg.role.findIndex((role) => role === ROLE_FOUNDATION);
    // A piece set down far off still changes the world's shapes: every car steps once, then is answered again.
    const far = start(h.world, foundation, 200, 0, 200, 0, 777, 1000);
    expect(far).toBeGreaterThanOrEqual(0);
    expect(run(30)).toEqual({ steps: cars.length, kept: 0 });
    expect(run(30)).toEqual({ steps: cars.length, kept: cars.length });
    // A car given half a millimetre a second downward, still at rest, is a car its last heartbeat did not leave.
    h.world.ents.vy[cars[0]!] = -0.0005;
    expect(h.host.urban.resting(cars[0]!)).toBe(true);
    expect(run(30).kept).toBe(cars.length - 1);
    // One parked on a floor two metres up, settled and answered, falls once the floor is taken away.
    const floor = start(h.world, foundation, 120, 2, 120, 0, 777, 1000);
    const top = h.world.structs.topIn(119, 119, 121, 121);
    const car = h.host.spawnVehicle("core:compact", 120, 120, 0, 0, { y: top });
    expect(car).toBeGreaterThanOrEqual(0);
    run(900);
    expect(h.host.urban.resting(car)).toBe(true);
    const y = h.world.ents.y[car]!;
    expect(y).toBeGreaterThan(2);
    expect(run(60).kept).toBe(2 * (cars.length + 1));
    h.world.structs.remove(floor);
    run(120);
    expect(h.world.ents.y[car]!).toBeLessThan(1);
  } finally {
    h.host.shutdown();
  }
});
