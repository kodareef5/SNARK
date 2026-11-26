// An agent moving a dyed stack into a box must not pick a plain stack of the same item as where it goes: the server
// does not join the two, and a whole stack put down on another swaps with it.

import { expect, test } from "bun:test";
import { play } from "../fixtures/agent.ts";

test("an agent's dyed stack moved into a box lands there, not swapped for a plain one", async () => {
  const p = play();
  await p.typed("enablecheats");
  await p.typed("give wood 7");
  const box = p.h.world.structs.add(p.id("storage_box"), 250, 0.3125, 244, 0, p.rec.team, 500);
  p.run(300);
  expect(await p.call("open", { id: `s${box}` })).toMatchObject({ state: "done" });
  // Three plain wood into the box, then the four left in the bag are dyed.
  expect(await p.call("move_item", { from: "self", slot: 0, count: 3, to: "box" })).toMatchObject({ state: "done" });
  const mine = p.h.host.items.inv(p.rec);
  const from = mine.item.indexOf(p.id("wood"));
  expect(p.h.host.items.restyle(p.rec, from, 0, 5 | (6 << 8))).toBe(true);
  p.run(300);
  expect(p.s.inventory!.dyeOf(from)).toBe(5 | (6 << 8));
  expect(await p.call("move_item", { from: "self", slot: from, to: "box" })).toMatchObject({ state: "done" });
  const theirs = p.h.host.fixtures.find(box)!.inv!;
  expect([theirs.total(p.id("wood")), mine.total(p.id("wood"))]).toEqual([7, 0]);
});
