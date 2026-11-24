// A tame's levels after taming are on ARK's own table for tames, not the survivors'.

import { expect, test } from "bun:test";
import { TAME_XP } from "../../content/core.ts";
import { camp, tame } from "../kit/kit.ts";

test("a tame gains ARK's 88 levels on the tames' table and stops at its end", () => {
  const { h, ada, me } = camp();
  const prog = h.host.progression;
  const pet = tame(h, ada, "dodo").rec;
  pet.xp = 0;
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
