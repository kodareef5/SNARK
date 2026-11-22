import { expect, test } from "bun:test";
import { camp, count, find, pos, restart, survivor, tame, walk } from "../kit.ts";

test("after a restart a survivor is where it stood, with its things and its tame", () => {
  const { h, ada, me, at } = camp({ save: true, items: { stone: 7 } });
  tame(h, ada, "dodo");
  expect(walk(h, ada, { x: at.x - 5, z: at.z - 5 })).toBe(true);
  const stood = pos(h, ada);
  ada.close();
  h.run(200);

  const next = restart(h);
  expect(next.host.loaded!.fresh).toBe(false);
  expect(next.world.tick).toBe(h.world.tick);
  expect(find(next, "dodo").rec.team).toBe(me.team);
  const again = survivor(next, "ada");
  expect(pos(next, again)).toEqual(stood);
  expect(count(next, again, "stone")).toBe(7);
});
