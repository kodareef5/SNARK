// The streets' rules and overlay (tools/mapworld/streets, planning/workstreams/streets.md): the shared rules with a city's
// over them, a stretch's type by the first rule that holds and its section by every `set` that does, and the overlay's
// entries checked, matched to stretches by way, point, line and area, and stopping the build where one matches none.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holds, sideSection, streetRules, typeOf } from "../../tools/mapworld/streets/rules.ts";
import { matchOverlay, readOverlay, sidesFacing } from "../../tools/mapworld/streets/overlay.ts";
import type { Run } from "../../tools/mapworld/streets/fit.ts";

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
  id: `osm:${way}:0`, run: 0, line: way, way, name, mtfcc: "S1400", highway: "residential", lanes: 2, half: 4, oneway: 0, sidewalk: null, parking: [null, null], maxspeed: null, xz: Float64Array.of(x0, z, x1, z),
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

test("a side faces a compass point by its way out, x being west", () => {
  // Drawn toward -x (east): its left is south, its right north.
  const r = run(1, "A", 0, 0, -100);
  expect(sidesFacing(r, "s")).toEqual([0]);
  expect(sidesFacing(r, "n")).toEqual([1]);
  expect(sidesFacing(r, "e")).toEqual([]);
});
