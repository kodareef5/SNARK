// What ARK makes at a station, made there (planning/reference/stations-plan.md, S6): each moved recipe's station,
// ingredients, seconds, experience and engram as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15, read from each page's
// wikitext infobox, the page named beside it. A Crafting XP is the one the page shows: its craftingxp times the global 4 of
// patches 253.0 and 313.5 (D465). A crafting time a page leaves blank is ours (DEV135); an ingredient that does not exist
// yet is left out or stood in for, as the deviation named beside it says. Then, a station at a time, every one of them is
// refused in the hand and made at its station from its slots into them, for the survivor who queued it.

import { expect, test } from "bun:test";
import { stationRecipes } from "../../client/core/ui/station.ts";
import type { EngramDef, ItemDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { RESULT_DENIED, RESULT_OK } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";
import { flatGround } from "../fixtures/arena.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (name: string): number => reg.index.get(`core:${name}`)!;
const item = (name: string): ItemDef => reg.defs[at(name)] as ItemDef;

/** How it is made: where, its ingredients, seconds, experience and how many one crafting makes; then its engram's level and points. */
type Made = [at: string, needs: string, seconds: number, xp: number, count: number, level: number, cost: number];
function made(name: string): Made {
  const c = item(name).craft!;
  const e = reg.defs.find((d) => d?.type === "engram" && d.item === `core:${name}`) as EngramDef;
  return [(c.at ?? "hand").replace("core:", ""), c.needs.map((n) => `${n.count} ${n.item.slice(5)}`).join(", "), c.seconds, c.xp, c.count ?? 1, e.level, e.cost];
}

// The mortar and pestle's.
const MORTAR: Readonly<Record<string, Made>> = {
  // Cementing Paste: 4 chitin, keratin or shell fragment (chitin is ours) and 8 stone; 1 s; craftingxp 1.2. DEV51 closed.
  paste: ["mortar", "4 chitin, 8 stone", 1, 4.8, 1, 13, 3],
  // Narcotic: 5 narcoberries (or ascerbic mushrooms) and 1 spoiled meat; 5 s; craftingxp 2.
  narcotic: ["mortar", "5 narcoberry, 1 spoiled_meat", 5, 8, 1, 6, 6],
};

test("cementing paste and the narcotic are made at the mortar and pestle at ARK's numbers (Cementing Paste, Narcotic)", () => {
  for (const name of Object.keys(MORTAR)) expect([name, made(name)]).toEqual([name, MORTAR[name]!]);
  // The mortar makes these and sparkpowder; gunpowder waits for the forge's charcoal and is made in the hand (S1).
  expect(stationRecipes(reg, at("mortar")).map((k) => reg.ids[k]!.slice(5)).sort()).toEqual(["narcotic", "paste", "sparkpowder"]);
  expect(made("gunpowder")[0]).toBe("hand");
});

/**
 * A Harness with ada joined and a station of `kind` placed beside her. Every item of `names` is refused in her hands, then
 * made at the station from what is put in its slots, each in its seconds, landing there, with its experience hers.
 */
function makesEach(kind: string, names: readonly string[], fuel?: [string, number]): void {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0 }, reg);
  try {
    const s = h.join("ada");
    h.run(200);
    const ground = flatGround(h, 30, 30);
    const me = h.host.records.byPid.get(h.client(s)!.pid)!;
    const k = at(kind);
    const ref = h.world.structs.add(k, ground.x + 1.5, ground.y + reg.halfY[k]!, ground.z, 0, me.team, reg.maxHp[k]!);
    const rec = h.host.fixtures.ensure(ref);
    if (fuel) {
      h.host.items.mint(rec, at(fuel[0]), fuel[1]);
      expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    }
    const inv = () => h.host.items.inv(rec);
    for (const name of names) {
      const product = at(name);
      const craft = item(name).craft!;
      me.engrams.push(reg.defs.findIndex((d) => d?.type === "engram" && d.item === `core:${name}`));
      expect([name, h.host.progression.craft(me, product, 1)]).toEqual([name, RESULT_DENIED]);
      const before = [product, ...craft.needs.map((n) => at(n.item.slice(5)))].map((i) => inv().total(i));
      for (const n of craft.needs) h.host.items.mint(rec, at(n.item.slice(5)), n.count);
      const xp = me.xp;
      expect([name, h.host.progression.craftAt(me, rec, product, 1)]).toEqual([name, RESULT_OK]);
      for (let t = 0; t < Math.ceil(craft.seconds * TICK_RATE) + 2; t++) h.server.tick();
      const after = [product, ...craft.needs.map((n) => at(n.item.slice(5)))].map((i) => inv().total(i));
      // The product is in the station and what it was made of is gone from it, whatever else lies there.
      expect([name, after]).toEqual([name, before.map((n, i) => (i === 0 ? n + (craft.count ?? 1) : n))]);
      expect([name, me.xp - xp]).toEqual([name, expect.closeTo(craft.xp, 6) as unknown as number]);
      expect([name, rec.jobs.length]).toEqual([name, 0]);
    }
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
}

test("each of the mortar's moved recipes is refused in the hand and made at the mortar, from its slots into them", () => {
  makesEach("mortar", Object.keys(MORTAR));
});
