// What is under way when a rule changes: timed again from that tick, by one
// function for each kind of thing, whether the rule changed while the server
// ran or the world was saved under one set of files and loaded under another.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BAG_TICKS, CACHE_TICKS } from "../../server/death.ts";
import type { HostOptions } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { ORDER_MATE } from "../../shared/net/protocol.ts";
import { MATE_TICKS, growthStep, leftAtPeriod, leftAtSpeed } from "../../shared/sim/breeding.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { V_FOOD, V_HEALTH, V_TORPOR, V_WATER } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { nodesOf } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** Rules from the text of the two files, each given its section, and a command line. */
function rulesOf(server: string[] = [], mode: string[] = [], argv: string[] = [], live?: string) {
  const made = loadConfig({ gus: ["[ServerSettings]", ...server].join("\n"), game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n"), ...(live !== undefined ? { live } : {}) }, argv);
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return made.rules;
}

/** A place on level ground, the same in every world made here. */
const PLACE = { x: 0, z: 0, y: 0 };

/** A server on those settings. Nobody is in it unless `who` is named. */
function world(server: string[] = [], mode: string[] = [], host: HostOptions = {}, who = "") {
  const h = new Harness({}, 1, 60, { dev: true, config: rulesOf(server, mode), ...host });
  const g = flatGround(h, 40, 40);
  PLACE.x = g.x + 20;
  PLACE.z = g.z + 10;
  PLACE.y = g.y;
  const ada = who !== "" ? h.join(who) : null;
  if (ada) {
    h.run(500);
    h.say(ada, "enablecheats");
    h.say(ada, `tp ${PLACE.x.toFixed(3)} ${(PLACE.z - 4).toFixed(3)}`);
  }
  return { h, ada };
}

const recOf = (h: Harness, e: number): EntityRecord => h.host.records.byPid.get(h.world.ents.pid[e]!)!;

/** An egg lying at the place, `span` ticks in the hatching with `left` of them to go. */
function eggOf(h: Harness, span: number, left: number, dx = 0): EntityRecord {
  const parent = recOf(h, h.host.spawnCreature("core:parasaur", PLACE.x + 30, PLACE.z + 30 + dx, 3));
  const egg = h.host.records.create(id("egg_parasaur"), "parasaur egg");
  egg.genome = parent.genome;
  egg.x = PLACE.x + dx;
  egg.z = PLACE.z + 3;
  egg.y = PLACE.y;
  egg.egg = { species: id("parasaur"), span, hatchAt: h.world.tick + left, carrier: 0 };
  h.host.death.place(egg);
  h.host.death.die(parent, 0);
  h.host.records.dirty.add(egg.pid);
  return egg;
}

/** A young parasaur at the place, whose growing takes `span` ticks with `left` of them to go. */
function youngOf(h: Harness, span: number, left: number, dx = 0): EntityRecord {
  const rec = recOf(h, h.host.spawnCreature("core:parasaur", PLACE.x + dx, PLACE.z + 8, 3));
  rec.span = span;
  rec.grown = h.world.tick + left;
  h.world.ents.setYoung(h.host.records.entOf.get(rec.pid)!, rec.span, rec.grown);
  h.host.refreshBody(rec);
  // Fed for the whole of it, so that hunger is not what this is about.
  h.host.survival.gods.add(rec.pid);
  h.host.records.dirty.add(rec.pid);
  return rec;
}

/** Run the world on by exactly one tick. */
function oneTick(h: Harness): void {
  const t = h.world.tick;
  while (h.world.tick === t) h.run(4);
  expect(h.world.tick).toBe(t + 1);
}

/** Change a setting as whoever runs the server does, and let the tick it takes effect on go by. Returns that tick. */
function change(h: Harness, name: string, value: string): number {
  expect(h.host.setSetting(name, value)).toBe("");
  oneTick(h);
  return h.world.tick;
}

test("a rule changed while the server runs: an egg and a young one are timed again from that tick, the same watched and unwatched, and each comes due on the tick that says", () => {
  /** The same egg and young one, a rule changed part way, and when each came due: with someone standing by, or nobody in the world at all. */
  const story = (watched: boolean) => {
    const { h } = world([], ["EggHatchSpeedMultiplier=10", "BabyMatureSpeedMultiplier=10"], {}, watched ? "ada" : "");
    const egg = eggOf(h, 9000, 6000);
    const young = youngOf(h, 30000, 20000, 6);
    h.host.breeding.resume();
    h.run(1000);
    // Hatching twice as fast: the egg has half of what it had left on the tick the rule changed, and its whole time is half what it was.
    const hatchWas = egg.egg!.hatchAt;
    let t = change(h, "EggHatchSpeedMultiplier", "20");
    expect([egg.egg!.hatchAt, egg.egg!.span]).toEqual([t + leftAtSpeed(hatchWas - t, 10, 20), 4500]);
    // Growing up four times as slow: the young one has four times what it had left, and is the same hundredth grown as it was.
    const grownWas = young.grown;
    const stepWas = growthStep(young.span, young.grown, h.world.tick);
    t = change(h, "BabyMatureSpeedMultiplier", "2.5");
    expect([young.grown, young.span, growthStep(young.span, young.grown, t)]).toEqual([t + (grownWas - t) * 4, 120000, stepWas]);
    // Its body says so, for whoever looks at it; and so does the egg's.
    const e = h.host.records.entOf.get(young.pid)!;
    const ee = h.host.records.entOf.get(egg.pid)!;
    expect([h.world.ents.span[e], h.world.ents.grown[e], h.world.ents.span[ee], h.world.ents.grown[ee]]).toEqual([young.span, young.grown, 4500, egg.egg!.hatchAt]);
    return { h, egg, young, at: { hatch: egg.egg!.hatchAt - h.world.tick, grown: young.grown - h.world.tick } };
  };
  const seen = story(true);
  const unseen = story(false);
  // What each has left is the same in both worlds, to the tick: nothing about it depends on being looked at.
  expect(seen.at).toEqual(unseen.at);
  for (const { h, egg, young } of [seen, unseen]) {
    // The egg hatches on the tick it says, not before and not after.
    const hatchAt = egg.egg!.hatchAt;
    const eggPid = egg.pid;
    while (h.world.tick < hatchAt - 1) oneTick(h);
    expect([h.host.records.byPid.has(eggPid), h.host.breeding.hatched]).toEqual([true, 0]);
    oneTick(h);
    expect([h.world.tick, h.host.records.byPid.has(eggPid), h.host.breeding.hatched]).toEqual([hatchAt, false, 1]);
    // Growing up hurried, to see it done: two hundred times as fast again. It is grown on the tick it then says.
    const t = change(h, "BabyMatureSpeedMultiplier", "500");
    const grown = young.grown;
    expect(grown - t).toBeLessThan(600);
    while (h.world.tick < grown - 1) oneTick(h);
    expect(young.grown).toBe(grown);
    oneTick(h);
    expect([h.world.tick, young.grown, young.span, h.host.breeding.grownUp >= 1]).toEqual([grown, 0, 0, true]);
  }
});

test("a rule changed while the server runs: a female's wait, a pair part way through, a bag and a cache lying, and the hunger of the young", () => {
  const { h, ada } = world([], [], {}, "ada");
  const me = h.host.records.byPid.get(h.client(ada!)!.pid)!;
  const set = (name: string, value: string): number => change(h, name, value);
  const own = (dx: number, female: boolean): { e: number; rec: EntityRecord } => {
    const e = h.host.spawnCreature("core:parasaur", PLACE.x + dx, PLACE.z + 4, 5);
    const rec = recOf(h, e);
    rec.genome!.female = female;
    h.host.taming.give(rec, me, 1);
    return { e, rec };
  };
  // A female who has lately laid: she waits. The rule halved, she waits half of what was left; trebled from there, three times that.
  const waiting = own(-12, true);
  waiting.rec.mateReadyAt = h.world.tick + 100001;
  let t = set("MatingIntervalMultiplier", "0.5");
  expect(waiting.rec.mateReadyAt - t).toBe(50000);
  t = set("MatingIntervalMultiplier", "1.5");
  expect(waiting.rec.mateReadyAt - t).toBe(149997);

  // A pair, a third of the way through their thirty seconds. Three times as fast, they have a third of what was left, and are as far along as they were.
  const f = own(-2, true);
  const m = own(2, false);
  for (const c of [f, m]) expect(h.host.breeding.order(c.rec, ORDER_MATE)).toBe(0);
  h.run(1000 + (MATE_TICKS / 3 / TICK_RATE) * 1000);
  expect(h.host.breeding.pairCount).toBe(1);
  const was = h.host.breeding.progress(f.rec);
  expect(was).toBeGreaterThan(0.3);
  expect(was).toBeLessThan(0.45);
  const laid = h.host.breeding.laid;
  set("MatingSpeedMultiplier", "3");
  expect(Math.abs(h.host.breeding.progress(f.rec) - was)).toBeLessThan(0.02);
  // What was left of thirty seconds was about nineteen: now about six.
  h.run(5000);
  expect(h.host.breeding.laid).toBe(laid);
  h.run(2500);
  expect(h.host.breeding.laid).toBeGreaterThan(laid);
  // A pair that begins now takes a third of the time from the start.
  set("MatingIntervalMultiplier", "0.000001");

  // A bag set down by hand lies two minutes; a cache, fifteen. Each rule lengthens its own, from where it had got to.
  h.host.items.mint(me, id("flint"), 5);
  const inv = h.host.items.inv(me);
  expect(h.host.death.drop(me, inv.item.indexOf(id("flint")), 0)).toBe(true);
  const bag = [...h.host.records.byPid.values()].find((r) => r.kind === id("bag"))!;
  const cache = h.host.death.spill(PLACE.x + 5, PLACE.y, PLACE.z, "left behind");
  h.host.items.mint(cache, id("flint"), 1);
  expect([bag.expiresAt - h.world.tick, cache.expiresAt - h.world.tick]).toEqual([BAG_TICKS, CACHE_TICKS]);
  h.run(30000);
  const bagAt = bag.expiresAt;
  const cacheAt = cache.expiresAt;
  t = set("GlobalItemDecompositionTimeMultiplier", "3");
  expect([bag.expiresAt, cache.expiresAt]).toEqual([t + (bagAt - t) * 3, cacheAt]);
  // The two for what the dead leave are one factor between them: one doubled and the other halved changes nothing.
  expect(h.host.setSetting("GlobalCorpseDecompositionTimeMultiplier", "2")).toBe("");
  set("UseCorpseLifeSpanMultiplier", "0.5");
  expect(cache.expiresAt).toBe(cacheAt);
  t = set("UseCorpseLifeSpanMultiplier", "0.25");
  expect(cache.expiresAt).toBe(t + leftAtPeriod(cacheAt - t, 1, 0.5));
  // What is set down from now on lies as long as the rules now say from the start.
  h.host.items.mint(me, id("flint"), 5);
  h.host.death.drop(me, h.host.items.inv(me).item.indexOf(id("flint")), 0);
  const next = [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag")).find((r) => r !== bag)!;
  expect([next.expiresAt - h.world.tick, h.host.death.spill(PLACE.x + 8, PLACE.y, PLACE.z, "x").expiresAt - h.world.tick]).toEqual([BAG_TICKS * 3, CACHE_TICKS / 2]);
  // The bag is gone on the tick it says, with nobody having opened it.
  const gone = bag.expiresAt;
  const bagPid = bag.pid;
  while (h.world.tick < gone - 1) h.run(33);
  expect(h.host.records.byPid.has(bagPid)).toBe(true);
  h.run(100);
  expect(h.host.records.byPid.has(bagPid)).toBe(false);

  // The young hunger by a rule of their own, which may change while they grow: halved, they eat half as fast from that tick.
  const baby = recOf(h, h.host.spawnCreature("core:parasaur", PLACE.x + 12, PLACE.z + 8, 3));
  baby.span = 60000;
  baby.grown = h.world.tick + 60000;
  h.world.ents.setYoung(h.host.records.entOf.get(baby.pid)!, baby.span, baby.grown);
  h.host.refreshBody(baby);
  const grownUp = own(16, true);
  const rate = baby.vitals!.rate[V_FOOD]!;
  const other = grownUp.rec.vitals!.rate[V_FOOD]!;
  set("BabyFoodConsumptionSpeedMultiplier", "0.5");
  expect([Math.round((baby.vitals!.rate[V_FOOD]! / rate) * 100) / 100, grownUp.rec.vitals!.rate[V_FOOD]]).toEqual([0.5, other]);
  expect(h.host.items.audit()).toEqual([]);
});

test("the rules that are read as a thing begins: how soon a node grows back, how fast a body hungers, thirsts, mends and wakes, and how much oxygen quickens a swimmer", () => {
  const plain = world([], [], {}, "ada");
  const tuned = world(
    ["ResourcesRespawnPeriodMultiplier=0.25", "PlayerCharacterFoodDrainMultiplier=2", "PlayerCharacterWaterDrainMultiplier=3", "PlayerCharacterHealthRecoveryMultiplier=4", "DinoCharacterFoodDrainMultiplier=5", "DinoCharacterHealthRecoveryMultiplier=6", "OxygenSwimSpeedStatMultiplier=3"],
    ["WildDinoCharacterFoodDrainMultiplier=0.5", "TamedDinoCharacterFoodDrainMultiplier=2", "WildDinoTorporDrainMultiplier=7", "TamedDinoTorporDrainMultiplier=0.5"],
    {},
    "ada",
  );
  /** A survivor, a wild creature and a tamed one, each hurt a little and with some torpor on it: the rates of each of their vitals. */
  const rates = (m: ReturnType<typeof world>) => {
    const { h, ada } = m;
    const me = h.host.records.byPid.get(h.client(ada!)!.pid)!;
    const wild = recOf(h, h.host.spawnCreature("core:parasaur", PLACE.x + 10, PLACE.z + 10, 6));
    const tame = recOf(h, h.host.spawnCreature("core:parasaur", PLACE.x - 10, PLACE.z + 10, 6));
    h.host.taming.give(tame, me, 1);
    for (const r of [me, wild, tame]) {
      h.host.survival.add(r, V_HEALTH, -5);
      h.host.survival.add(r, V_TORPOR, 20);
    }
    const of = (r: EntityRecord): number[] => [V_FOOD, V_WATER, V_HEALTH, V_TORPOR].map((i) => r.vitals!.rate[i]!);
    return { me: of(me), wild: of(wild), tame: of(tame), swim: h.world.ents.swimQ[h.host.records.entOf.get(wild.pid)!]! };
  };
  const a = rates(plain);
  const b = rates(tuned);
  // Rates are whole numbers of millionths a tick, so a ratio of two of them is the rule to within a part in a hundred.
  const ratio = (x: number[], y: number[]): number[] => x.map((v, i) => (y[i] === 0 ? v : Math.round((v / y[i]!) * 10) / 10));
  // A survivor: food by 2, water by 3, mending by 4, and torpor as it was (ARK has no rule for a survivor's).
  expect(ratio(b.me, a.me)).toEqual([2, 3, 4, 1]);
  // A wild creature: food by 5 and by a half; mending by 6; torpor shaken off seven times as fast.
  expect(ratio(b.wild, a.wild)).toEqual([2.5, 0, 6, 7]);
  // A tamed one: food by 5 and by 2; mending by 6; torpor half as fast.
  expect(ratio(b.tame, a.tame)).toEqual([10, 0, 6, 0.5]);
  // A level-6 parasaur has some of its levels in oxygen, or none: either way the gain of them is trebled.
  expect(b.swim - 1000).toBe((a.swim - 1000) * 3);

  // A tree used up grows back in two game hours; in a quarter of that there.
  const regrow = (m: ReturnType<typeof world>): number => {
    const { h, ada } = m;
    const tree = nodesOf(h, "core:tree", 256, 256)[0]!;
    const table = h.host.harvest!.field.store.chunks[tree.chunk]!;
    h.say(ada!, `tp ${(tree.x + 1.2).toFixed(3)} ${tree.z.toFixed(3)}`);
    while (table.kind[tree.index] !== 0) h.host.harvest!.strike(h.client(ada!)!, tree.chunk, tree.index);
    const used = h.world.tick;
    // She goes away, and it is looked for every so often until it is back.
    h.say(ada!, "tp 300 300");
    while (table.kind[tree.index] === 0 && h.world.tick < used + 3 * GAME_HOUR_TICKS) h.run(1000);
    return Math.round((h.world.tick - used) / 30) * 30;
  };
  expect([regrow(plain), regrow(tuned)]).toEqual([2 * GAME_HOUR_TICKS, GAME_HOUR_TICKS / 2]);
});

test("a world saved under one set of files and loaded under another is brought to the new ones once: eggs, young, waits, what lies, what spoils, what burns, what grows back, and the rates of bodies", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-retime-"));
  const dbPath = join(dir, "world.db");
  const OLD: [string[], string[]] = [["DinoCharacterFoodDrainMultiplier=1"], ["EggHatchSpeedMultiplier=10", "BabyMatureSpeedMultiplier=10", "MatingIntervalMultiplier=1"]];
  const NEW: [string[], string[]] = [
    ["DinoCharacterFoodDrainMultiplier=3", "ResourcesRespawnPeriodMultiplier=0.25", "PlayerCharacterFoodDrainMultiplier=2"],
    ["EggHatchSpeedMultiplier=20", "BabyMatureSpeedMultiplier=5", "MatingIntervalMultiplier=3", "GlobalSpoilingTimeMultiplier=2", "FuelConsumptionIntervalMultiplier=0.5", "GlobalItemDecompositionTimeMultiplier=4", "GlobalCorpseDecompositionTimeMultiplier=0.5"],
  ];
  let { h, ada } = world(OLD[0], OLD[1], { dbPath }, "ada");
  const me = h.host.records.byPid.get(h.client(ada!)!.pid)!;
  // An egg and a young one with a long way to go; a wild creature; and a female of hers who has lately laid.
  const egg = eggOf(h, 90000, 60000);
  const young = youngOf(h, 300000, 200000, 6);
  const wild = recOf(h, h.host.spawnCreature("core:parasaur", PLACE.x + 14, PLACE.z + 14, 4));
  const waiting = recOf(h, h.host.spawnCreature("core:parasaur", PLACE.x - 14, PLACE.z + 14, 4));
  h.host.taming.give(waiting, me, 1);
  waiting.mateReadyAt = h.world.tick + 90000;
  // Two boxes of cooked meat, which keeps two game hours a piece.
  const U = 16;
  const box = (dx: number): EntityRecord => {
    const ref = h.world.structs.add(id("storage_box"), PLACE.x + dx, Math.ceil(PLACE.y * U) / U + 0.3125, PLACE.z - 8, 0, me.team, 500);
    const state = h.host.fixtures.ensure(ref);
    h.host.items.mint(state, id("meat_cooked"), 20);
    return state;
  };
  const opened = box(-2);
  const shut = box(2);
  h.host.breeding.resume();
  // Nearly two and a half game hours on, a piece of meat has spoiled in each box and the next is part way.
  h.run(((2.5 * GAME_HOUR_TICKS) / TICK_RATE) * 1000 - 62000);
  // Then, a minute before the world is stopped: a bag is set down and a cache left; a fire is lit with eight pieces of wood
  // on it, half a minute a piece; and a tree is used up.
  h.host.items.mint(me, id("flint"), 5);
  expect(h.host.death.drop(me, h.host.items.inv(me).item.indexOf(id("flint")), 0)).toBe(true);
  const bag = [...h.host.records.byPid.values()].find((r) => r.kind === id("bag"))!;
  const cache = h.host.death.spill(PLACE.x + 5, PLACE.y, PLACE.z, "left behind");
  h.host.items.mint(cache, id("flint"), 1);
  const fireRef = h.world.structs.add(id("campfire"), PLACE.x + 8, Math.ceil(PLACE.y * U) / U + 0.25, PLACE.z - 8, 0, me.team, 500);
  const fire = h.host.fixtures.ensure(fireRef);
  h.host.items.mint(fire, id("wood"), 8);
  expect(h.host.stations.toggle(fireRef)).toBe(0);
  const tree = nodesOf(h, "core:tree", 256, 256)[0]!;
  h.say(ada!, `tp ${(tree.x + 1.2).toFixed(3)} ${tree.z.toFixed(3)}`);
  while (h.host.harvest!.field.store.chunks[tree.chunk]!.kind[tree.index] !== 0) h.host.harvest!.strike(h.client(ada!)!, tree.chunk, tree.index);
  h.say(ada!, `tp ${PLACE.x.toFixed(3)} ${(PLACE.z - 4).toFixed(3)}`);
  h.run(60000);
  // One box is looked into, the other not. The young one, which has not been fed since it was made, is.
  h.host.items.inv(opened);
  const meat = (r: EntityRecord): number[] => {
    const inv = r.inv!;
    const s = inv.item.indexOf(id("meat_cooked"));
    return [inv.count[s]!, inv.spoilAt[s]!];
  };
  expect([meat(opened)[0], meat(shut)[0]]).toEqual([19, 20]);
  h.host.survival.gods.delete(young.pid);
  h.host.survival.refill(young);
  h.host.survival.touch(young);
  h.run(100);
  const T = h.world.tick;
  const pids = { egg: egg.pid, young: young.pid, wild: wild.pid, waiting: waiting.pid, bag: bag.pid, cache: cache.pid, opened: opened.pid, shut: shut.pid, fire: fire.pid, me: me.pid };
  const was = {
    hatch: egg.egg!.hatchAt - T,
    eggSpan: egg.egg!.span,
    grown: young.grown - T,
    step: growthStep(young.span, young.grown, T),
    wait: waiting.mateReadyAt - T,
    bag: bag.expiresAt - T,
    cache: cache.expiresAt - T,
    top: meat(opened)[1]! - T,
    wildFood: wild.vitals!.rate[V_FOOD]!,
    wildHas: wild.vitals!.at(V_FOOD, T),
    youngFood: young.vitals!.rate[V_FOOD]!,
  };
  // Where the fire will have got to at T, worked out by looking at it there in a copy of this world that nobody keeps.
  const under = h.host.rules;
  h.host.shutdown();

  /** The world, loaded: every timer as it now stands, from the tick it was loaded on. */
  const load = (server: string[], mode: string[], extra: HostOptions = {}) => {
    const h2 = new Harness({}, 1, 60, { dev: true, dbPath, config: rulesOf(server, mode), ...extra });
    const get = (pid: number): EntityRecord => h2.host.records.byPid.get(pid)!;
    const t = h2.world.tick;
    const node = h2.host.harvest!.regrowsAt(tree.chunk, tree.index);
    return {
      h: h2,
      get,
      t,
      now: {
        hatch: get(pids.egg).egg!.hatchAt - t,
        eggSpan: get(pids.egg).egg!.span,
        grown: get(pids.young).grown - t,
        step: growthStep(get(pids.young).span, get(pids.young).grown, t),
        wait: get(pids.waiting).mateReadyAt - t,
        bag: get(pids.bag).expiresAt - t,
        cache: get(pids.cache).expiresAt - t,
        opened: meat(get(pids.opened)).map((v, i) => (i === 1 ? v - t : v)),
        shut: meat(get(pids.shut)).map((v, i) => (i === 1 ? v - t : v)),
        fuel: get(pids.fire).fire?.fuel ?? -1,
        wood: get(pids.fire).inv!.total(id("wood")),
        node: node - t,
        wildFood: get(pids.wild).vitals!.rate[V_FOOD]!,
        wildHas: get(pids.wild).vitals!.at(V_FOOD, t),
        youngFood: get(pids.young).vitals!.rate[V_FOOD]!,
      },
    };
  };

  // Loaded under the files it was saved under: nothing has moved.
  const same = load(OLD[0], OLD[1], { config: under, commitEvery: 1e9 });
  // (The fire, looked at there: three pieces of wood taken in its minute, and the third part burned.)
  same.h.host.stations.tend(same.get(pids.fire));
  same.now.fuel = same.get(pids.fire).fire!.fuel;
  same.now.wood = same.get(pids.fire).inv!.total(id("wood"));
  expect([same.t, same.now.hatch, same.now.eggSpan, same.now.grown, same.now.wait, same.now.bag, same.now.cache, same.now.wildFood, same.now.youngFood]).toEqual([T, was.hatch, was.eggSpan, was.grown, was.wait, was.bag, was.cache, was.wildFood, was.youngFood]);
  // The box that was looked into and the one that was not come to the same once anyone looks: nineteen pieces, the top one as far gone.
  expect(same.now.opened).toEqual([19, was.top]);
  const fireWas = { fuel: same.now.fuel, wood: same.now.wood, node: same.now.node };
  expect([fireWas.wood, fireWas.fuel > 0, fireWas.fuel < 30 * TICK_RATE, fireWas.node > 0]).toEqual([5, true, true, true]);
  // (Left as it was found: nothing of that look was written.)

  // Loaded under the new files. Each thing has left what it had left, by its own rule.
  const first = load(NEW[0], NEW[1], { commitEvery: 1e9 });
  const want = {
    hatch: leftAtSpeed(was.hatch, 10, 20),
    eggSpan: 45000,
    grown: was.grown * 2,
    step: was.step,
    wait: leftAtPeriod(was.wait, 1, 3),
    bag: leftAtPeriod(was.bag, 1, 4),
    cache: leftAtPeriod(was.cache, 1, 0.5),
    // Spoiled as it would have under the old files, in both boxes alike; then the piece on top keeps twice what it had left.
    opened: [19, was.top * 2],
    shut: [19, was.top * 2],
    // Burned as it would have under the old files; then the piece burning has half of what it had left, and the pile is as it was.
    fuel: leftAtPeriod(fireWas.fuel, 1, 0.5),
    wood: fireWas.wood,
    node: leftAtPeriod(fireWas.node, 1, 0.25),
    // A wild creature hungers three times as fast from this tick, with what it had; a young one likewise. (Rates are whole
    // numbers of millionths a tick: three times the rule, to the nearest of them.)
    wildFood: 3,
    wildHas: was.wildHas,
    youngFood: 3,
  };
  const as = (now: typeof first.now) => ({ ...now, wildFood: Math.round((now.wildFood / was.wildFood) * 10) / 10, youngFood: Math.round((now.youngFood / was.youngFood) * 10) / 10 });
  expect(as(first.now)).toEqual(want);
  expect([first.t, first.h.host.loadedUnder!.EggHatchSpeedMultiplier, first.h.host.loadedUnder!.GlobalSpoilingTimeMultiplier ?? 1]).toEqual([T, 10, 1]);
  const ye = first.h.host.records.entOf.get(pids.young)!;
  expect([first.h.world.ents.span[ye], first.h.world.ents.grown[ye]]).toEqual([first.get(pids.young).span, first.get(pids.young).grown]);

  // That server dies before it has written anything. Started again, it is brought over the same way: not twice, and not differently.
  const again = load(NEW[0], NEW[1]);
  expect(as(again.now)).toEqual(want);
  expect(again.now).toEqual(first.now);
  expect(again.h.host.items.audit()).toEqual([]);
  // This one lives: a few seconds on it has written what it made of the save, and what it made it under.
  again.h.run(3000);
  const later = again.h.world.tick;
  const eggAt = again.get(pids.egg).egg!.hatchAt;
  const woodAt = again.get(pids.fire).inv!.total(id("wood"));
  again.h.host.shutdown();
  // Started a third time under the same files, nothing is brought over: it is already there.
  const third = load(NEW[0], NEW[1]);
  expect([third.t, third.get(pids.egg).egg!.hatchAt, third.now.eggSpan, third.now.wait, third.now.bag, third.now.shut, third.now.wildFood, third.get(pids.fire).inv!.total(id("wood")) <= woodAt]).toEqual([later, eggAt, 45000, want.wait - (later - T), want.bag - (later - T), [19, want.shut[1]! - (later - T)], first.now.wildFood, true]);
  expect(third.h.host.loadedUnder!.EggHatchSpeedMultiplier).toBe(20);

  // And each comes due when it now says, with nobody near: the egg hatches, the tree grows back, the fire burns its pile at the new rate.
  const { h: h3 } = third;
  const table = h3.host.harvest!.field.store.chunks[tree.chunk];
  h3.run(((want.node - (later - T) + 60) / TICK_RATE) * 1000);
  expect([h3.host.harvest!.regrowsAt(tree.chunk, tree.index), table ? table.kind[tree.index] !== 0 : true]).toEqual([0, true]);
  while (h3.world.tick < eggAt + 30) h3.run(1000);
  expect([h3.host.records.byPid.has(pids.egg), h3.host.breeding.hatched]).toEqual([false, 1]);
  // Five pieces of wood, a quarter of a minute each now, and what was left of the one burning: out within two minutes of the load.
  h3.run(120000);
  expect([third.get(pids.fire).fire, h3.host.stations.wentOut]).toEqual([null, 1]);
  expect(h3.host.items.audit()).toEqual([]);
  h3.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
  void ada;
});

test("the live file is read again as often as the server says, and at once when an admin asks; what it changes is timed again like any change", () => {
  let text = "EggHatchSpeedMultiplier=4\n";
  const config = () => loadConfig({ gus: "[ServerSettings]\nAutoSavePeriodMinutes=0.5\n", game: "[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=2\n", live: text }, ["-UseDynamicConfig"]).rules;
  // At the start the live file is over the two files.
  const h = new Harness({}, 1, 60, { dev: true, config: config(), live: () => text });
  flatGround(h, 40, 40);
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const rules = h.host.rules;
  expect([rules.num("EggHatchSpeedMultiplier"), rules.num("AutoSavePeriodMinutes")]).toEqual([4, 0.5]);
  const egg = eggOf(h, 9000, 6000);
  h.host.breeding.resume();
  // Whoever runs the server writes another number into the file. Nothing happens until the server looks again: within half a minute.
  text = "EggHatchSpeedMultiplier=8\nServerPassword=nope\nGravity=2\n";
  h.run(5000);
  expect([rules.num("EggHatchSpeedMultiplier"), egg.egg!.span]).toEqual([4, 9000]);
  const left = egg.egg!.hatchAt - h.world.tick;
  h.run(26000);
  expect([rules.num("EggHatchSpeedMultiplier"), rules.sourceOf({ name: "EggHatchSpeedMultiplier" } as never), egg.egg!.span, rules.text("ServerPassword")]).toEqual([8, "live file", 4500, ""]);
  expect(Math.abs(egg.egg!.hatchAt - h.world.tick - (left - 26 * TICK_RATE) / 2)).toBeLessThanOrEqual(15 * TICK_RATE);
  // An admin does not wait: ARK's command reads it now, and says what came of it.
  text = "EggHatchSpeedMultiplier=16\nServerPassword=nope\n";
  expect(h.say(ada, "ForceUpdateDynamicConfig")).toEqual(["DynamicConfig.ini read again: 1 applied, 0 not yet effective, 0 of no meaning here, 0 unknown, 1 refused", "  applied   EggHatchSpeedMultiplier=16  (DynamicConfig.ini:1)", "  refused   ServerPassword  (DynamicConfig.ini:2): is read at start only"]);
  expect([rules.num("EggHatchSpeedMultiplier"), egg.egg!.span]).toEqual([16, 2250]);
  // What an admin set at the console is stronger than the file, and stays when the file is read again.
  h.say(ada, "setting EggHatchSpeedMultiplier 32");
  h.say(ada, "ForceUpdateDynamicConfig");
  expect(rules.num("EggHatchSpeedMultiplier")).toBe(32);
  // The file gone: said, and nothing changes.
  const none = new Harness({}, 1, 60, { dev: true, config: config(), live: () => null });
  expect(none.host.readLive()).toEqual(["there is no DynamicConfig.ini to read"]);
  // A server not started with the flag does not read one, however it is asked.
  const off = new Harness({}, 1, 60, { dev: true, config: loadConfig({ live: "EggHatchSpeedMultiplier=9\n" }).rules, live: () => "EggHatchSpeedMultiplier=9\n" });
  expect([off.host.rules.num("EggHatchSpeedMultiplier"), off.host.readLive()]).toEqual([1, ["the live file is not in use: the server was not started with -UseDynamicConfig"]]);
  off.run(40000);
  expect(off.host.rules.num("EggHatchSpeedMultiplier")).toBe(1);
});
