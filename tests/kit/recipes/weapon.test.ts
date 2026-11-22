import { expect, test } from "bun:test";
import { BTN_PRIMARY } from "../../../shared/sim/character.ts";
import { V_HEALTH } from "../../../shared/sim/vitals.ts";
import { takeInHand } from "../../fixtures/gather.ts";
import { camp, find, id, look, press, until } from "../kit.ts";

test("a pistol shot takes a round and its damage from a dummy's health", () => {
  const { h, ada } = camp({ gear: ["pistol"] });
  takeInHand(h, ada, id("pistol"));
  expect(until(h, () => ada.own.rounds > 0, 10)).toBe(true);
  const rounds = ada.own.rounds;
  expect(h.say(ada, "dummy")).toEqual(["a bare dummy"]);
  const dummy = find(h, "dummy");
  const health = h.host.survival.value(dummy.rec, V_HEALTH);

  look(h, ada, dummy.e);
  press(h, ada, BTN_PRIMARY);
  expect([h.host.combat.hits, ada.own.rounds]).toEqual([1, rounds - 1]);
  expect(h.host.combat.last.damage).toBeGreaterThan(0);
  expect(h.host.survival.value(dummy.rec, V_HEALTH)).toBeCloseTo(health - h.host.combat.last.damage, 0);
});
