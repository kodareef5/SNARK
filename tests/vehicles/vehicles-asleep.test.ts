// A vehicle at rest with nothing to do, where no chunk near it is awake, sleeps (server/urban.ts): the tick does not look
// at it, counted here by the looks Urban counts. Whatever touches it wakes it, and it then answers as if it had been
// looked at every tick.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { ROLE_FOUNDATION } from "../../shared/world/snap.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { start } from "../fixtures/slots.ts";

/** One survivor at (200, 200) with a car beside it, and four cars parked a kilometre away, all settled. */
function lots() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], wild: false, map: writeMap(flatMap(20, { spawns: [{ name: "Camp", x: 200, z: 200, yaw: 0 }] })) });
  const session = h.join("watcher");
  h.run(1000);
  const near = h.host.spawnVehicle("core:compact", 212, 200, 0, 0);
  const far = [0, 1, 2, 3].map((i) => h.host.spawnVehicle("core:compact", 1100 + i * 9, 1100, 0, i));
  expect([near, ...far].every((e) => e >= 0)).toBe(true);
  const urban = h.host.urban;
  /** What the tick did to vehicles over `ticks` ticks: health looked at, bodies stepped, pairs swept. */
  const looks = (ticks: number): { observed: number; stepped: number; sweeps: number } => {
    const before = { observed: urban.observed, stepped: urban.stepped, sweeps: urban.contacts!.sweeps };
    for (let k = 0; k < ticks; k++) h.server.tick();
    return { observed: urban.observed - before.observed, stepped: urban.stepped - before.stepped, sweeps: urban.contacts!.sweeps - before.sweeps };
  };
  looks(400);
  return { h, session, near, far, urban, looks };
}

test("parked cars far from every survivor sleep and are not looked at; one beside a survivor is", () => {
  const { h, near, far, urban, looks } = lots();
  try {
    expect(far.map((e) => urban.asleep(e))).toEqual([true, true, true, true]);
    expect(urban.asleep(near)).toBe(false);
    expect(urban.asleepCount).toBe(4);
    // The survivor stands twelve metres outside the parked car, beyond the reach of either body this tick.
    expect(looks(90)).toEqual({ observed: 90, stepped: 3, sweeps: 0 });
    // History keeps no row for a sleeper: the survivor's and the near car's are all there are.
    expect(h.world.history.rows).toBe(2);
  } finally {
    h.host.shutdown();
  }
});

test("a sleeping car wakes when it is harmed, pushed or stood on nothing, and answers as one looked at every tick", () => {
  const { h, far, urban, looks } = lots();
  try {
    const ents = h.world.ents;
    const rec = (e: number) => h.host.records.byPid.get(ents.pid[e]!)!;
    // Harm that is no collision still costs the engine and the hull, on the next tick.
    h.host.survival.hurt(rec(far[0]!), 200, 0);
    expect(urban.asleep(far[0]!)).toBe(false);
    looks(1);
    expect(ents.vehicleEngineCondition[ents.vrow[far[0]!]!]!).toBeLessThan(1);
    expect(ents.vehicleHullCondition[ents.vrow[far[0]!]!]!).toBeLessThan(1);
    // A shove wakes it, and its neighbours stay asleep.
    urban.push(far[1]!, 0, 1);
    expect(urban.asleep(far[1]!)).toBe(false);
    expect([urban.asleep(far[2]!), urban.asleep(far[3]!)]).toEqual([true, true]);
    // A car asleep on a floor falls when the floor is taken away, though nobody is near.
    const foundation = h.reg.role.findIndex((role) => role === ROLE_FOUNDATION);
    const floor = start(h.world, foundation, 700, 2, 1100, 0, 777, 1000);
    const high = h.host.spawnVehicle("core:compact", 700, 1100, 0, 0, { y: h.world.structs.topIn(699, 1099, 701, 1101) });
    looks(600);
    expect(urban.asleep(high)).toBe(true);
    expect(ents.y[high]!).toBeGreaterThan(2);
    h.world.structs.remove(floor);
    expect(urban.asleep(high)).toBe(false);
    looks(120);
    expect(ents.y[high]!).toBeLessThan(1);
    // Left alone, all of them sleep again.
    looks(600);
    expect(urban.asleepCount).toBe(4);
  } finally {
    h.host.shutdown();
  }
});

test("a survivor coming near wakes the cars there, and they sleep again once it has gone", () => {
  const { h, session, far, urban, looks } = lots();
  try {
    h.say(session, "enablecheats");
    h.say(session, "tp 1090 1090");
    expect(far.map((e) => urban.asleep(e))).toEqual([false, false, false, false]);
    // The four there are looked at each tick. The one left behind sleeps now.
    expect(looks(30).observed).toBe(4 * 30);
    h.say(session, "tp 200 200");
    looks(400);
    expect(far.map((e) => urban.asleep(e))).toEqual([true, true, true, true]);
  } finally {
    h.host.shutdown();
  }
});
