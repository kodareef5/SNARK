// What using an item does (server/use.ts): stats at once and over time, buffs given, the water skin drunk from and filled,
// and what spoils into something (server/items.ts). The books balance throughout.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { Items } from "../../server/items.ts";
import { Records } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { Use } from "../../server/use.ts";
import type { ServerWorld } from "../../server/world.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { CMD_USE, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { MODE_SWIM, STAMINA_UNITS } from "../../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_TORPOR, V_WATER } from "../../shared/sim/vitals.ts";
import { PROVING_POOL, PROVING_SEA_LEVEL, PROVING_SPAWN } from "../../shared/world/proving.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-use-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A brew that mends over time and quickens, and a root that tires and drowses: what a later catalogue will have.
const TEST_CONTENT: readonly Def[] = [
  { type: "buff", id: "test:quick", label: "Quick", color: 12, seconds: 10, speed: 1.25, good: true },
  { type: "item", class: "consumable", id: "test:brew", stack: 10, weight: 1, use: { adds: [{ stat: "health", amount: 40, seconds: 5 }], buffs: ["test:quick"] }, color: 9 },
  { type: "item", class: "consumable", id: "test:root", stack: 10, weight: 0.1, eat: { food: 3 }, use: { adds: [{ stat: "stamina", amount: -30 }, { stat: "torpidity", amount: 20, seconds: 4 }] }, color: 9 },
];
let tested: Registry | null = null;
function testRegistry(): Registry {
  if (tested) return tested;
  const { registry, errors } = compileContent([...CORE_CONTENT, ...TEST_CONTENT]);
  if (!registry) throw new Error(errors.join("\n"));
  return (tested = registry);
}

function setup(reg: Registry = coreRegistry(), host = {}) {
  const h = new Harness({}, 1, 30, { dev: true, ...host }, reg);
  const s = h.join("ada");
  h.run(500);
  expect(h.say(s, "enablecheats")).toEqual(["cheats enabled"]);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const id = (name: string) => h.reg.index.get(name)!;
  const codes = new Map<number, number>();
  s.onResult = (seq, code) => void codes.set(seq, code);
  /** Uses what is in `slot`, waits 150 ms for the answer and returns it. */
  const use = (slot: number, item: number): number => {
    const seq = s.command(CMD_USE, (w: BitWriter) => (w.varint(slot), w.u16(item)));
    h.run(150);
    return codes.get(seq) ?? -1;
  };
  return { h, s, rec, id, use, items: h.host.items, sv: h.host.survival, ents: h.world.ents, e: h.ent(s) };
}
const told = (s: ClientSession, words: string): boolean => s.log.some((l) => l.text.includes(words));

test("the water skin is made empty, is filled standing in shallow water, gives its 100 water in one drink, and is kept empty", () => {
  const { h, s, rec, id, use, items, sv, ents, e } = setup();
  const skin = id("core:waterskin");
  expect(items.mint(rec, skin, 1)).toBe(1);
  const inv = items.inv(rec);
  const slot = inv.item.indexOf(skin);
  expect(inv.dur[slot]).toBe(0);

  // Empty, on dry ground: refused, and she is told why.
  sv.add(rec, V_WATER, -90);
  const thirsty = sv.value(rec, V_WATER);
  h.run(200);
  expect(use(slot, skin)).toBe(RESULT_INVALID);
  h.run(200);
  expect(told(s, "is empty")).toBe(true);
  expect(sv.value(rec, V_WATER)).toBeLessThanOrEqual(thirsty);

  // Out in the middle of the pool she swims, and a skin cannot be filled swimming.
  h.say(s, `tp ${PROVING_POOL.x} ${PROVING_POOL.z}`);
  h.run(2000);
  expect(ents.mode[e]).toBe(MODE_SWIM);
  expect(use(slot, skin)).toBe(RESULT_INVALID);
  h.run(100);
  expect(inv.dur[slot]).toBe(0);

  // At its edge she stands in water to her shins, and fills it.
  const hf = h.world.hf;
  let x = PROVING_POOL.x;
  while (x < PROVING_POOL.x + 60 && !(hf.heightAt(x, PROVING_POOL.z) > PROVING_SEA_LEVEL - 0.6 && hf.heightAt(x, PROVING_POOL.z) < PROVING_SEA_LEVEL - 0.15)) x += 0.25;
  expect(x).toBeLessThan(PROVING_POOL.x + 60);
  h.say(s, `tp ${x} ${PROVING_POOL.z}`);
  h.run(1000);
  expect([ents.mode[e] !== MODE_SWIM, ents.y[e]! < PROVING_SEA_LEVEL]).toEqual([true, true]);
  expect(use(slot, skin)).toBe(RESULT_OK);
  h.run(200);
  expect([inv.dur[slot], s.inventory!.dur[slot], inv.total(skin)]).toEqual([100, 100, 1]);

  // Back on dry ground, one drink empties it, and she has what it held.
  h.say(s, `tp ${PROVING_SPAWN.x} ${PROVING_SPAWN.z}`);
  h.run(500);
  const before = sv.value(rec, V_WATER);
  expect(use(slot, skin)).toBe(RESULT_OK);
  h.run(200);
  expect(sv.value(rec, V_WATER)).toBeCloseTo(Math.min(before + 100, rec.vitals!.max[V_WATER]! / 1e6), 1);
  expect([inv.dur[slot], s.inventory!.dur[slot], inv.item[slot], inv.total(skin)]).toEqual([0, 0, skin, 1]);
  expect(use(slot, skin)).toBe(RESULT_INVALID);
  h.run(100);
  // Kept, not burned: the ledger never saw it go.
  expect([items.minted[skin], items.burned[skin]]).toEqual([1, 0]);
  expect(items.audit()).toEqual([]);
});

