// Where a lobby building's ways in are marked (tools/mapworld/ruin-layouts.ts): at its doors, and nowhere else.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Mason, type Frame } from "../../tools/mapworld/ruin-geometry.ts";
import { layout } from "../../tools/mapworld/ruin-layouts.ts";
import type { Rule } from "../../tools/mapworld/ruin-vocabulary.ts";

const defaults = JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { forms: Record<string, Rule["form"]>; assemblies: Rule["assemblies"] };
const frame = (width: number, depth: number): Frame => ({ x: 128, z: 128, yaw: 0, c: 1, s: 0, width, depth, rings: [[[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2], [-width / 2, -depth / 2]]] });
/** A block of flats with a lobby, laid out whole: its ground-storey canopies, its lobby's wall modules, and its doors. */
function flats(width: number, depth: number, seed: number): { canopies: { x: number; z: number }[]; doors: { x: number; z: number }[]; walls: { x: number; z: number }[] } {
  const m = new Mason(frame(width, depth), 0);
  const rule: Rule = { recipe: "apartment", height: 12, finish: "concrete", feature: "frame", holes: 0, wall: 1, bay: 8, matched: [], provisional: true, form: defaults.forms.apartment, formName: "apartment", assemblies: defaults.assemblies };
  layout(m, rule, { seed, playable: 3, detail: 0 });
  return { canopies: m.pieces.filter((p) => p.kind.includes("_zentry_") && p.y < 4), doors: m.entries, walls: m.pieces.filter((p) => p.kind.includes("_zlobby_") && p.y < 4) };
}

test("a lobby building's canopies hang at its doors alone", () => {
  for (const [width, depth, seed] of [[16, 16, 5], [16, 32, 9], [24, 24, 17]] as const) {
    const b = flats(width, depth, seed);
    expect(b.doors.length).toBeGreaterThan(0);
    const far = b.canopies.filter((c) => b.doors.every((d) => Math.hypot(d.x - c.x, d.z - c.z) > 2));
    expect([width, depth, far.length]).toEqual([width, depth, 0]);
    expect(b.canopies.length).toBeGreaterThan(0);
  }
});

test("the side of an entry lane's tile is walled as any other bay is", () => {
  // Two tiles by two: the lane is one column, so each of its tiles has a side on the street.
  const b = flats(16, 16, 5);
  expect(b.doors.map((d) => [d.x, d.z])).toEqual([[124, 120], [124, 136]]);
  expect(b.canopies.filter((c) => Math.abs(c.x - 128) > 8.5)).toEqual([]);
  // The lane's west face, 4 m either side of the middle, wears the lobby's wall module.
  expect(b.walls.filter((w) => Math.abs(w.x - 120) < 0.1).map((w) => Math.round(w.z)).sort()).toEqual([124, 132]);
});
