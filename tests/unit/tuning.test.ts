// deriveRegistry runs the same on the server and every client. It is total, so any tuning gives content that compiles.

import { expect, test } from "bun:test";
import type { EngramDef, ItemDef, LevelsDef, NodeDef, SpeciesDef } from "../../shared/content/defs.ts";
import { STAMINA_DEFAULT, type Registry } from "../../shared/content/registry.ts";
import { STAMINA_UNITS } from "../../shared/sim/character.ts";
import { applyTuning, deriveRegistry, parseTuning, tuningText, type Tuning } from "../../shared/content/tuning.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { FIXED_TUNING } from "../../tools/simhash.ts";
import { coreRegistry } from "../fixtures/world.ts";

const base = coreRegistry();
const at = (reg: Registry, name: string): number => reg.index.get(`core:${name}`)!;
const def = <T>(reg: Registry, name: string): T => reg.defs[at(reg, name)] as T;
const levels = (reg: Registry): LevelsDef => reg.defs.find((d) => d?.type === "levels") as LevelsDef;

test("a tuning that changes nothing gives the very registry it was given; one that changes something gives another, with the same names at the same places", () => {
  for (const nothing of [{}, { stack: 1, spoil: 1, fuel: 1, nodeHits: 1, stamina: 1 }, { stacks: {}, costs: {}, engrams: {}, staminaOf: {}, autoAll: false, onlyNamed: false, most: 0, tameMost: 0 }] as Tuning[]) {
    expect(tuningText(nothing)).toBe("");
    expect(deriveRegistry(base, nothing)).toBe(base);
  }
  expect([base.baseHash, base.tuning, base.source]).toEqual([base.hash, "", null]);
  const tuned = deriveRegistry(base, { stack: 2 });
  expect(tuned).not.toBe(base);
  expect([tuned.ids, tuned.baseHash, tuned.source === base, tuned.tuning, tuned.hash !== base.hash]).toEqual([base.ids, base.hash, true, '{"stack":2}', true]);
  // Deriving from a tuned registry starts from the base. The same tuning gives the same registry, none gives the base, and another replaces the first.
  expect([deriveRegistry(tuned, { stack: 2 }) === tuned, deriveRegistry(tuned, {}) === base, deriveRegistry(tuned, { stack: 3 }).stack[at(base, "wood")]]).toEqual([true, true, 300]);
  // A tuning's text does not depend on key order, and the registry depends only on the text.
  const a: Tuning = { stack: 2, stacks: { "core:wood": { n: 7 }, "core:thatch": { plain: true, n: 9 } }, spoil: 3 };
  const b: Tuning = { spoil: 3, stacks: { "core:thatch": { n: 9, plain: true }, "core:wood": { n: 7 } }, stack: 2, fuel: 1 };
  expect(tuningText(a)).toBe(tuningText(b));
  expect(deriveRegistry(base, a).hash).toBe(deriveRegistry(base, b).hash);
  expect(deriveRegistry(base, parseTuning(tuningText(FIXED_TUNING))!).hash).toBe(deriveRegistry(base, FIXED_TUNING).hash);
  expect([parseTuning(""), parseTuning("not a tuning"), parseTuning("[1]"), parseTuning("7")]).toEqual([{}, null, null, null]);
});

test("stacks: every stack of more than one by the multiplier, one item by its own number, and what is one to a slot because it wears stays one", () => {
  const reg = deriveRegistry(base, { stack: 3, stacks: { "core:thatch": { n: 543, plain: true }, "core:flint": { n: 70 }, "core:hatchet": { n: 5 }, "core:saddle_parasaur": { n: 4, plain: true }, "core:nothing": { n: 9 } } });
  const stack = (name: string): number => reg.stack[at(reg, name)]!;
  // Wood is multiplied by three. Thatch takes its own number without the multiplier, and flint its own number times the multiplier.
  expect([stack("wood"), stack("thatch"), stack("flint"), stack("arrow_stone")]).toEqual([300, 543, 210, 150]);
  // A tool wears, so it stays one to a slot even if the tuning says otherwise. A saddle does not wear and may stack.
  expect([stack("hatchet"), stack("spear"), stack("saddle_parasaur"), stack("saddle_raptor")]).toEqual([1, 1, 4, 1]);
  expect(def<ItemDef>(reg, "wood").stack).toBe(300);
  // Never past what a slot can count, and never down to one, which would turn a stackable item into a single one.
  expect([deriveRegistry(base, { stack: 100000 }).stack[at(base, "wood")], deriveRegistry(base, { stack: 0.0001 }).stack[at(base, "wood")], deriveRegistry(base, { stacks: { "core:wood": { n: 1, plain: true } } }).stack[at(base, "wood")]]).toEqual([65535, 2, 2]);
});