test("a use burns one, gives its buffs, mends over time on one instance that a second use runs after, and changes stamina and torpor", () => {
  const { h, s, rec, id, use, items, sv, ents, e } = setup(testRegistry());
  const brew = id("test:brew");
  const root = id("test:root");
  const mending = id("core:mending");
  items.mint(rec, brew, 3);
  items.mint(rec, root, 2);
  const inv = items.inv(rec);
  sv.hurt(rec, 90, 0);
  const hurt = sv.value(rec, V_HEALTH);
  const from = h.world.tick;
  h.run(200);

  expect(use(inv.item.indexOf(brew), brew)).toBe(RESULT_OK);
  h.run(100);
  expect(inv.total(brew)).toBe(2);
  // Hurt so badly she is injured too.
  expect(rec.buffs.map((b) => b.buff).sort()).toEqual([id("test:quick"), mending, id("core:injured")].sort());
  expect(rec.buffs.find((b) => b.buff === mending)!.health).toBeCloseTo(8, 5);
  // The client is told of both.
  expect(s.buffs.map((b) => b.buff).sort()).toEqual([id("test:quick"), mending, id("core:injured")].sort());

  // A second brew, a second in: what the first still had to give runs on, and the second follows it.
  h.run(900);
  const healed = sv.value(rec, V_HEALTH) - hurt;
  const on = rec.buffs.find((b) => b.buff === mending)!;
  const left = (on.until - h.world.tick) / TICK_RATE;
  expect(use(inv.item.indexOf(brew), brew)).toBe(RESULT_OK);
  // Both are on the one instance: what was left and the new forty, over what time was left and five more seconds.
  expect(rec.buffs.filter((b) => b.buff === mending).length).toBe(1);
  expect(rec.buffs.find((b) => b.buff === mending)!.health).toBeCloseTo((8 * left + 40) / (left + 5), 1);
  h.run(15000);
  expect(rec.buffs.some((b) => b.buff === mending)).toBe(false);
  // Eighty from the two, and the 0.2 a second a body mends of itself.
  expect(sv.value(rec, V_HEALTH) - hurt).toBeCloseTo(80 + (0.2 * (h.world.tick - from)) / TICK_RATE, 0);
  expect(healed).toBeGreaterThan(8);

  // The root is eaten for its food and used for the rest: stamina at once, torpor over four seconds.
  sv.add(rec, V_FOOD, -20);
  const food = sv.value(rec, V_FOOD);
  const stamina = ents.stamina[e]!;
  expect(use(inv.item.indexOf(root), root)).toBe(RESULT_OK);
  h.run(100);
  expect(sv.value(rec, V_FOOD)).toBeCloseTo(food + 3, 0);
  // Thirty, less what she got back in the quarter second the answer took.
  expect(stamina - ents.stamina[e]!).toBeGreaterThan(25 * STAMINA_UNITS);
  h.run(4000);
  expect(sv.value(rec, V_TORPOR)).toBeGreaterThan(15);
  expect(inv.total(root)).toBe(1);
  expect(items.audit()).toEqual([]);
});

