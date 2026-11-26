// A street the data tags as running through a building: the ground storey opens along it and the storeys above stay.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import { onGround, readPassages, type Passage } from "../../tools/mapworld/passages.ts";
import { clearCirculation } from "../../tools/mapworld/ruin-clearance.ts";
import { Mason, type Frame } from "../../tools/mapworld/ruin-geometry.ts";
import { layout } from "../../tools/mapworld/ruin-layouts.ts";
import type { Rule } from "../../tools/mapworld/ruin-vocabulary.ts";
import type { RuinRecord } from "../../tools/mapworld/ruins.ts";
import type { StaticPiece } from "../../tools/mapworld/statics.ts";

const folder = mkdtempSync(join(tmpdir(), "snark-passage-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const defaults = JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { forms: Record<string, Rule["form"]>; assemblies: Rule["assemblies"] };

/** A block of flats 24 m square and three storeys high round (128, 128), its floor at the ground. */
function flats(): StaticPiece[] {
  const frame: Frame = { x: 128, z: 128, yaw: 0, c: 1, s: 0, width: 24, depth: 24, rings: [[[-12, -12], [12, -12], [12, 12], [-12, 12], [-12, -12]]] };
  const m = new Mason(frame, 0);
  layout(m, { recipe: "apartment", height: 12, finish: "concrete", feature: "frame", holes: 0, wall: 1, bay: 8, matched: [], provisional: true, form: defaults.forms.apartment, formName: "apartment", assemblies: defaults.assemblies }, { seed: 17, playable: 3, detail: 0 });
  return m.pieces;
}
/** The pieces a car driving the passage would be in: a box of theirs holds a point of its width between 0.6 and 1.8 m up. */
function inTheWay(pieces: readonly StaticPiece[], p: Passage): StaticPiece[] {
  const [a, b] = [p.points[0]!, p.points.at(-1)!];
  return pieces.filter((q) => {
    const shape = q.kind.split("_")[1] as RuinShape, [w, h, d] = RUIN_SHAPES[shape];
    if (shape === "flight" || shape === "step" || shape === "landing" || shape.startsWith("ramp")) return false;
    const turn = (q.yaw * Math.PI) / 180, [c, s] = [Math.cos(turn), Math.sin(turn)];
    for (let t = 0; t <= 1; t += 1 / 64) for (let side = -p.width / 2; side <= p.width / 2; side += 0.5) for (const up of [0.6, 1.2, 1.8]) {
      const [dx, dz] = [a.x + (b.x - a.x) * t - q.x, a.z + (b.z - a.z) * t + side - q.z];
      if (Math.abs(dx * c - dz * s) < w / 2 && Math.abs(dx * s + dz * c) < d / 2 && Math.abs(up - q.y) < h / 2) return true;
    }
    return false;
  });
}
const whole = (pieces: readonly StaticPiece[]): RuinRecord[] => [{ firstPiece: 0, blocks: pieces.length, approaches: [], escapes: [], routes: [], rooms: [] }] as unknown as RuinRecord[];

test("a street through a building opens its ground storey along it; the storeys above stay", () => {
  // West to east through the middle of the block, 6 m wide.
  const passage: Passage = { points: [{ x: 108, y: 0, z: 128 }, { x: 148, y: 0, z: 128 }], width: 6 };
  const pieces = flats(), above = pieces.filter((p) => p.y > 4.5).length;
  expect(inTheWay(pieces, passage).length).toBeGreaterThan(1);
  const plain = flats();
  clearCirculation(plain, whole(plain), 0);
  expect(inTheWay(plain, passage).length).toBeGreaterThan(1);
  const cleared = clearCirculation(pieces, whole(pieces), 0, [], [], [passage]);
  expect(Object.keys(cleared).length).toBeGreaterThan(0);
  expect(inTheWay(pieces, passage)).toEqual([]);
  expect(pieces.filter((p) => p.y > 4.5).length).toBe(above);
});

test("the passages are the road data's tagged streets, at the ground, a point every 4 m", () => {
  mkdirSync(join(folder, "base"), { recursive: true });
  const line = (passage: boolean | undefined, bridge: boolean, n: number) => ({ geometry: { type: "LineString", coordinates: [[0, n], [10, n], [10, n + 3]] }, properties: { id: `osm:${n}:0`, width_m: 5, bridge, ...(passage === undefined ? {} : { passage }) } });
  writeFileSync(join(folder, "base/roads.geojson"), JSON.stringify({ features: [line(true, false, 0), line(false, false, 20), line(undefined, false, 40), line(true, true, 60)] }));
  const read = readPassages({ source: folder, toLattice: (e, n) => [e, n], groundAt: () => 0 });
  expect(read.map((p) => [p.width, p.points.map((q) => `${q.x.toFixed(2)},${q.z}`).join(" ")])).toEqual([[5, "0.00,0 3.33,0 6.67,0 10.00,0 10.00,3"]]);
  expect(onGround(read, (x) => x / 10)[0]!.points.map((q) => q.y.toFixed(3))).toEqual(["0.000", "0.333", "0.667", "1.000", "1.000"]);
  expect(readPassages({ source: join(folder, "none"), toLattice: (e, n) => [e, n], groundAt: () => 0 })).toEqual([]);
});