test("what a thing is made of is what the tuning says, of things there are", () => {
  const reg = deriveRegistry(base, { costs: { "core:hatchet": [{ item: "core:thatch", count: 2.4 }, { item: "core:wood", count: 3 }, { item: "core:unobtainium", count: 1 }, { item: "core:wood", count: 99 }, { item: "core:flint", count: 0 }], "core:pick": [], "core:thatch": [{ item: "core:wood", count: 1 }] } });
  const needs = (r: Registry, name: string) => def<ItemDef>(r, name).craft!.needs;
  // A count becomes a whole number. An unknown item, a repeated item and a count of zero are skipped.
  expect(needs(reg, "hatchet")).toEqual([{ item: "core:thatch", count: 2 }, { item: "core:wood", count: 3 }]);
  expect([...reg.recipeOf[at(reg, "hatchet")]!]).toEqual([at(reg, "thatch"), 2, at(reg, "wood"), 3]);
  // A thing is made of at least one ingredient, so an empty list changes nothing. An item that cannot be made is left alone too.
  expect([needs(reg, "pick"), reg.recipeOf[at(reg, "thatch")]]).toEqual([needs(base, "pick"), null]);
  expect(needs(reg, "spear")).toBe(needs(base, "spear"));
});

test("engrams: a level and a cost of the server's, not offered, learned without asking; all of them so; only those named", () => {
  const engram = (r: Registry, name: string): [number, number, boolean, number | undefined] => {
    const d = def<EngramDef>(r, `engram-${name}`);
    return [d.level, d.cost, d.hidden === true, d.auto];
  };
  expect([engram(base, "hatchet"), engram(base, "pick"), engram(base, "waterskin")]).toEqual([[2, 3, false, undefined], [1, 0, false, undefined], [3, 6, false, undefined]]);
  let reg = deriveRegistry(base, { engrams: { "core:engram-hatchet": { level: 7, cost: 1 }, "core:engram-pick": { hidden: true }, "core:engram-waterskin": { auto: 0 }, "core:engram-nothing": { level: 2 } } });
  expect([engram(reg, "hatchet"), engram(reg, "pick"), engram(reg, "waterskin"), engram(reg, "spear")]).toEqual([[7, 1, false, undefined], [1, 0, true, undefined], [3, 6, false, 0], engram(base, "spear")]);
  reg = deriveRegistry(base, { onlyNamed: true, engrams: { "core:engram-hatchet": {} } });
  expect([engram(reg, "hatchet"), engram(reg, "pick")[2], engram(reg, "spear")[2]]).toEqual([[2, 3, false, undefined], true, true]);
  // With autoAll, every engram is learned at its level, and onlyNamed and per-engram settings are ignored.
  reg = deriveRegistry(base, { autoAll: true, onlyNamed: true, engrams: { "core:engram-hatchet": { level: 50, hidden: true } } });
  expect([engram(reg, "hatchet"), engram(reg, "waterskin"), engram(reg, "spear")[3]]).toEqual([[2, 3, false, 2], [3, 6, false, 3], def<EngramDef>(base, "engram-spear").level]);
});