test("spoiled meat is eaten for a little food and costs health at once", () => {
  const { h, rec, id, use, items, sv } = setup();
  const spoiled = id("core:spoiled_meat");
  items.mint(rec, spoiled, 2);
  sv.add(rec, V_FOOD, -50);
  const [food, health] = [sv.value(rec, V_FOOD), sv.value(rec, V_HEALTH)];
  h.run(200);
  expect(use(items.inv(rec).item.indexOf(spoiled), spoiled)).toBe(RESULT_OK);
  h.run(100);
  expect(sv.value(rec, V_FOOD)).toBeCloseTo(food + 2.5, 0);
  expect(health - sv.value(rec, V_HEALTH)).toBeCloseTo(12, 0);
  expect(items.audit()).toEqual([]);
});

test("raw and cooked meat spoil into spoiled meat through the ledger, which the client sees, and spoiled meat spoils away", () => {
  // A hundredth of the spoil times: raw meat keeps 6 seconds, cooked 12, spoiled 36.
  const config = loadConfig({ game: "[/script/shootergame.shootergamemode]\nGlobalSpoilingTimeMultiplier=0.01\n" }).rules;
  const { h, s, rec, id, items } = setup(coreRegistry(), { config });
  const [meat, cooked, spoiled] = [id("core:meat"), id("core:meat_cooked"), id("core:spoiled_meat")];
  const tuned = h.world.reg;
  expect([tuned.spoilTicks[meat], tuned.spoilTicks[cooked], tuned.spoilTicks[spoiled]]).toEqual([6 * TICK_RATE, 12 * TICK_RATE, 36 * TICK_RATE]);
  items.mint(rec, meat, 2);
  items.mint(rec, cooked, 1);
  const total = (item: number): number => s.inventory?.total(item) ?? 0;
  h.run(6500);
  expect([total(meat), total(cooked), total(spoiled)]).toEqual([1, 1, 1]);
  expect(items.audit()).toEqual([]);
  h.run(6000);
  expect([total(meat), total(cooked), total(spoiled)]).toEqual([0, 0, 3]);
  expect([items.minted[spoiled], items.burned[meat], items.burned[cooked]]).toEqual([3, 2, 1]);
  expect(items.audit()).toEqual([]);
  // The first spoiled at 6 s and the stack is as old as it: one goes at 42 s, 78 s and 114 s.
  h.run(30000);
  expect(total(spoiled)).toBe(2);
  h.run(80000);
  expect([total(spoiled), items.inv(rec).total(spoiled), items.burned[spoiled]]).toEqual([0, 0, 3]);
  expect(items.audit()).toEqual([]);
});

// The books and the stacks without a world around them: a world's tick and a registry are all Items reads.
function bare() {
  const reg = coreRegistry();
  const world = { reg, tick: 1 } as unknown as ServerWorld;
  const records = new Records(1);
  const items = new Items(world, records);
  const rec = records.create(reg.index.get("core:survivor")!);
  return { reg, world, items, rec, id: (name: string) => reg.index.get(name)! };
}
const contents = (items: Items, rec: ReturnType<typeof bare>["rec"]): string[] => {
  const inv = items.inv(rec);
  const out: string[] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) out.push(`${inv.item[s]}x${inv.count[s]}@${inv.spoilAt[s]}`);
  return out.sort();
};

test("one settle after a long time leaves what a settle every tick would, spoiled meat and all, and a full bag loses the spoiled meat", () => {
  const a = bare();
  const b = bare();
  for (const { items, rec, id } of [a, b]) {
    items.mint(rec, id("core:meat"), 3);
    items.mint(rec, id("core:meat_cooked"), 2);
    items.mint(rec, id("core:berry"), 4);
  }
  const end = 1 + 5000 * TICK_RATE;
  for (let t = 2; t <= end; t++) {
    a.world.tick = t;
    a.items.inv(a.rec);
  }
  b.world.tick = end;
  expect(contents(b.items, b.rec)).toEqual(contents(a.items, a.rec));
  // At 5000 s: the three raw went bad at 600, 1200 and 1800 s and the cooked at 1200 and 2400, and of the five spoiled one
  // went at 4200 s.
  const spoiled = a.id("core:spoiled_meat");
  expect([a.items.inv(a.rec).total(spoiled), a.items.minted[spoiled], a.items.burned[spoiled]]).toEqual([4, 5, 1]);
  expect([a.items.audit(), b.items.audit()]).toEqual([[], []]);

  // A bag with no room left: a piece of meat spoils and nothing takes its place.
  const c = bare();
  const [stone, meat] = [c.id("core:stone"), c.id("core:meat")];
  const inv = c.items.inv(c.rec);
  c.items.mint(c.rec, meat, 2);
  c.items.mint(c.rec, stone, (inv.bag - 1) * 100);
  expect(inv.free()).toBe(-1);
  c.world.tick = 1 + 700 * TICK_RATE;
  expect([c.items.inv(c.rec).total(meat), c.items.inv(c.rec).total(spoiled), c.items.minted[spoiled], c.items.burned[meat]]).toEqual([1, 0, 0, 1]);
  expect(c.items.audit()).toEqual([]);
});

