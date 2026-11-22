// Each named place does what its name says to a survivor who walks, drives, swims or boards there.

import { expect, test } from "bun:test";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { camp, clearing, dock, drive, find, pilot, pond, pos, ride, room, street, walk, yard } from "./kit.ts";

test("a room holds a survivor in and a yard's wall stops one, with no cheats", () => {
  const cell = room();
  const inside = camp({ place: cell, cheats: false });
  expect(walk(inside.h, inside.ada, { x: cell.max.x + 6, z: inside.at.z }, 5)).toBe(false);
  expect(pos(inside.h, inside.ada).x).toBeLessThan(cell.max.x);

  const fenced = yard();
  const { h, ada } = camp({ place: fenced, cheats: false });
  expect(walk(h, ada, { x: fenced.wall.x, z: fenced.wall.z + 3 }, 5)).toBe(false);
  expect(pos(h, ada).z).toBeLessThan(fenced.wall.z);
});

test("a street's parked car is found and driven off", () => {
  const { h, ada, at } = camp({ place: street() });
  const car = find(h, "compact");
  drive(h, ada, car.e);
  pilot(h, ada).moveZ = 1;
  h.run(3000);
  expect(pos(h, car.e).z).toBeGreaterThan(at.z + 15);
});

test("a pond is deep enough to swim, and a dock's boat is boarded from the dock", () => {
  const water = pond();
  const wet = camp({ place: water, cheats: false });
  expect(walk(wet.h, wet.ada, water.water, 40)).toBe(true);
  expect(wet.h.world.ents.mode[wet.h.ent(wet.ada)]).toBe(MODE_SWIM);

  const quay = dock();
  const { h, ada } = camp({ place: quay, cheats: false });
  expect(walk(h, ada, quay.berth)).toBe(true);
  const boat = find(h, "jon_boat");
  ride(h, ada, boat.e);
  pilot(h, ada).moveZ = 1;
  h.run(5000);
  expect(pos(h, boat.e).x).toBeGreaterThan(quay.boat.x + 10);
});

test("a clearing on the proving ground is level and empty to the north", () => {
  const { h, ada, at } = camp({ place: clearing(24, 30, 1.5) });
  expect(walk(h, ada, { x: at.x, z: at.z + 27 })).toBe(true);
  expect(pos(h, ada).y).toBeCloseTo(at.y, 2);
});