test("levels: the survivors' table and the tames', the most each may have, and the engram points of each level", () => {
  const was = levels(base);
  expect([was.xp.slice(0, 4), was.most, was.tame]).toEqual([[0, 5, 20, 40], undefined, undefined]);
  // With only the survivors' table set, tames keep the table they had. A level past the content's last gives the last level's engram points.
  let l = levels(deriveRegistry(base, { xp: [0, 10, 30], points: [0, 4] }));
  expect([l.xp, l.engramPoints, l.most, l.tame]).toEqual([[0, 10, 30], [0, 4, was.engramPoints[2]!], undefined, { xp: was.xp }]);
  const tall = Array.from({ length: 150 }, (_, i) => i * 100);
  l = levels(deriveRegistry(base, { xp: tall }));
  expect([l.xp.length, l.engramPoints.length, l.engramPoints[149]]).toEqual([150, 150, was.engramPoints[99]!]);
  l = levels(deriveRegistry(base, { tameXp: [0, 12, 30], most: 99999, tameMost: 25 }));
  expect([l.xp, l.most, l.tame]).toEqual([was.xp, 99999, { xp: [0, 12, 30], most: 25 }]);
  l = levels(deriveRegistry(base, { tameMost: 25 }));
  expect(l.tame).toEqual({ xp: was.xp, most: 25 });
  // A table that does not start at 0 or does not rise is ignored.
  for (const bad of [[5, 10], [0, 10, 10], [0], [0, 5, "x"], "ramp"]) expect(levels(deriveRegistry(base, { xp: bad as number[], stack: 2 }))).toBe(was);
});

test("how fast a body tires, how long things keep and burn, and how much a tree takes", () => {
  const reg = deriveRegistry(base, { stamina: 2, staminaOf: { "core:survivor": 0.5 }, spoil: 3, fuel: 0.5, nodeHits: 2.5 });
  const move = (r: Registry, name: string) => r.move[at(r, name)]!;
  // Survivors use their own multiplier and every other species the general one. Regeneration is unchanged.
  // Costs are whole units per tick, so each is the nearest whole number to the half or the double.
  const cost = (name: string, by: number): number[] => {
    const s = def<SpeciesDef>(base, name).stamina ?? STAMINA_DEFAULT;
    return [Math.round((s.sprint * by * STAMINA_UNITS) / TICK_RATE), Math.round(s.jump * by * STAMINA_UNITS), move(base, name).staminaRegen];
  };
  const costs = (name: string): number[] => [move(reg, name).staminaSprint, move(reg, name).staminaJump, move(reg, name).staminaRegen];
  expect([costs("survivor"), costs("raptor"), costs("parasaur")]).toEqual([cost("survivor", 0.5), cost("raptor", 2), cost("parasaur", 2)]);
  expect([move(reg, "survivor").staminaSprint < move(base, "survivor").staminaSprint, move(reg, "raptor").staminaSprint > move(base, "raptor").staminaSprint, move(reg, "raptor").walkSpeed]).toEqual([true, true, move(base, "raptor").walkSpeed]);
  // Cooked meat keeps two game hours, so six here. Wood burns thirty seconds, so fifteen. An item that does not spoil or burn still does not.
  expect([reg.spoilTicks[at(reg, "meat_cooked")], reg.fuelTicks[at(reg, "wood")], reg.fuelTicks[at(reg, "thatch")], reg.spoilTicks[at(reg, "wood")], reg.fuelTicks[at(reg, "flint")]]).toEqual([6 * GAME_HOUR_TICKS, 15 * TICK_RATE, Math.round(3.75 * TICK_RATE), 0, 0]);
  // A tree takes twelve blows, so thirty here. A bush takes four, so ten.
  expect([reg.nodeHits[at(reg, "tree")], reg.nodeHits[at(reg, "bush")], def<NodeDef>(reg, "rock").hits]).toEqual([30, 10, 25]);
  // The results never reach zero, which would mean keeping for ever, burning for no time or falling to no blow.
  const least = deriveRegistry(base, { spoil: 1e-12, fuel: 1e-12, nodeHits: 1e-12 });
  expect([least.spoilTicks[at(base, "meat_cooked")], least.fuelTicks[at(base, "wood")]! >= 1, least.nodeHits[at(base, "tree")]]).toEqual([1, true, 1]);
});

