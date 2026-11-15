// Numbers brought to ARK's by the item program's parity fixes, as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15, read
// from each page's wikitext and its infobox. Each test names the pages it was read from.

import { expect, test } from "bun:test";
import { DAMAGE_TYPES } from "../../shared/sim/damage.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (name: string): number => reg.index.get(`core:${name}`)!;

test("every creature takes 70% from guns, and a survivor all of it (Longneck Rifle)", () => {
  const bullet = DAMAGE_TYPES.indexOf("bullet");
  const creatures = reg.defs.filter((d) => d?.type === "species" && d.class === "creature").map((d) => d!.id.slice(5));
  expect(creatures.sort()).toEqual(["dodo", "grazer", "parasaur", "pteranodon", "raptor"]);
  for (const name of creatures) expect([name, reg.takes[at(name)]![bullet]]).toEqual([name, Math.fround(0.7)]);
  expect(reg.takes[at("survivor")]![bullet]).toBe(1);
});