test("what a use still had to mend is saved with its buff, and goes on after a restart", () => {
  const db = join(dir, "mending.db");
  const reg = testRegistry();
  let h = new Harness({}, 1, 30, { dbPath: db, dev: true }, reg);
  const s = h.join("ada");
  h.run(500);
  const pid = h.client(s)!.pid;
  let rec = h.host.records.byPid.get(pid)!;
  const host = h.host;
  const use = new Use({ world: host.world, game: host.game, records: host.records, items: host.items, survival: host.survival, buffs: host.buffs });
  use.apply(rec, { adds: [{ stat: "health", amount: 30, seconds: 10 }] });
  const until = rec.buffs[0]!.until;
  h.run(300);
  h.host.shutdown();

  h = new Harness({}, 1, 30, { dbPath: db, dev: true }, reg);
  rec = h.host.records.byPid.get(pid)!;
  expect(rec.buffs).toEqual([{ buff: reg.index.get("core:mending")!, until, by: 0, torpor: 0, health: 3 }]);
  h.host.shutdown();
});

test("the water skin and spoiled meat are ARK's at 1x (Waterskin, Water Jar, Spoiled Meat, Spoilage, read 2026-11-15)", () => {
  const reg = coreRegistry();
  const at = (name: string): number => reg.index.get(`core:${name}`)!;
  const skin = reg.defs[at("waterskin")] as ItemDef;
  expect([skin.stack, skin.weight, skin.use?.holds, skin.craft?.needs, skin.craft?.xp]).toEqual([1, 0.3, { water: 100, each: 100 }, [{ item: "core:hide", count: 4 }, { item: "core:fiber", count: 12 }], 2]);
  // A vessel wears no other way, so it is made with its water at 0: empty.
  expect(reg.uses[at("waterskin")]).toBe(0);
  const spoiled = at("spoiled_meat");
  expect([reg.stack[spoiled], reg.weight[spoiled]! > 0.099 && reg.weight[spoiled]! < 0.101, reg.spoilTicks[spoiled]! / TICK_RATE]).toEqual([100, true, 3600]);
  expect([reg.spoilsInto[at("meat")], reg.spoilsInto[at("meat_cooked")], reg.spoilsInto[spoiled], reg.spoilsInto[at("berry")]]).toEqual([spoiled, spoiled, 0, 0]);
});

test("a use facet is checked: what it may change, at once and over time, and a vessel's shape", () => {
  const faults = (d: Def): string[] => compileContent([...CORE_CONTENT, d]).errors;
  const item = (more: Record<string, unknown>): Def => ({ type: "item", class: "consumable", id: "test:x", stack: 10, color: 1, ...more }) as Def;
  expect(faults(item({ use: { adds: [{ stat: "food", amount: 5, seconds: 3 }] } }))).toEqual(['test:x: use.adds may change health, torpidity over time, not "food"']);
  expect(faults(item({ use: { adds: [{ stat: "melee", amount: 5 }] } }))).toEqual(['test:x: use.adds may change health, stamina, oxygen, food, water, torpidity, not "melee"']);
  expect(faults(item({ use: { adds: [{ stat: "health", amount: -5, seconds: 3 }] } }))).toEqual(["test:x: use.adds amount must be a number other than 0, and above 0 over time"]);
  expect(faults(item({ use: { holds: { water: 100, each: 50 } } }))).toEqual(["test:x: a vessel stacks to 1, wears no durability of its own, and is drunk from, not eaten"]);
  expect(faults(item({ stack: 1, use: { holds: { water: 100, each: 150 } } }))).toEqual(["test:x: use.holds.each must be in (0, 100], got 150"]);
  expect(faults(item({ eat: { food: 1 }, spoilsInto: "core:spoiled_meat" }))).toEqual(["test:x: spoilsInto names another item, and only something that spoils has it"]);
  expect(faults(item({ use: { buffs: ["core:stone"] } }))).toEqual(['test:x: "core:stone" is not a buff']);
});
