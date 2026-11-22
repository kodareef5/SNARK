// Colour sets: the colours each region of a species may roll, by weight, and what a species without one still rolls.
import { expect, test } from "bun:test";
import type { Def, SpeciesDef } from "../../shared/content/defs.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import { MUTATION_COLORS, WILD_COLORS, compileContent } from "../../shared/content/registry.ts";
import { deriveRegistry } from "../../shared/content/tuning.ts";
import { Rng } from "../../shared/rng.ts";
import { COLOR_REGIONS, rollWild } from "../../shared/sim/genome.ts";

const PLAIN: SpeciesDef = { type: "species", class: "creature", id: "t:plain", mesh: "box", color: 3, radius: 0.5, height: 1.2, eyeHeight: 1, walkSpeed: 3, sprintMul: 2, jumpSpeed: 5, stats: { health: [100, 0.2, 0.1] } };
const DYED: SpeciesDef = {
  ...PLAIN,
  id: "t:dyed",
  regions: [
    { name: "body", colors: [[20, 3], [21, 1]] },
    null,
    { name: "crest", colors: [[30, 1]] },
    { name: "back", colors: [[31, 0.5], [32, 1.5]] },
    null,
    { name: "belly", colors: [[33, 1], [34, 1], [35, 2]] },
  ],
  mutations: [40, 41],
};

// Through JSON, as a pack on disk arrives. A variant states its own regions and keeps its parent's mutations.
const PALE = { id: "t:pale", extends: "t:dyed", regions: [null, null, null, null, null, { name: "belly", colors: [[50, 1]] }] };
const made = compilePacks([{ name: "t", defs: JSON.parse(JSON.stringify([PLAIN, DYED, PALE])) }]);
const reg = made.registry!;
const kind = (name: string): number => reg.index.get(`t:${name}`)!;

test("a species with no colour set rolls the seven colours it always did, draw for draw", () => {
  expect(made.errors).toEqual([]);
  expect([[...WILD_COLORS], [...MUTATION_COLORS]]).toEqual([[3, 5, 6, 7, 9, 12, 15], [8, 10, 11, 13, 14, 17, 19, 21]]);
  expect(reg.mutationColors[kind("plain")]).toBe(MUTATION_COLORS);
  const seen = new Set<number>();
  for (let seed = 1; seed <= 400; seed++) {
    const [a, b] = [new Rng(seed), new Rng(seed)];
    const was = rollWild(a, 1 + (seed % 150), [3, 5, 6, 7, 9, 12, 15]);
    const now = rollWild(b, 1 + (seed % 150), reg.colorSet[kind("plain")]!);
    // The next number is the same too, so whatever is rolled after a creature is unmoved.
    expect([[...now.wild], [...now.colors], now.female, b.u32()]).toEqual([[...was.wild], [...was.colors], was.female, a.u32()]);
    for (const c of now.colors) seen.add(c);
  }
  expect([...seen].sort((x, y) => x - y)).toEqual([3, 5, 6, 7, 9, 12, 15]);
});

test("each region draws from its own colours by weight, a region with none stays undyed, and every region takes one draw", () => {
  const set = reg.colorSet[kind("dyed")]!;
  const rng = new Rng(11);
  const twin = new Rng(11);
  let body = 0;
  for (let n = 0; n < 4000; n++) {
    // At level 1 no points are spread, so the roll is six draws for the regions and one for its sex.
    const g = rollWild(rng, 1, set);
    const at = Array.from({ length: COLOR_REGIONS }, () => twin.float());
    const want = [at[0]! * 4 < 3 ? 20 : 21, 0, 30, at[3]! * 2 < 0.5 ? 31 : 32, 0, at[5]! * 4 < 1 ? 33 : at[5]! * 4 < 2 ? 34 : 35];
    if (g.colors[0] === 20) body++;
    if (g.colors.join() !== want.join() || g.female !== (twin.int(2) === 0)) throw new Error(`roll ${n}: ${g.colors.join()} is not ${want.join()}`);
  }
  expect(rng.u32()).toBe(twin.u32());
  // Three in four, as its weights of 3 and 1 say.
  expect(Math.abs(body - 3000)).toBeLessThan(120);
  // With points to spread, the points and the sex are what a single list gives: the colours took as many draws.
  const [a, b] = [rollWild(new Rng(5), 150, set), rollWild(new Rng(5), 150, [9])];
  expect([[...a.wild], a.female]).toEqual([[...b.wild], b.female]);
  expect([...a.colors].filter((c, r) => (c === 0) !== (DYED.regions![r] === null))).toEqual([]);
});

test("a variant's regions replace its parent's, its mutations are inherited, and a tuned registry keeps both", () => {
  const pale = rollWild(new Rng(3), 40, reg.colorSet[kind("pale")]!);
  expect([...pale.colors]).toEqual([0, 0, 0, 0, 0, 50]);
  expect([reg.mutationColors[kind("dyed")], reg.mutationColors[kind("pale")]]).toEqual([[40, 41], [40, 41]]);
  const tuned = deriveRegistry(reg, { stamina: 2 });
  expect(tuned).not.toBe(reg);
  expect([tuned.colorSet[kind("dyed")], tuned.mutationColors[kind("dyed")]]).toEqual([reg.colorSet[kind("dyed")]!, [40, 41]]);
  // A colour set is content, so it is part of what client and server must agree on.
  expect(compileContent([PLAIN, { ...DYED, regions: undefined }]).registry!.hash).not.toBe(compileContent([PLAIN, DYED]).registry!.hash);
});

test("a colour set that cannot be rolled is refused, and only a creature has one", () => {
  const bad = (more: Record<string, unknown>): string[] => compileContent([{ ...DYED, ...more } as Def]).errors;
  const region = (colors: unknown, name: unknown = "body"): string[] => bad({ regions: [{ name, colors }, null, null, null, null, null] });
  const REGION = "t:dyed: a region is null, or a name and its colours, each [palette index, weight above 0]";
  expect(bad({ regions: DYED.regions!.slice(0, 5) })).toEqual(["t:dyed: regions must list all 6 colour regions, with null for one that takes no colour"]);
  expect(bad({ regions: [null, null, null, null, null, null] })).toEqual([]);
  expect(region([[20, 1]])).toEqual([]);
  for (const colors of [[], [[256, 1]], [[-1, 1]], [[2.5, 1]], [[20, 0]], [[20, -1]], [[20, Infinity]], [[20, "3"]], [[20]], [20, 21], "20"]) expect([colors, region(colors)]).toEqual([colors, [REGION]]);
  expect([region([[20, 1]], ""), region([[20, 1]], 7), bad({ regions: [7, null, null, null, null, null] })]).toEqual([[REGION], [REGION], [REGION]]);
  for (const mutations of [[], [256], [1.5], ["8"]]) expect([mutations, bad({ mutations })]).toEqual([mutations, ["t:dyed: mutations must be palette indices, and at least one"]]);
  expect(bad({ regions: "all", mutations: 8 })).toEqual(['t:dyed: "regions" must be a list', 't:dyed: "mutations" must be a list']);
  expect(bad({ class: "target", skeleton: "human", still: true })).toEqual(['t:dyed: class species/target may not declare "regions"', 't:dyed: class species/target may not declare "mutations"']);
});
