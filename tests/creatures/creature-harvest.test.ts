// The node accounting used by every creature strike: actor eligibility, material/profile choice, settings, inventory,
// experience and persisted depletion. Combat separately proves contact, obstruction and once-per-action dedup.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { CreatureHarvestFacet, Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { nodesOf, standFacing, takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

// Fixed resource rolls make the profile/rule accounting observable independently of the random-number implementation.
// All geometry, inventory capacity, item definitions, creature stats and server services are the real ones.
const { registry, errors } = compileContent(CORE_CONTENT.map((d): Def => {
  if (d.type !== "node") return d;
  if (d.id === "core:tree") return { ...d, yields: [
    { item: "core:thatch", min: 2, max: 2 },
    { item: "core:wood", min: 1, max: 1, tool: true },
    { item: "core:fiber", min: 1, max: 1, flat: true },
  ] };
  if (d.id === "core:bush") return { ...d, yields: [{ item: "core:berry", min: 2, max: 2 }, { item: "core:fiber", min: 1, max: 1 }] };
  return d;
}));
if (!registry) throw new Error(errors.join("\n"));
const WOOD: CreatureHarvestFacet = { materials: ["wood"], power: 1, damage: 1 };

function setup(server: string[] = [], mode: string[] = [], kind = "core:tree") {
  const config = loadConfig({ gus: ["[ServerSettings]", ...server].join("\n"), game: ["[/script/shootergame.shootergamemode]", "DinoHarvestingDamageMultiplier=1", ...mode].join("\n") });
  expect([config.report.refused, config.report.unknown]).toEqual([[], []]);
  const h = new Harness({}, 1, 30, { dev: true, config: config.rules }, registry!);
  const s = h.join("keeper");
  h.run(500);
  h.say(s, "enablecheats");
  const node = nodesOf(h, kind, 256, 256).find((n) => standFacing(h, s, h.pilots[0]!, n, 5))!;
  expect(node).toBeDefined();
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const e = h.host.spawnCreature("core:parasaur", h.world.ents.x[h.ent(s)]! + 4, h.world.ents.z[h.ent(s)]!, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  rec.team = me.team;
  h.world.ents.team[e] = me.team;
  h.host.creatures.mind.stay(e, 0);
  const harvest = h.host.harvest!, items = h.host.items;
  const id = (name: string) => h.reg.index.get(`core:${name}`)!;
  const total = (name: string, actor = rec) => items.inv(actor).total(id(name));
  const hp = () => harvest.field.store.chunks[node.chunk]!.hp[node.index]!;
  const strike = (profile = WOOD) => harvest.creature(rec, node.chunk, node.index, profile);
  return { h, s, e, me, rec, harvest, items, node, id, total, hp, strike };
}

test("a creature's harvest profile and server rules fill its bag, wear no rider tool, and share raw XP once", () => {
  const f = setup(["HarvestAmountMultiplier=3", "XPMultiplier=2"], ["DinoHarvestingDamageMultiplier=2", "HarvestXPMultiplier=4", 'HarvestResourceItemAmountClassMultipliers=(ClassName="core:wood",Multiplier=2)']);
  const { h, s, me, rec, harvest, items, id, total, hp, strike } = f;
  h.say(s, "give pick 1");
  const tool = takeInHand(h, s, id("pick"));
  const durability = items.inv(me).dur[tool];
  harvest.riderOf = (actor) => actor === rec ? me : null;
  const start = hp(), ownXp = rec.xp, riderXp = me.xp;
  expect(strike({ ...WOOD, power: 2, yields: [{ item: "core:wood", mult: 3 }, { item: "core:thatch", mult: .5 }] })).toBe(true);
  expect(hp()).toBe(start - 2);
  expect([total("wood"), total("thatch"), total("fiber")]).toEqual([72, 12, 6]);
  expect([total("wood", me), total("thatch", me), total("fiber", me)]).toEqual([0, 0, 0]);
  expect([rec.xp - ownXp, me.xp - riderXp]).toEqual([16, 8]);
  expect(items.inv(me).dur[tool]).toBe(durability);
  expect(items.audit()).toEqual([]);
});

test("a plant profile harvests berries and can exclude fibre; a wood profile cannot pick it", () => {
  const { rec, harvest, total, hp, strike } = setup([], [], "core:bush");
  const before = hp();
  expect(strike()).toBe(false);
  expect([hp(), rec.xp, harvest.hits]).toEqual([before, 0, 0]);
  expect(strike({ materials: ["plant"], power: 2, damage: 1, yields: [{ item: "core:fiber", mult: 0 }] })).toBe(true);
  expect([hp(), total("berry"), total("fiber"), rec.xp]).toEqual([before - 1, 4, 0, .5]);
});

test("only a live, conscious tame with a current creature record may harvest an allowed material", () => {
  const { h, e, rec, me, node, harvest, hp, strike } = setup();
  const before = hp(), team = rec.team, flags = h.world.ents.flags[e]!;
  rec.team = 0;
  expect(strike()).toBe(false);
  rec.team = team; rec.out = true;
  expect(strike()).toBe(false);
  rec.out = false; rec.dead = true;
  expect(strike()).toBe(false);
  rec.dead = false; h.world.ents.flags[e] = flags & ~F_ALIVE;
  expect(strike()).toBe(false);
  h.world.ents.flags[e] = flags;
  expect(harvest.creature(me, node.chunk, node.index, WOOD)).toBe(false);
  const stale = new EntityRecord(rec.pid, rec.kind); stale.team = team;
  expect(harvest.creature(stale, node.chunk, node.index, WOOD)).toBe(false);
  expect(strike({ ...WOOD, materials: ["stone"] })).toBe(false);
  for (const [chunk, index] of [[-1, node.index], [node.chunk, -1], [node.chunk, 256], [1e9, 0], [node.chunk, .5]]) expect(harvest.creature(rec, chunk!, index!, WOOD)).toBe(false);
  expect([hp(), rec.xp, harvest.hits, rec.inv]).toEqual([before, 0, 0, null]);
});

test("melee strength and dino harvest damage shorten depletion without awarding more than the node holds", () => {
  function fell(damage: number, rate: number, meleePoints = 0) {
    const { rec, node, harvest, total, strike, items } = setup([], [`DinoHarvestingDamageMultiplier=${rate}`]);
    rec.genome!.wild[STAT_NAMES.indexOf("melee")] = meleePoints;
    let swings = 0;
    while (harvest.field.standing(node.chunk, node.index) !== 0 && swings < 100) { expect(strike({ ...WOOD, damage })).toBe(true); swings++; }
    expect(items.audit()).toEqual([]);
    return [swings, total("wood"), total("thatch"), total("fiber"), rec.xp];
  }
  expect(fell(1, 1)).toEqual([12, 12, 24, 12, 12]);
  expect(fell(2, 1)).toEqual([6, 12, 24, 12, 12]);
  expect(fell(1, 2)).toEqual([6, 12, 24, 12, 12]);
  expect(fell(1, 1, 20)).toEqual([6, 12, 24, 12, 12]);
  expect(fell(100, 1)).toEqual([1, 12, 24, 12, 12]);
});

test("zero harvesting damage produces nothing, and fractional damage stays seeded and exhausts the finite node", () => {
  const zero = setup([], ["DinoHarvestingDamageMultiplier=0"]), before = zero.hp();
  for (let n = 0; n < 10; n++) expect(zero.strike()).toBe(true);
  expect([zero.hp(), zero.rec.xp, zero.harvest.hits, zero.total("wood")]).toEqual([before, 0, 0, 0]);
  function fraction() {
    const { rec, node, harvest, total, strike } = setup([], ["DinoHarvestingDamageMultiplier=0.25"]);
    let swings = 0;
    while (harvest.field.standing(node.chunk, node.index) !== 0 && swings < 200) { expect(strike()).toBe(true); swings++; }
    return [swings, total("wood"), rec.xp];
  }
  const a = fraction(), b = fraction();
  expect(a).toEqual(b);
  expect(a[0]).toBeGreaterThan(12);
  expect(a[0]).toBeLessThan(120);
  expect(a.slice(1)).toEqual([12, 12]);
});

test("a depleted node is saved once and repeated strikes cannot mint or award experience again", () => {
  const { rec, node, harvest, total, strike, items } = setup();
  const version = harvest.version[node.chunk]!;
  expect(strike({ ...WOOD, damage: 100 })).toBe(true);
  const xp = rec.xp, amount = total("wood"), encoded = harvest.encode(node.chunk)!;
  const until = harvest.regrowsAt(node.chunk, node.index);
  expect(until).toBeGreaterThan(0);
  expect(harvest.dirty.has(node.chunk)).toBe(true);
  expect(harvest.version[node.chunk]).toBe(version + 1);
  for (let n = 0; n < 20; n++) expect(strike()).toBe(false);
  expect([rec.xp, total("wood"), harvest.hits, harvest.version[node.chunk]]).toEqual([xp, amount, 1, version + 1]);
  expect(harvest.encode(node.chunk)).toEqual(encoded);
  const fresh = new Harness({}, 1, 30, {}, registry!);
  fresh.host.harvest!.decode(node.chunk, encoded);
  fresh.host.harvest!.retain(node.chunk, 0, 1);
  expect(fresh.host.harvest!.regrowsAt(node.chunk, node.index)).toBe(until);
  expect(fresh.host.harvest!.field.standing(node.chunk, node.index)).toBe(0);
  expect(items.audit()).toEqual([]);
});
