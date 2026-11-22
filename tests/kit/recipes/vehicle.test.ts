import { expect, test } from "bun:test";
import { BTN_USE } from "../../../shared/sim/character.ts";
import { camp, pilot, pos, press, until, vehicle } from "../kit.ts";

test("a car is driven north from its driver's seat and left where it stops", () => {
  const { h, ada, at } = camp();
  const car = vehicle(h, ada, "compact", { drive: true });
  expect(ada.driving).toBe(car.e);

  pilot(h, ada).moveZ = 1;
  h.run(3000);
  pilot(h, ada).moveZ = 0;
  expect(pos(h, car.e).z).toBeGreaterThan(at.z + 15);
  expect(Math.abs(pos(h, ada).z - pos(h, car.e).z)).toBeLessThan(2);

  expect(until(h, () => Math.hypot(h.world.ents.vx[car.e]!, h.world.ents.vz[car.e]!) < 0.5, 20)).toBe(true);
  press(h, ada, BTN_USE);
  expect(until(h, () => ada.driving === -1, 3)).toBe(true);
});
