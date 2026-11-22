// A server rolls a wild creature from its species' colour set, and a mutation gives its young one of the species' own colours.
import { expect, test } from "bun:test";
import { CORE_PACK } from "../../content/core.ts";
import { BREEDING } from "../../server/breeding.ts";
import type { EntityRecord } from "../../server/records.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import { ORDER_MATE, RESULT_OK } from "../../shared/net/protocol.ts";
import { MATE_TICKS } from "../../shared/sim/breeding.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

const REGIONS = [{ name: "body", colors: [[20, 3], [21, 1]] }, null, { name: "crest", colors: [[30, 1]] }, null, null, { name: "belly", colors: [[33, 1], [34, 1]] }];
// Whatever the parasaur comes to declare, the first of these has no colour set and the second has this one.
const made = compilePacks([
  CORE_PACK,
  {
    name: "t",
    requires: ["core"],
    defs: [
      { id: "t:plain", extends: "core:parasaur", regions: undefined, mutations: undefined },
      { id: "t:dyed", extends: "core:parasaur", regions: REGIONS, mutations: [40, 41] },
    ],
  },
]);

test("wild creatures take their species' colours region by region, and their young mutate into its mutation colours", () => {
  expect(made.errors).toEqual([]);
  const h = new Harness({}, 1, 60, { dev: true }, made.registry!);
  const ada = h.join("ada");
  h.run(500);
  const g = flatGround(h, 40, 40);
  h.say(ada, "enablecheats");
  h.say(ada, `tp ${(g.x + 20).toFixed(3)} ${(g.z + 4).toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  let spawned = 0;
  const wild = (species: string): EntityRecord => {
    const n = spawned++;
    const e = h.host.spawnCreature(species, g.x + 6 + (n % 8) * 4, g.z + 10 + Math.floor(n / 8) * 3, 1 + n);
    expect(e).toBeGreaterThanOrEqual(0);
    return h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  };
  /** The colours `n` wild ones of a species rolled, by region. */
  const rolled = (species: string, n: number): number[][] => {
    const seen = Array.from({ length: 6 }, () => new Set<number>());
    for (; n > 0; n--) wild(species).genome!.colors.forEach((c, r) => seen[r]!.add(c));
    return seen.map((s) => [...s].sort((a, b) => a - b));
  };
  expect(rolled("t:dyed", 32)).toEqual([[20, 21], [0], [30], [0], [0], [33, 34]]);
  expect([...new Set(rolled("t:plain", 32).flat())].sort((a, b) => a - b)).toEqual([3, 5, 6, 7, 9, 12, 15]);

  // A pair of each species, mated again and again. A colour neither parent has in a region came from a mutation.
  const breeding = h.host.breeding;
  const pairs = ["t:dyed", "t:plain"].map((species) => {
    const [f, m] = [wild(species), wild(species)];
    f.genome!.female = true;
    m.genome!.female = false;
    for (const rec of [f, m]) {
      h.host.taming.give(rec, me, 1);
      expect(breeding.order(rec, ORDER_MATE)).toBe(RESULT_OK);
    }
    return { f, m };
  });
  for (let n = 0; n < 200; n++) {
    for (const { f } of pairs) f.own(BREEDING).mateReadyAt = 0;
    breeding.step(0);
    for (const { f } of pairs) breeding.due(f.pid, MATE_TICKS);
  }
  const mutant = pairs.map(({ f, m }) => {
    const eggs = [...h.host.records.byPid.values()].filter((r) => r.egg !== null && r.genome!.mother === f.pid);
    expect(eggs.length).toBeGreaterThanOrEqual(200);
    const fresh = eggs.flatMap((egg) => [...egg.genome!.colors].filter((c, r) => c !== f.genome!.colors[r] && c !== m.genome!.colors[r]));
    return [...new Set(fresh)].sort((a, b) => a - b);
  });
  expect(mutant[0]).toEqual([40, 41]);
  expect([mutant[1]!.length > 1, mutant[1]!.filter((c) => ![8, 10, 11, 13, 14, 17, 19, 21].includes(c))]).toEqual([true, []]);
});
