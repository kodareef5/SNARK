// A tame's levels after taming are on ARK's own table for tames, not the survivors'.

import { expect, test } from "bun:test";
import { TAME_XP } from "../../content/core.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { camp, creature, look, pos, survivor, tame, until } from "../kit/kit.ts";

test("a tame gains ARK's 88 levels on the tames' table and stops at its end", () => {
  const { h, ada, me } = camp();
  const prog = h.host.progression;
  const pet = tame(h, ada, "dodo").rec;
  expect(pet.xp).toBe(0);
  // Level 2 takes a tame 10 and a survivor 5.
  expect([prog.levelOf(5, true), prog.levelOf(10, true), prog.levelOf(5)]).toEqual([1, 2, 2]);
  expect([prog.addXp(pet, 9), prog.level(pet), prog.addXp(pet, 1), prog.level(pet), prog.statPoints(pet)]).toEqual([9, 1, 1, 2, 1]);
  // Where the two tables part: 6,300 is a survivor's level 36 and short of a tame's.
  expect([prog.levelOf(6300), prog.levelOf(6300, true), prog.levelOf(6545, true)]).toEqual([36, 35, 36]);
  prog.addXp(pet, 1e9);
  expect([pet.xp, prog.level(pet), prog.most(pet)]).toEqual([22213960, 89, TAME_XP[88]!]);
  // The survivor's own cap is its own table's.
  expect(prog.most(me)).toBe(4098538);
});

test("a raptor earns domestic XP only after taming and keeps it with a new owner", () => {
  const { h, ada, me, at } = camp({ god: true });
  const hunter = creature(h, "raptor", { x: at.x + 3, z: at.z });
  const kill = () => {
    const from = pos(h, hunter.e);
    const prey = creature(h, "dodo", { x: from.x, z: from.z + 1.5 }, 51);
    const survival = h.host.survival;
    survival.hurt(prey.rec, survival.value(prey.rec, V_HEALTH) - 1, 0);
    h.host.creatures.mind.attack(hunter.e, prey.e);
    expect(until(h, () => !h.host.records.entOf.has(prey.rec.pid), 12)).toBe(true);
  };
  const points = () => h.host.progression.statPoints(hunter.rec);
  kill();
  expect([hunter.rec.xp, points()]).toEqual([0, 0]);
  // A wild creature from an older save may already have XP.
  hunter.rec.xp = 12;
  look(h, ada, hunter.e);
  expect(h.say(ada, "forcetame")[0]).toStartWith("tamed core:raptor");
  expect([hunter.rec.team, hunter.rec.xp, points()]).toEqual([me.team, 0, 0]);
  kill();
  expect([hunter.rec.xp, points()]).toEqual([12, 1]);
  const bob = survivor(h, "bob", { at: { x: at.x + 3, z: at.z + 3 } });
  look(h, bob, hunter.e);
  expect(h.say(bob, "forcetame")[0]).toStartWith("tamed core:raptor");
  expect([hunter.rec.xp, points()]).toEqual([12, 1]);
});
