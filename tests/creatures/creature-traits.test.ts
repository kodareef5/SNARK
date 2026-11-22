import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { CreatureTraits, inventoryEffectiveWeight } from "../../server/creature-traits.ts";
import { EntityRecord } from "../../server/records.ts";
import type { CreatureCombatFacet, Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { F_ALIVE, F_AWAKE } from "../../shared/sim/entities.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { FLAG_BLUEPRINT, Inventory } from "../../shared/sim/items.ts";
import { MICRO } from "../../shared/sim/lazy.ts";
import { V_HEALTH, V_TORPOR, Vitals } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

const COMBAT: CreatureCombatFacet = {
  primary: { name: "test strike", clip: "attack", socket: "mouth", radius: .5, reach: 5, damage: 1, type: "melee", ticks: 20, lands: 8, through: 10, stamina: 1 },
  rivalry: { distance: 12, minThreatDrag: 300, damage: 1.1, resistance: .8, health: 1.5 },
  weight: [{ item: "core:berry", mult: .5 }, { item: "core:round_rifle", mult: .25 }, { item: "core:rifle", mult: .1 }, { item: "core:scope", mult: .1 }],
};
const { registry, errors } = compileContent(CORE_CONTENT.map((d): Def => {
  if (d.type !== "species") return d;
  if (d.id === "core:parasaur") return { ...d, combat: COMBAT };
  if (d.id === "core:raptor") return { ...d, drag: 350 };
  if (d.id === "core:grazer") return { ...d, drag: 1000 };
  return d;
}));
if (!registry) throw new Error(errors.join("\n"));
const reg = registry, id = (name: string) => reg.index.get(`core:${name}`)!;

function fixture() {
  const h = new Harness({}, 1, 30, { dev: true }, reg), player = h.join("keeper");
  h.run(500);
  const g = flatGround(h, 90, 26);
  const x = g.x + 30, y = g.y, z = g.z + 13;
  const spawn = (name: string, dx = 0, dy = 0, dz = 0) => {
    const e = h.host.spawnCreature(`core:${name}`, x + dx, z + dz, 1);
    expect(e).toBeGreaterThanOrEqual(0);
    h.world.ents.setPosition(e, x + dx, y + dy, z + dz);
    h.world.ents.flags[e] = h.world.ents.flags[e]! | F_AWAKE;
    const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
    h.host.creatures.mind.stay(e, h.world.tick + 10000);
    return { e, rec };
  };
  const owner = spawn("parasaur");
  const refreshes: number[] = [], healthChanges: number[][] = [];
  const alliances = new Set<string>();
  const traits = new CreatureTraits({
    world: h.world, records: h.host.records,
    refresh: rec => { refreshes.push(rec.pid); h.host.survival.init(rec); },
    healthChanged: (rec, before, after) => { healthChanges.push([before, after]); h.host.survival.init(rec); },
    allied: (a, b) => alliances.has(`${Math.min(a, b)}:${Math.max(a, b)}`),
  });
  h.host.survival.healthMultiplier = rec => traits.healthOf(rec);
  const step = () => traits.step([owner.e], 1);
  const advance = (ticks: number) => { for (let n = 0; n < ticks; n++) { h.server.tick(); step(); } };
  return { h, player, owner, x, y, z, spawn, traits, refreshes, healthChanges, alliances, step, advance };
}

test("effective creature weight changes only ordinary loose stacks and never mutates the inventory", () => {
  const rec = new EntityRecord(1, id("parasaur")), inv = rec.inv = new Inventory(8, 8);
  inv.set(0, id("berry"), 100, 0, 0, 321);
  inv.set(1, id("round_rifle"), 20, 0, 0, 0);
  inv.set(2, id("rifle"), 1, 0, 20, 0);
  inv.setGear(2, id("round_rifle"), 1, id("scope"));
  inv.set(3, id("berry"), 1, 0, 0, 0, FLAG_BLUEPRINT);
  inv.set(4, id("scope"), 1, 0, 0, 0);
  inv.setRef(2, 123);
  const snapshot = structuredClone(inv), real = inv.weight(reg);
  const reduction = 100 * reg.weight[id("berry")]! * .5 + 20 * reg.weight[id("round_rifle")]! * .75;
  expect(inventoryEffectiveWeight(reg, rec)).toBeCloseTo(real - reduction, 8);
  expect(structuredClone(inv)).toEqual(snapshot);
  rec.kind = id("raptor");
  expect(inventoryEffectiveWeight(reg, rec)).toBe(real);
  rec.inv = null;
  expect(inventoryEffectiveWeight(reg, rec)).toBe(0);
});

test("rivalry requires a nearby hostile hunting creature; small, allied, dead and unconscious animals do not count", () => {
  const f = fixture(), { owner, traits, spawn, h, step } = f;
  owner.rec.team = h.world.ents.team[owner.e] = 10;
  spawn("grazer", 3); // Larger drag than the hunter, but a herbivore.
  spawn("dodo", 4);
  const hunter = spawn("raptor", 7);
  hunter.rec.team = h.world.ents.team[hunter.e] = 10;
  step();
  expect([traits.damageOf(owner.rec), traits.takenOf(owner.rec)]).toEqual([1, 1]);
  hunter.rec.team = h.world.ents.team[hunter.e] = 11;
  f.alliances.add("10:11");
  traits.remove(owner.rec); step();
  expect(traits.damageOf(owner.rec)).toBe(1);
  f.alliances.clear(); hunter.rec.out = true;
  traits.remove(owner.rec); step();
  expect(traits.damageOf(owner.rec)).toBe(1);
  hunter.rec.out = false; hunter.rec.dead = true;
  traits.remove(owner.rec); step();
  expect(traits.damageOf(owner.rec)).toBe(1);
  hunter.rec.dead = false;
  traits.remove(owner.rec); step();
  expect([traits.damageOf(owner.rec), traits.takenOf(owner.rec), traits.healthOf(owner.rec)]).toEqual([1.1, .8, 1.5]);
  // Wild is not an alliance: an unowned hunter threatens another wild creature too.
  owner.rec.team = h.world.ents.team[owner.e] = 0;
  hunter.rec.team = h.world.ents.team[hunter.e] = 0;
  traits.remove(owner.rec); step();
  expect(traits.damageOf(owner.rec)).toBe(1.1);
});

test("rivalry uses three-dimensional distance and queries at most about once a second per awake owner", () => {
  const { h, owner, traits, spawn, x, y, z, step, advance, refreshes } = fixture();
  const hunter = spawn("raptor", 0, 13);
  step();
  expect(traits.damageOf(owner.rec)).toBe(1);
  h.world.ents.setPosition(hunter.e, x + 11, y, z);
  const before = traits.checks;
  advance(30);
  expect(traits.damageOf(owner.rec)).toBe(1.1);
  expect(traits.checks - before).toBeLessThanOrEqual(1);
  const changes = refreshes.length, checks = traits.checks;
  advance(90);
  expect(traits.checks - checks).toBe(3);
  expect(refreshes.length).toBe(changes);
  h.world.ents.setPosition(hunter.e, x + 13, y, z);
  advance(30);
  expect(traits.damageOf(owner.rec)).toBe(1);
});

test("slow strengths expire independently and refreshing a weaker effect does not prolong a stronger one", () => {
  const { owner, traits, refreshes, advance } = fixture();
  expect(traits.applySlow(owner.rec, .25, 1)).toBe(true);
  expect(traits.applySlow(owner.rec, .6, 3)).toBe(true);
  expect(traits.speedOf(owner.rec)).toBe(.25);
  expect(refreshes.length).toBe(1);
  advance(30);
  expect(traits.speedOf(owner.rec)).toBe(.6);
  expect(refreshes.length).toBe(2);
  expect(traits.applySlow(owner.rec, .6, 3)).toBe(true);
  advance(60);
  expect(traits.speedOf(owner.rec)).toBe(.6);
  advance(30);
  expect(traits.speedOf(owner.rec)).toBe(1);
  expect(refreshes.length).toBe(3);
  for (const [mult, seconds] of [[0, 1], [.01, 1], [1, 1], [-1, 2], [.5, 0], [.5, 61], [.5, Infinity], [NaN, 2]]) expect(traits.applySlow(owner.rec, mult!, seconds!)).toBe(false);
});

test("temporary traits cannot leak to a recycled entity, sleeping body or stale record", () => {
  const { h, owner, traits, spawn, step } = fixture();
  spawn("raptor", 4);
  traits.applySlow(owner.rec, .5, 10); step();
  expect([traits.speedOf(owner.rec), traits.damageOf(owner.rec)]).toEqual([.5, 1.1]);
  h.world.ents.gen[owner.e] = h.world.ents.gen[owner.e]! + 1;
  expect([traits.speedOf(owner.rec), traits.damageOf(owner.rec)]).toEqual([1, 1]);
  traits.step([], 0);
  expect(traits.healthOf(owner.rec)).toBe(1);
  traits.applySlow(owner.rec, .5, 10); step();
  h.world.ents.flags[owner.e] = h.world.ents.flags[owner.e]! & ~F_AWAKE;
  traits.step([], 0);
  expect([traits.speedOf(owner.rec), traits.damageOf(owner.rec), traits.healthOf(owner.rec)]).toEqual([1, 1, 1]);
  expect(traits.applySlow(owner.rec, .5, 10)).toBe(false);
  h.world.ents.flags[owner.e] = h.world.ents.flags[owner.e]! | F_AWAKE;
  const stale = new EntityRecord(owner.rec.pid, owner.rec.kind);
  expect(traits.applySlow(stale, .5, 10)).toBe(false);
  traits.applySlow(owner.rec, .5, 10);
  h.world.ents.flags[owner.e] = h.world.ents.flags[owner.e]! & ~F_ALIVE;
  traits.step([], 0);
  expect(traits.speedOf(owner.rec)).toBe(1);
});

test("rivalry preserves health fraction through toggles, damage, early unrelated refresh and ordinary stat gains", () => {
  const { h, owner, traits, spawn, step, healthChanges } = fixture();
  const survival = h.host.survival, rec = owner.rec, v = rec.vitals!;
  survival.add(rec, V_HEALTH, -100);
  spawn("raptor", 4); step();
  expect([v.value[V_HEALTH]! / MICRO, v.max[V_HEALTH]! / MICRO]).toEqual([150, 300]);
  survival.add(rec, V_HEALTH, -30);
  traits.remove(rec);
  expect([v.value[V_HEALTH]! / MICRO, v.max[V_HEALTH]! / MICRO]).toEqual([80, 200]);
  for (let n = 0; n < 20; n++) { step(); traits.remove(rec); }
  expect([v.value[V_HEALTH]! / MICRO, v.max[V_HEALTH]! / MICRO]).toEqual([80, 200]);
  step(); v.value[V_TORPOR] = v.max[V_TORPOR]!; rec.out = true;
  survival.init(rec); // Happens before the trait tick notices the knockout.
  expect([v.value[V_HEALTH]! / MICRO, v.max[V_HEALTH]! / MICRO]).toEqual([80, 200]);
  traits.step([], 0);
  expect(v.value[V_HEALTH]! / MICRO).toBe(80);
  expect(healthChanges[0]).toEqual([1, 1.5]);
  rec.genome!.wild[STAT_NAMES.indexOf("health")] = 1;
  survival.init(rec);
  expect([v.value[V_HEALTH]! / MICRO, v.max[V_HEALTH]! / MICRO]).toEqual([80, 240]);
});

test("restoring boosted saved vitals removes temporary health without healing or retaining the boost", () => {
  const { h, owner, traits } = fixture(), rec = owner.rec;
  const v = rec.vitals = new Vitals();
  v.max[V_HEALTH] = 300 * MICRO;
  v.value[V_HEALTH] = 120 * MICRO;
  v.tick = h.world.tick;
  expect(traits.healthOf(rec)).toBe(1);
  h.host.survival.restore(rec, true);
  expect([v.value[V_HEALTH]! / MICRO, v.max[V_HEALTH]! / MICRO]).toEqual([80, 200]);
  h.host.survival.init(rec);
  expect(v.value[V_HEALTH]! / MICRO).toBe(80);
  v.max[V_HEALTH] = 300 * MICRO; v.value[V_HEALTH] = 0;
  h.host.survival.restore(rec, false);
  expect([v.value[V_HEALTH], v.max[V_HEALTH]! / MICRO]).toEqual([0, 200]);
});

test("restoring a rivalry maximum recalculates injury and its recovery deadline", () => {
  const { h, owner } = fixture(), rec = owner.rec, v = rec.vitals!;
  const changes: boolean[] = [];
  h.host.survival.onInjured = (_rec, injured) => changes.push(injured);
  v.max[V_HEALTH] = 300 * MICRO;
  v.value[V_HEALTH] = 36 * MICRO;
  h.host.survival.restore(rec, true);
  expect(v.value[V_HEALTH]! / MICRO).toBe(24);
  expect(changes).toEqual([true]);
  expect(rec.vitalsDue).toBeGreaterThan(h.world.tick);
});
