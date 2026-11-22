// Vehicles nobody drives cost nothing once they rest. A boat that floats still is stepped only on its own heartbeat, as
// a parked car is (server/urban.ts), and two vehicles that kept their poses through a tick are not swept against each
// other in it (server/vehicle-contacts.ts). What moves is still swept against them as before: a boat driven among them
// sweeps its own pairs, meets and wakes the one it hits, and a hit still lands on a resting boat.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BOAT_ART } from "../../content/vehicles/boat-art.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const COLUMNS = 6;
const ROWS = 5;

/** A marina of COLUMNS by ROWS boats moored 5 m abreast and 11 m apart in rows, on 3 m of sea, and one player on the quay. */
function marina() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2, { seaLevel: 3 })) });
  const session = h.join("marina-pilot");
  h.run(400);
  const c = h.client(session)!, actor = h.host.records.byPid.get(c.pid)!, ents = h.world.ents;
  ents.setPosition(c.ent, 8, 1.65, 8);
  const boats: number[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLUMNS; col++) boats.push(h.host.spawnVehicle("core:boat", 40 + col * 5, 30 + row * 11, actor.team));
  expect(boats.every((e) => e >= 0)).toBe(true);
  // A vehicle set down is swept against its neighbours in its first tick, as anything newly placed is.
  h.server.tick();
  /** Pairs swept and vehicles stepped over `ticks` ticks. */
  const cost = (ticks: number): { sweeps: number; steps: number } => {
    const { sweeps, stepped } = { sweeps: h.host.urban.contacts!.sweeps, stepped: h.host.urban.stepped };
    for (let k = 0; k < ticks; k++) h.server.tick();
    return { sweeps: h.host.urban.contacts!.sweeps - sweeps, steps: h.host.urban.stepped - stepped };
  };
  return { h, c, ents, boats, cost };
}

test("a marina of thirty boats at rest is stepped only on each boat's heartbeat and sweeps no pair, and pushed it is awake until it rests again", () => {
  const { h, ents, boats, cost } = marina();
  try {
    // Set down at their waterline, the boats rest from then on: each is stepped once in thirty ticks, and no pair is
    // swept.
    expect(cost(60)).toEqual({ sweeps: 0, steps: boats.length * 2 });
    // Lifted off the water, every boat is awake: stepped every tick, and swept against its neighbours.
    for (const e of boats) ents.vy[e] = 1;
    const awake = cost(30);
    expect(awake.steps).toBe(boats.length * 30);
    expect(awake.sweeps).toBeGreaterThan(boats.length * 30);
    // Once they float still again, they cost what they did.
    cost(600);
    expect(cost(60)).toEqual({ sweeps: 0, steps: boats.length * 2 });
  } finally {
    h.host.shutdown();
  }
});

test("a boat driven through the settled marina sweeps its own pairs, and the boat it rams wakes and moves", () => {
  const { h, c, ents, boats, cost } = marina();
  try {
    // The player boards the middle boat of the front row and drives it ahead, into the row behind.
    const boat = boats[2]!, rammed = boats[COLUMNS + 2]!, entry = BOAT_ART.anchors.boarding_water;
    ents.setPosition(c.ent, ents.x[boat]! + entry[0], 1.65, ents.z[boat]! + entry[2]);
    expect(h.host.urban.mount(c, boat)).toBe(RESULT_OK);
    h.run(1400);
    const at = { x: ents.x[rammed]!, z: ents.z[rammed]! }, hull = h.host.survival.value(h.host.records.byPid.get(ents.pid[rammed]!)!, V_HEALTH);
    let swept = 0, met = false;
    for (let k = 0; k < 150 && !met; k++) {
      c.inputs.set(h.world.tick + 1, 0, 127, 0, 0, 0);
      const before = h.host.urban.contacts!.sweeps;
      h.server.tick();
      swept = Math.max(swept, h.host.urban.contacts!.sweeps - before);
      met = Math.hypot(ents.x[rammed]! - at.x, ents.z[rammed]! - at.z) > 0.01;
    }
    expect(met).toBe(true);
    // The driven boat sweeps at most each of the others once a pass of its contacts.
    expect(swept).toBeGreaterThan(0);
    expect(swept).toBeLessThanOrEqual(4 * (boats.length - 1));
    // The rammed boat wakes: it is stepped every tick until it rests again, and its hull took the hit.
    const { steps } = cost(10);
    expect(steps).toBeGreaterThanOrEqual(10);
    expect(h.host.survival.value(h.host.records.byPid.get(ents.pid[rammed]!)!, V_HEALTH)).toBeLessThanOrEqual(hull);
  } finally {
    h.host.shutdown();
  }
});
