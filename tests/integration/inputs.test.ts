// What the server does with the inputs a client sends, and with the ones it does not.

import { expect, test } from "bun:test";
import { BTN_PRIMARY, BTN_PRONE, BTN_SPRINT, STANCE_PRONE } from "../../shared/sim/character.ts";
import { Harness } from "../fixtures/net.ts";

test("a survivor stops a quarter of a second after its inputs stop, and stays in its stance", () => {
  const h = new Harness();
  const s = h.join("ada", {}, { manual: true });
  h.run(500, (now) => s.update(now, 0, 0, 0, 0, 0));
  const c = h.client(s)!;
  const ents = h.world.ents;
  const e = h.ent(s);
  h.run(1500, (now) => s.update(now, 0, 1, 0, 0, BTN_SPRINT | BTN_PRIMARY));
  // The tab is hidden: the client runs no frames and sends nothing. The body runs on for the inputs in hand and eight ticks more.
  const z = ents.z[e]!;
  h.run(500);
  const rest = ents.z[e]!;
  expect(rest - z).toBeGreaterThan(1.9);
  expect(rest - z).toBeLessThan(3.3);
  h.run(2000);
  expect([ents.z[e], c.heldButtons]).toEqual([rest, 0]);

  // Lying down is a state, not an act, so a body that lay down stays down.
  h.run(1000, (now) => s.update(now, 0, 0, 0, 0, BTN_PRONE));
  h.run(1000);
  expect([ents.stance[e], c.heldButtons]).toEqual([STANCE_PRONE, BTN_PRONE]);
});
