// The streets' rules and overlay (tools/mapworld/streets, planning/workstreams/streets.md): the shared rules with a city's
// over them, a stretch's type by the first rule that holds and its section by every `set` that does, and the overlay's
// entries checked, matched to stretches by way, point, line and area, and stopping the build where one matches none.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StreetSectors, heldSide, kerbLines, kindsByte, type StreetsPart } from "../../shared/world/streets.ts";
import { kerbSection } from "../../tools/mapworld/bent-walks.ts";
import { holds, sideSection, streetRules, typeOf, type Section } from "../../tools/mapworld/streets/rules.ts";
import { conflictRecord, conflictText, matchOverlay, overlayConflicts, readOverlay, sidesFacing, sortOverlay, type Applied, type OverlayEntry } from "../../tools/mapworld/streets/overlay.ts";
import type { Run, SideFit } from "../../tools/mapworld/streets/fit.ts";
import { ASKED_KERB, ASKED_VERGE, PlannedStreets, planSide } from "../../tools/mapworld/streets/plan.ts";

test("a stretch's type is the first rule's that holds, and its section its type's with each set that holds laid over it", () => {
  const r = streetRules();
  expect(typeOf(r, { class: "motorway", style: "concrete" }).type).toBe("highway");
  expect(typeOf(r, { class: "residential", style: "concrete", built: 0.8, room: 5 })).toMatchObject({ type: "downtown", rule: "downtown core" });
  expect(typeOf(r, { class: "residential", style: "terracotta", built: 0.1 }).type).toBe("residential-rough");
  expect(typeOf(r, { class: "residential", style: "residential", built: 0.1 })).toMatchObject({ type: "residential-tidy", rule: "any other street", sure: 0.3 });
  const tight = sideSection(r, "residential-tidy", { type: "residential-tidy", side: "left", inner: false, room: 2, tagged: null });
  expect(tight.section.verge).toBe("none");
  expect(tight.rules).toEqual(["no room for a verge"]);
  const median = sideSection(r, "boulevard", { type: "boulevard", side: "left", inner: true, room: 3 });
  expect(median.section.walk).toBe("none");
  expect(holds({ room: [0, 3.5], name: "^South" }, { room: 3.5, name: "South River" })).toBe(true);
  expect(holds({ side: "outer" }, { side: "left", inner: false })).toBe(true);
});

test("a city's rules come first, its own types beside the shared, and a shared rule of the same id replaced in its place", () => {
  const r = streetRules({
    types: { "brick-lane": { about: "cobbles", section: { kerb: "raised", verge: "none", walk: "walk", walkWidth: 2 } } },
    rules: [{ id: "old town", when: { district: ["Old Town"] }, type: "brick-lane" }, { id: "downtown core", when: { style: ["concrete"] }, type: "main-street" }],
  });
  expect(r.rules[0]!.id).toBe("old town");
  expect(typeOf(r, { district: "Old Town", class: "residential" }).type).toBe("brick-lane");
  expect(typeOf(r, { class: "residential", style: "concrete", built: 0 }).type).toBe("main-street");
  expect(r.rules.filter((x) => x.id === "downtown core").length).toBe(1);
  // What no stretch could hold is refused, naming the rule.
  expect(() => streetRules({ rules: [{ id: "x", when: { colour: "red" }, type: "alley" }] })).toThrow(/rule "x" reads "colour"/);
  expect(() => streetRules({ rules: [{ id: "y", when: {}, type: "canal" }] })).toThrow(/type "canal"/);
  expect(() => streetRules({ rules: [{ id: "z", when: {}, set: { verge: "lava" as never } }] })).toThrow(/verge to "lava"/);
});

/** A run along x at z, from x0 to x1, of way `way`. */
const run = (way: number, name: string, z: number, x0: number, x1: number): Run => ({
  id: `osm:${way}:0`, run: 0, line: way, way, name, mtfcc: "S1400", highway: "residential", lanes: 2, half: 4, oneway: 0, sidewalk: null, parking: [null, null], maxspeed: null, yielded: null, xz: Float64Array.of(x0, z, x1, z),
});
// Longitude and latitude as the map's metres: a hundred thousand metres a degree, x west.
const toMap = (lon: number, lat: number): [number, number] => [-lon * 1e5, lat * 1e5];

