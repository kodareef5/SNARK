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
 * A Harness with ada joined and, for each item of `names`, a station of `kind` placed beside her (lit on `fuel` if it
 * needs it). Each item is refused in her hands, then made at its station from what is put in its slots, all at once, each
 * in its seconds, landing there, with the experience hers.
 */
function makesEach(kind: string, names: readonly string[], fuel?: [string, number]): void {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0 }, reg);
  try {
    const s = h.join("ada");
    h.run(200);
    const ground = flatGround(h, 30, 30);
    const me = h.host.records.byPid.get(h.client(s)!.pid)!;
    const k = at(kind);
    const xp = me.xp;
    const stations = names.map((name, n) => {
      const ref = h.world.structs.add(k, ground.x + 2 + (n % 6) * 4, ground.y + reg.halfY[k]!, ground.z + 2 + Math.floor(n / 6) * 4, 0, me.team, reg.maxHp[k]!);
      const rec = h.host.fixtures.ensure(ref);
      if (fuel) {
        h.host.items.mint(rec, at(fuel[0]), fuel[1]);
        expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
      }
      const product = at(name);
      const craft = item(name).craft!;
      me.engrams.push(reg.defs.findIndex((d) => d?.type === "engram" && d.item === `core:${name}`));
      expect([name, h.host.progression.craft(me, product, 1)]).toEqual([name, RESULT_DENIED]);
      for (const need of craft.needs) h.host.items.mint(rec, at(need.item.slice(5)), need.count);
      expect([name, h.host.progression.craftAt(me, rec, product, 1)]).toEqual([name, RESULT_OK]);
      return rec;
    });
    const longest = Math.max(...names.map((name) => item(name).craft!.seconds));
    for (let t = 0; t < Math.ceil(longest * TICK_RATE) + 2; t++) h.server.tick();
    names.forEach((name, n) => {
      const craft = item(name).craft!;
      const inv = h.host.items.inv(stations[n]!);
      // The product is in its station, and what it was made of is gone from it.
      expect([name, inv.total(at(name)), ...craft.needs.map((need) => inv.total(at(need.item.slice(5))))]).toEqual([name, craft.count ?? 1, ...craft.needs.map(() => 0)]);
      expect([name, stations[n]!.jobs.length]).toEqual([name, 0]);
    });
    // The experience of every one is the survivor's who queued it.
    expect(me.xp - xp).toBeCloseTo(names.reduce((sum, name) => sum + item(name).craft!.xp, 0), 6);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
}

test("each of the mortar's moved recipes is refused in the hand and made at the mortar, from its slots into them", () => {
  makesEach("mortar", Object.keys(MORTAR));
});

// The smithy's: the guns and their rounds, the grenade, the tranquilizer dart, the scope and the silencer (DEV136, removed); chitin
// and flak armor; the metal building pieces. Its own numbers are S2's (tests/integration/fabricator.test.ts).
const SMITHY: Readonly<Record<string, Made>> = {
  // Crossbow, Simple Pistol, Longneck Rifle, Shotgun: no page gives a crafting time (DEV135).
  crossbow: ["smithy", "7 ingot, 10 wood, 35 fiber", 10, 36, 1, 25, 12],
  pistol: ["smithy", "60 ingot, 5 wood, 15 hide", 12, 100.8, 1, 34, 15],
  rifle: ["smithy", "95 ingot, 20 wood, 25 hide", 15, 330, 1, 35, 18],
  shotgun: ["smithy", "80 ingot, 20 wood, 25 hide", 15, 423.2, 1, 39, 18],
  // Grenade: its 4 oil now that oil exists (DEV140, removed); no crafting time (DEV135).
  grenade: ["smithy", "15 fiber, 20 stone, 30 gunpowder, 5 hide, 2 ingot, 4 oil", 8, 45.6, 1, 38, 20],
  // Simple Bullet (1 s), Simple Rifle Ammo and Simple Shotgun Ammo (no crafting time, DEV135), two a crafting.
  round_pistol: ["smithy", "1 ingot, 6 gunpowder", 1, 1.6, 2, 34, 6],
  round_rifle: ["smithy", "2 ingot, 12 gunpowder", 2, 3.2, 2, 35, 6],
  round_shotgun: ["smithy", "3 round_pistol, 1 ingot, 3 gunpowder", 2, 1.2, 2, 39, 6],
  // Tranquilizer Dart.
  dart_tranq: ["smithy", "3 narcotic, 2 ingot, 1 round_rifle", 1, 0.2, 1, 62, 30],
  // Scope Attachment: its 20 crystal and 5 stone, no longer 20 stone; Silencer Attachment: its 5 oil (DEV140, removed).
  scope: ["smithy", "40 ingot, 20 crystal, 5 stone", 10, 196, 1, 35, 13],
  silencer: ["smithy", "50 ingot, 5 oil, 20 chitin, 10 hide", 6, 196, 1, 41, 13],
  // Chitin Helmet, Chestpiece, Gauntlets, Leggings, Boots: level 37, each piece's points and craftingxp; 5 s ours (DEV135).
  chitin_hat: ["smithy", "15 chitin, 7 hide, 3 fiber", 5, 7.6, 1, 37, 18],
  chitin_shirt: ["smithy", "20 chitin, 10 hide, 4 fiber", 5, 10.4, 1, 37, 18],
  chitin_gloves: ["smithy", "10 chitin, 5 hide, 2 fiber", 5, 5.2, 1, 37, 15],
  chitin_pants: ["smithy", "25 chitin, 12 hide, 5 fiber", 5, 12.8, 1, 37, 15],
  chitin_boots: ["smithy", "12 chitin, 6 hide, 4 fiber", 5, 6.4, 1, 37, 15],
  // Flak Helmet, Chestpiece, Gauntlets, Leggings, Boots: level 56.
  flak_hat: ["smithy", "10 ingot, 7 hide, 3 fiber", 5, 17.64, 1, 56, 20],
  flak_shirt: ["smithy", "13 ingot, 10 hide, 4 fiber", 5, 23.12, 1, 56, 18],
  flak_gloves: ["smithy", "6 ingot, 5 hide, 2 fiber", 5, 10.76, 1, 56, 16],
  flak_pants: ["smithy", "16 ingot, 12 hide, 5 fiber", 5, 28.4, 1, 56, 15],
  flak_boots: ["smithy", "8 ingot, 6 hide, 4 fiber", 5, 14.32, 1, 56, 16],
  // Metal Foundation, Wall, Ceiling, Door, Pillar and Stairs: each piece's level, points and craftingxp; ARK's door is 10
  // ingots, not 20; 5 s ours.
  piece_foundation_metal: ["smithy", "50 ingot, 15 paste", 5, 92, 1, 45, 24],
  piece_wall_metal: ["smithy", "25 ingot, 7 paste", 5, 18.4, 1, 45, 15],
  piece_ceiling_metal: ["smithy", "35 ingot, 10 paste", 5, 51.2, 1, 45, 15],
  piece_door_metal: ["smithy", "10 ingot, 4 paste", 5, 11.6, 1, 45, 12],
  piece_pillar_metal: ["smithy", "25 ingot, 7 paste", 5, 27.2, 1, 46, 18],
  piece_stairs_metal: ["smithy", "35 ingot, 10 paste", 5, 64, 1, 47, 12],
};