test("whatever a tuning is, what comes of it compiles: numbers out of range are brought into it and nonsense is passed over", () => {
  const nonsense = [
    '{"stack":"x","stacks":5,"costs":[1],"engrams":{"core:engram-hatchet":7},"xp":[0,5,5],"points":"no","staminaOf":[],"spoil":-3,"fuel":null,"nodeHits":{},"most":"all","autoAll":"yes"}',
    '{"stacks":{"core:wood":null,"core:thatch":{"n":"many"},"__proto__":{"n":5}},"costs":{"core:hatchet":"wood","core:pick":[null,7,{"item":5,"count":1},{"item":"core:wood"}]},"engrams":{"core:engram-pick":null}}',
    '{"unknown":{"deep":[1,2,3]},"tameXp":{"0":0},"points":[-1,"x",null]}',
  ];
  for (const text of nonsense) {
    const reg = deriveRegistry(base, parseTuning(text)!);
    expect(reg.hash).toBe(base.hash);
  }
  const reg = deriveRegistry(base, { stack: 1e300, spoil: 1e300, fuel: 1e300, nodeHits: 1e300, stamina: 1e300, engrams: { "core:engram-hatchet": { level: 1e9, cost: 1e9, auto: 1e9 } }, points: [1e99, 2.5] });
  expect([reg.stack[at(base, "wood")], reg.nodeHits[at(base, "tree")], def<EngramDef>(reg, "engram-hatchet").level, def<EngramDef>(reg, "engram-hatchet").cost, levels(reg).engramPoints.slice(0, 2)]).toEqual([65535, 10000, 1000, 65535, [65535, 3]]);
  // Definitions the tuning leaves alone are the same objects it was given.
  const defs = base.defs.filter((d) => d !== null);
  const out = applyTuning(defs, { stack: 2 });
  expect(out.filter((d, i) => d !== defs[i]).every((d) => d.type === "item" && d.stack > 2)).toBe(true);
  expect(out.length).toBe(defs.length);
});

test("what a species' stats are: where each begins and what a level is worth, for every species or for one in place of that", () => {
  const curve = (r: Registry, species: string, stat: string) => (def<SpeciesDef>(r, species).stats as Record<string, readonly number[]>)[stat]!;
  expect([curve(base, "parasaur", "health"), curve(base, "survivor", "health"), curve(base, "raptor", "melee")]).toEqual([[200, 0.2, 0.054], [100, 0, 0.1], [1, 0.05, 0.017]]);
  const reg = deriveRegistry(base, { gains: { wild: { health: 0.5 }, tamed: { health: 2, melee: 3 } }, gainsOf: { "core:survivor": { base: { health: 2 }, tamed: { weight: 4 } } } });
  const near = (c: readonly number[]): number[] => c.map((v) => Math.round(v * 1e6) / 1e6);
  expect([near(curve(reg, "parasaur", "health")), near(curve(reg, "raptor", "melee")), curve(reg, "raptor", "stamina")]).toEqual([[200, 0.1, 0.108], [1, 0.05, 0.051], curve(base, "raptor", "stamina")]);
  expect([near(curve(reg, "survivor", "health")), near(curve(reg, "survivor", "weight")), curve(reg, "survivor", "melee")]).toEqual([[200, 0, 0.1], [100, 0, 0.4], curve(base, "survivor", "melee")]);
  // Named with empty gains, it still takes none of the general ones.
  const apart = deriveRegistry(base, { gains: { tamed: { health: 2 } }, gainsOf: { "core:survivor": {} } });
  expect([near(curve(apart, "parasaur", "health")), curve(apart, "survivor", "health")]).toEqual([[200, 0.2, 0.108], curve(base, "survivor", "health")]);
  // Empty gains change nothing, nonsense is skipped, and a stat never starts at zero.
  expect(deriveRegistry(base, { gains: { wild: {}, tamed: {} }, gainsOf: {} })).toBe(base);
  expect(deriveRegistry(base, parseTuning('{"gains":{"wild":"x","tamed":{"health":"y","melee":-1,"nostat":2},"base":{"health":0}},"gainsOf":{"core:survivor":7,"core:nothing":{"base":{"health":3}}}}')!).hash).toBe(base.hash);
});