test("the overlay's entries match by way, point, line and area, the most particular last, and one that matches none stops the build", () => {
  const dir = mkdtempSync(join(tmpdir(), "streets-overlay-"));
  try {
    mkdirSync(join(dir, "streets"));
    const runs = [run(11, "Main Street", 100, -200, 0), run(11, "Main Street", 100, 0, 200), run(12, "Side Street", 300, -200, 200)];
    writeFileSync(join(dir, "streets/a.jsonl"), [
      `{"area": [[0.003, 0.0005], [-0.003, 0.0005], [-0.003, 0.0035], [0.003, 0.0035]], "type": "alley", "reason": "an area over both streets"}`,
      `{"way": 11, "name": "Main Street", "type": "main-street", "reason": "the whole way"}`,
      `{"line": [[0.001, 0.003], [-0.001, 0.003]], "side": "n", "set": {"walk": "full"}, "reason": "along the side street, its north side"}`,
      `{"at": [-0.001, 0.0011], "set": {"verge": "dirt"}, "reason": "one stretch by a point"}`,
      "",
    ].join("\n"));
    const entries = readOverlay(dir, ["alley", "main-street"]);
    expect(entries.map((e) => e.key)).toEqual(["area", "way", "line", "at"]);
    const got = matchOverlay(entries, runs, toMap, (r) => r.highway ?? r.mtfcc);
    // Main Street's two stretches: the area, then the way; the point's stretch also the point's.
    expect(got[0]!.map((a) => a.entry.key)).toEqual(["area", "way"]);
    expect(got[1]!.map((a) => a.entry.key)).toEqual(["area", "way", "at"]);
    // The side street: the area, then the line's set on its north side alone, its left: it is drawn toward +x, the west.
    expect(got[2]!.map((a) => a.entry.key)).toEqual(["area", "line"]);
    expect(got[2]![1]!.sides).toEqual([0]);
    // An entry for a street the data has not, or a place with no street near, stops the build with its file and line.
    writeFileSync(join(dir, "streets/b.jsonl"), `{"way": 99, "type": "alley", "reason": "no such way"}\n`);
    expect(() => matchOverlay(readOverlay(dir, ["alley", "main-street"]), runs, toMap, () => "residential")).toThrow(/streets\/b.jsonl:1: matches no stretch/);
    // A bad entry is refused as it is read.
    for (const [line, why] of [
      [`{"way": 11, "type": "alley"}`, /gives its reason/],
      [`{"way": 11, "at": [0, 0], "type": "alley", "reason": "two keys"}`, /one of way, at, line or area/],
      [`{"way": 11, "type": "canal", "reason": "no such type"}`, /none of the street types/],
      [`{"way": 11, "set": {"walk": "wide"}, "reason": "no such walk"}`, /walk to "wide"/],
      [`{"way": 11, "side": "n", "type": "alley", "reason": "a side for a type"}`, /a side is for a set/],
      [`{"way": 11, "colour": "red", "type": "alley", "reason": "an unknown key"}`, /"colour" is no key/],
    ] as const) {
      writeFileSync(join(dir, "streets/b.jsonl"), `${line}\n`);
      expect(() => readOverlay(dir, ["alley", "main-street"])).toThrow(why);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A run along z at x, from z0 to z1, of way `way`. */
const runZ = (way: number, name: string, x: number, z0: number, z1: number): Run => ({ ...run(way, name, 0, 0, 0), xz: Float64Array.of(x, z0, x, z1) });
const TYPES = ["alley", "main-street", "residential-tidy"];
const RUNS = [run(11, "Main Street", 100, -200, 0), run(11, "Main Street", 100, 0, 200), run(12, "Side Street", 300, -200, 200), runZ(13, "Cross Street", -250, 0, 400)];
const MAIN = `[[0.003, 0.0005], [-0.003, 0.0005], [-0.003, 0.0015], [0.003, 0.0015]]`;
const BOTH = `[[0.003, 0.0005], [-0.003, 0.0005], [-0.003, 0.0035], [0.003, 0.0035]]`;

/** A work folder whose streets/ holds `files`, each a name and its lines, for `use` to read; taken away after. */
function withOverlay<T>(files: Record<string, readonly string[]>, use: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "streets-overlay-"));
  try {
    mkdirSync(join(dir, "streets"));
    for (const [name, lines] of Object.entries(files)) writeFileSync(join(dir, "streets", name), lines.map((l) => `${l}\n`).join(""));
    return use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const match = (dir: string) => matchOverlay(readOverlay(dir, TYPES), RUNS, toMap, (r) => r.highway ?? r.mtfcc);
/** What the build makes of a folder's overlay, as plan.ts lays it on: each stretch's type, each side's fields, and the entries in order. */
const built = (dir: string) => match(dir).map((over) => ({
  type: over.filter((a) => a.entry.type).at(-1)?.entry.type ?? null,
  sides: [0, 1].map((s) => Object.assign({}, ...over.filter((a) => a.entry.set && a.sides.includes(s)).map((a) => a.entry.set))),
  entries: over.map((a) => a.entry.text),
}));

test("the overlay builds the same whatever the order of its lines and of its files, and street.ts --sort changes nothing built", () => {
  const lines = [
    `{"area": ${BOTH}, "type": "alley", "reason": "an area over both streets"}`,
    `{"area": ${MAIN}, "set": {"verge": "dirt"}, "reason": "another area, another field"}`,
    `{"way": 11, "type": "main-street", "reason": "the whole way"}`,
    `{"way": 11, "set": {"walk": "full"}, "reason": "the same way, another field"}`,
    `{"way": 11, "type": "residential-tidy", "priority": 1, "reason": "the way again, settled by its priority"}`,
    `{"way": 11, "set": {"walk": "full"}, "reason": "the same field to the same value"}`,
    `{"way": 12, "side": "n", "set": {"walkWidth": 2}, "reason": "its north side"}`,
    `{"at": [-0.001, 0.0011], "set": {"verge": "grass"}, "reason": "one stretch by a point, over the area's verge"}`,
  ];
  const want = withOverlay({ "a.jsonl": lines }, built);
  // Main Street: the priority's type over the way's and the area's; the point's verge over the area's on its stretch.
  expect(want[0]!.type).toBe("residential-tidy");
  expect(want[1]!.sides[0]).toEqual({ verge: "grass", walk: "full" });
  expect(want[2]).toMatchObject({ type: "alley", sides: [{ walkWidth: 2 }, {}] });
  // The lines backwards, and shuffled into two files each way round.
  expect(withOverlay({ "a.jsonl": [...lines].reverse() }, built)).toEqual(want);
  const odd = lines.filter((_, k) => k % 2), even = lines.filter((_, k) => k % 2 === 0);
  expect(withOverlay({ "a.jsonl": odd, "b.jsonl": even }, built)).toEqual(want);
  expect(withOverlay({ "a.jsonl": [...even].reverse(), "b.jsonl": odd }, built)).toEqual(want);
  // Sorted as street.ts --sort sorts a file: the lines move, nothing built does.
  const sorted = sortOverlay([...lines].reverse().join("\n"), "a.jsonl");
  expect(sorted).not.toBe(`${[...lines].reverse().join("\n")}\n`);
  expect(sortOverlay(sorted, "a.jsonl")).toBe(sorted);
  expect(withOverlay({ "a.jsonl": sorted.trimEnd().split("\n") }, built)).toEqual(want);
});

test("two entries as particular and of one priority that set a field to different values stop the build, each named; a priority settles it", () => {
  const alley = `{"way": 11, "type": "alley", "reason": "lanes behind the shops"}`, tidy = `{"way": 11, "type": "residential-tidy", "reason": "houses and lawns"}`;
  // As the review found it: two entries for one way, the type built hanging on which came last. Now it stops, either way round.
  expect(() => withOverlay({ "a.jsonl": [alley], "b.jsonl": [tidy] }, match)).toThrow(/1 conflict in the overlay[^]*type on 2 stretches \(the first osm:11:0, Main Street\): streets\/b.jsonl:1 sets "residential-tidy" and streets\/a.jsonl:1 "alley", both way entries of priority 0; streets\/b.jsonl:1 is later/);
  expect(() => withOverlay({ "a.jsonl": [tidy, alley] }, match)).toThrow(/streets\/a.jsonl:1 sets "residential-tidy" and streets\/a.jsonl:2 "alley"/);
  // Every conflict is named, a field of a side at a time: here the walk's width on Side Street's north side.
  expect(() => withOverlay({ "a.jsonl": [alley, tidy, `{"way": 12, "side": "n", "set": {"walkWidth": 2}, "reason": "north"}`, `{"way": 12, "set": {"walkWidth": 3}, "reason": "both"}`] }, match))
    .toThrow(/2 conflicts[^]*\n {2}type on 2 stretches[^]*\n {2}walkWidth on 1 stretch \(the first osm:12:0, Side Street\): streets\/a.jsonl:3 sets 2 and streets\/a.jsonl:4 3/);
  // No conflict: two sides apart, one value twice, or a more particular entry deciding the field after both.
  withOverlay({ "a.jsonl": [`{"way": 12, "side": "n", "set": {"walkWidth": 2}, "reason": "north"}`, `{"way": 12, "side": "s", "set": {"walkWidth": 3}, "reason": "south"}`] }, match);
  withOverlay({ "a.jsonl": [alley, alley.replace("lanes", "the lanes")] }, match);
  withOverlay({ "a.jsonl": [`{"area": ${MAIN}, "type": "alley", "reason": "one area"}`, `{"area": ${MAIN}, "type": "main-street", "reason": "another"}`, tidy] }, match);
  // A priority settles it: the higher wins in any order, and the report lists it with both lines and the winner.
  const first = alley.replace(`"reason"`, `"priority": 1, "reason"`);
  for (const files of [{ "a.jsonl": [first], "b.jsonl": [tidy] }, { "a.jsonl": [tidy], "b.jsonl": [first] }]) {
    withOverlay(files, (dir) => {
      const got = match(dir);
      expect(got[0]!.filter((a) => a.entry.type).at(-1)!.entry.type).toBe("alley");
      const [c, ...rest] = overlayConflicts(got);
      expect(rest).toEqual([]);
      expect(c).toMatchObject({ field: "type", settled: true, stretches: 2, first: 0 });
      expect(conflictText(c!, RUNS)).toMatch(/sets "alley" and streets\/.\.jsonl:1 "residential-tidy"; streets\/.\.jsonl:1 wins by its priority, 1 to 0/);
      expect(conflictRecord(c!, RUNS)).toMatchObject({ field: "type", winner: { priority: 1, value: "alley" }, other: { priority: 0, value: "residential-tidy" }, settled: true, stretches: 2, first: "osm:11:0" });
    });
  }
  // Two of one stated priority are as unsettled as two of none.
  expect(() => withOverlay({ "a.jsonl": [first, tidy.replace(`"reason"`, `"priority": 1, "reason"`)] }, match)).toThrow(/both way entries of priority 1/);
  expect(() => withOverlay({ "a.jsonl": [`{"way": 11, "type": "alley", "priority": "high", "reason": "a word"}`] }, match)).toThrow(/"priority" is a number/);
});

test("an entry whose side is no side of any stretch it matches stops the build, saying which way each faces", () => {
  // Side Street runs east and west: its sides face north and south.
  expect(() => withOverlay({ "c.jsonl": [`{"way": 12, "side": "e", "set": {"verge": "dirt"}, "reason": "no east side"}`] }, match))
    .toThrow(/streets\/c.jsonl:1: its side "e" is no side of the 1 stretch it matches: osm:12:0 \(Side Street\) faces n and s/);
  expect(() => withOverlay({ "c.jsonl": [`{"way": 11, "side": "w", "type": "alley", "set": {"verge": "dirt"}, "reason": "no west side"}`] }, match)).toThrow(/of the 2 stretches it matches/);
  // Over an area of all three streets it reaches Cross Street's east side alone (its left: it is drawn north), and of
  // the others nothing, but a type it gives too.
  withOverlay({ "c.jsonl": [`{"area": [[0.003, -0.0005], [-0.003, -0.0005], [-0.003, 0.0035], [0.003, 0.0035]], "side": "e", "set": {"verge": "dirt"}, "reason": "east sides"}`] }, (dir) => {
    expect(match(dir).map((over) => over.map((a) => a.sides))).toEqual([[], [], [], [[0]]]);
  });
  withOverlay({ "c.jsonl": [`{"area": [[0.003, -0.0005], [-0.003, -0.0005], [-0.003, 0.0035], [0.003, 0.0035]], "side": "e", "type": "alley", "set": {"verge": "dirt"}, "reason": "east sides"}`] }, (dir) => {
    expect(match(dir).map((over) => over.map((a) => a.sides))).toEqual([[[]], [[]], [[]], [[0]]]);
  });
});

test("a side faces a compass point by its way out, x being west", () => {
  // Drawn toward -x (east): its left is south, its right north.
  const r = run(1, "A", 0, 0, -100);
  expect(sidesFacing(r, "s")).toEqual([0]);
  expect(sidesFacing(r, "n")).toEqual([1]);
  expect(sidesFacing(r, "e")).toEqual([]);
});

/** A side's fit: no building line, the data drawing no walk, unless given. */
const fitSide = (o: Partial<SideFit> = {}): SideFit => ({ room: Infinity, built: 0, green: 0, drawn: null, drawnShare: 0, tagged: null, inner: false, ...o });
/** An overlay entry of downtown.jsonl's line `line` setting `set` on both sides. */
const entry = (set: Section, line = 2): Applied => ({ entry: { file: "downtown.jsonl", line, key: "way", way: 82541900, set, priority: 0, reason: "a test's", text: JSON.stringify(set) } as OverlayEntry, sides: [0, 1] });
/** Side `side` of a stretch of `type` as the build lays it, with `over` over it. */
const laid = (type: string, sf: SideFit, over: Applied[], side = 0, median = 0) => planSide(streetRules(), type, {}, sf, over, side, 1234, 4, median);

test("a value an overlay entry sets is final: the verge a drawn walk would give and the building line do not work it out again", () => {
  // Northwest South River Drive: a 1.5 m verge asked of a residential-tidy street, whose walk is where the data draws
  // it. The verge was worked out again from the drawn walk afterward, 2.5 m on one side and 0.875 m on the other.
  const over = [entry({ vergeWidth: 1.5 })];
  const near = laid("residential-tidy", fitSide({ drawn: 1.6 }), over), far = laid("residential-tidy", fitSide({ drawn: 3.6 }), over, 1);
  expect([near.verge, far.verge]).toEqual([1.5, 1.5]);
  for (const s of [near, far]) expect(s.asked).toEqual({ vergeWidth: { asked: 1.5, at: "downtown.jsonl:2", effect: 1.5 } });
  // Without the entry the drawn walk still sets it, as before.
  expect(laid("residential-tidy", fitSide({ drawn: 3.6 }), [], 1).verge).toBe(2.75);
  // Its other side has 3 m to the building line, where a rule takes the verge away (no room for a verge): the width asked
  // for brings it back, of its type's kind. So does a walk's width a rule took away (a walk tagged absent).
  const tight = laid("residential-tidy", fitSide({ room: 3, drawn: 1.6 }), over);
  expect([tight.section.verge, tight.verge, tight.asked.vergeWidth!.by]).toEqual(["planted", 1.5, undefined]);
  expect(laid("residential-tidy", fitSide({ tagged: "none" }), [entry({ walkWidth: 2 })]).walk).toBe(2);
  // A walk's width asked for stands though the building line is nearer; one worked out gives way to it.
  expect(laid("main-street", fitSide({ room: 2 }), [entry({ walkWidth: 3 })]).walk).toBe(3);
  expect(laid("main-street", fitSide({ room: 2 }), []).walk).toBe(2);
  // A kerb asked for, its wear, a pair's median side's verge.
  const worn = laid("residential-tidy", fitSide(), [entry({ kerb: "worn", wear: 0.9 })]);
  expect([worn.section.kerb, worn.section.wear, worn.asked.kerb!.effect, worn.asked.wear!.effect]).toEqual(["worn", 0.9, "worn", 0.9]);
  const inner = laid("boulevard", fitSide({ inner: true }), [entry({ verge: "gravel", vergeWidth: 2 })], 0, 10);
  expect([inner.section.verge, inner.verge]).toEqual(["gravel", 2]);
});

test("where what is in effect is not what an entry asked, the report says so and why", () => {
  // A walk asked for where the building line leaves no room past the verge asked for.
  const tight = laid("residential-tidy", fitSide({ room: 0.9 }), [entry({ verge: "planted", vergeWidth: 1.5, walk: "walk" })]);
  expect(tight.asked.walk).toEqual({ asked: "walk", at: "downtown.jsonl:2", effect: "none", by: "a walk under 0.6 m is none (0 m: the building line 0.9 m out)" });
  expect(tight.asked.vergeWidth!.by).toBeUndefined();
  // A verge's width asked of a type with no verge; a median asked of a side that faces no pair; a walk where the data
  // draws it, on a side where it draws none; a width a part holds in eighths of a metre.
  const none = laid("downtown", fitSide({ room: 20 }), [entry({ vergeWidth: 1.2, median: "planted", walkAt: "drawn" })]);
  expect(none.asked.vergeWidth).toEqual({ asked: 1.2, at: "downtown.jsonl:2", effect: 0, by: 'no verge: verge "none" by type downtown' });
  expect(none.asked.median).toEqual({ asked: "planted", at: "downtown.jsonl:2", effect: "none", by: "not a pair's median side" });
  expect(none.asked.walkAt).toEqual({ asked: "drawn", at: "downtown.jsonl:2", effect: "kerb", by: "the data draws no walk on this side" });
  expect(laid("residential-tidy", fitSide(), [entry({ vergeWidth: 1.3 })]).asked.vergeWidth).toEqual({ asked: 1.3, at: "downtown.jsonl:2", effect: 1.25, by: "held in eighths of a metre" });
  // Two widths asked for are as asked by the one between them the seed chose.
  expect(laid("residential-tidy", fitSide(), [entry({ vergeWidth: [1, 2] })]).asked.vergeWidth!.by).toBeUndefined();
  // A walk's width asked of a type with no walk is no walk's, and where it comes from is named.
  expect(laid("alley", fitSide(), [entry({ walkWidth: 2 })]).asked.walkWidth).toEqual({ asked: 2, at: "downtown.jsonl:2", effect: 0, by: 'no walk: walk "none" by type alley' });
});

test("the kerbs are laid with the wear their side's section has, a kerb an entry set even on a type laid without them, and a narrow verge an entry set not paved over", () => {
  const types = Object.keys(streetRules().types), raised = heldSide(4, 0, 2, kindsByte(0, 1, 0));
  const part = (type: string, side = raised): StreetsPart => ({ x0: 0, z0: 0, stretches: [{ type: types.indexOf(type), flags: 0, seed: 7, sides: [side, side], xz: Float64Array.of(0, 100, 400, 100) }], corners: [] });
  const lines = (p: StreetsPart, wear: number, asked: number) => {
    const held = new PlannedStreets();
    held.put(0, p, 0, 0, 16, 16);
    held.keep(p, Float64Array.of(wear, wear), Uint8Array.of(asked, asked));
    return kerbLines(held, p).map((k) => kerbSection(k, p, held, streetRules(), new Set(["highway", "alley"])));
  };
  // A planted verge of 0.4 m: paved over by the kerb's walk, as the walk kit did, unless an entry asked for it.
  const narrow = part("residential-tidy", heldSide(4, 0.375, 2, kindsByte(1, 1, 0)));
  expect([lines(narrow, 0.25, 0)[0]!.walk, lines(narrow, 0.25, ASKED_VERGE)[0]!.walk]).toEqual([2.375, 0]);
  // The type's wear was what the placing read, whatever the rules and the overlay set.
  expect(lines(part("residential-tidy"), 0.9, 0).map((s) => s?.wear)).toEqual([0.9, 0.9]);
  const plain = new StreetSectors(), p = part("residential-tidy");
  plain.put(0, p, 0, 0, 16, 16);
  expect(kerbLines(plain, p).map((k) => kerbSection(k, p, plain, streetRules(), new Set())?.wear)).toEqual([0.25, 0.25]);
  // An alley is laid without bent kerbs, but where an entry set its kerb.
  expect(lines(part("alley"), 0.35, 0)).toEqual([null, null]);
  expect(lines(part("alley"), 0.35, ASKED_KERB).map((s) => s?.kerb)).toEqual(["raised", "raised"]);
});
