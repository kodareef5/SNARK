import { expect, test } from "bun:test";
import { BTN_USE } from "../../../shared/sim/character.ts";
import { camp, creature, pos, press, ride, tame, use, walk } from "../kit.ts";

test("a wild raptor is not ridden; a tamed and saddled one carries its rider", () => {
  const { h, ada, me, at } = camp();
  const wild = creature(h, "raptor", { x: at.x + 3, z: at.z }, 5);
  use(h, ada, wild.e);
  expect([wild.rec.team, wild.rec.genome!.level, ada.driving]).toEqual([0, 5, -1]);

  const mine = tame(h, ada, "raptor", { level: 5, saddled: true });
  expect(mine.rec.team).toBe(me.team);
  ride(h, ada, mine.e);
  expect(ada.driving).toBe(mine.e);
  expect(walk(h, ada, { x: at.x, z: at.z + 25 })).toBe(true);
  expect(pos(h, mine.e).z).toBeGreaterThan(at.z + 24);

  press(h, ada, BTN_USE);
  expect(ada.driving).toBe(-1);
});
