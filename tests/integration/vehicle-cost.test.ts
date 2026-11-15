// What a vehicle costs the server: work in proportion to what is near it and to what changes, not to the world.
import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";
import { flatGround } from "../fixtures/arena.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";

function setup() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  const ada = h.join("ada");
  h.run(400);
  const ground = flatGround(h, 24, 28), x = ground.x + 10, z = ground.z + 8;
  h.say(ada, "enablecheats");
  h.say(ada, `tp ${x + 1.6} ${z + 0.12}`);
  h.run(500);
  const me = h.client(ada)!;
  const car = h.host.spawnVehicle("core:compact", x, z, h.host.records.byPid.get(me.pid)!.team, 0);
  return { h, me, car };
}

test("a parked car at rest is stepped once a second, not every tick, and wakes when something moves it", () => {
  const { h, car } = setup();
  try {
    h.run(2000);
    const ents = h.world.ents;
    const own = StaticVehicleWorld.prototype.support;
    let probes = 0;
    StaticVehicleWorld.prototype.support = function (this: StaticVehicleWorld, ...args: Parameters<typeof own>) { probes++; return own.apply(this, args); };
    try {
      h.run(3000);
      // Stepped every tick, 90 ticks of four substeps of eight wheel probes would be some 2,900.
      expect(probes).toBeLessThan(400);
      const z = ents.z[car]!;
      ents.vz[car] = 2;
      h.run(100);
      expect(ents.z[car]!).toBeGreaterThan(z + 0.05);
    } finally {
      StaticVehicleWorld.prototype.support = own;
    }
  } finally {
    h.host.shutdown();
  }
});

test("a parked car is nobody's mount, so a snapshot ranks it with what is idle and not with the players", () => {
  const { h, car } = setup();
  try {
    h.run(1000);
    expect(h.world.ents.driven[car]).toBe(0);
  } finally {
    h.host.shutdown();
  }
});

test("a door check looks at the bodies near the car, not at every record in the world", () => {
  const { h, me, car } = setup();
  try {
    const entOf = h.host.records.entOf;
    let walked = 0;
    const own = Map.prototype[Symbol.iterator];
    // Every walk over the whole table of bodies is counted while the check runs.
    Object.defineProperty(entOf, Symbol.iterator, { configurable: true, value: function (this: Map<number, number>) { walked++; return own.call(this); } });
    for (const name of ["entries", "keys", "values"] as const) {
      const was = Map.prototype[name];
      Object.defineProperty(entOf, name, { configurable: true, value: function (this: Map<number, number>) { walked++; return was.call(this); } });
    }
    let result = -1;
    try { result = h.host.urban.mount(me, car); } finally {
      for (const key of [Symbol.iterator, "entries", "keys", "values"] as const) delete (entOf as unknown as Record<PropertyKey, unknown>)[key];
    }
    expect(result).toBe(RESULT_OK);
    expect(walked).toBe(0);
    h.run(800);
    expect(me.drive).toBe(car);
  } finally {
    h.host.shutdown();
  }
});
