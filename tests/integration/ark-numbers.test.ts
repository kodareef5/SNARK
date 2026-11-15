// What the ARK wiki (ark.wiki.gg) says a thing does, on a running server. Each test names the page it was read from,
// on 2026-11-14.

import { expect, test } from "bun:test";
import type { EntityRecord } from "../../server/records.ts";
import { STAT_HEALTH, statOf } from "../../server/survival.ts";
import { ZONE_NONE, ZONE_TORSO } from "../../shared/anim/human.ts";
import type { EngramDef, SpeciesDef } from "../../shared/content/defs.ts";
import { RESULT_SHORT } from "../../shared/net/protocol.ts";
import { DMG_BULLET, DMG_EXPLOSIVE, DMG_MELEE } from "../../shared/sim/damage.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** A server with one survivor in it. `creature` puts a wild one near her. */
function world() {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(300);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const ents = h.world.ents;
  const at = { x: ents.x[h.ent(ada)]!, z: ents.z[h.ent(ada)]! };
  // The body is made first and looked up after, because making one may replace the store's columns.
  const creature = (species: string, dx: number, level = 1): EntityRecord => {
    const e = h.host.spawnCreature(`core:${species}`, at.x + dx, at.z + 6, level);
    return h.host.records.byPid.get(ents.pid[e]!)!;
  };
  return { h, ada, me, at, creature };
}

test("food keeps four times as long in a creature as in a survivor's hands, and what a piece has left is scaled as it changes hands (Spoilage, Raw Prime Meat)", () => {
  const { h, me, creature } = world();
  const items = h.host.items;
  const meat = id("meat");
  const piece = h.reg.spoilTicks[meat]!;
  const raptor = creature("raptor", 4);
  /** Ticks until the top piece of its meat spoils. */
  const left = (rec: EntityRecord): number => {
    const inv = items.inv(rec);
    return inv.spoilAt[inv.item.indexOf(meat)]! - h.world.tick;
  };
  items.mint(me, meat, 5);
  expect(left(me)).toBe(piece);
  items.mint(raptor, meat, 2);
  expect(left(raptor)).toBe(4 * piece);
  // Hers has 100 ticks left. Two of them given to the creature have 400 there, and its stack is as old as they are.
  me.inv!.spoilAt[me.inv!.item.indexOf(meat)] = h.world.tick + 100;
  expect(items.give(me, raptor, meat, 2)).toBe(true);
  expect([left(me), left(raptor), items.inv(raptor).total(meat)]).toEqual([100, 400, 4]);
  // Taken back by its slot they have 100 again, and no more for the round trip.
  const from = items.inv(raptor).item.indexOf(meat);
  const to = items.inv(me).free();
  expect(items.move(raptor, from, me, to, 1)).toBe(1);
  expect([items.inv(me).spoilAt[to]! - h.world.tick, left(raptor)]).toEqual([100, 400]);
  expect(items.audit()).toEqual([]);
});

test("a survivor saved before ARK's level table keeps what it spent and learned, is never short of points below nothing, and stops at level 105", () => {
  const { h, me } = world();
  const prog = h.host.progression;
  // The old table's last level took 157,980 experience, which is level 78 now. She had placed its 99 stat points and
  // learned every engram: she keeps both, and has no stat point to place until level 101.
  me.xp = 157980;
  me.genome!.tamed[STAT_HEALTH] = 99;
  me.engrams.push(...h.reg.defs.flatMap((d, k) => (d?.type === "engram" ? [k] : [])));
  const cost = me.engrams.reduce((sum, e) => sum + (h.reg.defs[e] as EngramDef).cost, 0);
  const health = statOf(h.reg.defs[me.kind] as SpeciesDef, me.genome, STAT_HEALTH, 0);
  expect([prog.level(me), prog.statPoints(me), prog.engramPoints(me)]).toEqual([78, 0, 1884 - cost]);
  expect([prog.spend(me, STAT_HEALTH), me.genome!.tamed[STAT_HEALTH], health]).toEqual([RESULT_SHORT, 99, 100 * (1 + 99 * 0.1)]);
  expect(me.engrams.every((e) => prog.knows(me, e))).toBe(true);
  // With less experience than her engrams cost under this table, she has none to spend and still knows them.
  me.xp = 450;
  expect([prog.level(me), cost > 76, prog.engramPoints(me), prog.knows(me, me.engrams[0]!)]).toEqual([10, true, 0, true]);
  // More experience than the last level takes is left as it is, and gains nothing.
  me.xp = 5e6;
  expect([prog.level(me), prog.addXp(me, 100), me.xp, prog.most(me)]).toEqual([105, 0, 5e6, 4098538]);
});

test("whatever kills a creature carries off nothing: its body lies where it fell, the hide and the meat in it for a tool (Raw Meat, Hide)", () => {
  const { h, me, creature } = world();
  const items = h.host.items;
  const ents = h.world.ents;
  /** `by` kills a grazer with one bite. Returns the stacks it then carries, and the bodies that lie. */
  const kills = (by: EntityRecord): number[] => {
    const prey = creature("grazer", -4);
    const e = h.host.records.entOf.get(prey.pid)!;
    h.host.combat.land({ by, x: ents.x[e]!, z: ents.z[e]!, item: 0, base: 1e6, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 }, e, ZONE_TORSO, ents.x[e]!, ents.y[e]! + 1, ents.z[e]!, 2);
    expect([h.host.combat.last.killed, h.host.combat.last.by]).toEqual([true, by.pid]);
    return [items.inv(by).used(), h.host.corpses.count];
  };
  const raptor = creature("raptor", 4);
  expect([raptor.team, ...kills(raptor)]).toEqual([0, 0, 1]);
  raptor.team = me.team;
  expect(kills(raptor)).toEqual([0, 2]);
  expect(items.audit()).toEqual([]);
});

test("a saddle of 25 halves a round or a blow and takes a fifth off an explosion (Saddles)", () => {
  const { h, at, creature } = world();
  const rec = creature("parasaur", 4);
  const e = h.host.records.entOf.get(rec.pid)!;
  const ents = h.world.ents;
  /** The health a hit of `base` points takes. */
  const hit = (base: number, type: number, zone: number): number => {
    const before = h.host.survival.value(rec, V_HEALTH);
    h.host.combat.land({ by: null, x: at.x, z: at.z, item: 0, base, type, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 }, e, zone, ents.x[e]!, ents.y[e]! + 1, ents.z[e]!, 3);
    return before - h.host.survival.value(rec, V_HEALTH);
  };
  expect(reg.saddleArmor[id("saddle_parasaur")]).toBe(25);
  // A creature takes 70% of a round, saddled or not (Longneck Rifle).
  expect(hit(20, DMG_BULLET, ZONE_TORSO)).toBeCloseTo(14, 3);
  expect(hit(20, DMG_MELEE, ZONE_TORSO)).toBeCloseTo(20, 3);
  rec.saddle = id("saddle_parasaur");
  // The page's examples: a pistol round of 60 does 30, and an explosion of 750 does 600. These are a tenth of the second.
  // The round's 30 is the saddle's alone; the creature takes 70% of it.
  expect(hit(60, DMG_BULLET, ZONE_TORSO)).toBeCloseTo(30 * 0.7, 3);
  expect(hit(60, DMG_MELEE, ZONE_TORSO)).toBeCloseTo(30, 3);
  expect(hit(75, DMG_EXPLOSIVE, ZONE_NONE)).toBeCloseTo(60, 3);
});