test("the smithy makes the guns, rounds, grenade, tranquilizer dart, scope and silencer, chitin and flak, and the metal pieces, at ARK's numbers", () => {
  expect(Object.keys(SMITHY).length).toBe(27);
  for (const name of Object.keys(SMITHY)) expect([name, made(name)]).toEqual([name, SMITHY[name]!]);
  // What it makes is these and the fabricator (S2), and nothing else.
  expect(stationRecipes(reg, at("smithy")).map((k) => reg.ids[k]!.slice(5)).sort()).toEqual([...Object.keys(SMITHY), "piece_fabricator"].sort());
  // Each armor piece weighs what its page says (Chitin Helmet to Flak Boots); the metal pieces 4 (Metal Foundation to Metal Stairs).
  const weight = (name: string): number => item(name).weight!;
  expect(["hat", "shirt", "gloves", "pants", "boots"].map((p) => [weight(`chitin_${p}`), weight(`flak_${p}`)])).toEqual([[4, 4], [6, 10], [3, 2], [6, 10], [3, 4]]);
  expect(["foundation", "wall", "ceiling", "door", "pillar", "stairs"].map((p) => weight(`piece_${p}_metal`))).toEqual([4, 4, 4, 4, 4, 4]);
});

test("each of the smithy's moved recipes is refused in the hand and made at the smithy, from its slots into them", () => {
  makesEach("smithy", Object.keys(SMITHY));
});

// The fabricator's (DEV136, removed). Its own numbers are S2's (tests/integration/fabricator.test.ts).
const FABRICATOR: Readonly<Record<string, Made>> = {
  // Shocking Tranquilizer Dart: ARK's is 3 bio toxin, 2 ingots and a tranquilizer dart; bio toxin does not exist (DEV139).
  dart_shock: ["fabricator", "6 narcotic, 4 ingot, 4 gunpowder", 1, 0.2, 1, 96, 30],
  // Flashlight Attachment and Laser Attachment: their crystal and electronics (DEV140, removed); no crafting time (DEV135).
  flashlight: ["fabricator", "40 ingot, 40 crystal, 10 electronics", 6, 304, 1, 52, 18],
  laser: ["fabricator", "50 ingot, 60 crystal, 40 electronics", 6, 544, 1, 59, 24],
  // Poison Grenade: its 14 charcoal and 5 crystal; no crafting time, the grenade's 8 s (DEV143).
  grenade_poison: ["fabricator", "10 narcotic, 14 charcoal, 5 ingot, 18 sparkpowder, 12 gunpowder, 5 crystal, 20 fiber, 5 flint", 8, 33, 1, 40, 18],
  // Vault: craftingxp 82; no crafting time (DEV135); its 70 oil and 90 polymer wait for the structure menu (DEV174).
  piece_vault: ["fabricator", "500 ingot, 100 paste", 5, 328, 1, 75, 30],
};

test("the fabricator makes the shock dart, the flashlight and laser, the poison grenade and the vault, at ARK's numbers (Fabricator, and each page)", () => {
  for (const name of Object.keys(FABRICATOR)) expect([name, made(name)]).toEqual([name, FABRICATOR[name]!]);
  // What it makes, lit or out, is these and S2's polymer and electronics.
  const makes = (kind: string): string[] => stationRecipes(reg, at(kind)).map((k) => reg.ids[k]!.slice(5)).sort();
  expect([makes("fabricator"), makes("fabricator_lit")]).toEqual([[...Object.keys(FABRICATOR), "electronics", "polymer"].sort(), [...Object.keys(FABRICATOR), "electronics", "polymer"].sort()]);
  // The vault weighs 20 and stacks to 1 (Vault).
  expect([item("piece_vault").weight, item("piece_vault").stack]).toEqual([20, 1]);
});

test("each of the fabricator's moved recipes is refused in the hand and made at a lit fabricator, from its slots into them", () => {
  makesEach("fabricator", Object.keys(FABRICATOR), ["gasoline", 1]);
});
