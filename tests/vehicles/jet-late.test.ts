// A family whose code comes late (shared/sim/families.ts laterFamily, the jet's row): before the code comes a vehicle of
// it is taken as checked, stands still and meets nothing, and wanting it asks for the code; once given, the row answers
// as the code does. The browser's first frame holds the row and not the code (tests/tools/first-frame.test.ts).

import { expect, test } from "bun:test";
import { JET_VEHICLE } from "../../content/vehicles/jet.ts";
import { familyWanted, JET_FAMILY, laterFamily, type VehicleFamily } from "../../shared/sim/families.ts";
import { Body } from "../../shared/sim/character.ts";
import type { VehicleDefinition } from "../../shared/sim/vehicle.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";

const def = JET_VEHICLE as VehicleDefinition;

test("a later family's row is inert until its code is given, asks for it when wanted, then answers as the code", () => {
  const row = laterFamily("jet");
  const asked: string[] = [];
  const was = familyWanted.ask;
  familyWanted.ask = (name) => asked.push(name);
  try {
    expect(row.is(def)).toBe(true);
    // A check asks nothing: a browser compiles content with a jet in it before it has met one.
    row.validateSpec(def);
    expect([row.ready, asked]).toEqual([false, []]);
    const body = new Body();
    body.vx = 5;
    row.step({} as CollisionWorld, body, 0, 127, 0, def, true);
    expect([body.vx, row.parts(def), row.movers(def), row.supports({} as CollisionWorld, 0, 0, 0, 0, def), row.hazard]).toEqual([5, [], [], false, null]);
    expect(asked.length).toBeGreaterThan(0);
    expect(new Set(asked)).toEqual(new Set(["jet"]));
    // Given, it is the code's: the jet's own row has had it since the jet's family file loaded.
    expect(JET_FAMILY.ready).toBe(true);
    row.give(JET_FAMILY as VehicleFamily);
    asked.length = 0;
    expect([row.ready, row.parts(def).length, row.movers(def).length > 0, asked]).toEqual([true, JET_FAMILY.parts(def).length, true, []]);
    expect(() => row.validateSpec({ ...def, spec: { ...def.spec, topSpeed: 999 } } as VehicleDefinition)).toThrow();
  } finally {
    familyWanted.ask = was;
  }
});
