import { expect, test } from "bun:test";
import { BAD_LINK, camp, pos, ride, seen, survivor, tame, walk } from "../kit.ts";

test("a player on a poor line sees another ride off, where the server has them", () => {
  const { h, ada, at } = camp();
  const bob = survivor(h, "bob", { link: BAD_LINK, at: { x: at.x + 3, z: at.z } });
  const raptor = tame(h, ada, "raptor", { saddled: true });
  expect(seen(bob, raptor.e)).not.toBeNull();

  ride(h, ada, raptor.e);
  walk(h, ada, { x: at.x, z: at.z + 25 });
  h.run(1000);
  const theirs = pos(h, raptor.e);
  const his = seen(bob, raptor.e)!;
  expect(theirs.z).toBeGreaterThan(at.z + 24);
  expect(Math.hypot(his.x - theirs.x, his.z - theirs.z)).toBeLessThan(0.05);
  expect(bob.stats.undecodable).toBe(0);
});
