import { expect, test } from "bun:test";
import { HELICOPTER_VEHICLE as def } from "../../content/vehicles/helicopter.ts";
import { moverBoxes } from "../../shared/sim/vehicle-movers.ts";

test("a ragdoll meets a helicopter's cabin, not only the boxes authored beside it", () => {
  const boxes = Array.from(moverBoxes(def)), s = def.spec;
  const at = (k: number) => boxes.slice(k * 6, k * 6 + 6);
  // Its cabin, as its shapes have it.
  expect(at(0)).toEqual([0, (s.clearance + s.height) / 2, 0, s.halfWidth, (s.height - s.clearance) / 2, s.halfLength]);
  // And every authored body box after it, the mast among them.
  for (const b of s.bodyBoxes!) expect(boxes.join()).toContain([...b.at, ...b.half].join());
});
