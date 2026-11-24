// Experience that comes with time (server/experience.ts): the drip to a living survivor, and to a tame near one of its tribe.

import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { DRIP_PER_MINUTE, SHARE_RANGE } from "../../server/experience.ts";
import { camp, creature, tame } from "../kit/kit.ts";

const MINUTE = 60_000;

test("a living survivor gains ARK's drip each minute, and its own screen has the fraction", () => {
  const { h, ada, me } = camp();
  const xp = me.xp;
  h.run(MINUTE);
  expect(me.xp - xp).toBeCloseTo(DRIP_PER_MINUTE, 6);
  expect(DRIP_PER_MINUTE).toBe(0.66);
  h.run(500);
  expect(ada.progress.xp).toBeCloseTo(me.xp, 6);
});

test("GenericXPMultiplier and XPMultiplier multiply the drip, and 0 ends it", () => {
  const fast = camp({ rules: { GenericXPMultiplier: 5, XPMultiplier: 2 } });
  const xp = fast.me.xp;
  fast.h.run(MINUTE);
  expect(fast.me.xp - xp).toBeCloseTo(DRIP_PER_MINUTE * 10, 6);
  const none = camp({ rules: { GenericXPMultiplier: 0 } });
  none.h.run(MINUTE);
  expect(none.me.xp).toBe(0);
});

test("a dead survivor gains nothing with time", () => {
  const { h, ada, me } = camp();
  h.say(ada, "suicide");
  expect(me.dead).toBe(true);
  const xp = me.xp;
  h.run(MINUTE);
  expect(me.xp).toBe(xp);
});

test("a tame gains the drip only with a survivor of its tribe within 100 m; a wild creature never", () => {
  const { h, ada, at } = camp();
  const near = tame(h, ada, "dodo");
  const far = tame(h, ada, "dodo", { at: { x: at.x + 6, z: at.z + 6 } });
  const wild = creature(h, "dodo", { x: at.x - 6, z: at.z + 6 });
  h.world.ents.x[far.e] = at.x + SHARE_RANGE + 20;
  for (const body of [near, far, wild]) h.host.creatures.mind.stay(body.e, h.world.tick + 120 * TICK_RATE);
  const was = [near.rec.xp, far.rec.xp, wild.rec.xp];
  h.run(MINUTE);
  expect(near.rec.xp - was[0]!).toBeCloseTo(DRIP_PER_MINUTE, 6);
  expect([far.rec.xp - was[1]!, wild.rec.xp - was[2]!]).toEqual([0, 0]);
});
